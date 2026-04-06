import 'server-only';

import {
  type GeocodeLocationResult,
  normalizeRestaurantLocationInput,
  type RestaurantLocationInput,
} from '@/lib/restaurantLocation';
import { getGoogleServerApiKey } from '@/lib/googleApiKey';

type GoogleGeocodingResponse = {
  results?: Array<{
    address_components?: Array<{
      long_name: string;
      short_name: string;
      types: string[];
    }>;
    geometry?: {
      location?: {
        lat: number;
        lng: number;
      };
    };
  }>;
  status?: string;
  error_message?: string;
};

function buildGeocodingQuery(input: RestaurantLocationInput) {
  const location = normalizeRestaurantLocationInput(input);
  const { address, city, region, postalCode } = location;

  const looksLikeFullAddress =
    Boolean(address) &&
    (address!.includes(',') ||
      /\d/.test(address!) ||
      Boolean(postalCode) ||
      (Boolean(city) && Boolean(region)));

  if (address && looksLikeFullAddress) {
    return address;
  }

  const compositeAddress = [address, city, region, postalCode].filter(Boolean).join(', ');

  if (compositeAddress) {
    return compositeAddress;
  }

  if (postalCode) {
    return postalCode;
  }

  return null;
}

function getAddressComponent(
  components: NonNullable<GoogleGeocodingResponse['results']>[number]['address_components'],
  type: string
) {
  return components?.find((component) => component.types.includes(type)) ?? null;
}

export async function geocodeRestaurantLocation(
  input: RestaurantLocationInput
): Promise<GeocodeLocationResult> {
  const apiKey = getGoogleServerApiKey();

  if (!apiKey) {
    return {
      ok: false,
      warning: 'Restaurant location saved without geocoding because the Google geocoding key is not configured.',
    };
  }

  const query = buildGeocodingQuery(input);

  if (!query) {
    return {
      ok: false,
      warning: 'Restaurant location saved without geocoding because no address or postal code was provided.',
    };
  }

  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(query)}&key=${encodeURIComponent(apiKey)}`,
      {
        method: 'GET',
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      return {
        ok: false,
        warning: `Restaurant location saved, but geocoding failed with HTTP ${response.status}.`,
      };
    }

    const payload = (await response.json()) as GoogleGeocodingResponse;

    if (payload.status !== 'OK' || !payload.results?.length) {
      return {
        ok: false,
        warning:
          payload.status === 'ZERO_RESULTS'
            ? 'Restaurant location saved, but no matching coordinates were found.'
            : `Restaurant location saved, but geocoding failed${payload.error_message ? `: ${payload.error_message}` : '.'}`,
      };
    }

    const firstResult = payload.results[0];
    const location = firstResult.geometry?.location;

    if (!location) {
      return {
        ok: false,
        warning: 'Restaurant location saved, but geocoding returned no coordinates.',
      };
    }

    const cityComponent =
      getAddressComponent(firstResult.address_components, 'locality') ??
      getAddressComponent(firstResult.address_components, 'postal_town') ??
      getAddressComponent(firstResult.address_components, 'administrative_area_level_2');
    const regionComponent = getAddressComponent(
      firstResult.address_components,
      'administrative_area_level_1'
    );
    const postalCodeComponent = getAddressComponent(firstResult.address_components, 'postal_code');

    return {
      ok: true,
      data: {
        latitude: location.lat,
        longitude: location.lng,
        city: cityComponent?.long_name ?? null,
        region: regionComponent?.short_name ?? null,
        postalCode: postalCodeComponent?.long_name ?? null,
      },
    };
  } catch {
    return {
      ok: false,
      warning: 'Restaurant location saved, but geocoding could not be completed right now.',
    };
  }
}
