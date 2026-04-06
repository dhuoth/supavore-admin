import { type RestaurantHoursSyncStatus } from '@/lib/restaurantHoursSync';

export type RestaurantHoursBackfillItem = {
  restaurantId: string;
  name: string | null;
  status: RestaurantHoursSyncStatus;
  message: string;
  manualLockSkipped: boolean;
};

export type RestaurantHoursBackfillResult = {
  attempted: number;
  succeeded: number;
  failed: number;
  hasMore: boolean;
  nextOffset: number | null;
  results: RestaurantHoursBackfillItem[];
};

export async function backfillRestaurantHours(params?: {
  restaurantIds?: string[];
  limit?: number;
  force?: boolean;
}) {
  const accumulatedResults: RestaurantHoursBackfillItem[] = [];
  let attempted = 0;
  let succeeded = 0;
  let failed = 0;
  let offset = 0;
  const limit = params?.limit ?? 25;

  while (true) {
    const response = await fetch('/api/restaurants/backfill-hours', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        restaurantIds: params?.restaurantIds,
        limit,
        offset,
        force: params?.force ?? false,
      }),
    });

    const payload = (await response.json()) as
      | RestaurantHoursBackfillResult
      | {
          error?: string;
        };

    if (!response.ok) {
      throw new Error(
        'error' in payload && payload.error
          ? payload.error
          : 'Unable to backfill restaurant operating hours right now.'
      );
    }

    const result = payload as RestaurantHoursBackfillResult;

    attempted += result.attempted;
    succeeded += result.succeeded;
    failed += result.failed;
    accumulatedResults.push(...result.results);

    if (!result.hasMore || result.nextOffset === null) {
      return {
        attempted,
        succeeded,
        failed,
        hasMore: false,
        nextOffset: null,
        results: accumulatedResults,
      } satisfies RestaurantHoursBackfillResult;
    }

    offset = result.nextOffset;
  }
}
