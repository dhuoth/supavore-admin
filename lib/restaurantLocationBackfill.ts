export type RestaurantLocationBackfillStatus =
  | 'updated'
  | 'missing_input'
  | 'geocode_failed'
  | 'update_noop'
  | 'update_error'
  | 'verification_failed';

export type RestaurantLocationBackfillItem = {
  restaurantId: string;
  name: string | null;
  status: RestaurantLocationBackfillStatus;
  message: string;
  latitude: number | null;
  longitude: number | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
};

export type RestaurantLocationBackfillResult = {
  attempted: number;
  succeeded: number;
  failed: number;
  results: RestaurantLocationBackfillItem[];
};

export async function backfillRestaurantLocations(restaurantIds?: string[]) {
  const response = await fetch('/api/restaurants/backfill-locations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(restaurantIds?.length ? { restaurantIds } : {}),
  });

  const payload = (await response.json()) as
    | RestaurantLocationBackfillResult
    | {
        error?: string;
      };

  if (!response.ok) {
    throw new Error(
      'error' in payload && payload.error
        ? payload.error
        : 'Unable to backfill restaurant locations right now.'
    );
  }

  return payload as RestaurantLocationBackfillResult;
}
