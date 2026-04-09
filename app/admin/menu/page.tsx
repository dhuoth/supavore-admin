'use client';

import Link from 'next/link';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { ReviewActions } from '@/app/admin/reviews/review-actions';
import { formatAdminTimestamp } from '@/lib/adminTimestamp';
import { geocodeRestaurantLocationViaApi } from '@/lib/geocodingClient';
import { enrichRestaurantHoursViaApi } from '@/lib/googlePlacesHoursClient';
import {
  backfillRestaurantHours,
  type RestaurantHoursBackfillItem,
} from '@/lib/restaurantHoursBackfill';
import {
  canonicalizeDietaryCompliance,
  dietaryOptions,
  normalizeMenuItemPayload,
  normalizeOptionalText,
  normalizeRestaurantPayload,
  normalizeWhitespace,
  type DietaryOption,
} from '@/lib/menuNormalization';
import {
  backfillRestaurantLocations,
  type RestaurantLocationBackfillItem,
} from '@/lib/restaurantLocationBackfill';
import {
  mergeRestaurantLocation,
  restaurantLocationChanged,
  restaurantLocationHasMeaningfulInput,
} from '@/lib/restaurantLocation';
import { supabase } from '@/lib/supabaseClient';

type MenuItemRow = {
  id: string;
  name: string | null;
  canonical_name: string | null;
  created_at: string;
  updated_at: string | null;
  base_price: number | string | null;
  recommended_modification: string | null;
  price_with_modification: number | string | null;
  ingredients: string | null;
  dietary_compliance: string | null;
  is_active: boolean;
  restaurants: {
    id: string;
    name: string | null;
    address: string | null;
    city: string | null;
    region: string | null;
    postal_code: string | null;
    latitude: number | null;
    longitude: number | null;
    online_ordering_link: string | null;
    google_place_id?: string | null;
    hours_source?: string | null;
    hours_last_synced_at?: string | null;
    hours_sync_status?: string | null;
    hours_match_confidence?: number | null;
    hours_notes?: string | null;
    timezone?: string | null;
    place_name_from_source?: string | null;
    hours_is_manually_managed?: boolean;
  } | null;
};

type RawMenuItemRow = Omit<MenuItemRow, 'restaurants'> & {
  restaurants: MenuItemRow['restaurants'][] | MenuItemRow['restaurants'];
};

type DrawerEditState = {
  restaurantName: string;
  restaurantAddress: string;
  restaurantCity: string;
  restaurantRegion: string;
  restaurantPostalCode: string;
  onlineOrderingLink: string;
  menuItem: string;
  basePrice: string;
  priceWithModification: string;
  recommendedModification: string;
  ingredients: string;
  dietaryOptions: DietaryOption[];
  noModifications: boolean;
  isActive: boolean;
};

type DuplicateKeyParts = {
  restaurant: string;
  address: string;
  menuItem: string;
};

type RestaurantHoursAdminWindow = {
  id?: string;
  dayOfWeek: number;
  openTimeLocal: string | null;
  closeTimeLocal: string | null;
  isClosed: boolean;
  windowIndex: number;
  source: string | null;
};

type RestaurantHoursAdminRecord = {
  restaurantId: string;
  googlePlaceId: string | null;
  hoursSource: string | null;
  hoursLastSyncedAt: string | null;
  hoursSyncStatus: string | null;
  hoursMatchConfidence: number | null;
  hoursNotes: string | null;
  timezone: string | null;
  placeNameFromSource: string | null;
  hoursIsManuallyManaged: boolean;
  pendingReviewId?: string | null;
  pendingReviewSummary?: string | null;
  pendingReviewConfidence?: number | null;
  pendingReviewPayload?: Record<string, unknown> | null;
  hours: RestaurantHoursAdminWindow[];
};

type HoursEditorWindow = {
  id: string;
  windowIndex: number;
  openTimeLocal: string;
  closeTimeLocal: string;
};

type HoursEditorDay = {
  dayOfWeek: number;
  isClosed: boolean;
  windows: HoursEditorWindow[];
};

const exclusiveDietaryOptions: DietaryOption[] = ['None', 'Unknown'];
const standardDietaryOptions: DietaryOption[] = [
  'Vegan',
  'Vegetarian',
  'Gluten-Free',
  'No Nuts',
];
const weekdayLabels = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
];

