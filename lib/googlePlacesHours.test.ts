import test, { afterEach, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { enrichRestaurantHoursFromGoogle } from '@/lib/googlePlacesHours';

const originalFetch = global.fetch;
const originalGeocodingKey = process.env.GOOGLE_MAPS_GEOCODING_API_KEY;
const originalPlacesKey = process.env.GOOGLE_PLACES_API_KEY;

beforeEach(() => {
  process.env.GOOGLE_MAPS_GEOCODING_API_KEY = 'test-key';
  delete process.env.GOOGLE_PLACES_API_KEY;
});

afterEach(() => {
  global.fetch = originalFetch;

  if (originalGeocodingKey === undefined) {
    delete process.env.GOOGLE_MAPS_GEOCODING_API_KEY;
  } else {
    process.env.GOOGLE_MAPS_GEOCODING_API_KEY = originalGeocodingKey;
  }

  if (originalPlacesKey === undefined) {
    delete process.env.GOOGLE_PLACES_API_KEY;
  } else {
    process.env.GOOGLE_PLACES_API_KEY = originalPlacesKey;
  }
});

test('enrichRestaurantHoursFromGoogle returns matched_with_hours for a confident match', async () => {
  global.fetch = async (input, init) => {
    const url = String(input);

    if (url === 'https://places.googleapis.com/v1/places:searchText') {
      assert.equal(init?.method, 'POST');
      assert.equal(init?.headers && (init.headers as Record<string, string>)['X-Goog-FieldMask'], 'places.id,places.displayName,places.formattedAddress,places.location');

      return new Response(
        JSON.stringify({
          places: [
            {
              id: 'test-place-id',
              displayName: { text: 'Tasty Noodles' },
              formattedAddress: '123 Main St, Los Angeles, CA 90012',
              location: {
                latitude: 34.0501,
                longitude: -118.2499,
              },
            },
          ],
        }),
        { status: 200 }
      );
    }

    assert.equal(url, 'https://places.googleapis.com/v1/places/test-place-id');

    return new Response(
      JSON.stringify({
        id: 'test-place-id',
        displayName: { text: 'Tasty Noodles' },
        utcOffsetMinutes: -420,
        regularOpeningHours: {
          periods: [
            {
              open: { day: 1, hour: 11, minute: 0 },
              close: { day: 1, hour: 14, minute: 0 },
            },
            {
              open: { day: 1, hour: 17, minute: 0 },
              close: { day: 1, hour: 21, minute: 0 },
            },
            {
              open: { day: 5, hour: 22, minute: 0 },
              close: { day: 6, hour: 2, minute: 0 },
            },
          ],
        },
        currentOpeningHours: {
          openNow: true,
        },
      }),
      { status: 200 }
    );
  };

  const result = await enrichRestaurantHoursFromGoogle({
    restaurantName: 'Tasty Noodles',
    address: '123 Main St, Los Angeles, CA 90012',
    latitude: 34.05,
    longitude: -118.25,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'matched_with_hours');
  assert.equal(result.placeId, 'test-place-id');
  assert.equal(result.timezone, 'UTC-07:00');
  assert.equal(result.scoreBreakdown?.effectiveNameScore, 1);
  assert.equal(result.hours?.filter((window) => window.dayOfWeek === 1).length, 2);
  assert.deepEqual(result.hours?.find((window) => window.dayOfWeek === 0), {
    dayOfWeek: 0,
    openTimeLocal: null,
    closeTimeLocal: null,
    isClosed: true,
    windowIndex: 0,
    source: 'google_places_new',
  });
  assert.deepEqual(result.hours?.find((window) => window.dayOfWeek === 5 && window.windowIndex === 0), {
    dayOfWeek: 5,
    openTimeLocal: '22:00:00',
    closeTimeLocal: '02:00:00',
    isClosed: false,
    windowIndex: 0,
    source: 'google_places_new',
  });
});

test('enrichRestaurantHoursFromGoogle returns matched_no_hours when structured hours are unavailable', async () => {
  global.fetch = async (input) => {
    const url = String(input);

    if (url === 'https://places.googleapis.com/v1/places:searchText') {
      return new Response(
        JSON.stringify({
          places: [
            {
              id: 'test-place-id',
              displayName: { text: 'Tasty Noodles' },
              formattedAddress: '123 Main St, Los Angeles, CA 90012',
              location: {
                latitude: 34.0501,
                longitude: -118.2499,
              },
            },
          ],
        }),
        { status: 200 }
      );
    }

    return new Response(
      JSON.stringify({
        id: 'test-place-id',
        displayName: { text: 'Tasty Noodles' },
        currentOpeningHours: {
          openNow: false,
        },
      }),
      { status: 200 }
    );
  };

  const result = await enrichRestaurantHoursFromGoogle({
    restaurantName: 'Tasty Noodles',
    address: '123 Main St, Los Angeles, CA 90012',
    latitude: 34.05,
    longitude: -118.25,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'matched_no_hours');
  assert.equal(result.placeId, 'test-place-id');
  assert.equal(result.matchConfidence, 1);
  assert.deepEqual(result.rawSummary, {
    regularOpeningHours: undefined,
    currentOpeningHours: {
      openNow: false,
    },
  });
});

test('enrichRestaurantHoursFromGoogle returns no_match when Google finds no place candidates', async () => {
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        places: [],
      }),
      { status: 200 }
    );

  const result = await enrichRestaurantHoursFromGoogle({
    restaurantName: 'Unknown Cafe',
    address: '999 Missing Ave',
  });

  assert.deepEqual(result, {
    ok: false,
    status: 'no_match',
    source: 'google_places_new',
    matchConfidence: null,
    timezone: null,
    note: 'Google Places text search returned no candidate restaurants.',
  });
});

