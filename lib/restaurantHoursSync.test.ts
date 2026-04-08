import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  getRestaurantHoursForAdmin,
  persistRestaurantHoursResult,
  syncRestaurantHoursFromGoogle,
  updateRestaurantHoursManually,
} from '@/lib/restaurantHoursSync';

type RestaurantRecord = {
  id: string;
  name: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  google_place_id: string | null;
  hours_source: string | null;
  hours_last_synced_at: string | null;
  hours_sync_status: string | null;
  hours_match_confidence: number | null;
  hours_notes: string | null;
  timezone: string | null;
  place_name_from_source: string | null;
  hours_is_manually_managed: boolean;
};

type StoredRow = {
  id: string;
  restaurant_id: string;
  day_of_week: number;
  open_time_local: string | null;
  close_time_local: string | null;
  is_closed: boolean;
  window_index: number;
  source: string | null;
};

type PendingReview = {
  id: string;
  summary: string | null;
  confidence: number | null;
  review_payload: Record<string, unknown>;
} | null;

const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function createDependencies(options?: {
  restaurant?: Partial<RestaurantRecord>;
  hours?: StoredRow[];
  enrichResult?: {
    ok: boolean;
    status:
      | 'matched_with_hours'
      | 'matched_no_hours'
      | 'review_required_match'
      | 'no_match'
      | 'low_confidence_match'
      | 'api_error';
    placeId?: string;
    source?: 'google_places_new';
    matchedDisplayName?: string;
    timezone?: string | null;
    matchConfidence?: number | null;
    hours?: Array<{
      dayOfWeek: number;
      openTimeLocal: string | null;
      closeTimeLocal: string | null;
      isClosed: boolean;
      windowIndex: number;
      source: 'google_places_new';
    }>;
    scoreBreakdown?: {
      rawNameScore: number | null;
      normalizedNameScore: number | null;
      effectiveNameScore: number | null;
      addressScore: number | null;
      distanceScore: number | null;
    };
    candidateFormattedAddress?: string | null;
    candidateLatitude?: number | null;
    candidateLongitude?: number | null;
    note?: string;
  };
}) {
  const restaurant: RestaurantRecord = {
    id: 'restaurant-1',
    name: 'Tasty Noodles',
    address: '123 Main St',
    latitude: 34.05,
    longitude: -118.25,
    google_place_id: null,
    hours_source: null,
    hours_last_synced_at: null,
    hours_sync_status: null,
    hours_match_confidence: null,
    hours_notes: null,
    timezone: null,
    place_name_from_source: null,
    hours_is_manually_managed: false,
    ...options?.restaurant,
  };
  let storedHours =
    options?.hours?.map((row) => ({ ...row })) ??
    [
      {
        id: 'row-1',
        restaurant_id: restaurant.id,
        day_of_week: 0,
        open_time_local: null,
        close_time_local: null,
        is_closed: true,
        window_index: 1,
        source: 'google_places_new',
      },
    ];
  let rowCounter = storedHours.length + 1;
  let pendingReview: PendingReview = null;

  return {
    state: {
      restaurant,
      get hours() {
        return storedHours;
      },
      get pendingReview() {
        return pendingReview;
      },
      set pendingReview(value: PendingReview) {
        pendingReview = value;
      },
    },
    dependencies: {
      async enrichHours() {
        return (
          options?.enrichResult ?? {
            ok: true as const,
            status: 'matched_with_hours' as const,
            placeId: 'place-123',
            source: 'google_places_new' as const,
            matchedDisplayName: 'Tasty Noodles',
            timezone: 'UTC-07:00',
            matchConfidence: 0.97,
            hours: [
              {
                dayOfWeek: 1,
                openTimeLocal: '11:00:00',
                closeTimeLocal: '20:00:00',
                isClosed: false,
                windowIndex: 0,
                source: 'google_places_new',
              },
              {
                dayOfWeek: 2,
                openTimeLocal: null,
                closeTimeLocal: null,
                isClosed: true,
                windowIndex: 0,
                source: 'google_places_new',
              },
            ],
          }
        );
      },
      async getRestaurantById() {
        return { ...restaurant };
      },
      async listRestaurantHours() {
        return storedHours.map((row) => ({ ...row }));
      },
      async getPendingReview() {
        return pendingReview ? { ...pendingReview } : null;
      },
      async upsertReviewForResult(currentRestaurant: RestaurantRecord, result) {
        if (
          result.status !== 'review_required_match' &&
          result.status !== 'low_confidence_match'
        ) {
          return null;
        }

        pendingReview = {
          id: 'review-1',
          summary: result.note ?? null,
          confidence: result.matchConfidence ?? null,
          review_payload: {
            restaurantName: currentRestaurant.name,
            restaurantAddress: currentRestaurant.address,
            placeId: result.placeId ?? null,
            matchedDisplayName: result.matchedDisplayName ?? null,
            candidateFormattedAddress: result.candidateFormattedAddress ?? null,
            candidateLatitude: result.candidateLatitude ?? null,
            candidateLongitude: result.candidateLongitude ?? null,
            scoreBreakdown: result.scoreBreakdown ?? null,
          },
        };

        return null;
      },
      async clearHoursReview() {
        pendingReview = null;
        return null;
      },
      async upsertRestaurantHours(rows: Array<Omit<StoredRow, 'id'>>) {
        for (const row of rows) {
          const existingIndex = storedHours.findIndex(
            (candidate) =>
              candidate.restaurant_id === row.restaurant_id &&
              candidate.day_of_week === row.day_of_week &&
              candidate.window_index === row.window_index
          );

          if (existingIndex >= 0) {
            storedHours[existingIndex] = {
              ...storedHours[existingIndex],
              ...row,
            };
          } else {
            storedHours.push({
              id: `row-${rowCounter++}`,
              ...row,
            });
          }
        }

        return null;
      },
      async deleteRestaurantHours(rowIds: string[]) {
        storedHours = storedHours.filter((row) => !rowIds.includes(row.id));
        return null;
      },
      async updateRestaurantMetadata(_restaurantId: string, payload: Partial<RestaurantRecord>) {
        Object.assign(restaurant, payload);
        return null;
      },
    },
  };
}

beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
});

afterEach(() => {
  if (originalServiceRoleKey === undefined) {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  } else {
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
  }
});

test('persistRestaurantHoursResult writes metadata and replaces rows for matched_with_hours', async () => {
  const { dependencies, state } = createDependencies({
    hours: [
      {
        id: 'stale-row',
        restaurant_id: 'restaurant-1',
        day_of_week: 5,
        open_time_local: '09:00:00',
        close_time_local: '18:00:00',
        is_closed: false,
        window_index: 1,
        source: 'google_places_new',
      },
    ],
  });

  const result = await persistRestaurantHoursResult(
    {
      restaurantId: 'restaurant-1',
      result: {
        ok: true,
        status: 'matched_with_hours',
        placeId: 'place-123',
        source: 'google_places_new',
        matchedDisplayName: 'Tasty Noodles',
        timezone: 'UTC-07:00',
        matchConfidence: 0.97,
        hours: [
          {
            dayOfWeek: 1,
            openTimeLocal: '11:00:00',
            closeTimeLocal: '20:00:00',
            isClosed: false,
            windowIndex: 0,
            source: 'google_places_new',
          },
        ],
      },
    },
    dependencies
  );

  assert.equal(result.status, 'matched_with_hours');
  assert.equal(result.rowsReplaced, true);
  assert.equal(state.restaurant.google_place_id, 'place-123');
  assert.equal(state.restaurant.hours_source, 'google_places_new');
  assert.equal(state.hours.length, 1);
  assert.equal(state.hours[0]?.day_of_week, 1);
  assert.equal(state.hours[0]?.window_index, 1);
});

test('persistRestaurantHoursResult preserves existing rows for matched_no_hours', async () => {
  const { dependencies, state } = createDependencies({
    restaurant: {
      hours_source: 'admin_manual',
      hours_is_manually_managed: true,
    },
    enrichResult: {
      ok: false,
      status: 'matched_no_hours',
      placeId: 'place-123',
      source: 'google_places_new',
      matchedDisplayName: 'Tasty Noodles',
      timezone: null,
      matchConfidence: 0.91,
      note: 'No weekly hours.',
    },
  });

  const beforeHours = state.hours.map((row) => ({ ...row }));
  const result = await persistRestaurantHoursResult(
    {
      restaurantId: 'restaurant-1',
      result: await dependencies.enrichHours({
        restaurantName: 'Tasty Noodles',
        address: '123 Main St',
      }),
    },
    dependencies
  );

  assert.equal(result.status, 'matched_no_hours');
  assert.equal(result.rowsReplaced, false);
  assert.deepEqual(state.hours, beforeHours);
  assert.equal(state.restaurant.hours_source, 'admin_manual');
});

