export const adminCsvTemplateHeaders = [
  'Restaurant Name',
  'Restaurant Address',
  'Online Ordering Link',
  'Menu Item',
  'Base Price',
  'Recommended Modification',
  'Price with Modification',
  'Ingredients',
  'Dietary Need Compliance',
] as const;

export function buildAdminCsvTemplate() {
  return `${adminCsvTemplateHeaders.join(',')}\n`;
}
