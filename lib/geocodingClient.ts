import {
  type GeocodeLocationResult,
  normalizeRestaurantLocationInput,
  restaurantLocationHasMeaningfulInput,
  type RestaurantLocationInput,
} from '@/lib/restaurantLocation';

export async function geocodeRestaurantLocationViaApi(
  input: RestaurantLocationInput
): Promise<GeocodeLocationResult> {
  if (!restaurantLocationHasMeaningfulInput(input)) {
    return {
      ok: false,
      warning: 'Restaurant location saved without geocoding because no address or postal code was provided.',
    };
  }

  try {
    const response = await fetch('/api/geocode', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(normalizeRestaurantLocationInput(input)),
    });

    const payload = (await response.json()) as GeocodeLocationResult;

    if (!response.ok) {
      return {
        ok: false,
        warning: 'Restaurant location saved, but geocoding could not be completed right now.',
      };
    }

    return payload;
  } catch {
    return {
      ok: false,
      warning: 'Restaurant location saved, but geocoding could not be completed right now.',
    };
  }
}