test('persistRestaurantHoursResult queues review_required_match without replacing rows', async () => {
  const { dependencies, state } = createDependencies();
  const beforeHours = state.hours.map((row) => ({ ...row }));

  const result = await persistRestaurantHoursResult(
    {
      restaurantId: 'restaurant-1',
      result: {
        ok: false,
        status: 'review_required_match',
        placeId: 'place-review',
        source: 'google_places_new',
        matchedDisplayName: "Bludso's BBQ",
        matchConfidence: 0.68,
        note: 'Needs admin review.',
      },
    },
    dependencies
  );

  assert.equal(result.status, 'review_required_match');
  assert.deepEqual(state.hours, beforeHours);
  assert.equal(state.pendingReview?.id, 'review-1');
});

test('persistRestaurantHoursResult queues low_confidence_match with a candidate without replacing rows', async () => {
  const { dependencies, state } = createDependencies();
  const beforeHours = state.hours.map((row) => ({ ...row }));

  const result = await persistRestaurantHoursResult(
    {
      restaurantId: 'restaurant-1',
      result: {
        ok: false,
        status: 'low_confidence_match',
        placeId: 'place-low',
        source: 'google_places_new',
        matchedDisplayName: 'moonbowls (Healthy Korean Bowls)',
        matchConfidence: 0.38,
        candidateFormattedAddress: '123 Main St, Los Angeles, CA 90012',
        scoreBreakdown: {
          rawNameScore: 0.38,
          normalizedNameScore: 0.38,
          effectiveNameScore: 0.38,
          addressScore: 0.96,
          distanceScore: 1,
        },
        note: 'Google Places candidate was below the confidence threshold.',
      },
    },
    dependencies
  );

  assert.equal(result.status, 'low_confidence_match');
  assert.equal(result.ok, true);
  assert.deepEqual(state.hours, beforeHours);
  assert.equal(state.pendingReview?.id, 'review-1');
  assert.equal(state.pendingReview?.review_payload.matchedDisplayName, 'moonbowls (Healthy Korean Bowls)');
});

test('syncRestaurantHoursFromGoogle skips non-forced syncs when manual lock is enabled', async () => {
  const { dependencies } = createDependencies({
    restaurant: {
      hours_is_manually_managed: true,
      hours_source: 'admin_manual',
    },
  });

  const result = await syncRestaurantHoursFromGoogle(
    {
      restaurantId: 'restaurant-1',
      restaurantName: 'Tasty Noodles',
      address: '123 Main St',
    },
    dependencies
  );

  assert.equal(result.status, 'skipped_manual_lock');
  assert.equal(result.manualLockSkipped, true);
});

test('updateRestaurantHoursManually replaces rows and sets manual override metadata', async () => {
  const { dependencies, state } = createDependencies();

  const result = await updateRestaurantHoursManually(
    {
      restaurantId: 'restaurant-1',
      hours: [
        {
          dayOfWeek: 1,
          openTimeLocal: '10:00',
          closeTimeLocal: '21:00',
          isClosed: false,
          windowIndex: 1,
        },
        {
          dayOfWeek: 2,
          openTimeLocal: null,
          closeTimeLocal: null,
          isClosed: true,
          windowIndex: 1,
        },
      ],
      note: 'Verified by admin.',
    },
    dependencies
  );

  assert.equal(result.status, 'manual_override');
  assert.equal(result.rowsReplaced, true);
  assert.equal(state.restaurant.hours_source, 'admin_manual');
  assert.equal(state.restaurant.hours_is_manually_managed, true);
  assert.equal(state.hours.some((row) => row.day_of_week === 1 && row.open_time_local === '10:00:00'), true);
});

test('getRestaurantHoursForAdmin returns sorted stored hours and metadata', async () => {
  const { dependencies, state } = createDependencies({
    hours: [
      {
        id: 'row-b',
        restaurant_id: 'restaurant-1',
        day_of_week: 4,
        open_time_local: '12:00:00',
        close_time_local: '20:00:00',
        is_closed: false,
        window_index: 2,
        source: 'google_places_new',
      },
      {
        id: 'row-a',
        restaurant_id: 'restaurant-1',
        day_of_week: 4,
        open_time_local: '09:00:00',
        close_time_local: '11:00:00',
        is_closed: false,
        window_index: 1,
        source: 'google_places_new',
      },
    ],
  });
  state.pendingReview = {
    id: 'review-1',
    summary: 'Review this place.',
    confidence: 0.65,
    review_payload: {
      placeId: 'place-1',
    },
  };

  const record = await getRestaurantHoursForAdmin('restaurant-1', dependencies);

  assert.equal(record?.restaurantId, 'restaurant-1');
  assert.equal(record?.hours[0]?.windowIndex, 1);
  assert.equal(record?.hours[1]?.windowIndex, 2);
  assert.equal(record?.pendingReviewId, 'review-1');
});