test('enrichRestaurantHoursFromGoogle returns low_confidence_match for weak candidates', async () => {
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        places: [
          {
            id: 'weak-match',
            displayName: { text: 'Different Kitchen' },
            formattedAddress: '400 Side St, Los Angeles, CA 90013',
          },
        ],
      }),
      { status: 200 }
    );

  const result = await enrichRestaurantHoursFromGoogle({
    restaurantName: 'Tasty Noodles',
    address: '123 Main St, Los Angeles, CA 90012',
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'low_confidence_match');
  assert.equal(result.placeId, 'weak-match');
});

test('enrichRestaurantHoursFromGoogle auto-matches generic suffix variants with strong location evidence', async () => {
  global.fetch = async (input) => {
    const url = String(input);

    if (url === 'https://places.googleapis.com/v1/places:searchText') {
      return new Response(
        JSON.stringify({
          places: [
            {
              id: 'review-place',
              displayName: { text: "Bludso's BBQ" },
              formattedAddress: '609 N La Brea Ave, Los Angeles, CA 90036',
              location: {
                latitude: 34.081,
                longitude: -118.345,
              },
            },
          ],
        }),
        { status: 200 }
      );
    }

    return new Response(
      JSON.stringify({
        id: 'review-place',
        displayName: { text: "Bludso's BBQ" },
        currentOpeningHours: {
          openNow: false,
        },
      }),
      { status: 200 }
    );
  };

  const result = await enrichRestaurantHoursFromGoogle({
    restaurantName: "Bludso's",
    address: '609 N La Brea Ave, Los Angeles, CA 90036',
    latitude: 34.0811,
    longitude: -118.3451,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'matched_no_hours');
  assert.equal(result.placeId, 'review-place');
  assert.equal(result.candidateFormattedAddress, '609 N La Brea Ave, Los Angeles, CA 90036');
  assert.equal(result.scoreBreakdown?.distanceScore, 1);
  assert.equal(result.scoreBreakdown?.effectiveNameScore, 1);
});

test('enrichRestaurantHoursFromGoogle returns review_required_match for borderline same-location candidates', async () => {
  global.fetch = async () =>
    new Response(
      JSON.stringify({
        places: [
          {
            id: 'review-place',
            displayName: { text: 'Shake Shack Santa Monica' },
            formattedAddress: '225 Santa Monica Blvd, Santa Monica, CA 90401',
            location: {
              latitude: 34.0155,
              longitude: -118.4973,
            },
          },
        ],
      }),
      { status: 200 }
    );

  const result = await enrichRestaurantHoursFromGoogle({
    restaurantName: 'Shake Shack',
    address: '225 Santa Monica Blvd, Santa Monica, CA 90401',
    latitude: 34.0156,
    longitude: -118.4972,
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'review_required_match');
  assert.equal(result.placeId, 'review-place');
  assert.equal(result.candidateFormattedAddress, '225 Santa Monica Blvd, Santa Monica, CA 90401');
  assert.equal(result.scoreBreakdown?.distanceScore, 1);
  assert.ok((result.scoreBreakdown?.effectiveNameScore ?? 0) >= 0.5);
  assert.ok((result.scoreBreakdown?.effectiveNameScore ?? 0) < 0.7);
});

test('enrichRestaurantHoursFromGoogle prefers the closer candidate when names are otherwise similar', async () => {
  global.fetch = async (input) => {
    const url = String(input);

    if (url === 'https://places.googleapis.com/v1/places:searchText') {
      return new Response(
        JSON.stringify({
          places: [
            {
              id: 'far-place',
              displayName: { text: 'Tasty Noodles' },
              formattedAddress: '123 Main St, Los Angeles, CA 90012',
              location: {
                latitude: 34.08,
                longitude: -118.27,
              },
            },
            {
              id: 'near-place',
              displayName: { text: 'Tasty Noodles' },
              formattedAddress: '123 Main St, Los Angeles, CA 90012',
              location: {
                latitude: 34.0501,
                longitude: -118.2501,
              },
            },
          ],
        }),
        { status: 200 }
      );
    }

    assert.equal(url, 'https://places.googleapis.com/v1/places/near-place');

    return new Response(
      JSON.stringify({
        id: 'near-place',
        displayName: { text: 'Tasty Noodles' },
        regularOpeningHours: {
          periods: [
            {
              open: { day: 2, hour: 10, minute: 0 },
              close: { day: 2, hour: 20, minute: 0 },
            },
          ],
        },
      }),
      { status: 200 }
    );
  };

  const result = await enrichRestaurantHoursFromGoogle({
    restaurantName: 'Tasty Noodles',
    address: '123 Main St, Los Angeles, CA 90012',
    latitude: 34.05,
    longitude: -118.25,
  });

  assert.equal(result.ok, true);
  assert.equal(result.placeId, 'near-place');
});

test('enrichRestaurantHoursFromGoogle returns api_error when Google search fails', async () => {
  global.fetch = async () => new Response('bad gateway', { status: 502 });

  const result = await enrichRestaurantHoursFromGoogle({
    restaurantName: 'Tasty Noodles',
    address: '123 Main St, Los Angeles, CA 90012',
  });

  assert.deepEqual(result, {
    ok: false,
    status: 'api_error',
    placeId: undefined,
    source: 'google_places_new',
    matchConfidence: null,
    timezone: null,
    note: 'Google Places text search failed with HTTP 502.',
  });
});

test('enrichRestaurantHoursFromGoogle returns api_error when fetch throws', async () => {
  global.fetch = async () => {
    throw new Error('network down');
  };

  const result = await enrichRestaurantHoursFromGoogle({
    restaurantName: 'Tasty Noodles',
    address: '123 Main St, Los Angeles, CA 90012',
  });

  assert.deepEqual(result, {
    ok: false,
    status: 'api_error',
    placeId: undefined,
    source: 'google_places_new',
    matchConfidence: null,
    timezone: null,
    note: 'Google Places text search could not be completed right now.',
  });
});