function triggerRestaurantHoursEnrichment(input: {
  restaurantId: string;
  restaurantName: string;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
}) {
  if (!input.restaurantId || !input.restaurantName || !input.address) {
    return;
  }

  void enrichRestaurantHoursViaApi(input)
    .then((result) => {
      if (!result.ok) {
        console.warn('Google Places hours enrichment completed with a non-fatal warning.', {
          restaurantId: input.restaurantId,
          restaurantName: input.restaurantName,
          status: result.status,
          message: result.message,
        });
      }
    })
    .catch((error) => {
      console.warn('Google Places hours enrichment request failed.', {
        restaurantId: input.restaurantId,
        restaurantName: input.restaurantName,
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    });
}

function FieldLabel({
  htmlFor,
  label,
  required = false,
}: {
  htmlFor: string;
  label: string;
  required?: boolean;
}) {
  return (
    <label htmlFor={htmlFor} className="mb-2 block text-sm font-medium text-zinc-900">
      {label}
      {required ? <span className="ml-1 text-zinc-500">*</span> : null}
    </label>
  );
}

function inputClassName() {
  return 'w-full rounded-xl border border-zinc-200 bg-white px-4 py-3 text-sm text-zinc-950 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200';
}

function formatPrice(value: number | string | null) {
  if (value === null || value === undefined) return '—';
  return `$${Number(value).toFixed(2)}`;
}

function formatHoursDisplayTime(value: string | null | undefined) {
  if (!value) {
    return '—';
  }

  return value.slice(0, 5);
}

function formatScore(value: unknown) {
  return typeof value === 'number' ? value.toFixed(2) : '—';
}

function buildEmptyHoursEditorDays(): HoursEditorDay[] {
  return weekdayLabels.map((_, dayOfWeek) => ({
    dayOfWeek,
    isClosed: true,
    windows: [],
  }));
}

function buildHoursEditorState(hours: RestaurantHoursAdminWindow[]): HoursEditorDay[] {
  const days = buildEmptyHoursEditorDays();

  for (const hour of hours) {
    const day = days[hour.dayOfWeek];

    if (!day) {
      continue;
    }

    if (hour.isClosed) {
      day.isClosed = true;
      day.windows = [];
      continue;
    }

    day.isClosed = false;
    day.windows.push({
      id: hour.id ?? `${hour.dayOfWeek}-${hour.windowIndex}`,
      windowIndex: hour.windowIndex,
      openTimeLocal: hour.openTimeLocal?.slice(0, 5) ?? '',
      closeTimeLocal: hour.closeTimeLocal?.slice(0, 5) ?? '',
    });
  }

  for (const day of days) {
    day.windows.sort((left, right) => left.windowIndex - right.windowIndex);
  }

  return days;
}

function buildHoursPayload(days: HoursEditorDay[]) {
  return days.flatMap<{
    dayOfWeek: number;
    openTimeLocal: string | null;
    closeTimeLocal: string | null;
    isClosed: boolean;
    windowIndex: number;
    source: string;
  }>((day) => {
    if (day.isClosed || day.windows.length === 0) {
      return [
        {
          dayOfWeek: day.dayOfWeek,
          openTimeLocal: null,
          closeTimeLocal: null,
          isClosed: true,
          windowIndex: 1,
          source: 'admin_manual',
        },
      ];
    }

    return day.windows.map((window, index) => {
      if (!window.openTimeLocal || !window.closeTimeLocal) {
        throw new Error(`Enter both open and close times for ${weekdayLabels[day.dayOfWeek]}.`);
      }

      return {
        dayOfWeek: day.dayOfWeek,
        openTimeLocal: window.openTimeLocal,
        closeTimeLocal: window.closeTimeLocal,
        isClosed: false,
        windowIndex: index + 1,
        source: 'admin_manual',
      };
    });
  });
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) {
    return error.message;
  }

  if (typeof error === 'object' && error !== null && 'error' in error) {
    const message = (error as { error?: unknown }).error;

    if (typeof message === 'string') {
      return message;
    }
  }

  return 'Unable to complete this request right now.';
}

function normalizeForEntityMatch(value: string | null | undefined) {
  if (!value) return '';

  return value
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\w\s]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function normalizeAddressForMatch(value: string | null | undefined) {
  const tokenMap: Record<string, string> = {
    street: 'st',
    avenue: 'ave',
    boulevard: 'blvd',
    road: 'rd',
    drive: 'dr',
    lane: 'ln',
    place: 'pl',
    court: 'ct',
    suite: 'ste',
    unit: 'unit',
    apartment: 'apt',
    north: 'n',
    south: 's',
    east: 'e',
    west: 'w',
  };

  return normalizeForEntityMatch(value)
    .split(' ')
    .map((token) => tokenMap[token] || token)
    .join(' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function buildDuplicateKeyParts(input: {
  restaurantName: string | null | undefined;
  restaurantAddress: string | null | undefined;
  menuItemName: string | null | undefined;
}): DuplicateKeyParts {
  return {
    restaurant: normalizeForEntityMatch(input.restaurantName),
    address: normalizeAddressForMatch(input.restaurantAddress),
    menuItem: normalizeForEntityMatch(input.menuItemName),
  };
}

function simpleSimilarity(a: string, b: string) {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.9;

  const aTokens = new Set(a.split(' ').filter(Boolean));
  const bTokens = new Set(b.split(' ').filter(Boolean));
  const overlap = Array.from(aTokens).filter((token) => bTokens.has(token)).length;
  const union = new Set([...aTokens, ...bTokens]).size;
  const tokenScore = union === 0 ? 0 : overlap / union;

  const aBigrams = new Set(
    a
      .split(' ')
      .filter(Boolean)
      .map((token, index, tokens) => `${token} ${tokens[index + 1] || ''}`.trim())
      .filter((token) => token.includes(' '))
  );
  const bBigrams = new Set(
    b
      .split(' ')
      .filter(Boolean)
      .map((token, index, tokens) => `${token} ${tokens[index + 1] || ''}`.trim())
      .filter((token) => token.includes(' '))
  );
  const bigramOverlap = Array.from(aBigrams).filter((token) => bBigrams.has(token)).length;
  const bigramUnion = new Set([...aBigrams, ...bBigrams]).size;
  const phraseScore = bigramUnion === 0 ? 0 : bigramOverlap / bigramUnion;

  return Math.max(tokenScore * 0.85, phraseScore * 0.95);
}

function createEmptyDrawerEditState(): DrawerEditState {
  return {
    restaurantName: '',
    restaurantAddress: '',
    restaurantCity: '',
    restaurantRegion: '',
    restaurantPostalCode: '',
    onlineOrderingLink: '',
    menuItem: '',
    basePrice: '',
    priceWithModification: '',
    recommendedModification: '',
    ingredients: '',
    dietaryOptions: [],
    noModifications: true,
    isActive: true,
  };
}

function buildDrawerEditState(menuItem: MenuItemRow): DrawerEditState {
  const noModifications = menuItem.recommended_modification === 'No Modifications';

  return {
    restaurantName: menuItem.restaurants?.name || '',
    restaurantAddress: menuItem.restaurants?.address || '',
    restaurantCity: menuItem.restaurants?.city || '',
    restaurantRegion: menuItem.restaurants?.region || '',
    restaurantPostalCode: menuItem.restaurants?.postal_code || '',
    onlineOrderingLink: menuItem.restaurants?.online_ordering_link || '',
    menuItem: menuItem.name || '',
    basePrice:
      menuItem.base_price === null || menuItem.base_price === undefined
        ? ''
        : String(menuItem.base_price),
    priceWithModification:
      menuItem.price_with_modification === null || menuItem.price_with_modification === undefined
        ? ''
        : String(menuItem.price_with_modification),
    recommendedModification: noModifications ? '' : menuItem.recommended_modification || '',
    ingredients: menuItem.ingredients || '',
    dietaryOptions: canonicalizeDietaryCompliance(menuItem.dietary_compliance),
    noModifications,
    isActive: menuItem.is_active,
  };
}

export default function MenuDatabasePage() {
  const maxVisibleBackfillWarnings = 5;
  const formRef = useRef<HTMLFormElement>(null);
  const [noModifications, setNoModifications] = useState(true);
  const [selectedDietaryOptions, setSelectedDietaryOptions] = useState<DietaryOption[]>([]);
  const [menuItems, setMenuItems] = useState<MenuItemRow[]>([]);
  const [selectedMenuItem, setSelectedMenuItem] = useState<MenuItemRow | null>(null);
  const [isEditing, setIsEditing] = useState(false);
  const [editingMenuItemId, setEditingMenuItemId] = useState<string | null>(null);
  const [drawerEditState, setDrawerEditState] = useState<DrawerEditState>(
    createEmptyDrawerEditState()
  );
  const [loadingMenuItems, setLoadingMenuItems] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isBackfillingLocations, setIsBackfillingLocations] = useState(false);
  const [isBackfillingHours, setIsBackfillingHours] = useState(false);
  const [backfillResults, setBackfillResults] = useState<RestaurantLocationBackfillItem[]>([]);
  const [hoursBackfillResults, setHoursBackfillResults] = useState<RestaurantHoursBackfillItem[]>(
    []
  );
  const [saveMessage, setSaveMessage] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hoursRecord, setHoursRecord] = useState<RestaurantHoursAdminRecord | null>(null);
  const [hoursEditorDays, setHoursEditorDays] = useState<HoursEditorDay[]>(
    buildEmptyHoursEditorDays()
  );
  const [hoursLoading, setHoursLoading] = useState(false);
  const [hoursLoadError, setHoursLoadError] = useState<string | null>(null);
  const [isHoursEditing, setIsHoursEditing] = useState(false);
  const [isHoursSaving, setIsHoursSaving] = useState(false);
  const [isHoursRefreshing, setIsHoursRefreshing] = useState(false);
  const [isHoursReviewResolving, setIsHoursReviewResolving] = useState(false);
  const [pendingDuplicateCandidate, setPendingDuplicateCandidate] = useState<MenuItemRow | null>(
    null
  );
  const [duplicateOverrideConfirmed, setDuplicateOverrideConfirmed] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'All' | 'Active' | 'Inactive'>('All');

  const fetchMenuItems = async () => {
    setLoadingMenuItems(true);

    const { data, error } = await supabase
      .from('menu_items')
      .select(`
        id,
        name,
        canonical_name,
        created_at,
        updated_at,
        base_price,
        recommended_modification,
        price_with_modification,
        ingredients,
        dietary_compliance,
        is_active,
        restaurants (
          id,
          name,
          address,
          city,
          region,
          postal_code,
          latitude,
          longitude,
          online_ordering_link,
          google_place_id,
          hours_source,
          hours_last_synced_at,
          hours_sync_status,
          hours_match_confidence,
          hours_notes,
          timezone,
          place_name_from_source,
          hours_is_manually_managed
        )
      `)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Error fetching menu items:', error);
      setMenuItems([]);
      setLoadingMenuItems(false);
      return [];
    }

    const rows = (((data as RawMenuItemRow[] | null) || []).map((row) => ({
      ...row,
      restaurants: Array.isArray(row.restaurants) ? row.restaurants[0] ?? null : row.restaurants,
    })) as MenuItemRow[]) || [];
    setMenuItems(rows);
    setLoadingMenuItems(false);
    return rows;
  };

  const handleDietaryOptionChange = (option: DietaryOption) => {
    setSelectedDietaryOptions((current) => {
      const nextValues = current.includes(option)
        ? current.filter((value) => value !== option)
        : [...current, option];

      return canonicalizeDietaryCompliance(nextValues);
    });
  };

  const canonicalizeMenuItemName = (value: string) => value.trim().toLowerCase().replace(/\s+/g, ' ');

  const handleReset = () => {
    formRef.current?.reset();
    setNoModifications(true);
    setSelectedDietaryOptions([]);
    setBackfillResults([]);
    setSaveMessage(null);
    setSaveError(null);
    setPendingDuplicateCandidate(null);
    setDuplicateOverrideConfirmed(false);
  };

  const handleCloseDrawer = () => {
    setSelectedMenuItem(null);
    setIsEditing(false);
    setIsHoursEditing(false);
    setEditingMenuItemId(null);
    setDrawerEditState(createEmptyDrawerEditState());
    setHoursRecord(null);
    setHoursEditorDays(buildEmptyHoursEditorDays());
    setHoursLoadError(null);
  };

  const handleCancelEdit = () => {
    setIsEditing(false);
    setEditingMenuItemId(null);
    if (selectedMenuItem) {
      setDrawerEditState(buildDrawerEditState(selectedMenuItem));
    } else {
      setDrawerEditState(createEmptyDrawerEditState());
    }
  };

  const resolveRestaurantId = async (params: {
    restaurantName: string;
    restaurantAddress: string | null;
    restaurantCity: string | null;
    restaurantRegion: string | null;
    restaurantPostalCode: string | null;
    onlineOrderingLink: string | null;
    shouldUpdateExistingLink: boolean;
    shouldRefreshLocation: boolean;
  }) => {
    const { data: restaurantCandidates, error: restaurantFetchError } = await supabase
      .from('restaurants')
      .select(
        'id, name, address, city, region, postal_code, latitude, longitude, online_ordering_link'
      );

    if (restaurantFetchError) {
      throw restaurantFetchError;
    }

    const matchingRestaurant = (restaurantCandidates || []).find((restaurant) => {
      const normalizedCandidate = normalizeRestaurantPayload({
        restaurantName: restaurant.name,
        restaurantAddress: restaurant.address,
        restaurantCity: restaurant.city,
        restaurantRegion: restaurant.region,
        restaurantPostalCode: restaurant.postal_code,
        onlineOrderingLink: null,
      });

      return (
        normalizedCandidate.name === params.restaurantName &&
        normalizedCandidate.address === params.restaurantAddress
      );
    });

    const restaurantLocationInput = {
      address: params.restaurantAddress,
      city: params.restaurantCity,
      region: params.restaurantRegion,
      postalCode: params.restaurantPostalCode,
    };
    const shouldGeocode =
      restaurantLocationHasMeaningfulInput(restaurantLocationInput) &&
      (!matchingRestaurant ||
        params.shouldRefreshLocation ||
        matchingRestaurant.latitude === null ||
        matchingRestaurant.longitude === null ||
        restaurantLocationChanged(
          {
            address: matchingRestaurant.address,
            city: matchingRestaurant.city,
            region: matchingRestaurant.region,
            postalCode: matchingRestaurant.postal_code,
          },
          restaurantLocationInput
        ));
    const geocodeResult = shouldGeocode
      ? await geocodeRestaurantLocationViaApi(restaurantLocationInput)
      : null;
    const restaurantLocation = mergeRestaurantLocation(
      restaurantLocationInput,
      geocodeResult?.ok ? geocodeResult.data : null
    );
    const restaurantWritePayload = {
      name: params.restaurantName,
      address: restaurantLocation.address,
      city: restaurantLocation.city,
      region: restaurantLocation.region,
      postal_code: restaurantLocation.postal_code,
      latitude: restaurantLocation.latitude,
      longitude: restaurantLocation.longitude,
      online_ordering_link: params.onlineOrderingLink,
      is_active: true,
    };

    if (!matchingRestaurant) {
      const { data: insertedRestaurant, error: restaurantInsertError } = await supabase
        .from('restaurants')
        .insert(restaurantWritePayload)
        .select('id')
        .single();

      if (restaurantInsertError) {
        throw restaurantInsertError;
      }

      triggerRestaurantHoursEnrichment({
        restaurantId: insertedRestaurant.id,
        restaurantName: restaurantWritePayload.name,
        address: restaurantWritePayload.address,
        latitude: restaurantWritePayload.latitude,
        longitude: restaurantWritePayload.longitude,
      });

      return {
        restaurantId: insertedRestaurant.id,
        geocodeWarning: geocodeResult && !geocodeResult.ok ? geocodeResult.warning : null,
      };
    }

    const shouldUpdateLocation =
      params.shouldRefreshLocation ||
      matchingRestaurant.address !== restaurantWritePayload.address ||
      matchingRestaurant.city !== restaurantWritePayload.city ||
      matchingRestaurant.region !== restaurantWritePayload.region ||
      matchingRestaurant.postal_code !== restaurantWritePayload.postal_code ||
      matchingRestaurant.latitude !== restaurantWritePayload.latitude ||
      matchingRestaurant.longitude !== restaurantWritePayload.longitude;

    if (
      params.shouldUpdateExistingLink &&
      normalizeOptionalText(matchingRestaurant.online_ordering_link) !== params.onlineOrderingLink
    ) {
      restaurantWritePayload.online_ordering_link = params.onlineOrderingLink;
    }

    if (
      shouldUpdateLocation ||
      (params.shouldUpdateExistingLink &&
        normalizeOptionalText(matchingRestaurant.online_ordering_link) !== params.onlineOrderingLink)
    ) {
      const { error: restaurantUpdateError } = await supabase
        .from('restaurants')
        .update(restaurantWritePayload)
        .eq('id', matchingRestaurant.id);

      if (restaurantUpdateError) {
        throw restaurantUpdateError;
      }

      triggerRestaurantHoursEnrichment({
        restaurantId: matchingRestaurant.id,
        restaurantName: restaurantWritePayload.name,
        address: restaurantWritePayload.address,
        latitude: restaurantWritePayload.latitude,
        longitude: restaurantWritePayload.longitude,
      });
    }

    return {
      restaurantId: matchingRestaurant.id,
      geocodeWarning: geocodeResult && !geocodeResult.ok ? geocodeResult.warning : null,
    };
  };

  const buildNormalizedSubmission = (params: {
    restaurantName: string;
    restaurantAddress: string;
    restaurantCity: string;
    restaurantRegion: string;
    restaurantPostalCode: string;
    onlineOrderingLink: string;
    menuItem: string;
    basePrice: string;
    priceWithModification: string;
    recommendedModification: string;
    ingredients: string;
    dietaryOptions: DietaryOption[];
    noModifications: boolean;
  }) => {
    const restaurantPayload = normalizeRestaurantPayload({
      restaurantName: params.restaurantName,
      restaurantAddress: params.restaurantAddress,
      restaurantCity: params.restaurantCity,
      restaurantRegion: params.restaurantRegion,
      restaurantPostalCode: params.restaurantPostalCode,
      onlineOrderingLink: params.onlineOrderingLink,
    });

    const menuItemPayload = normalizeMenuItemPayload({
      menuItem: params.menuItem,
      basePrice: params.basePrice,
      priceWithModification: params.priceWithModification,
      recommendedModification: params.recommendedModification,
      ingredients: params.ingredients,
      dietaryCompliance: params.dietaryOptions,
      noModifications: params.noModifications,
    });

    const canonicalDietaryCompliance = canonicalizeDietaryCompliance(params.dietaryOptions);
    const recommendedModificationValue = normalizeOptionalText(params.recommendedModification);

    if (!restaurantPayload.name) {
      throw new Error('Restaurant Name is required.');
    }

    if (!restaurantPayload.address && !restaurantPayload.postalCode) {
      throw new Error('Restaurant Address or Postal Code is required.');
    }

    if (!menuItemPayload.name) {
      throw new Error('Menu Item is required.');
    }

    if (menuItemPayload.basePrice === null) {
      throw new Error('Base Price is required.');
    }

    if (canonicalDietaryCompliance.length === 0 || !menuItemPayload.dietaryCompliance) {
      throw new Error('Dietary Compliance is required.');
    }

    if (!params.noModifications && !recommendedModificationValue) {
      throw new Error('Recommended Modification is required when No Modifications is unchecked.');
    }

    const finalModification = params.noModifications
      ? 'No Modifications'
      : menuItemPayload.recommendedModification;
    const finalPriceWithModification = params.noModifications
      ? menuItemPayload.basePrice
      : menuItemPayload.priceWithModification;

    if (!finalModification) {
      throw new Error('Recommended Modification is required when No Modifications is unchecked.');
    }

    if (finalPriceWithModification === null) {
      throw new Error('Price w/ Modification is required.');
    }

    return {
      restaurantPayload,
      menuItemPayload,
      finalModification,
      finalPriceWithModification,
    };
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setBackfillResults([]);
    setSaveMessage(null);
    setSaveError(null);

    const formData = new FormData(event.currentTarget);

    setIsSaving(true);

    try {
      const { restaurantPayload, menuItemPayload, finalModification, finalPriceWithModification } =
        buildNormalizedSubmission({
          restaurantName: formData.get('restaurantName')?.toString() || '',
          restaurantAddress: formData.get('restaurantAddress')?.toString() || '',
          restaurantCity: formData.get('restaurantCity')?.toString() || '',
          restaurantRegion: formData.get('restaurantRegion')?.toString() || '',
          restaurantPostalCode: formData.get('restaurantPostalCode')?.toString() || '',
          onlineOrderingLink: formData.get('onlineOrderingLink')?.toString() || '',
          menuItem: formData.get('menuItem')?.toString() || '',
          basePrice: formData.get('basePrice')?.toString() || '',
          priceWithModification: formData.get('priceWithModification')?.toString() || '',
          recommendedModification: formData.get('recommendedModification')?.toString() || '',
          ingredients: formData.get('ingredients')?.toString() || '',
          dietaryOptions: selectedDietaryOptions,
          noModifications,
        });

      const newKeyParts = buildDuplicateKeyParts({
        restaurantName: restaurantPayload.name,
        restaurantAddress: restaurantPayload.address,
        menuItemName: menuItemPayload.name,
      });

      const duplicateRows = menuItems.map((item) => ({
        row: item,
        keyParts: buildDuplicateKeyParts({
          restaurantName: item.restaurants?.name,
          restaurantAddress: item.restaurants?.address,
          menuItemName: item.name,
        }),
      }));

      const hardDuplicate = duplicateRows.find(
        ({ keyParts }) =>
          keyParts.restaurant === newKeyParts.restaurant &&
          keyParts.address === newKeyParts.address &&
          keyParts.menuItem === newKeyParts.menuItem
      );

      if (hardDuplicate) {
        setPendingDuplicateCandidate(null);
        setDuplicateOverrideConfirmed(false);
        setIsSaving(false);
        setSaveError(
          `Possible duplicate blocked: this menu item already exists for that restaurant and location. (${hardDuplicate.row.restaurants?.name || '—'} — ${hardDuplicate.row.restaurants?.address || '—'} — ${hardDuplicate.row.name || '—'})`
        );
        return;
      }

      const softDuplicate = duplicateRows.find(({ keyParts }) => {
        const restaurantScore = simpleSimilarity(newKeyParts.restaurant, keyParts.restaurant);
        const addressScore = simpleSimilarity(newKeyParts.address, keyParts.address);
        const menuItemScore = simpleSimilarity(newKeyParts.menuItem, keyParts.menuItem);
        const averageScore = (restaurantScore + addressScore + menuItemScore) / 3;

        return (
          (restaurantScore >= 0.98 && addressScore >= 0.98 && menuItemScore >= 0.7) ||
          (restaurantScore >= 0.82 &&
            addressScore >= 0.82 &&
            menuItemScore >= 0.72 &&
            averageScore >= 0.82)
        );
      });

      if (softDuplicate && !duplicateOverrideConfirmed) {
        setPendingDuplicateCandidate(softDuplicate.row);
        setIsSaving(false);
        return;
      }

      const { restaurantId, geocodeWarning } = await resolveRestaurantId({
        restaurantName: restaurantPayload.name,
        restaurantAddress: restaurantPayload.address,
        restaurantCity: restaurantPayload.city,
        restaurantRegion: restaurantPayload.region,
        restaurantPostalCode: restaurantPayload.postalCode,
        onlineOrderingLink: restaurantPayload.onlineOrderingLink,
        shouldUpdateExistingLink: false,
        shouldRefreshLocation: true,
      });

      const { error: menuItemInsertError } = await supabase.from('menu_items').insert({
        restaurant_id: restaurantId,
        name: menuItemPayload.name,
        base_price: menuItemPayload.basePrice,
        recommended_modification: finalModification,
        price_with_modification: finalPriceWithModification,
        ingredients: menuItemPayload.ingredients,
        dietary_compliance: menuItemPayload.dietaryCompliance,
        is_active: true,
      });

      if (menuItemInsertError) {
        throw menuItemInsertError;
      }

      handleReset();
      setSaveMessage(
        geocodeWarning ? `Menu item saved. ${geocodeWarning}` : 'Menu item saved.'
      );
      await fetchMenuItems();
    } catch (error) {
      console.error('Error saving menu item:', error);
      setSaveError(error instanceof Error ? error.message : 'Unable to save menu item right now.');
    } finally {
      setIsSaving(false);
    }
  };

  const handleDrawerDietaryOptionChange = (option: DietaryOption) => {
    setDrawerEditState((current) => {
      const nextValues = current.dietaryOptions.includes(option)
        ? current.dietaryOptions.filter((value) => value !== option)
        : [...current.dietaryOptions, option];

      return {
        ...current,
        dietaryOptions: canonicalizeDietaryCompliance(nextValues),
      };
    });
  };

  const handleDrawerUpdate = async () => {
    if (!selectedMenuItem || !editingMenuItemId) {
      return;
    }

    setBackfillResults([]);
    setSaveMessage(null);
    setSaveError(null);
    setIsSaving(true);

    try {
      const normalizedSubmission = buildNormalizedSubmission({
        restaurantName: drawerEditState.restaurantName,
        restaurantAddress: drawerEditState.restaurantAddress,
        restaurantCity: drawerEditState.restaurantCity,
        restaurantRegion: drawerEditState.restaurantRegion,
        restaurantPostalCode: drawerEditState.restaurantPostalCode,
        onlineOrderingLink: drawerEditState.onlineOrderingLink,
        menuItem: drawerEditState.menuItem,
        basePrice: drawerEditState.basePrice,
        priceWithModification: drawerEditState.priceWithModification,
        recommendedModification: drawerEditState.recommendedModification,
        ingredients: drawerEditState.ingredients,
        dietaryOptions: drawerEditState.dietaryOptions,
        noModifications: drawerEditState.noModifications,
      });
      const { restaurantPayload, menuItemPayload, finalModification, finalPriceWithModification } =
        normalizedSubmission;
      const existingRestaurant = selectedMenuItem.restaurants;

      const menuItemUpdatePayload = {
        restaurant_id: existingRestaurant?.id,
        name: menuItemPayload.name,
        canonical_name: canonicalizeMenuItemName(menuItemPayload.name),
        base_price: menuItemPayload.basePrice,
        recommended_modification: finalModification,
        price_with_modification: finalPriceWithModification,
        ingredients: menuItemPayload.ingredients,
        dietary_compliance: menuItemPayload.dietaryCompliance,
        is_active: drawerEditState.isActive,
      };

      console.log('Drawer menu_items update', {
        editingMenuItemId,
        payload: menuItemUpdatePayload,
      });

      if (!existingRestaurant?.id) {
        throw new Error('Menu item update failed: missing restaurant reference.');
      }

      const { restaurantId, geocodeWarning } = await resolveRestaurantId({
        restaurantName: restaurantPayload.name,
        restaurantAddress: restaurantPayload.address,
        restaurantCity: restaurantPayload.city,
        restaurantRegion: restaurantPayload.region,
        restaurantPostalCode: restaurantPayload.postalCode,
        onlineOrderingLink: restaurantPayload.onlineOrderingLink,
        shouldUpdateExistingLink: true,
        shouldRefreshLocation: restaurantLocationChanged(
          {
            address: existingRestaurant.address,
            city: existingRestaurant.city,
            region: existingRestaurant.region,
            postalCode: existingRestaurant.postal_code,
          },
          {
            address: restaurantPayload.address,
            city: restaurantPayload.city,
            region: restaurantPayload.region,
            postalCode: restaurantPayload.postalCode,
          }
        ),
      });

      menuItemUpdatePayload.restaurant_id = restaurantId;

      const { data: updatedMenuItemRow, error: menuItemUpdateError } = await supabase
        .from('menu_items')
        .update(menuItemUpdatePayload)
        .eq('id', editingMenuItemId)
        .select('id')
        .single();

      console.log('Drawer menu_items update result', updatedMenuItemRow);

      if (menuItemUpdateError || !updatedMenuItemRow) {
        throw new Error('Menu item update failed: no matching row was updated.');
      }

      const updatedRows = await fetchMenuItems();
      const refreshedMenuItem = updatedRows.find((item) => item.id === editingMenuItemId) || null;

      setSelectedMenuItem(refreshedMenuItem);
      setIsEditing(false);
      setEditingMenuItemId(null);
      setSaveMessage(
        geocodeWarning ? `Menu item updated. ${geocodeWarning}` : 'Menu item updated.'
      );
    } catch (error) {
      console.error('Error updating menu item:', error);
      setSaveError(error instanceof Error ? error.message : 'Unable to update menu item right now.');
    } finally {
      setIsSaving(false);
    }
  };

  const loadRestaurantHours = async (restaurantId: string) => {
    setHoursLoading(true);
    setHoursLoadError(null);

    try {
      const response = await fetch(
        `/api/restaurants/hours?restaurantId=${encodeURIComponent(restaurantId)}`
      );
      const payload = (await response.json()) as RestaurantHoursAdminRecord | { error?: string };

      if (!response.ok) {
        throw new Error(getErrorMessage(payload));
      }

      const record = payload as RestaurantHoursAdminRecord;
      setHoursRecord(record);
      setHoursEditorDays(buildHoursEditorState(record.hours));
    } catch (error) {
      setHoursRecord(null);
      setHoursEditorDays(buildEmptyHoursEditorDays());
      setHoursLoadError(getErrorMessage(error));
    } finally {
      setHoursLoading(false);
    }
  };

  const handleHoursDayClosedChange = (dayOfWeek: number, isClosed: boolean) => {
    setHoursEditorDays((current) =>
      current.map((day) =>
        day.dayOfWeek !== dayOfWeek
          ? day
          : {
              ...day,
              isClosed,
              windows: isClosed
                ? []
                : day.windows.length > 0
                  ? day.windows
                  : [
                      {
                        id: `${dayOfWeek}-${crypto.randomUUID()}`,
                        windowIndex: 1,
                        openTimeLocal: '',
                        closeTimeLocal: '',
                      },
                    ],
            }
      )
    );
  };

  const handleHoursWindowChange = (
    dayOfWeek: number,
    windowId: string,
    field: 'openTimeLocal' | 'closeTimeLocal',
    value: string
  ) => {
    setHoursEditorDays((current) =>
      current.map((day) =>
        day.dayOfWeek !== dayOfWeek
          ? day
          : {
              ...day,
              windows: day.windows.map((window) =>
                window.id === windowId
                  ? {
                      ...window,
                      [field]: value,
                    }
                  : window
              ),
            }
      )
    );
  };

  const handleAddHoursWindow = (dayOfWeek: number) => {
    setHoursEditorDays((current) =>
      current.map((day) =>
        day.dayOfWeek !== dayOfWeek
          ? day
          : {
              ...day,
              isClosed: false,
              windows: [
                ...day.windows,
                {
                  id: `${dayOfWeek}-${crypto.randomUUID()}`,
                  windowIndex: day.windows.length + 1,
                  openTimeLocal: '',
                  closeTimeLocal: '',
                },
              ],
            }
      )
    );
  };

  const handleRemoveHoursWindow = (dayOfWeek: number, windowId: string) => {
    setHoursEditorDays((current) =>
      current.map((day) => {
        if (day.dayOfWeek !== dayOfWeek) {
          return day;
        }

        const nextWindows = day.windows
          .filter((window) => window.id !== windowId)
          .map((window, index) => ({
            ...window,
            windowIndex: index + 1,
          }));

        return {
          ...day,
          windows: nextWindows,
          isClosed: nextWindows.length === 0 ? true : day.isClosed,
        };
      })
    );
  };

  const handleHoursEditCancel = () => {
    setIsHoursEditing(false);
    setHoursEditorDays(buildHoursEditorState(hoursRecord?.hours ?? []));
  };

  const handleHoursSave = async () => {
    if (!hoursRecord) {
      return;
    }

    setIsHoursSaving(true);
    setSaveError(null);
    setSaveMessage(null);

    try {
      const response = await fetch('/api/restaurants/hours', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          restaurantId: hoursRecord.restaurantId,
          hours: buildHoursPayload(hoursEditorDays),
          note: 'Hours updated manually from Supavore Admin.',
        }),
      });
      const payload = (await response.json()) as { message?: string; error?: string };

      if (!response.ok) {
        throw new Error(getErrorMessage(payload));
      }

      setIsHoursEditing(false);
      setSaveMessage(payload.message ?? 'Operating hours saved.');
      await loadRestaurantHours(hoursRecord.restaurantId);
      await fetchMenuItems();
    } catch (error) {
      setSaveError(getErrorMessage(error));
    } finally {
      setIsHoursSaving(false);
    }
  };

  const handleHoursRefresh = async () => {
    if (!selectedMenuItem?.restaurants?.id) {
      return;
    }

    setIsHoursRefreshing(true);
    setSaveError(null);
    setSaveMessage(null);

    try {
      const result = await enrichRestaurantHoursViaApi({
        restaurantId: selectedMenuItem.restaurants.id,
        restaurantName: selectedMenuItem.restaurants.name || '',
        address: selectedMenuItem.restaurants.address,
        latitude: selectedMenuItem.restaurants.latitude,
        longitude: selectedMenuItem.restaurants.longitude,
        force: true,
      });

      setSaveMessage(result.message);
      await loadRestaurantHours(selectedMenuItem.restaurants.id);
      await fetchMenuItems();
    } catch (error) {
      setSaveError(getErrorMessage(error));
    } finally {
      setIsHoursRefreshing(false);
    }
  };

  const handleHoursReviewResolved = async (
    resolution: 'approve_candidate_and_sync' | 'reject_candidate'
  ) => {
    if (!hoursRecord) {
      return;
    }

    setIsHoursReviewResolving(true);
    setSaveError(null);
    setSaveMessage(
      resolution === 'approve_candidate_and_sync'
        ? 'Approved Google Places candidate and syncing hours...'
        : 'Rejected Google Places candidate.'
    );

    try {
      await loadRestaurantHours(hoursRecord.restaurantId);
      await fetchMenuItems();
      setSaveMessage(
        resolution === 'approve_candidate_and_sync'
          ? 'Approved Google Places candidate and synced restaurant hours.'
          : 'Rejected Google Places candidate.'
      );
    } catch (error) {
      setSaveError(getErrorMessage(error));
    } finally {
      setIsHoursReviewResolving(false);
    }
  };

  const handleLocationBackfill = async () => {
    setBackfillResults([]);
    setSaveMessage(null);
    setSaveError(null);
    setIsBackfillingLocations(true);

    try {
      const result = await backfillRestaurantLocations();
      const failedResults = result.results.filter((entry) => entry.status !== 'updated');
      const issueSuffix =
        failedResults.length > 0
          ? ` ${failedResults.length} issue${failedResults.length === 1 ? '' : 's'} logged.`
          : '';

      setBackfillResults(failedResults);
      setSaveMessage(
        `Restaurant location backfill complete. Attempted ${result.attempted}, succeeded ${result.succeeded}, failed ${result.failed}.${issueSuffix}`
      );
      await fetchMenuItems();
    } catch (error) {
      console.error('Error backfilling restaurant locations:', error);
      setSaveError(
        error instanceof Error
          ? error.message
          : 'Unable to backfill restaurant locations right now.'
      );
    } finally {
      setIsBackfillingLocations(false);
    }
  };

  const handleHoursBackfill = async () => {
    setHoursBackfillResults([]);
    setSaveMessage(null);
    setSaveError(null);
    setIsBackfillingHours(true);

    try {
      const result = await backfillRestaurantHours();
      const issueResults = result.results.filter(
        (entry) => entry.status !== 'matched_with_hours' && entry.status !== 'matched_no_hours'
      );
      const issueSuffix =
        issueResults.length > 0
          ? ` ${issueResults.length} issue${issueResults.length === 1 ? '' : 's'} logged.`
          : '';

      setHoursBackfillResults(issueResults);
      setSaveMessage(
        `Restaurant hours backfill complete. Attempted ${result.attempted}, succeeded ${result.succeeded}, failed ${result.failed}.${issueSuffix}`
      );
      await fetchMenuItems();

      if (selectedMenuItem?.restaurants?.id) {
        await loadRestaurantHours(selectedMenuItem.restaurants.id);
      }
    } catch (error) {
      setSaveError(getErrorMessage(error));
    } finally {
      setIsBackfillingHours(false);
    }
  };

  useEffect(() => {
    fetchMenuItems();
  }, []);

  useEffect(() => {
    const restaurantId = selectedMenuItem?.restaurants?.id;

    if (!restaurantId) {
      setHoursRecord(null);
      setHoursEditorDays(buildEmptyHoursEditorDays());
      setHoursLoadError(null);
      setIsHoursEditing(false);
      return;
    }

    void loadRestaurantHours(restaurantId);
  }, [selectedMenuItem?.restaurants?.id]);

  useEffect(() => {
    if (!selectedMenuItem) {
      document.body.style.overflow = '';
      return;
    }

    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = '';
    };
  }, [selectedMenuItem]);

  const textInputClassName = inputClassName();
  const hasExclusiveDietarySelection = selectedDietaryOptions.some((option) =>
    exclusiveDietaryOptions.includes(option)
  );
  const hasStandardDietarySelection = selectedDietaryOptions.some((option) =>
    standardDietaryOptions.includes(option)
  );

  const summaryCards = [
    {
      label: 'Restaurants',
      value: new Set(
        menuItems.flatMap((item) => {
          if (!item.restaurants) {
            return [];
          }

          return [
            `${normalizeWhitespace(item.restaurants.name).toLowerCase()}::${normalizeWhitespace(
              item.restaurants.address
            ).toLowerCase()}`,
          ];
        })
      ).size,
    },
    { label: 'Menu Items', value: menuItems.length },
  ];

  const normalizedSearchQuery = normalizeWhitespace(searchQuery).toLowerCase();
  const filteredMenuItems = menuItems.filter((item) => {
    const matchesStatus =
      statusFilter === 'All' ||
      (statusFilter === 'Active' ? item.is_active : !item.is_active);

    if (!matchesStatus) {
      return false;
    }

    if (!normalizedSearchQuery) {
      return true;
    }

    const searchableContent = [
      item.restaurants?.name,
      item.restaurants?.address,
      item.name,
      item.dietary_compliance,
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();

    return searchableContent.includes(normalizedSearchQuery);
  });

  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-10 text-zinc-950 sm:px-10 lg:px-16">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="space-y-3">
            <h1 className="text-4xl font-semibold tracking-tight text-zinc-950 sm:text-5xl">
              Menu Database
            </h1>
            <p className="max-w-3xl text-sm text-zinc-600 sm:text-base">
              Manage restaurant menu items and ordering data for Supavore recommendations.
            </p>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              onClick={handleLocationBackfill}
              disabled={isBackfillingLocations || isSaving || isBackfillingHours}
              className="inline-flex items-center justify-center rounded-2xl border border-zinc-200 bg-white px-5 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
            >
              {isBackfillingLocations ? 'Backfilling...' : 'Backfill Restaurant Locations'}
            </button>
            <button
              type="button"
              onClick={handleHoursBackfill}
              disabled={isBackfillingHours || isSaving || isBackfillingLocations}
              className="inline-flex items-center justify-center rounded-2xl border border-zinc-200 bg-white px-5 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
            >
              {isBackfillingHours ? 'Backfilling...' : 'Backfill Operating Hours'}
            </button>
          </div>
        </header>

        {saveError ? <p className="text-sm text-red-600">{saveError}</p> : null}
        {saveMessage ? <p className="text-sm text-zinc-600">{saveMessage}</p> : null}
        {backfillResults.length > 0 ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">Backfill issues</p>
            <ul className="mt-2 space-y-1">
              {backfillResults.slice(0, maxVisibleBackfillWarnings).map((result) => (
                <li key={`${result.restaurantId}-${result.status}`}>
                  {(result.name || 'Unknown restaurant') + ': ' + result.message}
                </li>
              ))}
              {backfillResults.length > maxVisibleBackfillWarnings ? (
                <li>
                  ...and {backfillResults.length - maxVisibleBackfillWarnings} more issue
                  {backfillResults.length - maxVisibleBackfillWarnings === 1 ? '' : 's'}.
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}
        {hoursBackfillResults.length > 0 ? (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p className="font-medium">Operating hours backfill issues</p>
            <ul className="mt-2 space-y-1">
              {hoursBackfillResults.slice(0, maxVisibleBackfillWarnings).map((result) => (
                <li key={`${result.restaurantId}-${result.status}`}>
                  {(result.name || 'Unknown restaurant') + ': ' + result.message}
                </li>
              ))}
              {hoursBackfillResults.length > maxVisibleBackfillWarnings ? (
                <li>
                  ...and {hoursBackfillResults.length - maxVisibleBackfillWarnings} more issue
                  {hoursBackfillResults.length - maxVisibleBackfillWarnings === 1 ? '' : 's'}.
                </li>
              ) : null}
            </ul>
          </div>
        ) : null}

        <section className="grid gap-4 sm:grid-cols-2">
          {summaryCards.map((card) => (
            <div
              key={card.label}
              className="rounded-2xl border border-zinc-200 bg-white p-6 shadow-sm"
            >
              <p className="text-sm font-medium text-zinc-600">{card.label}</p>
              <p className="mt-3 text-3xl font-semibold tracking-tight text-zinc-950">
                {card.value}
              </p>
            </div>
          ))}
        </section>

        <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-8 space-y-2">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-950">
              Add Menu Item
            </h2>
            <p className="text-sm text-zinc-600">
              Add a restaurant and menu item for the Supavore menu database.
            </p>
          </div>

          <form ref={formRef} onSubmit={handleSubmit} className="space-y-8">
            <div className="grid gap-5 md:grid-cols-2">
              <div>
                <FieldLabel htmlFor="restaurant-name" label="Restaurant Name" required />
                <input
                  id="restaurant-name"
                  name="restaurantName"
                  type="text"
                  className={textInputClassName}
                  placeholder="Sweetgreen"
                />
              </div>

              <div>
                <FieldLabel htmlFor="restaurant-address" label="Restaurant Address" />
                <input
                  id="restaurant-address"
                  name="restaurantAddress"
                  type="text"
                  className={textInputClassName}
                  placeholder="123 Market Street"
                />
              </div>

              <div>
                <FieldLabel htmlFor="restaurant-city" label="City" />
                <input
                  id="restaurant-city"
                  name="restaurantCity"
                  type="text"
                  className={textInputClassName}
                  placeholder="San Francisco"
                />
              </div>

              <div>
                <FieldLabel htmlFor="restaurant-region" label="Region" />
                <input
                  id="restaurant-region"
                  name="restaurantRegion"
                  type="text"
                  className={textInputClassName}
                  placeholder="CA"
                />
              </div>

              <div>
                <FieldLabel htmlFor="restaurant-postal-code" label="Postal Code" />
                <input
                  id="restaurant-postal-code"
                  name="restaurantPostalCode"
                  type="text"
                  className={textInputClassName}
                  placeholder="94103"
                />
              </div>

              <div>
                <FieldLabel htmlFor="online-ordering-link" label="Online Ordering Link" />
                <input
                  id="online-ordering-link"
                  name="onlineOrderingLink"
                  type="url"
                  className={textInputClassName}
                  placeholder="https://"
                />
              </div>

              <div>
                <FieldLabel htmlFor="menu-item" label="Menu Item" required />
                <input
                  id="menu-item"
                  name="menuItem"
                  type="text"
                  className={textInputClassName}
                  placeholder="Harvest Bowl"
                />
              </div>

              <div>
                <FieldLabel htmlFor="base-price" label="Base Price" required />
                <input
                  id="base-price"
                  name="basePrice"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  className={textInputClassName}
                  placeholder="0.00"
                />
              </div>

              <div>
                <FieldLabel
                  htmlFor="price-with-modification"
                  label="Price w/ Modification"
                  required
                />
                <input
                  id="price-with-modification"
                  name="priceWithModification"
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  className={textInputClassName}
                  placeholder="0.00"
                />
                <p className="mt-2 text-xs text-zinc-500">
                  Defaults to Base Price when No Modifications is selected.
                </p>
              </div>
            </div>

            <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/70 p-5">
              <div className="flex items-start gap-3">
                <input
                  id="no-modifications"
                  name="noModifications"
                  type="checkbox"
                  checked={noModifications}
                  onChange={(event) => setNoModifications(event.target.checked)}
                  className="mt-1 h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-300"
                />
                <div>
                  <label
                    htmlFor="no-modifications"
                    className="text-sm font-medium text-zinc-900"
                  >
                    No Modifications
                  </label>
                  <p className="mt-1 text-xs text-zinc-500">
                    Checked means this menu item is served as-is.
                  </p>
                </div>
              </div>

              {!noModifications ? (
                <div className="mt-5 max-w-3xl">
                  <FieldLabel
                    htmlFor="recommended-modification"
                    label="Recommended Modification"
                    required
                  />
                  <input
                    id="recommended-modification"
                    name="recommendedModification"
                    type="text"
                    className={textInputClassName}
                    placeholder="Swap dressing for olive oil and lemon"
                  />
                </div>
              ) : null}
            </div>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
              <div>
                <FieldLabel
                  htmlFor="dietary-compliance"
                  label="Dietary Compliance"
                  required
                />
                <div
                  id="dietary-compliance"
                  className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4"
                >
                  <div className="grid gap-3 sm:grid-cols-2">
                    {dietaryOptions.map((option) => {
                      const isSelected = selectedDietaryOptions.includes(option);
                      const isExclusiveOption = exclusiveDietaryOptions.includes(option);
                      const isDisabled =
                        !isSelected &&
                        ((hasExclusiveDietarySelection && !isExclusiveOption) ||
                          (hasStandardDietarySelection && isExclusiveOption));

                      return (
                        <label
                          key={option}
                          className={`flex items-center gap-3 rounded-xl border border-transparent px-1 py-1 text-sm ${
                            isDisabled ? 'cursor-not-allowed text-zinc-400' : 'text-zinc-700'
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleDietaryOptionChange(option)}
                            disabled={isDisabled}
                            className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-300"
                          />
                          <span>{option}</span>
                        </label>
                      );
                    })}
                  </div>
                  <p className="mt-3 text-xs text-zinc-500">
                    “None” and “Unknown” are exclusive options and should not be combined with
                    the others.
                  </p>
                </div>
              </div>

              <div>
                <FieldLabel htmlFor="ingredients" label="Ingredients" />
                <textarea
                  id="ingredients"
                  name="ingredients"
                  rows={7}
                  className={textInputClassName}
                  placeholder="Optional ingredient details"
                />
              </div>
            </div>

            <div className="flex flex-col gap-3 border-t border-zinc-200 pt-6 sm:flex-row">
              <button
                type="submit"
                disabled={isSaving}
                className="inline-flex items-center justify-center rounded-2xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:bg-neutral-800"
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
              <button
                type="button"
                onClick={handleReset}
                disabled={isSaving}
                className="inline-flex items-center justify-center rounded-2xl border border-zinc-200 bg-white px-5 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
              >
                Clear
              </button>
            </div>

            {pendingDuplicateCandidate ? (
              <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <p>
                  This appears to be a possible duplicate of{' '}
                  {`${pendingDuplicateCandidate.restaurants?.name || '—'} — ${pendingDuplicateCandidate.restaurants?.address || '—'} — ${pendingDuplicateCandidate.name || '—'}`}.
                  Click Confirm Create to continue anyway.
                </p>
                <div className="mt-3 flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    onClick={() => {
                      setDuplicateOverrideConfirmed(true);
                      formRef.current?.requestSubmit();
                    }}
                    className="inline-flex items-center justify-center rounded-2xl bg-black px-5 py-3 text-sm font-medium text-white transition hover:bg-neutral-800"
                  >
                    Confirm Create
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingDuplicateCandidate(null);
                      setDuplicateOverrideConfirmed(false);
                    }}
                    className="inline-flex items-center justify-center rounded-2xl border border-zinc-200 bg-white px-5 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}

            {saveError ? <p className="text-sm text-red-600">{saveError}</p> : null}
            {saveMessage ? <p className="text-sm text-zinc-600">{saveMessage}</p> : null}
          </form>
        </section>

        <section className="rounded-3xl border border-zinc-200 bg-white p-6 shadow-sm sm:p-8">
          <div className="mb-6">
            <h2 className="text-2xl font-semibold tracking-tight text-zinc-950">Menu Items</h2>
          </div>

          <div className="mb-6 grid gap-4 md:grid-cols-[minmax(0,1fr)_180px]">
            <div>
              <label
                htmlFor="menu-items-search"
                className="mb-2 block text-sm font-medium text-zinc-900"
              >
                Search
              </label>
              <input
                id="menu-items-search"
                type="text"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className={textInputClassName}
                placeholder="Search restaurant, address, item, or dietary compliance"
              />
            </div>

            <div>
              <label
                htmlFor="menu-items-status"
                className="mb-2 block text-sm font-medium text-zinc-900"
              >
                Status
              </label>
              <select
                id="menu-items-status"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as 'All' | 'Active' | 'Inactive')
                }
                className={textInputClassName}
              >
                <option value="All">All</option>
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </select>
            </div>
          </div>

          <div className="overflow-hidden rounded-2xl border border-zinc-200">
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-zinc-200">
                <thead className="bg-zinc-50">
                  <tr>
                    {[
                      'Restaurant Name',
                      'Restaurant Address',
                      'Menu Item',
                      'Base Price',
                      'Recommended Modification',
                      'Price w/ Modification',
                      'Dietary Compliance',
                      'Status',
                    ].map((header) => (
                      <th
                        key={header}
                        scope="col"
                        className="px-4 py-3 text-left text-xs font-semibold uppercase tracking-wide text-zinc-500"
                      >
                        {header}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-zinc-200 bg-white">
                  {loadingMenuItems ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-4 py-10 text-center text-sm text-zinc-500"
                      >
                        Loading...
                      </td>
                    </tr>
                  ) : filteredMenuItems.length === 0 ? (
                    <tr>
                      <td
                        colSpan={8}
                        className="px-4 py-10 text-center text-sm text-zinc-500"
                      >
                        {menuItems.length === 0
                          ? 'No menu items yet. Add your first restaurant + item.'
                          : 'No menu items match the current filters.'}
                      </td>
                    </tr>
                  ) : (
                    filteredMenuItems.map((row) => (
                      <tr
                        key={row.id}
                        onClick={() => setSelectedMenuItem(row)}
                        className="cursor-pointer transition hover:bg-zinc-50"
                      >
                        <td className="px-4 py-4 text-sm text-zinc-700">
                          {row.restaurants?.name || '—'}
                        </td>
                        <td className="px-4 py-4 text-sm text-zinc-700">
                          {row.restaurants?.address || '—'}
                        </td>
                        <td className="px-4 py-4 text-sm font-medium text-zinc-900">
                          {row.name || '—'}
                        </td>
                        <td className="px-4 py-4 text-sm text-zinc-700">
                          {formatPrice(row.base_price)}
                        </td>
                        <td className="px-4 py-4 text-sm text-zinc-700">
                          {row.recommended_modification || '—'}
                        </td>
                        <td className="px-4 py-4 text-sm text-zinc-700">
                          {formatPrice(row.price_with_modification)}
                        </td>
                        <td className="px-4 py-4 text-sm text-zinc-700">
                          {row.dietary_compliance || '—'}
                        </td>
                        <td className="px-4 py-4 text-sm text-zinc-700">
                          {row.is_active ? 'Active' : 'Inactive'}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {selectedMenuItem ? (
          <div
            className="fixed inset-0 z-50 flex justify-end bg-black/30"
            onClick={handleCloseDrawer}
          >
            <div
              className="h-full w-full max-w-2xl overflow-y-auto border-l border-zinc-200 bg-white p-6 shadow-2xl sm:p-8"
              onClick={(event) => event.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-4">
                <div>
                  <h2 className="text-2xl font-semibold tracking-tight text-zinc-950">
                    Menu Item Details
                  </h2>
                  <p className="mt-1 text-sm text-zinc-600">
                    {isEditing
                      ? 'Update this restaurant and menu item record.'
                      : 'Review the full record for this menu item.'}
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        onClick={handleDrawerUpdate}
                        disabled={isSaving}
                        className="inline-flex items-center justify-center rounded-2xl bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800"
                      >
                        {isSaving ? 'Updating...' : 'Update'}
                      </button>
                      <button
                        type="button"
                        onClick={handleCancelEdit}
                        disabled={isSaving}
                        className="inline-flex items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setIsEditing(true);
                        setEditingMenuItemId(selectedMenuItem.id);
                        setDrawerEditState(buildDrawerEditState(selectedMenuItem));
                      }}
                      className="inline-flex items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
                    >
                      Edit
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleCloseDrawer}
                    className="inline-flex items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
                  >
                    Close
                  </button>
                </div>
              </div>

              {saveError ? <p className="mt-4 text-sm text-red-600">{saveError}</p> : null}
              {saveMessage ? <p className="mt-4 text-sm text-zinc-600">{saveMessage}</p> : null}

              {isEditing ? (
                <div className="mt-6 space-y-6">
                  <div className="grid gap-5 sm:grid-cols-2">
                    <div>
                      <FieldLabel htmlFor="drawer-restaurant-name" label="Restaurant Name" required />
                      <input
                        id="drawer-restaurant-name"
                        type="text"
                        value={drawerEditState.restaurantName}
                        readOnly
                        className={textInputClassName}
                      />
                      <p className="mt-2 text-xs text-zinc-500">
                        To change restaurant name or location, use the Restaurants admin.
                      </p>
                    </div>

                    <div>
                      <FieldLabel
                        htmlFor="drawer-restaurant-address"
                        label="Restaurant Address"
                      />
                      <input
                        id="drawer-restaurant-address"
                        type="text"
                        value={drawerEditState.restaurantAddress}
                        onChange={(event) =>
                          setDrawerEditState((current) => ({
                            ...current,
                            restaurantAddress: event.target.value,
                          }))
                        }
                        className={textInputClassName}
                      />
                    </div>

                    <div>
                      <FieldLabel htmlFor="drawer-restaurant-city" label="City" />
                      <input
                        id="drawer-restaurant-city"
                        type="text"
                        value={drawerEditState.restaurantCity}
                        onChange={(event) =>
                          setDrawerEditState((current) => ({
                            ...current,
                            restaurantCity: event.target.value,
                          }))
                        }
                        className={textInputClassName}
                      />
                    </div>

                    <div>
                      <FieldLabel htmlFor="drawer-restaurant-region" label="Region" />
                      <input
                        id="drawer-restaurant-region"
                        type="text"
                        value={drawerEditState.restaurantRegion}
                        onChange={(event) =>
                          setDrawerEditState((current) => ({
                            ...current,
                            restaurantRegion: event.target.value,
                          }))
                        }
                        className={textInputClassName}
                      />
                    </div>

                    <div>
                      <FieldLabel htmlFor="drawer-restaurant-postal-code" label="Postal Code" />
                      <input
                        id="drawer-restaurant-postal-code"
                        type="text"
                        value={drawerEditState.restaurantPostalCode}
                        onChange={(event) =>
                          setDrawerEditState((current) => ({
                            ...current,
                            restaurantPostalCode: event.target.value,
                          }))
                        }
                        className={textInputClassName}
                      />
                    </div>

                    <div>
                      <FieldLabel
                        htmlFor="drawer-online-ordering-link"
                        label="Online Ordering Link"
                      />
                      <input
                        id="drawer-online-ordering-link"
                        type="url"
                        value={drawerEditState.onlineOrderingLink}
                        onChange={(event) =>
                          setDrawerEditState((current) => ({
                            ...current,
                            onlineOrderingLink: event.target.value,
                          }))
                        }
                        className={textInputClassName}
                      />
                    </div>

                    <div>
                      <FieldLabel htmlFor="drawer-menu-item" label="Menu Item" required />
                      <input
                        id="drawer-menu-item"
                        type="text"
                        value={drawerEditState.menuItem}
                        onChange={(event) =>
                          setDrawerEditState((current) => ({
                            ...current,
                            menuItem: event.target.value,
                          }))
                        }
                        className={textInputClassName}
                      />
                    </div>

                    <div>
                      <FieldLabel htmlFor="drawer-base-price" label="Base Price" required />
                      <input
                        id="drawer-base-price"
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        value={drawerEditState.basePrice}
                        onChange={(event) =>
                          setDrawerEditState((current) => ({
                            ...current,
                            basePrice: event.target.value,
                          }))
                        }
                        className={textInputClassName}
                      />
                    </div>

                    <div>
                      <FieldLabel
                        htmlFor="drawer-price-with-modification"
                        label="Price w/ Modification"
                        required
                      />
                      <input
                        id="drawer-price-with-modification"
                        type="number"
                        min="0"
                        step="0.01"
                        inputMode="decimal"
                        value={drawerEditState.priceWithModification}
                        onChange={(event) =>
                          setDrawerEditState((current) => ({
                            ...current,
                            priceWithModification: event.target.value,
                          }))
                        }
                        className={textInputClassName}
                      />
                    </div>
                  </div>

                  <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/70 p-5">
                    <div className="flex items-start gap-3">
                      <input
                        id="drawer-no-modifications"
                        type="checkbox"
                        checked={drawerEditState.noModifications}
                        onChange={(event) =>
                          setDrawerEditState((current) => ({
                            ...current,
                            noModifications: event.target.checked,
                            recommendedModification: event.target.checked
                              ? ''
                              : current.recommendedModification,
                          }))
                        }
                        className="mt-1 h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-300"
                      />
                      <div>
                        <label
                          htmlFor="drawer-no-modifications"
                          className="text-sm font-medium text-zinc-900"
                        >
                          No Modifications
                        </label>
                        <p className="mt-1 text-xs text-zinc-500">
                          Checked means this menu item is served as-is.
                        </p>
                      </div>
                    </div>

                    {!drawerEditState.noModifications ? (
                      <div className="mt-5">
                        <FieldLabel
                          htmlFor="drawer-recommended-modification"
                          label="Recommended Modification"
                          required
                        />
                        <input
                          id="drawer-recommended-modification"
                          type="text"
                          value={drawerEditState.recommendedModification}
                          onChange={(event) =>
                            setDrawerEditState((current) => ({
                              ...current,
                              recommendedModification: event.target.value,
                            }))
                          }
                          className={textInputClassName}
                        />
                      </div>
                    ) : null}
                  </div>

                  <div className="grid gap-5">
                    <div>
                      <FieldLabel htmlFor="drawer-status" label="Status" required />
                      <select
                        id="drawer-status"
                        value={drawerEditState.isActive ? 'Active' : 'Inactive'}
                        onChange={(event) =>
                          setDrawerEditState((current) => ({
                            ...current,
                            isActive: event.target.value === 'Active',
                          }))
                        }
                        className={textInputClassName}
                      >
                        <option value="Active">Active</option>
                        <option value="Inactive">Inactive</option>
                      </select>
                      <p className="mt-2 text-xs text-zinc-500">
                        Inactive items stay in Supabase but are excluded from app recommendations.
                      </p>
                    </div>

                    <div>
                      <FieldLabel
                        htmlFor="drawer-dietary-compliance"
                        label="Dietary Compliance"
                        required
                      />
                      <div
                        id="drawer-dietary-compliance"
                        className="rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4"
                      >
                        <div className="grid gap-3 sm:grid-cols-2">
                          {dietaryOptions.map((option) => {
                            const isSelected = drawerEditState.dietaryOptions.includes(option);
                            const isExclusiveOption = exclusiveDietaryOptions.includes(option);
                            const hasExclusiveSelection = drawerEditState.dietaryOptions.some(
                              (value) => exclusiveDietaryOptions.includes(value)
                            );
                            const hasStandardSelection = drawerEditState.dietaryOptions.some(
                              (value) => standardDietaryOptions.includes(value)
                            );
                            const isDisabled =
                              !isSelected &&
                              ((hasExclusiveSelection && !isExclusiveOption) ||
                                (hasStandardSelection && isExclusiveOption));

                            return (
                              <label
                                key={option}
                                className={`flex items-center gap-3 rounded-xl border border-transparent px-1 py-1 text-sm ${
                                  isDisabled
                                    ? 'cursor-not-allowed text-zinc-400'
                                    : 'text-zinc-700'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={isSelected}
                                  onChange={() => handleDrawerDietaryOptionChange(option)}
                                  disabled={isDisabled}
                                  className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-300"
                                />
                                <span>{option}</span>
                              </label>
                            );
                          })}
                        </div>
                        <p className="mt-3 text-xs text-zinc-500">
                          “None” and “Unknown” are exclusive options and should not be combined with
                          the others.
                        </p>
                      </div>
                    </div>

                    <div>
                      <FieldLabel htmlFor="drawer-ingredients" label="Ingredients" />
                      <textarea
                        id="drawer-ingredients"
                        rows={7}
                        value={drawerEditState.ingredients}
                        onChange={(event) =>
                          setDrawerEditState((current) => ({
                            ...current,
                            ingredients: event.target.value,
                          }))
                        }
                        className={textInputClassName}
                      />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-6 grid gap-6 sm:grid-cols-2">
        <div>
          <p className="text-xs text-zinc-500">Restaurant</p>
          <p className="text-sm font-medium text-zinc-900">
            {selectedMenuItem.restaurants?.name || '—'}
          </p>
        </div>

        <div>
          <p className="text-xs text-zinc-500">Address</p>
          <p className="text-sm text-zinc-700">
            {selectedMenuItem.restaurants?.address || '—'}
          </p>
        </div>

        <div>
          <p className="text-xs text-zinc-500">Menu Item</p>
          <p className="text-sm font-medium text-zinc-900">
            {selectedMenuItem.name || '—'}
          </p>
        </div>

        <div>
          <p className="text-xs text-zinc-500">Canonical Name</p>
          <p className="text-sm text-zinc-700">
            {selectedMenuItem.canonical_name || '—'}
          </p>
        </div>

        <div>
          <p className="text-xs text-zinc-500">Created At</p>
          <p className="text-sm text-zinc-700">
            {formatAdminTimestamp(selectedMenuItem.created_at)}
          </p>
        </div>

        <div>
          <p className="text-xs text-zinc-500">Last Updated</p>
          <p className="text-sm text-zinc-700">
            {selectedMenuItem.updated_at
              ? formatAdminTimestamp(selectedMenuItem.updated_at)
              : '—'}
          </p>
        </div>

        <div>
          <p className="text-xs text-zinc-500">Base Price</p>
          <p className="text-sm text-zinc-700">
            {formatPrice(selectedMenuItem.base_price)}
          </p>
        </div>

        <div>
          <p className="text-xs text-zinc-500">Price w/ Modification</p>
          <p className="text-sm text-zinc-700">
            {formatPrice(selectedMenuItem.price_with_modification)}
          </p>
        </div>

        <div className="sm:col-span-2">
          <p className="text-xs text-zinc-500">Recommended Modification</p>
          <p className="text-sm text-zinc-700">
            {selectedMenuItem.recommended_modification || '—'}
          </p>
        </div>

        <div className="sm:col-span-2">
          <p className="text-xs text-zinc-500">Ingredients</p>
          <p className="whitespace-pre-wrap text-sm text-zinc-700">
            {selectedMenuItem.ingredients || '—'}
          </p>
        </div>

        <div>
          <p className="text-xs text-zinc-500">Dietary Compliance</p>
          <p className="text-sm text-zinc-700">
            {selectedMenuItem.dietary_compliance || '—'}
          </p>
        </div>

        <div>
          <p className="text-xs text-zinc-500">Status</p>
          <p className="text-sm text-zinc-700">
            {selectedMenuItem.is_active ? 'Active' : 'Inactive'}
          </p>
        </div>

        <div className="sm:col-span-2">
          <p className="text-xs text-zinc-500">Ordering Link</p>
          {selectedMenuItem.restaurants?.online_ordering_link ? (
            <a
              href={selectedMenuItem.restaurants.online_ordering_link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm text-blue-600 underline"
            >
              Open ordering page
            </a>
          ) : (
            <p className="text-sm text-zinc-700">—</p>
          )}
        </div>
                </div>
              )}

              <section className="mt-8 rounded-3xl border border-zinc-200 bg-zinc-50/60 p-5 sm:p-6">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <h3 className="text-lg font-semibold text-zinc-950">Operating Hours</h3>
                    <p className="mt-1 text-sm text-zinc-600">
                      Review stored hours, make manual edits, or refresh from Google Places.
                    </p>
                  </div>

                  <div className="flex flex-wrap gap-3">
                    {isHoursEditing ? (
                      <>
                        <button
                          type="button"
                          onClick={handleHoursSave}
                          disabled={isHoursSaving || hoursLoading || isHoursReviewResolving}
                          className="inline-flex items-center justify-center rounded-2xl bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-zinc-300"
                        >
                          {isHoursSaving ? 'Saving...' : 'Save Hours'}
                        </button>
                        <button
                          type="button"
                          onClick={handleHoursEditCancel}
                          disabled={isHoursSaving || isHoursReviewResolving}
                          className="inline-flex items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
                        >
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() => setIsHoursEditing(true)}
                        disabled={hoursLoading || !hoursRecord || isHoursReviewResolving}
                        className="inline-flex items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
                      >
                        Edit Hours
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={handleHoursRefresh}
                      disabled={
                        isHoursRefreshing ||
                        hoursLoading ||
                        isHoursReviewResolving ||
                        !selectedMenuItem.restaurants?.id
                      }
                      className="inline-flex items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
                    >
                      {isHoursRefreshing ? 'Refreshing...' : 'Refresh Hours from Google'}
                    </button>
                  </div>
                </div>

                {hoursLoadError ? <p className="mt-4 text-sm text-red-600">{hoursLoadError}</p> : null}

                {hoursRecord?.pendingReviewId ? (
                  <div className="mt-5 rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="font-medium">Needs Review</p>
                        <p className="mt-1">
                          {hoursRecord.pendingReviewSummary || 'A Google Places candidate needs admin review.'}
                        </p>
                        {hoursRecord.pendingReviewConfidence !== null &&
                        hoursRecord.pendingReviewConfidence !== undefined ? (
                          <p className="mt-1 text-xs text-amber-800">
                            Confidence: {hoursRecord.pendingReviewConfidence.toFixed(2)}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex flex-col gap-2 sm:items-end">
                        <ReviewActions
                          reviewId={hoursRecord.pendingReviewId}
                          approveLabel="Approve & Sync"
                          rejectLabel="Reject"
                          onResolved={handleHoursReviewResolved}
                        />
                        <Link
                          href="/admin/reviews"
                          className="inline-flex items-center justify-center rounded-xl border border-amber-300 bg-white px-4 py-2 text-sm font-medium text-amber-900 transition hover:bg-amber-100"
                        >
                          Open Reviews
                        </Link>
                      </div>
                    </div>
                  </div>
                ) : null}

                {hoursRecord ? (
                  <div className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                      <p className="text-xs text-zinc-500">Source</p>
                      <p className="mt-1 text-sm text-zinc-800">{hoursRecord.hoursSource || '—'}</p>
                    </div>
                    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                      <p className="text-xs text-zinc-500">Sync Status</p>
                      <p className="mt-1 text-sm text-zinc-800">{hoursRecord.hoursSyncStatus || '—'}</p>
                    </div>
                    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                      <p className="text-xs text-zinc-500">Last Synced</p>
                      <p className="mt-1 text-sm text-zinc-800">
                        {hoursRecord.hoursLastSyncedAt
                          ? formatAdminTimestamp(hoursRecord.hoursLastSyncedAt)
                          : '—'}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                      <p className="text-xs text-zinc-500">Timezone</p>
                      <p className="mt-1 text-sm text-zinc-800">{hoursRecord.timezone || '—'}</p>
                    </div>
                    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                      <p className="text-xs text-zinc-500">Google Place ID</p>
                      <p className="mt-1 break-all text-sm text-zinc-800">
                        {hoursRecord.googlePlaceId || '—'}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                      <p className="text-xs text-zinc-500">Manual Lock</p>
                      <p className="mt-1 text-sm text-zinc-800">
                        {hoursRecord.hoursIsManuallyManaged ? 'Enabled' : 'Off'}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-zinc-200 bg-white p-4">
                      <p className="text-xs text-zinc-500">Review Status</p>
                      <p className="mt-1 text-sm text-zinc-800">
                        {hoursRecord.pendingReviewId ? 'Pending review' : 'None'}
                      </p>
                    </div>
                    <div className="rounded-2xl border border-zinc-200 bg-white p-4 sm:col-span-2 xl:col-span-3">
                      <p className="text-xs text-zinc-500">Source Place Name / Notes</p>
                      <p className="mt-1 text-sm text-zinc-800">
                        {hoursRecord.placeNameFromSource || '—'}
                        {hoursRecord.hoursNotes ? ` · ${hoursRecord.hoursNotes}` : ''}
                      </p>
                    </div>
                    {hoursRecord.pendingReviewPayload ? (
                      <>
                        <div className="rounded-2xl border border-zinc-200 bg-white p-4 sm:col-span-2 xl:col-span-3">
                          <p className="text-xs text-zinc-500">Review Candidate</p>
                          <p className="mt-1 text-sm font-medium text-zinc-900">
                            {typeof hoursRecord.pendingReviewPayload.matchedDisplayName === 'string'
                              ? hoursRecord.pendingReviewPayload.matchedDisplayName
                              : '—'}
                          </p>
                          <p className="mt-1 text-sm text-zinc-600">
                            {typeof hoursRecord.pendingReviewPayload.candidateFormattedAddress === 'string'
                              ? hoursRecord.pendingReviewPayload.candidateFormattedAddress
                              : '—'}
                          </p>
                          {typeof hoursRecord.pendingReviewPayload.placeId === 'string' ? (
                            <p className="mt-2 break-all text-xs text-zinc-500">
                              Place ID: {hoursRecord.pendingReviewPayload.placeId}
                            </p>
                          ) : null}
                        </div>
                        <div className="rounded-2xl border border-zinc-200 bg-white p-4 sm:col-span-2 xl:col-span-3">
                          <p className="text-xs text-zinc-500">Match Signals</p>
                          <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                            <div className="rounded-2xl border border-zinc-100 bg-zinc-50 p-3">
                              <p className="text-xs text-zinc-500">Raw name</p>
                              <p className="mt-1 text-sm text-zinc-800">
                                {formatScore(
                                  (hoursRecord.pendingReviewPayload.scoreBreakdown as Record<string, unknown> | null)
                                    ?.rawNameScore
                                )}
                              </p>
                            </div>
                            <div className="rounded-2xl border border-zinc-100 bg-zinc-50 p-3">
                              <p className="text-xs text-zinc-500">Normalized name</p>
                              <p className="mt-1 text-sm text-zinc-800">
                                {formatScore(
                                  (hoursRecord.pendingReviewPayload.scoreBreakdown as Record<string, unknown> | null)
                                    ?.normalizedNameScore
                                )}
                              </p>
                            </div>
                            <div className="rounded-2xl border border-zinc-100 bg-zinc-50 p-3">
                              <p className="text-xs text-zinc-500">Address</p>
                              <p className="mt-1 text-sm text-zinc-800">
                                {formatScore(
                                  (hoursRecord.pendingReviewPayload.scoreBreakdown as Record<string, unknown> | null)
                                    ?.addressScore
                                )}
                              </p>
                            </div>
                            <div className="rounded-2xl border border-zinc-100 bg-zinc-50 p-3">
                              <p className="text-xs text-zinc-500">Distance</p>
                              <p className="mt-1 text-sm text-zinc-800">
                                {formatScore(
                                  (hoursRecord.pendingReviewPayload.scoreBreakdown as Record<string, unknown> | null)
                                    ?.distanceScore
                                )}
                              </p>
                            </div>
                          </div>
                        </div>
                      </>
                    ) : null}
                  </div>
                ) : null}

                {hoursLoading ? (
                  <p className="mt-5 text-sm text-zinc-500">Loading operating hours...</p>
                ) : isHoursEditing ? (
                  <div className="mt-6 space-y-4">
                    {hoursEditorDays.map((day) => (
                      <div
                        key={day.dayOfWeek}
                        className="rounded-2xl border border-zinc-200 bg-white p-4"
                      >
                        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                          <div>
                            <p className="text-sm font-medium text-zinc-900">
                              {weekdayLabels[day.dayOfWeek]}
                            </p>
                            <p className="text-xs text-zinc-500">
                              {day.isClosed ? 'Closed all day' : 'Set one or more opening windows.'}
                            </p>
                          </div>

                          <label className="flex items-center gap-2 text-sm text-zinc-700">
                            <input
                              type="checkbox"
                              checked={day.isClosed}
                              onChange={(event) =>
                                handleHoursDayClosedChange(day.dayOfWeek, event.target.checked)
                              }
                              className="h-4 w-4 rounded border-zinc-300 text-zinc-900 focus:ring-zinc-300"
                            />
                            Closed
                          </label>
                        </div>

                        {day.isClosed ? null : (
                          <div className="mt-4 space-y-3">
                            {day.windows.map((window) => (
                              <div
                                key={window.id}
                                className="grid gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-3 sm:grid-cols-[1fr_1fr_auto]"
                              >
                                <div>
                                  <FieldLabel
                                    htmlFor={`hours-open-${day.dayOfWeek}-${window.id}`}
                                    label={`Open ${window.windowIndex}`}
                                  />
                                  <input
                                    id={`hours-open-${day.dayOfWeek}-${window.id}`}
                                    type="time"
                                    value={window.openTimeLocal}
                                    onChange={(event) =>
                                      handleHoursWindowChange(
                                        day.dayOfWeek,
                                        window.id,
                                        'openTimeLocal',
                                        event.target.value
                                      )
                                    }
                                    className={textInputClassName}
                                  />
                                </div>
                                <div>
                                  <FieldLabel
                                    htmlFor={`hours-close-${day.dayOfWeek}-${window.id}`}
                                    label={`Close ${window.windowIndex}`}
                                  />
                                  <input
                                    id={`hours-close-${day.dayOfWeek}-${window.id}`}
                                    type="time"
                                    value={window.closeTimeLocal}
                                    onChange={(event) =>
                                      handleHoursWindowChange(
                                        day.dayOfWeek,
                                        window.id,
                                        'closeTimeLocal',
                                        event.target.value
                                      )
                                    }
                                    className={textInputClassName}
                                  />
                                </div>
                                <div className="flex items-end">
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveHoursWindow(day.dayOfWeek, window.id)}
                                    className="inline-flex items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
                                  >
                                    Remove
                                  </button>
                                </div>
                              </div>
                            ))}
                            <button
                              type="button"
                              onClick={() => handleAddHoursWindow(day.dayOfWeek)}
                              className="inline-flex items-center justify-center rounded-2xl border border-zinc-200 bg-white px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
                            >
                              Add Window
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="mt-6 space-y-3">
                    {weekdayLabels.map((label, dayOfWeek) => {
                      const dayHours = (hoursRecord?.hours ?? []).filter(
                        (hour) => hour.dayOfWeek === dayOfWeek
                      );
                      const hasClosedWindow = dayHours.some((hour) => hour.isClosed);

                      return (
                        <div
                          key={label}
                          className="flex flex-col gap-2 rounded-2xl border border-zinc-200 bg-white p-4 sm:flex-row sm:items-start sm:justify-between"
                        >
                          <p className="text-sm font-medium text-zinc-900">{label}</p>
                          <div className="text-sm text-zinc-700 sm:text-right">
                            {dayHours.length === 0 ? (
                              <p>No saved hours.</p>
                            ) : hasClosedWindow ? (
                              <p>Closed</p>
                            ) : (
                              dayHours.map((hour) => (
                                <p key={`${label}-${hour.windowIndex}`}>
                                  {`${formatHoursDisplayTime(hour.openTimeLocal)} - ${formatHoursDisplayTime(hour.closeTimeLocal)}`}
                                </p>
                              ))
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            </div>
          </div>
        ) : null}
      </div>
    </main>
  );
}
