import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabaseAdmin';
import {
  syncRestaurantHoursFromGoogle,
  type RestaurantHoursSyncResult,
} from '@/lib/restaurantHoursSync';
import {
  type RestaurantHoursBackfillItem,
  type RestaurantHoursBackfillResult,
} from '@/lib/restaurantHoursBackfill';

type RestaurantHoursBackfillCandidate = {
  id: string;
  name: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  google_place_id: string | null;
  hours_sync_status: string | null;
  hours_is_manually_managed: boolean;
  restaurant_hours?: Array<{ id: string }> | null;
};

type RestaurantHoursBackfillDependencies = {
  listCandidates: () => Promise<RestaurantHoursBackfillCandidate[]>;
  syncRestaurantHours: (params: {
    restaurantId: string;
    restaurantName: string;
    address: string | null;
    latitude?: number | null;
    longitude?: number | null;
    force?: boolean;
  }) => Promise<RestaurantHoursSyncResult>;
};

function createServerRestaurantHoursBackfillDependencies(): RestaurantHoursBackfillDependencies {
  const supabaseAdmin = createSupabaseAdminClient();

  return {
    async listCandidates() {
      const { data, error } = await supabaseAdmin
        .from('restaurants')
        .select(
          'id, name, address, latitude, longitude, google_place_id, hours_sync_status, hours_is_manually_managed, restaurant_hours(id)'
        )
        .order('name', { ascending: true, nullsFirst: false });

      if (error) {
        throw error;
      }

      return (data as RestaurantHoursBackfillCandidate[] | null) ?? [];
    },
    syncRestaurantHours(params) {
      return syncRestaurantHoursFromGoogle(params);
    },
  };
}

function isHoursBackfillCandidate(restaurant: RestaurantHoursBackfillCandidate) {
  if (!restaurant.name || !restaurant.address) {
    return false;
  }

  return (
    !restaurant.google_place_id ||
    !restaurant.restaurant_hours?.length ||
    (restaurant.hours_sync_status !== 'matched_with_hours' &&
      restaurant.hours_sync_status !== 'manual_override')
  );
}

function toBackfillItem(
  candidate: RestaurantHoursBackfillCandidate,
  result: RestaurantHoursSyncResult
): RestaurantHoursBackfillItem {
  return {
    restaurantId: candidate.id,
    name: candidate.name,
    status: result.status,
    message: result.message,
    manualLockSkipped: result.manualLockSkipped,
  };
}

export async function backfillRestaurantHoursOnServer(
  params?: {
    restaurantIds?: string[];
    offset?: number;
    limit?: number;
    force?: boolean;
  },
  dependencies: RestaurantHoursBackfillDependencies = createServerRestaurantHoursBackfillDependencies()
): Promise<RestaurantHoursBackfillResult> {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY for restaurant hours backfill.');
  }

  const allCandidates = await dependencies.listCandidates();
  const filteredCandidates = allCandidates.filter((candidate) => {
    if (params?.restaurantIds?.length && !params.restaurantIds.includes(candidate.id)) {
      return false;
    }

    if (candidate.hours_is_manually_managed && !params?.force) {
      return isHoursBackfillCandidate(candidate);
    }

    return isHoursBackfillCandidate(candidate);
  });
  const offset = Math.max(params?.offset ?? 0, 0);
  const limit = Math.max(params?.limit ?? 25, 1);
  const batch = filteredCandidates.slice(offset, offset + limit);
  const results: RestaurantHoursBackfillItem[] = [];

  for (const candidate of batch) {
    const result = await dependencies.syncRestaurantHours({
      restaurantId: candidate.id,
      restaurantName: candidate.name ?? '',
      address: candidate.address,
      latitude: candidate.latitude,
      longitude: candidate.longitude,
      force: params?.force ?? false,
    });

    console.info('Restaurant hours backfill processed restaurant.', {
      restaurantId: candidate.id,
      status: result.status,
    });
    results.push(toBackfillItem(candidate, result));
  }

  const succeeded = results.filter(
    (result) =>
      result.status === 'matched_with_hours' ||
      result.status === 'matched_no_hours' ||
      result.status === 'review_required_match' ||
      result.status === 'skipped_manual_lock'
  ).length;

  return {
    attempted: batch.length,
    succeeded,
    failed: batch.length - succeeded,
    hasMore: offset + batch.length < filteredCandidates.length,
    nextOffset: offset + batch.length < filteredCandidates.length ? offset + batch.length : null,
    results,
  };
}
