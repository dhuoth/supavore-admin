import test from 'node:test';
import assert from 'node:assert/strict';
import { adminCsvTemplateHeaders, buildAdminCsvTemplate } from '@/lib/csvTemplate';

test('admin CSV template headers match the supported 9-column upload template', () => {
  assert.deepEqual(adminCsvTemplateHeaders, [
    'Restaurant Name',
    'Restaurant Address',
    'Online Ordering Link',
    'Menu Item',
    'Base Price',
    'Recommended Modification',
    'Price with Modification',
    'Ingredients',
    'Dietary Need Compliance',
  ]);
});

test('buildAdminCsvTemplate emits a single header row in the expected order', () => {
  assert.equal(
    buildAdminCsvTemplate(),
    'Restaurant Name,Restaurant Address,Online Ordering Link,Menu Item,Base Price,Recommended Modification,Price with Modification,Ingredients,Dietary Need Compliance\n'
  );
});
