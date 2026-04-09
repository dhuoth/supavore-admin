export type RestaurantMergeDisplayNameStrategy = 'keep_target' | 'keep_source' | 'custom';
export type RestaurantMergeOnlineOrderingLinkStrategy =
  | 'prefer_target'
  | 'prefer_source'
  | 'prefer_non_null';
export type RestaurantMergeHoursStrategy = 'abort_on_conflict';

export type RestaurantMergeRestaurantRecord = {
  id: string;
  created_at: string;
  name: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  online_ordering_link: string | null;
  is_active: boolean | null;
};

export type RestaurantMergePreview = {
  sourceRestaurant: RestaurantMergeRestaurantRecord;
  targetRestaurant: RestaurantMergeRestaurantRecord;
  identityKey: string | null;
  dependentCounts: {
    sourceMenuItems: number;
    targetMenuItems: number;
    sourceHours: number;
    targetHours: number;
    sourceSelections: number;
    targetSelections: number;
  };
  menuItemConflicts: Array<{
    canonicalName: string;
    sourceMenuItemId: string;
    targetMenuItemId: string;
    sourceName: string | null;
    targetName: string | null;
  }>;
  hoursConflicts: Array<{
    dayOfWeek: number;
    windowIndex: number;
    sourceHourId: string;
    targetHourId: string;
  }>;
  canMerge: boolean;
  conflictSummary: string | null;
};

export type ExecuteRestaurantMergeParams = {
  sourceRestaurantId: string;
  targetRestaurantId: string;
  displayNameStrategy?: RestaurantMergeDisplayNameStrategy;
  customDisplayName?: string | null;
  onlineOrderingLinkStrategy?: RestaurantMergeOnlineOrderingLinkStrategy;
  hoursStrategy?: RestaurantMergeHoursStrategy;
};
