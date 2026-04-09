import 'server-only';

import { canonicalizeRestaurantIdentity, normalizeOptionalText } from '@/lib/menuNormalization';
import type {
  ExecuteRestaurantMergeParams,
  RestaurantMergeDisplayNameStrategy,
  RestaurantMergeHoursStrategy,
  RestaurantMergeOnlineOrderingLinkStrategy,
  RestaurantMergePreview,
  RestaurantMergeRestaurantRecord,
} from '@/lib/restaurantMergeTypes';
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin';

type RestaurantHoursRow = {
  id: string;
  restaurant_id: string;
  day_of_week: number;
  open_time_local: string | null;
  close_time_local: string | null;
  is_closed: boolean;
  window_index: number;
  source: string | null;
};

type MenuItemRow = {
  id: string;
  restaurant_id: string | null;
  name: string | null;
  canonical_name: string | null;
  base_price: number | null;
  recommended_modification: string | null;
  price_with_modification: number | null;
  ingredients: string | null;
  dietary_compliance: string | null;
  is_active: boolean | null;
  created_at: string;
  updated_at: string | null;
};

type UserSelectionRow = {
  id: string;
  restaurant_id: string | null;
  menu_item_id: string | null;
};

type MergeDependencies = {
  getRestaurants: (
    restaurantIds: string[]
  ) => Promise<RestaurantMergeRestaurantRecord[]>;
  getRestaurantHours: (restaurantIds: string[]) => Promise<RestaurantHoursRow[]>;
  getMenuItems: (restaurantIds: string[]) => Promise<MenuItemRow[]>;
  getUserSelections: (restaurantIds: string[]) => Promise<UserSelectionRow[]>;
  mergeRestaurantsRpc: (params: {
    sourceRestaurantId: string;
    targetRestaurantId: string;
    displayNameStrategy: RestaurantMergeDisplayNameStrategy;
    customDisplayName: string | null;
    onlineOrderingLinkStrategy: RestaurantMergeOnlineOrderingLinkStrategy;
    hoursStrategy: RestaurantMergeHoursStrategy;
  }) => Promise<Record<string, unknown>>;
};


function createMergeDependencies(): MergeDependencies {
  const supabaseAdmin = createSupabaseAdminClient();

  return {
    async getRestaurants(restaurantIds) {
      const { data, error } = await supabaseAdmin
        .from('restaurants')
        .select('id, created_at, name, address, city, region, postal_code, online_ordering_link, is_active')
        .in('id', restaurantIds);

      if (error) {
        throw error;
      }

      return (data as RestaurantMergeRestaurantRecord[] | null) ?? [];
    },
    async getRestaurantHours(restaurantIds) {
      const { data, error } = await supabaseAdmin
        .from('restaurant_hours')
        .select('id, restaurant_id, day_of_week, open_time_local, close_time_local, is_closed, window_index, source')
        .in('restaurant_id', restaurantIds);

      if (error) {
        throw error;
      }

      return (data as RestaurantHoursRow[] | null) ?? [];
    },
    async getMenuItems(restaurantIds) {
      const { data, error } = await supabaseAdmin
        .from('menu_items')
        .select(
          'id, restaurant_id, name, canonical_name, base_price, recommended_modification, price_with_modification, ingredients, dietary_compliance, is_active, created_at, updated_at'
        )
        .in('restaurant_id', restaurantIds);

      if (error) {
        throw error;
      }

      return (data as MenuItemRow[] | null) ?? [];
    },
    async getUserSelections(restaurantIds) {
      const { data, error } = await supabaseAdmin
        .from('user_selections')
        .select('id, restaurant_id, menu_item_id')
        .in('restaurant_id', restaurantIds);

      if (error) {
        throw error;
      }

      return (data as UserSelectionRow[] | null) ?? [];
    },
    async mergeRestaurantsRpc(params) {
      const { data, error } = await supabaseAdmin.rpc('merge_restaurants', {
        p_source_restaurant_id: params.sourceRestaurantId,
        p_target_restaurant_id: params.targetRestaurantId,
        p_display_name_strategy: params.displayNameStrategy ?? 'keep_target',
        p_custom_display_name: params.customDisplayName ?? null,
        p_online_ordering_link_strategy: params.onlineOrderingLinkStrategy ?? 'prefer_non_null',
        p_hours_strategy: params.hoursStrategy ?? 'abort_on_conflict',
      });

      if (error) {
        throw error;
      }

      return (data as Record<string, unknown> | null) ?? {};
    },
  };
}

function canonicalizeMenuItemName(value: string | null | undefined) {
  return normalizeOptionalText(value)?.toLowerCase().replace(/\s+/g, ' ') ?? '';
}

function getComparableMenuItemShape(row: MenuItemRow) {
  return JSON.stringify({
    canonicalName: row.canonical_name ?? canonicalizeMenuItemName(row.name),
    name: normalizeOptionalText(row.name),
    basePrice: row.base_price,
    recommendedModification: normalizeOptionalText(row.recommended_modification),
    priceWithModification: row.price_with_modification,
    ingredients: normalizeOptionalText(row.ingredients),
    dietaryCompliance: normalizeOptionalText(row.dietary_compliance),
    isActive: row.is_active ?? true,
  });
}

function getComparableHoursShape(row: RestaurantHoursRow) {
  return JSON.stringify({
    dayOfWeek: row.day_of_week,
    windowIndex: row.window_index,
    openTimeLocal: row.open_time_local,
    closeTimeLocal: row.close_time_local,
    isClosed: row.is_closed,
    source: normalizeOptionalText(row.source),
  });
}

