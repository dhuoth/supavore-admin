import 'server-only';

import { geocodeRestaurantLocation } from '@/lib/geocoding';
import {
  type GeocodedRestaurantLocation,
  type GeocodeLocationResult,
  mergeRestaurantLocation,
  restaurantLocationHasMeaningfulInput,
} from '@/lib/restaurantLocation';
import {
  type RestaurantLocationBackfillItem,
  type RestaurantLocationBackfillResult,
} from '@/lib/restaurantLocationBackfill';
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin';

type RestaurantBackfillCandidate = {
  id: string;
  name: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
};

type RestaurantLocationWritePayload = {
  city: string | null;
  region: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
};

type BackfillDependencies = {
  listCandidates: (restaurantIds?: string[]) => Promise<RestaurantBackfillCandidate[]>;
  geocode: (input: {
    address: string | null;
    city: string | null;
    region: string | null;
    postalCode: string | null;
  }) => Promise<GeocodeLocationResult>;
  updateRestaurantLocation: (
    restaurantId: string,
    payload: RestaurantLocationWritePayload
  ) => Promise<string | null>;
  getRestaurantById: (restaurantId: string) => Promise<RestaurantBackfillCandidate | null>;
};

function toResultItem(
  restaurant: RestaurantBackfillCandidate,
  params: {
    status: RestaurantLocationBackfillItem['status'];
    message: string;
    persisted?: RestaurantBackfillCandidate | null;
  }
): RestaurantLocationBackfillItem {
  const source = params.persisted ?? restaurant;

  return {
    restaurantId: restaurant.id,
    name: restaurant.name,
    status: params.status,
    message: params.message,
    latitude: source.latitude,
    longitude: source.longitude,
    city: source.city,
    region: source.region,
    postal_code: source.postal_code,
  };
}

function buildLocationWritePayload(
  restaurant: RestaurantBackfillCandidate,
  geocodedLocation: GeocodedRestaurantLocation
): RestaurantLocationWritePayload {
  const mergedLocation = mergeRestaurantLocation(
    {
      address: restaurant.address,
      city: restaurant.city,
      region: restaurant.region,
      postalCode: restaurant.postal_code,
    },
    geocodedLocation
  );

  return {
    city: mergedLocation.city,
    region: mergedLocation.region,
    postal_code: mergedLocation.postal_code,
    latitude: mergedLocation.latitude,
    longitude: mergedLocation.longitude,
  };
}

function persistedLocationMatches(
  restaurant: RestaurantBackfillCandidate | null,
  payload: RestaurantLocationWritePayload
) {
  if (!restaurant) {
    return false;
  }

  return (
    restaurant.latitude === payload.latitude &&
    restaurant.longitude === payload.longitude &&
    restaurant.city === payload.city &&
    restaurant.region === payload.region &&
    restaurant.postal_code === payload.postal_code
  );
}

function locationPayloadChanged(
  previous: RestaurantBackfillCandidate,
  next: RestaurantLocationWritePayload
) {
  return !persistedLocationMatches(previous, next);
}

function createServerBackfillDependencies(): BackfillDependencies {
  const supabaseAdmin = createSupabaseAdminClient();

  return {
    async listCandidates(restaurantIds) {
      let query = supabaseAdmin
        .from('restaurants')
        .select('id, name, address, city, region, postal_code, latitude, longitude')
        .or('latitude.is.null,longitude.is.null');

      if (restaurantIds?.length) {
        query = query.in('id', restaurantIds);
      }

      const { data, error } = await query;

      if (error) {
        throw error;
      }

      return (data as RestaurantBackfillCandidate[] | null) ?? [];
    },
    async geocode(input) {
      return geocodeRestaurantLocation(input);
    },
    async updateRestaurantLocation(restaurantId, payload) {
      const { error } = await supabaseAdmin
        .from('restaurants')
        .update(payload)
        .eq('id', restaurantId);

      return error?.message ?? null;
    },
    async getRestaurantById(restaurantId) {
      const { data, error } = await supabaseAdmin
        .from('restaurants')
        .select('id, name, address, city, region, postal_code, latitude, longitude')
        .eq('id', restaurantId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return (data as RestaurantBackfillCandidate | null) ?? null;
    },
  };
}

export async function backfillRestaurantLocationsOnServer(
  restaurantIds?: string[],
  dependencies: BackfillDependencies = createServerBackfillDependencies()
): Promise<RestaurantLocationBackfillResult> {
  if (!process.env.GOOGLE_MAPS_GEOCODING_API_KEY) {
    throw new Error('Missing GOOGLE_MAPS_GEOCODING_API_KEY for restaurant location backfill.');
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY for restaurant location backfill.');
  }

  const restaurants = await dependencies.listCandidates(restaurantIds);
  const results: RestaurantLocationBackfillItem[] = [];

  for (const restaurant of restaurants) {
    const locationInput = {
      address: restaurant.address,
      city: restaurant.city,
      region: restaurant.region,
      postalCode: restaurant.postal_code,
    };

    if (!restaurantLocationHasMeaningfulInput(locationInput)) {
      results.push(
        toResultItem(restaurant, {
          status: 'missing_input',
          message: 'Cannot geocode without an address, city/region, or postal code.',
        })
      );
      continue;
    }

    const geocodeResult = await dependencies.geocode(locationInput);

    if (!geocodeResult.ok) {
      results.push(
        toResultItem(restaurant, {
          status: 'geocode_failed',
          message: geocodeResult.warning,
        })
      );
      continue;
    }

    const updatePayload = buildLocationWritePayload(restaurant, geocodeResult.data);
    const updateError = await dependencies.updateRestaurantLocation(restaurant.id, updatePayload);

    if (updateError) {
      const persisted = await dependencies.getRestaurantById(restaurant.id);

      results.push(
        toResultItem(restaurant, {
          status: 'update_error',
          message: updateError,
          persisted,
        })
      );
      continue;
    }

    const persisted = await dependencies.getRestaurantById(restaurant.id);

    if (!persisted) {
      results.push(
        toResultItem(restaurant, {
          status: 'verification_failed',
          message: 'Restaurant row could not be reloaded after the update.',
        })
      );
      continue;
    }

    if (!persistedLocationMatches(persisted, updatePayload)) {
      results.push(
        toResultItem(restaurant, {
          status: locationPayloadChanged(restaurant, updatePayload)
            ? 'verification_failed'
            : 'update_noop',
          message: locationPayloadChanged(restaurant, updatePayload)
            ? 'Location update did not persist the expected latitude, longitude, city, region, and postal code.'
            : 'Update completed without changing the persisted location fields.',
          persisted,
        })
      );
      continue;
    }

    results.push(
      toResultItem(restaurant, {
        status: 'updated',
        message: 'Restaurant location updated and verified.',
        persisted,
      })
    );
  }

  return {
    attempted: restaurants.length,
    succeeded: results.filter((result) => result.status === 'updated').length,
    failed: results.filter((result) => result.status !== 'updated').length,
    results,
  };
}
