import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { backfillRestaurantHoursOnServer } from '@/lib/restaurantHoursBackfillServer';

const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

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

test('backfillRestaurantHoursOnServer processes only candidate restaurants in small batches', async () => {
  const result = await backfillRestaurantHoursOnServer(
    { limit: 1, offset: 0 },
    {
      async listCandidates() {
        return [
          {
            id: 'restaurant-1',
            name: 'Tasty Noodles',
            address: '123 Main St',
            latitude: 34.05,
            longitude: -118.25,
            google_place_id: null,
            hours_sync_status: null,
            hours_is_manually_managed: false,
            restaurant_hours: [],
          },
          {
            id: 'restaurant-2',
            name: 'Manual Cafe',
            address: '456 Main St',
            latitude: null,
            longitude: null,
            google_place_id: 'place-2',
            hours_sync_status: 'manual_override',
            hours_is_manually_managed: true,
            restaurant_hours: [{ id: 'row-2' }],
          },
        ];
      },
      async syncRestaurantHours() {
        return {
          ok: true,
          restaurantId: 'restaurant-1',
          status: 'matched_with_hours',
          message: 'updated',
          rowsReplaced: true,
          metadataUpdated: true,
          manualLockSkipped: false,
        };
      },
    }
  );

  assert.equal(result.attempted, 1);
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.hasMore, false);
});

test('backfillRestaurantHoursOnServer reports skipped manual lock results', async () => {
  const result = await backfillRestaurantHoursOnServer(
    { limit: 5 },
    {
      async listCandidates() {
        return [
          {
            id: 'restaurant-1',
            name: 'Manual Cafe',
            address: '456 Main St',
            latitude: null,
            longitude: null,
            google_place_id: null,
            hours_sync_status: 'api_error',
            hours_is_manually_managed: true,
            restaurant_hours: [{ id: 'row-2' }],
          },
        ];
      },
      async syncRestaurantHours() {
        return {
          ok: true,
          restaurantId: 'restaurant-1',
          status: 'skipped_manual_lock',
          message: 'skipped',
          rowsReplaced: false,
          metadataUpdated: false,
          manualLockSkipped: true,
        };
      },
    }
  );

  assert.equal(result.succeeded, 1);
  assert.equal(result.results[0]?.status, 'skipped_manual_lock');
});

test('backfillRestaurantHoursOnServer counts review_required_match as processed successfully', async () => {
  const result = await backfillRestaurantHoursOnServer(
    { limit: 5 },
    {
      async listCandidates() {
        return [
          {
            id: 'restaurant-1',
            name: "Bludso's",
            address: '609 N La Brea Ave',
            latitude: 34.081,
            longitude: -118.345,
            google_place_id: null,
            hours_sync_status: null,
            hours_is_manually_managed: false,
            restaurant_hours: [],
          },
        ];
      },
      async syncRestaurantHours() {
        return {
          ok: true,
          restaurantId: 'restaurant-1',
          status: 'review_required_match',
          message: 'Queued for review.',
          rowsReplaced: false,
          metadataUpdated: true,
          manualLockSkipped: false,
        };
      },
    }
  );

  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.results[0]?.status, 'review_required_match');
});

test('backfillRestaurantHoursOnServer fails fast when service role config is missing', async () => {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  await assert.rejects(
    () =>
      backfillRestaurantHoursOnServer(undefined, {
        async listCandidates() {
          return [];
        },
        async syncRestaurantHours() {
          return {
            ok: false,
            restaurantId: 'restaurant-1',
            status: 'update_error',
            message: 'unused',
            rowsReplaced: false,
            metadataUpdated: false,
            manualLockSkipped: false,
          };
        },
      }),
    /Missing SUPABASE_SERVICE_ROLE_KEY/
  );
});