function buildConflictSummary(preview: {
  menuItemConflicts: RestaurantMergePreview['menuItemConflicts'];
  hoursConflicts: RestaurantMergePreview['hoursConflicts'];
}) {
  const parts: string[] = [];

  if (preview.menuItemConflicts.length > 0) {
    parts.push(
      `${preview.menuItemConflicts.length} menu item conflict${
        preview.menuItemConflicts.length === 1 ? '' : 's'
      }`
    );
  }

  if (preview.hoursConflicts.length > 0) {
    parts.push(
      `${preview.hoursConflicts.length} hours conflict${
        preview.hoursConflicts.length === 1 ? '' : 's'
      }`
    );
  }

  return parts.length > 0 ? parts.join('; ') : null;
}

export async function previewRestaurantMerge(
  params: {
    sourceRestaurantId: string;
    targetRestaurantId: string;
  },
  dependencies: MergeDependencies = createMergeDependencies()
): Promise<RestaurantMergePreview> {
  const restaurants = await dependencies.getRestaurants([
    params.sourceRestaurantId,
    params.targetRestaurantId,
  ]);
  const sourceRestaurant = restaurants.find((restaurant) => restaurant.id === params.sourceRestaurantId);
  const targetRestaurant = restaurants.find((restaurant) => restaurant.id === params.targetRestaurantId);

  if (!sourceRestaurant || !targetRestaurant) {
    throw new Error('Both source and target restaurants are required for merge preview.');
  }

  const [hoursRows, menuItemRows, selectionRows] = await Promise.all([
    dependencies.getRestaurantHours([params.sourceRestaurantId, params.targetRestaurantId]),
    dependencies.getMenuItems([params.sourceRestaurantId, params.targetRestaurantId]),
    dependencies.getUserSelections([params.sourceRestaurantId, params.targetRestaurantId]),
  ]);

  const sourceHours = hoursRows.filter((row) => row.restaurant_id === params.sourceRestaurantId);
  const targetHours = hoursRows.filter((row) => row.restaurant_id === params.targetRestaurantId);
  const sourceMenuItems = menuItemRows.filter((row) => row.restaurant_id === params.sourceRestaurantId);
  const targetMenuItems = menuItemRows.filter((row) => row.restaurant_id === params.targetRestaurantId);
  const sourceSelections = selectionRows.filter(
    (row) => row.restaurant_id === params.sourceRestaurantId
  );
  const targetSelections = selectionRows.filter(
    (row) => row.restaurant_id === params.targetRestaurantId
  );

  const targetHoursByKey = new Map(
    targetHours.map((row) => [`${row.day_of_week}:${row.window_index}`, row] as const)
  );
  const targetMenuItemsByCanonicalName = new Map(
    targetMenuItems.map((row) => [
      row.canonical_name ?? canonicalizeMenuItemName(row.name),
      row,
    ] as const)
  );

  const hoursConflicts = sourceHours.flatMap((sourceHour) => {
    const targetHour = targetHoursByKey.get(`${sourceHour.day_of_week}:${sourceHour.window_index}`);

    if (!targetHour || getComparableHoursShape(sourceHour) === getComparableHoursShape(targetHour)) {
      return [];
    }

    return [
      {
        dayOfWeek: sourceHour.day_of_week,
        windowIndex: sourceHour.window_index,
        sourceHourId: sourceHour.id,
        targetHourId: targetHour.id,
      },
    ];
  });

  const menuItemConflicts = sourceMenuItems.flatMap((sourceMenuItem) => {
    const canonicalName = sourceMenuItem.canonical_name ?? canonicalizeMenuItemName(sourceMenuItem.name);
    const targetMenuItem = targetMenuItemsByCanonicalName.get(canonicalName);

    if (
      !canonicalName ||
      !targetMenuItem ||
      getComparableMenuItemShape(sourceMenuItem) === getComparableMenuItemShape(targetMenuItem)
    ) {
      return [];
    }

    return [
      {
        canonicalName,
        sourceMenuItemId: sourceMenuItem.id,
        targetMenuItemId: targetMenuItem.id,
        sourceName: sourceMenuItem.name,
        targetName: targetMenuItem.name,
      },
    ];
  });

  const preview: RestaurantMergePreview = {
    sourceRestaurant,
    targetRestaurant,
    identityKey: canonicalizeRestaurantIdentity(sourceRestaurant.name, sourceRestaurant.address),
    dependentCounts: {
      sourceMenuItems: sourceMenuItems.length,
      targetMenuItems: targetMenuItems.length,
      sourceHours: sourceHours.length,
      targetHours: targetHours.length,
      sourceSelections: sourceSelections.length,
      targetSelections: targetSelections.length,
    },
    menuItemConflicts,
    hoursConflicts,
    canMerge: menuItemConflicts.length === 0 && hoursConflicts.length === 0,
    conflictSummary: null,
  };

  preview.conflictSummary = buildConflictSummary(preview);

  return preview;
}

export async function executeRestaurantMerge(
  params: ExecuteRestaurantMergeParams,
  dependencies: MergeDependencies = createMergeDependencies()
) {
  return dependencies.mergeRestaurantsRpc({
    sourceRestaurantId: params.sourceRestaurantId,
    targetRestaurantId: params.targetRestaurantId,
    displayNameStrategy: params.displayNameStrategy ?? 'keep_target',
    customDisplayName: params.customDisplayName ?? null,
    onlineOrderingLinkStrategy: params.onlineOrderingLinkStrategy ?? 'prefer_non_null',
    hoursStrategy: params.hoursStrategy ?? 'abort_on_conflict',
  });
}
