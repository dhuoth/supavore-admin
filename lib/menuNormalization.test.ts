import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalizeRestaurantIdentity,
  normalizeRestaurantDisplayName,
  normalizeRestaurantPayload,
} from '@/lib/menuNormalization';

test('normalizeRestaurantDisplayName converts accented latin characters to ASCII', () => {
  assert.equal(normalizeRestaurantDisplayName('Café'), 'Cafe');
});

test('normalizeRestaurantDisplayName preserves title casing after ASCII normalization', () => {
  assert.equal(normalizeRestaurantDisplayName('  rúttS hAwAiiAn café  '), 'Rutts Hawaiian Cafe');
});

test('normalizeRestaurantDisplayName converts common typographic punctuation to ASCII', () => {
  assert.equal(normalizeRestaurantDisplayName('Rütt’s Hawaiian Café'), "Rutt's Hawaiian Cafe");
});

test('normalizeRestaurantPayload normalizes only the restaurant name to ASCII', () => {
  assert.deepEqual(
    normalizeRestaurantPayload({
      restaurantName: 'Rütt’s Hawaiian Café',
      restaurantAddress: ' 123 Café St. ',
      restaurantCity: 'san josé',
      restaurantRegion: 'ca',
      restaurantPostalCode: ' 95112 ',
      onlineOrderingLink: ' https://example.com/order ',
    }),
    {
      name: "Rutt's Hawaiian Cafe",
      address: '123 Café St.',
      city: 'San José',
      region: 'CA',
      postalCode: '95112',
      onlineOrderingLink: 'https://example.com/order',
    }
  );
});

test('normalizeRestaurantPayload matches accented existing names against future ASCII writes', () => {
  const existingRestaurant = normalizeRestaurantPayload({
    restaurantName: 'Rütt’s Hawaiian Café',
    restaurantAddress: '456 Main St',
    restaurantCity: 'Los Angeles',
    restaurantRegion: 'ca',
    restaurantPostalCode: '90001',
    onlineOrderingLink: null,
  });
  const newWrite = normalizeRestaurantPayload({
    restaurantName: "Rutt's Hawaiian Cafe",
    restaurantAddress: '456 Main St',
    restaurantCity: 'Los Angeles',
    restaurantRegion: 'ca',
    restaurantPostalCode: '90001',
    onlineOrderingLink: null,
  });

  assert.equal(existingRestaurant.name, newWrite.name);
  assert.equal(existingRestaurant.address, newWrite.address);
});

test('canonicalizeRestaurantIdentity ignores punctuation-only name differences', () => {
  assert.equal(
    canonicalizeRestaurantIdentity('Blueys', '123 Main Street'),
    canonicalizeRestaurantIdentity("Bluey's", '123 Main St.')
  );
});

test('canonicalizeRestaurantIdentity keeps different addresses distinct', () => {
  assert.notEqual(
    canonicalizeRestaurantIdentity("Bluey's", '123 Main St'),
    canonicalizeRestaurantIdentity("Bluey's", '999 Main St')
  );
});
