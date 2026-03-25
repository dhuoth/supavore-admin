type NormalizedRestaurant = {
  name: string;
  address: string | null;
  city: string | null;
  region: string | null;
  postalCode: string | null;
  onlineOrderingLink: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

type NormalizedMenuItem = {
  name: string;
  basePrice: number;
  recommendedModification: string;
  priceWithModification: number;
  ingredients: string | null;
  dietaryCompliance: string[] | string;
};

export type NormalizedUploadRow = {
  restaurant: NormalizedRestaurant;
  menuItem: NormalizedMenuItem;
};

export function buildRestaurantUpsert(row: { restaurant: NormalizedRestaurant }) {
  return {
    name: row.restaurant.name,
    address: row.restaurant.address,
    city: row.restaurant.city,
    region: row.restaurant.region,
    postal_code: row.restaurant.postalCode,
    latitude: row.restaurant.latitude ?? null,
    longitude: row.restaurant.longitude ?? null,
    online_ordering_link: row.restaurant.onlineOrderingLink,
    is_active: true,
  };
}

export function buildMenuItemUpsert(params: {
  restaurantId: string;
  row: NormalizedUploadRow;
}) {
  const dietaryCompliance = Array.isArray(params.row.menuItem.dietaryCompliance)
    ? params.row.menuItem.dietaryCompliance.join(', ')
    : params.row.menuItem.dietaryCompliance;

  return {
    restaurant_id: params.restaurantId,
    name: params.row.menuItem.name,
canonical_name: params.row.menuItem.name
  .trim()
  .toLowerCase()
  .replace(/\s+/g, ' '),
    base_price: params.row.menuItem.basePrice,
    recommended_modification: params.row.menuItem.recommendedModification,
    price_with_modification: params.row.menuItem.priceWithModification,
    ingredients: params.row.menuItem.ingredients,
    dietary_compliance: dietaryCompliance,
    is_active: true,
  };
}
