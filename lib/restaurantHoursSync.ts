import 'server-only';

import {
  enrichRestaurantHoursFromGoogle,
  type EnrichedRestaurantHoursResult,
  type EnrichedRestaurantHoursWindow,
  type GooglePlaceHoursEnrichmentInput,
} from '@/lib/googlePlacesHours';
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin';

export type RestaurantHoursSyncStatus =
  | EnrichedRestaurantHoursResult['status']
  | 'manual_override'
  | 'skipped_manual_lock'
  | 'update_error';

export type RestaurantHoursSyncResult = {
  ok: boolean;
  restaurantId: string;
  status: RestaurantHoursSyncStatus;
  message: string;
  rowsReplaced: boolean;
  metadataUpdated: boolean;
  manualLockSkipped: boolean;
};

export type RestaurantHoursAdminWindow = {
  id?: string;
  dayOfWeek: number;
  openTimeLocal: string | null;
  closeTimeLocal: string | null;
  isClosed: boolean;
  windowIndex: number;
  source: string | null;
};

export type RestaurantHoursAdminRecord = {
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

type RestaurantHoursRestaurantRecord = {
  id: string;
  name: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  google_place_id: string | null;
  hours_source: string | null;
  hours_last_synced_at: string | null;
  hours_sync_status: string | null;
  hours_match_confidence: number | null;
  hours_notes: string | null;
  timezone: string | null;
  place_name_from_source: string | null;
  hours_is_manually_managed: boolean;
};

type RestaurantHoursStoredRow = {
  id: string;
  restaurant_id: string;
  day_of_week: number;
  open_time_local: string | null;
  close_time_local: string | null;
  is_closed: boolean;
  window_index: number;
  source: string | null;
};

type RestaurantHoursWriteRow = {
  restaurant_id: string;
  day_of_week: number;
  open_time_local: string | null;
  close_time_local: string | null;
  is_closed: boolean;
  window_index: number;
  source: string | null;
};

type RestaurantHoursMetadataUpdate = {
  google_place_id?: string | null;
  hours_source?: string | null;
  hours_last_synced_at?: string | null;
  hours_sync_status?: string | null;
  hours_match_confidence?: number | null;
  hours_notes?: string | null;
  timezone?: string | null;
  place_name_from_source?: string | null;
  hours_is_manually_managed?: boolean;
};

type RestaurantHoursSyncDependencies = {
  enrichHours: (input: GooglePlaceHoursEnrichmentInput) => Promise<EnrichedRestaurantHoursResult>;
  getRestaurantById: (restaurantId: string) => Promise<RestaurantHoursRestaurantRecord | null>;
  listRestaurantHours: (restaurantId: string) => Promise<RestaurantHoursStoredRow[]>;
  getPendingReview: (restaurantId: string) => Promise<{
    id: string;
    summary: string | null;
    confidence: number | null;
    review_payload: Record<string, unknown>;
  } | null>;
  upsertReviewForResult: (
    restaurant: RestaurantHoursRestaurantRecord,
    result: EnrichedRestaurantHoursResult
  ) => Promise<string | null>;
  clearHoursReview: (restaurantId: string) => Promise<string | null>;
  upsertRestaurantHours: (rows: RestaurantHoursWriteRow[]) => Promise<string | null>;
  deleteRestaurantHours: (rowIds: string[]) => Promise<string | null>;
  updateRestaurantMetadata: (
    restaurantId: string,
    payload: RestaurantHoursMetadataUpdate
  ) => Promise<string | null>;
};

type ManualRestaurantHoursInput = {
  dayOfWeek: number;
  openTimeLocal: string | null;
  closeTimeLocal: string | null;
  isClosed: boolean;
  windowIndex: number;
  source?: string | null;
};

type PersistRestaurantHoursParams = {
  restaurantId: string;
  result: EnrichedRestaurantHoursResult;
  force?: boolean;
};

function createServerRestaurantHoursSyncDependencies(): RestaurantHoursSyncDependencies {
  const supabaseAdmin = createSupabaseAdminClient();

  return {
    enrichHours(input) {
      return enrichRestaurantHoursFromGoogle(input);
    },
    async getRestaurantById(restaurantId) {
      const { data, error } = await supabaseAdmin
        .from('restaurants')
        .select(
          'id, name, address, latitude, longitude, google_place_id, hours_source, hours_last_synced_at, hours_sync_status, hours_match_confidence, hours_notes, timezone, place_name_from_source, hours_is_manually_managed'
        )
        .eq('id', restaurantId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return (data as RestaurantHoursRestaurantRecord | null) ?? null;
    },
    async listRestaurantHours(restaurantId) {
      const { data, error } = await supabaseAdmin
        .from('restaurant_hours')
        .select(
          'id, restaurant_id, day_of_week, open_time_local, close_time_local, is_closed, window_index, source'
        )
        .eq('restaurant_id', restaurantId)
        .order('day_of_week', { ascending: true })
        .order('window_index', { ascending: true });

      if (error) {
        throw error;
      }

      return (data as RestaurantHoursStoredRow[] | null) ?? [];
    },
    async getPendingReview(restaurantId) {
      const { data, error } = await supabaseAdmin
        .from('admin_review_queue')
        .select('id, summary, confidence, review_payload')
        .eq('review_type', 'restaurant_hours_place_match')
        .eq('entity_type', 'restaurant')
        .eq('entity_id', restaurantId)
        .eq('status', 'pending')
        .maybeSingle();

      if (error) {
        throw error;
      }

      return (data as {
        id: string;
        summary: string | null;
        confidence: number | null;
        review_payload: Record<string, unknown>;
      } | null) ?? null;
    },
    async upsertReviewForResult(restaurant, result) {
      const queueModule = await import('@/lib/adminReviewQueue');

      if (result.status !== 'review_required_match') {
        return null;
      }

      return queueModule.upsertHoursPlaceMatchReview({
        restaurantId: restaurant.id,
        summary: result.note ?? null,
        confidence: result.matchConfidence ?? null,
        reviewPayload: {
          restaurantName: restaurant.name ?? null,
          restaurantAddress: restaurant.address ?? null,
          placeId: result.placeId ?? null,
          matchedDisplayName: result.matchedDisplayName ?? null,
          candidateFormattedAddress: result.candidateFormattedAddress ?? null,
          candidateLatitude: result.candidateLatitude ?? null,
          candidateLongitude: result.candidateLongitude ?? null,
          scoreBreakdown: result.scoreBreakdown ?? null,
          source: result.source ?? null,
        },
      });
    },
    async clearHoursReview(restaurantId) {
      const queueModule = await import('@/lib/adminReviewQueue');
      return queueModule.clearHoursPlaceMatchReview(restaurantId);
    },
    async upsertRestaurantHours(rows) {
      if (!rows.length) {
        return null;
      }

      const { error } = await supabaseAdmin
        .from('restaurant_hours')
        .upsert(rows, { onConflict: 'restaurant_id,day_of_week,window_index' });

      return error?.message ?? null;
    },
    async deleteRestaurantHours(rowIds) {
      if (!rowIds.length) {
        return null;
      }

      const { error } = await supabaseAdmin.from('restaurant_hours').delete().in('id', rowIds);
      return error?.message ?? null;
    },
    async updateRestaurantMetadata(restaurantId, payload) {
      const { error } = await supabaseAdmin.from('restaurants').update(payload).eq('id', restaurantId);
      return error?.message ?? null;
    },
  };
}

function nowIsoString() {
  return new Date().toISOString();
}

function normalizeTimeString(value: string | null | undefined) {
  if (value === null || value === undefined) {
    return null;
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    return null;
  }

  if (/^\d{2}:\d{2}$/.test(normalizedValue)) {
    return `${normalizedValue}:00`;
  }

  if (/^\d{2}:\d{2}:\d{2}$/.test(normalizedValue)) {
    return normalizedValue;
  }

  throw new Error(`Invalid local time value: ${value}`);
}

function keyForHoursWindow(dayOfWeek: number, windowIndex: number) {
  return `${dayOfWeek}:${windowIndex}`;
}

function buildStoredHoursRow(
  restaurantId: string,
  window: EnrichedRestaurantHoursWindow
): RestaurantHoursWriteRow {
  return {
    restaurant_id: restaurantId,
    day_of_week: window.dayOfWeek,
    open_time_local: normalizeTimeString(window.openTimeLocal),
    close_time_local: normalizeTimeString(window.closeTimeLocal),
    is_closed: window.isClosed,
    window_index: window.windowIndex + 1,
    source: window.source,
  };
}

function sortAdminHours(rows: RestaurantHoursAdminWindow[]) {
  return [...rows].sort((left, right) => {
    if (left.dayOfWeek !== right.dayOfWeek) {
      return left.dayOfWeek - right.dayOfWeek;
    }

    return left.windowIndex - right.windowIndex;
  });
}

function toAdminHoursWindow(row: RestaurantHoursStoredRow): RestaurantHoursAdminWindow {
  return {
    id: row.id,
    dayOfWeek: row.day_of_week,
    openTimeLocal: row.open_time_local,
    closeTimeLocal: row.close_time_local,
    isClosed: row.is_closed,
    windowIndex: row.window_index,
    source: row.source,
  };
}

function buildGoogleMetadataUpdate(
  currentRestaurant: RestaurantHoursRestaurantRecord,
  result: EnrichedRestaurantHoursResult,
  params: {
    rowsReplaced: boolean;
    clearManualLock: boolean;
  }
): RestaurantHoursMetadataUpdate {
  const update: RestaurantHoursMetadataUpdate = {
    google_place_id: result.placeId ?? currentRestaurant.google_place_id,
    hours_last_synced_at: nowIsoString(),
    hours_sync_status: result.status,
    hours_match_confidence: result.matchConfidence ?? null,
    hours_notes: result.note ?? null,
    timezone: result.timezone ?? currentRestaurant.timezone,
    place_name_from_source:
      result.matchedDisplayName ?? currentRestaurant.place_name_from_source ?? null,
    hours_is_manually_managed: params.clearManualLock
      ? false
      : currentRestaurant.hours_is_manually_managed,
  };

  if (params.rowsReplaced) {
    update.hours_source = result.source ?? 'google_places_new';
  }

  return update;
}

function buildManualMetadataUpdate(note?: string | null): RestaurantHoursMetadataUpdate {
  return {
    hours_source: 'admin_manual',
    hours_last_synced_at: nowIsoString(),
    hours_sync_status: 'manual_override',
    hours_notes: note ?? null,
    hours_is_manually_managed: true,
  };
}

async function replaceRestaurantHoursRows(
  restaurantId: string,
  desiredRows: RestaurantHoursWriteRow[],
  dependencies: RestaurantHoursSyncDependencies
) {
  const upsertError = await dependencies.upsertRestaurantHours(desiredRows);

  if (upsertError) {
    return upsertError;
  }

  const persistedRows = await dependencies.listRestaurantHours(restaurantId);
  const desiredKeys = new Set(
    desiredRows.map((row) => keyForHoursWindow(row.day_of_week, row.window_index))
  );
  const staleRowIds = persistedRows
    .filter((row) => !desiredKeys.has(keyForHoursWindow(row.day_of_week, row.window_index)))
    .map((row) => row.id);

  return dependencies.deleteRestaurantHours(staleRowIds);
}

async function upsertOrClearReviewForResult(
  restaurant: RestaurantHoursRestaurantRecord,
  result: EnrichedRestaurantHoursResult,
  dependencies: RestaurantHoursSyncDependencies
) {
  if (result.status === 'matched_with_hours') {
    return dependencies.clearHoursReview(restaurant.id);
  }

  if (result.status !== 'review_required_match') {
    return null;
  }

  return dependencies.upsertReviewForResult(restaurant, result);
}

function buildManualHoursRows(
  restaurantId: string,
  hours: ManualRestaurantHoursInput[]
): RestaurantHoursWriteRow[] {
  const hoursByDay = new Map<number, ManualRestaurantHoursInput[]>();

  for (const hour of hours) {
    if (!Number.isInteger(hour.dayOfWeek) || hour.dayOfWeek < 0 || hour.dayOfWeek > 6) {
      throw new Error(`Invalid day of week: ${hour.dayOfWeek}`);
    }

    if (!Number.isInteger(hour.windowIndex) || hour.windowIndex < 1) {
      throw new Error(`Invalid window index: ${hour.windowIndex}`);
    }

    const currentDayHours = hoursByDay.get(hour.dayOfWeek) ?? [];
    currentDayHours.push(hour);
    hoursByDay.set(hour.dayOfWeek, currentDayHours);
  }

  const normalizedRows: RestaurantHoursWriteRow[] = [];

  for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek += 1) {
    const rawDayHours = (hoursByDay.get(dayOfWeek) ?? []).sort(
      (left, right) => left.windowIndex - right.windowIndex
    );

    if (!rawDayHours.length) {
      normalizedRows.push({
        restaurant_id: restaurantId,
        day_of_week: dayOfWeek,
        open_time_local: null,
        close_time_local: null,
        is_closed: true,
        window_index: 1,
        source: 'admin_manual',
      });
      continue;
    }

    const hasClosedWindow = rawDayHours.some((hour) => hour.isClosed);

    if (hasClosedWindow) {
      normalizedRows.push({
        restaurant_id: restaurantId,
        day_of_week: dayOfWeek,
        open_time_local: null,
        close_time_local: null,
        is_closed: true,
        window_index: 1,
        source: 'admin_manual',
      });
      continue;
    }

    for (const hour of rawDayHours) {
      normalizedRows.push({
        restaurant_id: restaurantId,
        day_of_week: dayOfWeek,
        open_time_local: normalizeTimeString(hour.openTimeLocal),
        close_time_local: normalizeTimeString(hour.closeTimeLocal),
        is_closed: false,
        window_index: hour.windowIndex,
        source: 'admin_manual',
      });
    }
  }

  return normalizedRows;
}

export async function getRestaurantHoursForAdmin(
  restaurantId: string,
  dependencies: RestaurantHoursSyncDependencies = createServerRestaurantHoursSyncDependencies()
): Promise<RestaurantHoursAdminRecord | null> {
  const restaurant = await dependencies.getRestaurantById(restaurantId);

  if (!restaurant) {
    return null;
  }

  const hours = await dependencies.listRestaurantHours(restaurantId);
  const pendingReview = await dependencies.getPendingReview(restaurantId);

  return {
    restaurantId: restaurant.id,
    googlePlaceId: restaurant.google_place_id,
    hoursSource: restaurant.hours_source,
    hoursLastSyncedAt: restaurant.hours_last_synced_at,
    hoursSyncStatus: restaurant.hours_sync_status,
    hoursMatchConfidence: restaurant.hours_match_confidence,
    hoursNotes: restaurant.hours_notes,
    timezone: restaurant.timezone,
    placeNameFromSource: restaurant.place_name_from_source,
    hoursIsManuallyManaged: restaurant.hours_is_manually_managed,
    pendingReviewId: pendingReview?.id ?? null,
    pendingReviewSummary: pendingReview?.summary ?? null,
    pendingReviewConfidence: pendingReview?.confidence ?? null,
    pendingReviewPayload: pendingReview?.review_payload ?? null,
    hours: sortAdminHours(hours.map(toAdminHoursWindow)),
  };
}

export async function persistRestaurantHoursResult(
  params: PersistRestaurantHoursParams,
  dependencies: RestaurantHoursSyncDependencies = createServerRestaurantHoursSyncDependencies()
): Promise<RestaurantHoursSyncResult> {
  const restaurant = await dependencies.getRestaurantById(params.restaurantId);

  if (!restaurant) {
    return {
      ok: false,
      restaurantId: params.restaurantId,
      status: 'update_error',
      message: 'Restaurant could not be found before persisting hours.',
      rowsReplaced: false,
      metadataUpdated: false,
      manualLockSkipped: false,
    };
  }

  const shouldReplaceRows =
    params.result.status === 'matched_with_hours' && Boolean(params.result.hours?.length);
  const shouldClearManualLock = Boolean(
    params.force && shouldReplaceRows && restaurant.hours_is_manually_managed
  );

  if (shouldReplaceRows) {
    const desiredRows = (params.result.hours ?? []).map((window) =>
      buildStoredHoursRow(params.restaurantId, window)
    );
    const replaceError = await replaceRestaurantHoursRows(
      params.restaurantId,
      desiredRows,
      dependencies
    );

    if (replaceError) {
      return {
        ok: false,
        restaurantId: params.restaurantId,
        status: 'update_error',
        message: replaceError,
        rowsReplaced: false,
        metadataUpdated: false,
        manualLockSkipped: false,
      };
    }
  }

  const metadataUpdate = buildGoogleMetadataUpdate(restaurant, params.result, {
    rowsReplaced: shouldReplaceRows,
    clearManualLock: shouldClearManualLock,
  });
  const updateError = await dependencies.updateRestaurantMetadata(params.restaurantId, metadataUpdate);

  if (updateError) {
    return {
      ok: false,
      restaurantId: params.restaurantId,
      status: 'update_error',
      message: updateError,
      rowsReplaced: shouldReplaceRows,
      metadataUpdated: false,
      manualLockSkipped: false,
    };
  }

  const reviewError = await upsertOrClearReviewForResult(restaurant, params.result, dependencies);

  if (reviewError) {
    return {
      ok: false,
      restaurantId: params.restaurantId,
      status: 'update_error',
      message: reviewError,
      rowsReplaced: shouldReplaceRows,
      metadataUpdated: true,
      manualLockSkipped: false,
    };
  }

  return {
    ok:
      params.result.status === 'matched_with_hours' ||
      params.result.status === 'matched_no_hours' ||
      params.result.status === 'review_required_match',
    restaurantId: params.restaurantId,
    status: params.result.status,
    message: params.result.note ?? 'Restaurant hours sync completed.',
    rowsReplaced: shouldReplaceRows,
    metadataUpdated: true,
    manualLockSkipped: false,
  };
}

export async function syncRestaurantHoursFromGoogle(
  params: {
    restaurantId: string;
    restaurantName: string;
    address: string | null;
    latitude?: number | null;
    longitude?: number | null;
    force?: boolean;
  },
  dependencies: RestaurantHoursSyncDependencies = createServerRestaurantHoursSyncDependencies()
): Promise<RestaurantHoursSyncResult> {
  const restaurant = await dependencies.getRestaurantById(params.restaurantId);

  if (!restaurant) {
    return {
      ok: false,
      restaurantId: params.restaurantId,
      status: 'update_error',
      message: 'Restaurant could not be found before syncing hours.',
      rowsReplaced: false,
      metadataUpdated: false,
      manualLockSkipped: false,
    };
  }

  if (restaurant.hours_is_manually_managed && !params.force) {
    return {
      ok: true,
      restaurantId: params.restaurantId,
      status: 'skipped_manual_lock',
      message: 'Restaurant hours are manually managed, so Google sync was skipped.',
      rowsReplaced: false,
      metadataUpdated: false,
      manualLockSkipped: true,
    };
  }

  const result = await dependencies.enrichHours({
    restaurantName: params.restaurantName,
    address: params.address,
    latitude: params.latitude ?? null,
    longitude: params.longitude ?? null,
  });

  return persistRestaurantHoursResult(
    {
      restaurantId: params.restaurantId,
      result,
      force: params.force,
    },
    dependencies
  );
}

export async function updateRestaurantHoursManually(
  params: {
    restaurantId: string;
    hours: ManualRestaurantHoursInput[];
    note?: string | null;
  },
  dependencies: RestaurantHoursSyncDependencies = createServerRestaurantHoursSyncDependencies()
): Promise<RestaurantHoursSyncResult> {
  const restaurant = await dependencies.getRestaurantById(params.restaurantId);

  if (!restaurant) {
    return {
      ok: false,
      restaurantId: params.restaurantId,
      status: 'update_error',
      message: 'Restaurant could not be found before saving manual hours.',
      rowsReplaced: false,
      metadataUpdated: false,
      manualLockSkipped: false,
    };
  }

  const desiredRows = buildManualHoursRows(params.restaurantId, params.hours);
  const replaceError = await replaceRestaurantHoursRows(params.restaurantId, desiredRows, dependencies);

  if (replaceError) {
    return {
      ok: false,
      restaurantId: params.restaurantId,
      status: 'update_error',
      message: replaceError,
      rowsReplaced: false,
      metadataUpdated: false,
      manualLockSkipped: false,
    };
  }

  const updateError = await dependencies.updateRestaurantMetadata(
    params.restaurantId,
    buildManualMetadataUpdate(params.note)
  );

  if (updateError) {
    return {
      ok: false,
      restaurantId: params.restaurantId,
      status: 'update_error',
      message: updateError,
      rowsReplaced: true,
      metadataUpdated: false,
      manualLockSkipped: false,
    };
  }

  const clearReviewError = await dependencies.clearHoursReview(params.restaurantId);

  if (clearReviewError) {
    return {
      ok: false,
      restaurantId: params.restaurantId,
      status: 'update_error',
      message: clearReviewError,
      rowsReplaced: true,
      metadataUpdated: true,
      manualLockSkipped: false,
    };
  }

  return {
    ok: true,
    restaurantId: params.restaurantId,
    status: 'manual_override',
    message: 'Restaurant operating hours were saved manually.',
    rowsReplaced: true,
    metadataUpdated: true,
    manualLockSkipped: false,
  };
}
