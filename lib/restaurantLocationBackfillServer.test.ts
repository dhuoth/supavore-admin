import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { backfillRestaurantLocationsOnServer } from '@/lib/restaurantLocationBackfillServer';

type Candidate = {
  id: string;
  name: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
};

const originalApiKey = process.env.GOOGLE_MAPS_GEOCODING_API_KEY;
const originalServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function createDependencies(rows: Candidate[], options?: { skipPersist?: boolean }) {
  const persistedRows = new Map(rows.map((row) => [row.id, { ...row }]));

  return {
    async listCandidates() {
      return rows.map((row) => ({ ...row }));
    },
    async geocode() {
      return {
        ok: true as const,
        data: {
          latitude: 40.7128,
          longitude: -74.006,
          city: 'New York',
          region: 'NY',
          postalCode: '10001',
        },
      };
    },
    async updateRestaurantLocation(restaurantId: string, payload: Omit<Candidate, 'id' | 'name' | 'address'>) {
      if (!options?.skipPersist) {
        const current = persistedRows.get(restaurantId);

        if (current) {
          persistedRows.set(restaurantId, {
            ...current,
            ...payload,
          });
        }
      }

      return null;
    },
    async getRestaurantById(restaurantId: string) {
      return persistedRows.get(restaurantId) ?? null;
    },
  };
}

beforeEach(() => {
  process.env.GOOGLE_MAPS_GEOCODING_API_KEY = 'test-key';
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';
});

afterEach(() => {
  if (originalApiKey === undefined) {
    delete process.env.GOOGLE_MAPS_GEOCODING_API_KEY;
  } else {
    process.env.GOOGLE_MAPS_GEOCODING_API_KEY = originalApiKey;
  }

  if (originalServiceRoleKey === undefined) {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  } else {
    process.env.SUPABASE_SERVICE_ROLE_KEY = originalServiceRoleKey;
  }
});

test('backfillRestaurantLocationsOnServer counts verified persisted updates as successes', async () => {
  const result = await backfillRestaurantLocationsOnServer(
    undefined,
    createDependencies([
      {
        id: 'restaurant-1',
        name: 'Chipotle',
        address: '1 Main St',
        city: null,
        region: null,
        postal_code: null,
        latitude: null,
        longitude: null,
      },
    ])
  );

  assert.equal(result.attempted, 1);
  assert.equal(result.succeeded, 1);
  assert.equal(result.failed, 0);
  assert.equal(result.results[0]?.status, 'updated');
  assert.equal(result.results[0]?.latitude, 40.7128);
});

test('backfillRestaurantLocationsOnServer records geocode failures', async () => {
  const rows: Candidate[] = [
    {
      id: 'restaurant-2',
      name: 'Sweetgreen',
      address: '2 Main St',
      city: null,
      region: null,
      postal_code: null,
      latitude: null,
      longitude: null,
    },
  ];

  const result = await backfillRestaurantLocationsOnServer(undefined, {
    async listCandidates() {
      return rows;
    },
    async geocode() {
      return {
        ok: false as const,
        warning: 'Restaurant location saved, but no matching coordinates were found.',
      };
    },
    async updateRestaurantLocation() {
      return null;
    },
    async getRestaurantById(restaurantId: string) {
      return rows.find((row) => row.id === restaurantId) ?? null;
    },
  });

  assert.equal(result.succeeded, 0);
  assert.equal(result.failed, 1);
  assert.equal(result.results[0]?.status, 'geocode_failed');
});

test('backfillRestaurantLocationsOnServer flags verification failures when persisted values do not change', async () => {
  const result = await backfillRestaurantLocationsOnServer(
    undefined,
    createDependencies(
      [
        {
          id: 'restaurant-3',
          name: 'HomeState',
          address: '3 Main St',
          city: null,
          region: null,
          postal_code: null,
          latitude: null,
          longitude: null,
        },
      ],
      { skipPersist: true }
    )
  );

  assert.equal(result.succeeded, 0);
  assert.equal(result.failed, 1);
  assert.equal(result.results[0]?.status, 'verification_failed');
});

test('backfillRestaurantLocationsOnServer fails fast when required config is missing', async () => {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;

  await assert.rejects(
    () =>
      backfillRestaurantLocationsOnServer(undefined, {
        async listCandidates() {
          return [];
        },
        async geocode() {
          return {
            ok: false as const,
            warning: 'unused',
          };
        },
        async updateRestaurantLocation() {
          return null;
        },
        async getRestaurantById() {
          return null;
        },
      }),
    /Missing SUPABASE_SERVICE_ROLE_KEY/
  );
});
