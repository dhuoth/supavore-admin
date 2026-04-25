import 'server-only';

import { createSupabaseAdminClient } from '@/lib/supabaseAdmin';

// ─── Free-tier limits (hard-coded) ───────────────────────────────────────────

export const LIMITS = {
  supabase: {
    dbMb: 500,         // 500 MB Postgres storage
    mau: 50_000,       // 50k monthly active users
    egressGb: 5,       // 5 GB egress / month
    storageGb: 1,      // 1 GB file storage
  },
  google: {
    // $200 / month free credit shared across all Google Maps Platform APIs
    monthlyCredit: 200,
    // New Places API pricing (per 1,000 requests)
    placesTextSearchPer1k: 17,
    placesDetailsPer1k: 17,
    geocodingPer1k: 5,
  },
  vercel: {
    // Hobby plan
    bandwidthGb: 100,
    buildMinutes: 6_000,
    plan: 'Hobby (free)',
  },
  expo: {
    plan: 'Free',
    easBuildsPerMonth: 30,   // free personal tier
  },
} as const;

// ─── Types ────────────────────────────────────────────────────────────────────

export type TableStat = {
  table: string;
  label: string;
  count: number;
};

export type SupabaseStats = {
  tables: TableStat[];
  authUserCount: number;
  fetchedAt: string;
};

export type GoogleApiProxyStats = {
  /** Restaurants with a lat/lng ≈ geocoding calls made */
  restaurantsGeocoded: number;
  /** Unique restaurants with any hours rows ≈ Places enrichment runs */
  restaurantsWithHours: number;
  totalRestaurants: number;
  /** Estimated lifetime geocoding API calls */
  estGeocodingCalls: number;
  /** Estimated lifetime Places API calls (2 per enriched restaurant: search + details) */
  estPlacesCalls: number;
  /** Estimated lifetime geocoding cost in USD */
  estGeocodingCostUsd: number;
  /** Estimated lifetime Places cost in USD */
  estPlacesCostUsd: number;
  fetchedAt: string;
};

// ─── Fetchers ─────────────────────────────────────────────────────────────────

const TABLE_DEFS: { table: string; label: string }[] = [
  { table: 'restaurants',           label: 'Restaurants' },
  { table: 'menu_items',            label: 'Menu items' },
  { table: 'profiles',              label: 'User profiles' },
  { table: 'user_selections',       label: 'User selections' },
  { table: 'restaurant_hours',      label: 'Restaurant hours rows' },
  { table: 'admin_review_queue',    label: 'Review queue items' },
  { table: 'coverage_requests',     label: 'Coverage requests' },
  { table: 'dietary_request_signals', label: 'Dietary signals' },
];

export async function getSupabaseStats(): Promise<SupabaseStats> {
  const supabase = createSupabaseAdminClient();

  const tableResults = await Promise.allSettled(
    TABLE_DEFS.map(async ({ table, label }) => {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });
      return { table, label, count: error ? 0 : (count ?? 0) };
    }),
  );

  const tables: TableStat[] = tableResults.map((r, i) =>
    r.status === 'fulfilled'
      ? r.value
      : { table: TABLE_DEFS[i].table, label: TABLE_DEFS[i].label, count: 0 },
  );

  // Auth user count — list all pages
  let authUserCount = 0;
  try {
    let page = 1;
    while (true) {
      const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
      if (error || !data) break;
      authUserCount += data.users.length;
      if (!data.nextPage) break;
      page = data.nextPage;
    }
  } catch {
    // non-fatal
  }

  return { tables, authUserCount, fetchedAt: new Date().toISOString() };
}

export async function getGoogleApiProxyStats(): Promise<GoogleApiProxyStats> {
  const supabase = createSupabaseAdminClient();

  const [totalRes, geocodedRes, hoursRes] = await Promise.allSettled([
    supabase.from('restaurants').select('*', { count: 'exact', head: true }),
    supabase
      .from('restaurants')
      .select('*', { count: 'exact', head: true })
      .not('latitude', 'is', null),
    supabase.from('restaurant_hours').select('restaurant_id'),
  ]);

  const totalRestaurants =
    totalRes.status === 'fulfilled' ? (totalRes.value.count ?? 0) : 0;

  const restaurantsGeocoded =
    geocodedRes.status === 'fulfilled' ? (geocodedRes.value.count ?? 0) : 0;

  // Unique restaurants that have at least one hours row
  let restaurantsWithHours = 0;
  if (hoursRes.status === 'fulfilled' && hoursRes.value.data) {
    const ids = new Set(hoursRes.value.data.map((r: { restaurant_id: string }) => r.restaurant_id));
    restaurantsWithHours = ids.size;
  }

  // Cost estimates
  // Each geocoded restaurant ≈ 1 Geocoding API call
  const estGeocodingCalls = restaurantsGeocoded;
  const estGeocodingCostUsd =
    (estGeocodingCalls / 1000) * LIMITS.google.geocodingPer1k;

  // Each enriched restaurant ≈ 2 Places calls (Text Search + Place Details)
  const estPlacesCalls = restaurantsWithHours * 2;
  const estPlacesCostUsd =
    (estPlacesCalls / 1000) * LIMITS.google.placesTextSearchPer1k;

  return {
    restaurantsGeocoded,
    restaurantsWithHours,
    totalRestaurants,
    estGeocodingCalls,
    estPlacesCalls,
    estGeocodingCostUsd,
    estPlacesCostUsd,
    fetchedAt: new Date().toISOString(),
  };
}
