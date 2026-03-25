import { normalizeOptionalText, toTitleCase } from '@/lib/menuNormalization';

export type RestaurantLocationInput = {
  address?: string | null;
  city?: string | null;
  region?: string | null;
  postalCode?: string | null;
};

export type GeocodedRestaurantLocation = {
  latitude: number;
  longitude: number;
  city: string | null;
  region: string | null;
  postalCode: string | null;
};

export type GeocodeLocationResult =
  | {
      ok: true;
      data: GeocodedRestaurantLocation;
      warning?: string;
    }
  | {
      ok: false;
      warning: string;
    };

export function normalizeRestaurantLocationInput<T extends RestaurantLocationInput>(input: T) {
  return {
    ...input,
    address: normalizeOptionalText(input.address),
    city: normalizeOptionalText(toTitleCase(input.city)),
    region: normalizeOptionalText(input.region)?.toUpperCase() ?? null,
    postalCode: normalizeOptionalText(input.postalCode)?.toUpperCase() ?? null,
  };
}

export function mergeRestaurantLocation(
  location: RestaurantLocationInput,
  geocodedLocation?: GeocodedRestaurantLocation | null
) {
  const normalizedLocation = normalizeRestaurantLocationInput(location);

  return {
    address: normalizedLocation.address,
    city: geocodedLocation?.city ?? normalizedLocation.city,
    region: geocodedLocation?.region ?? normalizedLocation.region,
    postal_code: geocodedLocation?.postalCode ?? normalizedLocation.postalCode,
    latitude: geocodedLocation?.latitude ?? null,
    longitude: geocodedLocation?.longitude ?? null,
  };
}

export function restaurantLocationHasMeaningfulInput(location: RestaurantLocationInput) {
  const normalizedLocation = normalizeRestaurantLocationInput(location);

  return Boolean(
    normalizedLocation.address ||
      normalizedLocation.city ||
      normalizedLocation.region ||
      normalizedLocation.postalCode
  );
}

export function restaurantLocationChanged(
  previousLocation: RestaurantLocationInput,
  nextLocation: RestaurantLocationInput
) {
  const previous = normalizeRestaurantLocationInput(previousLocation);
  const next = normalizeRestaurantLocationInput(nextLocation);

  return (
    previous.address !== next.address ||
    previous.city !== next.city ||
    previous.region !== next.region ||
    previous.postalCode !== next.postalCode
  );
}
