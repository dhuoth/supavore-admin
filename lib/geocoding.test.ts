import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { geocodeRestaurantLocation } from '@/lib/geocoding';

const originalFetch = global.fetch;
const originalApiKey = process.env.GOOGLE_MAPS_GEOCODING_API_KEY;

beforeEach(() => {
  process.env.GOOGLE_MAPS_GEOCODING_API_KEY = 'test-key';
});

afterEach(() => {
  global.fetch = originalFetch;

  if (originalApiKey === undefined) {
    delete process.env.GOOGLE_MAPS_GEOCODING_API_KEY;
  } else {
    process.env.GOOGLE_MAPS_GEOCODING_API_KEY = originalApiKey;
  }
});

test('geocodeRestaurantLocation returns coordinates for a successful Google response', async () => {
  global.fetch = async (input) => {
    assert.match(String(input), /1600%20Amphitheatre%20Parkway/);

    return new Response(
      JSON.stringify({
        status: 'OK',
        results: [
          {
            geometry: {
              location: {
                lat: 37.422,
                lng: -122.084,
              },
            },
            address_components: [
              {
                long_name: 'Mountain View',
                short_name: 'Mountain View',
                types: ['locality'],
              },
              {
                long_name: 'California',
                short_name: 'CA',
                types: ['administrative_area_level_1'],
              },
              {
                long_name: '94043',
                short_name: '94043',
                types: ['postal_code'],
              },
            ],
          },
        ],
      }),
      { status: 200 }
    );
  };

  const result = await geocodeRestaurantLocation({
    address: '1600 Amphitheatre Parkway',
    city: 'Mountain View',
    region: 'ca',
    postalCode: '94043',
  });

  assert.deepEqual(result, {
    ok: true,
    data: {
      latitude: 37.422,
      longitude: -122.084,
      city: 'Mountain View',
      region: 'CA',
      postalCode: '94043',
    },
  });
});

test('geocodeRestaurantLocation returns a no-results warning', async () => {
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        status: 'ZERO_RESULTS',
        results: [],
      }),
      { status: 200 }
    );

  const result = await geocodeRestaurantLocation({
    address: 'Unknown Place',
  });

  assert.deepEqual(result, {
    ok: false,
    warning: 'Restaurant location saved, but no matching coordinates were found.',
  });
});

test('geocodeRestaurantLocation surfaces Google API status errors', async () => {
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        status: 'REQUEST_DENIED',
        error_message: 'API key is invalid.',
      }),
      { status: 200 }
    );

  const result = await geocodeRestaurantLocation({
    address: '1 Main St',
  });

  assert.deepEqual(result, {
    ok: false,
    warning: 'Restaurant location saved, but geocoding failed: API key is invalid.',
  });
});

test('geocodeRestaurantLocation returns a generic warning when fetch throws', async () => {
  global.fetch = async () => {
    throw new Error('network down');
  };

  const result = await geocodeRestaurantLocation({
    address: '1 Main St',
  });

  assert.deepEqual(result, {
    ok: false,
    warning: 'Restaurant location saved, but geocoding could not be completed right now.',
  });
});
