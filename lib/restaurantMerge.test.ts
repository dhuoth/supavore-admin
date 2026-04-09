import test from 'node:test';
import assert from 'node:assert/strict';
import { previewRestaurantMerge } from '@/lib/restaurantMerge';

test('previewRestaurantMerge marks identical duplicate menu items as mergeable', async () => {
  const preview = await previewRestaurantMerge(
    {
      sourceRestaurantId: 'source-1',
      targetRestaurantId: 'target-1',
    },
    {
      async getRestaurants() {
        return [
          {
            id: 'source-1',
            created_at: '2026-04-01T00:00:00.000Z',
            name: "Bluey's",
            address: '123 Main St',
            city: null,
            region: null,
            postal_code: null,
            online_ordering_link: null,
            is_active: true,
          },
          {
            id: 'target-1',
            created_at: '2026-03-31T00:00:00.000Z',
            name: 'Blueys',
            address: '123 Main Street',
            city: null,
            region: null,
            postal_code: null,
            online_ordering_link: null,
            is_active: true,
          },
        ];
      },
      async getRestaurantHours() {
        return [];
      },
      async getMenuItems() {
        return [
          {
            id: 'source-item-1',
            restaurant_id: 'source-1',
            name: 'Harvest Bowl',
            canonical_name: 'harvest bowl',
            base_price: 12,
            recommended_modification: 'No Modifications',
            price_with_modification: 12,
            ingredients: 'Rice',
            dietary_compliance: 'Vegan',
            is_active: true,
            created_at: '2026-04-01T00:00:00.000Z',
            updated_at: '2026-04-01T00:00:00.000Z',
          },
          {
            id: 'target-item-1',
            restaurant_id: 'target-1',
            name: 'Harvest Bowl',
            canonical_name: 'harvest bowl',
            base_price: 12,
            recommended_modification: 'No Modifications',
            price_with_modification: 12,
            ingredients: 'Rice',
            dietary_compliance: 'Vegan',
            is_active: true,
            created_at: '2026-03-31T00:00:00.000Z',
            updated_at: '2026-03-31T00:00:00.000Z',
          },
        ];
      },
      async getUserSelections() {
        return [];
      },
      async mergeRestaurantsRpc() {
        throw new Error('not used');
      },
    }
  );

  assert.equal(preview.canMerge, true);
  assert.equal(preview.menuItemConflicts.length, 0);
  assert.equal(preview.identityKey, 'blueys::123 main st');
});

test('previewRestaurantMerge blocks merge when menu item payloads differ', async () => {
  const preview = await previewRestaurantMerge(
    {
      sourceRestaurantId: 'source-1',
      targetRestaurantId: 'target-1',
    },
    {
      async getRestaurants() {
        return [
          {
            id: 'source-1',
            created_at: '2026-04-01T00:00:00.000Z',
            name: 'Source',
            address: '123 Main St',
            city: null,
            region: null,
            postal_code: null,
            online_ordering_link: null,
            is_active: true,
          },
          {
            id: 'target-1',
            created_at: '2026-03-31T00:00:00.000Z',
            name: 'Target',
            address: '123 Main St',
            city: null,
            region: null,
            postal_code: null,
            online_ordering_link: null,
            is_active: true,
          },
        ];
      },
      async getRestaurantHours() {
        return [];
      },
      async getMenuItems() {
        return [
          {
            id: 'source-item-1',
            restaurant_id: 'source-1',
            name: 'Harvest Bowl',
            canonical_name: 'harvest bowl',
            base_price: 12,
            recommended_modification: 'No Modifications',
            price_with_modification: 12,
            ingredients: 'Rice',
            dietary_compliance: 'Vegan',
            is_active: true,
            created_at: '2026-04-01T00:00:00.000Z',
            updated_at: '2026-04-01T00:00:00.000Z',
          },
          {
            id: 'target-item-1',
            restaurant_id: 'target-1',
            name: 'Harvest Bowl',
            canonical_name: 'harvest bowl',
            base_price: 14,
            recommended_modification: 'No Modifications',
            price_with_modification: 14,
            ingredients: 'Rice',
            dietary_compliance: 'Vegan',
            is_active: true,
            created_at: '2026-03-31T00:00:00.000Z',
            updated_at: '2026-03-31T00:00:00.000Z',
          },
        ];
      },
      async getUserSelections() {
        return [];
      },
      async mergeRestaurantsRpc() {
        throw new Error('not used');
      },
    }
  );

  assert.equal(preview.canMerge, false);
  assert.equal(preview.menuItemConflicts.length, 1);
  assert.equal(preview.conflictSummary, '1 menu item conflict');
});
