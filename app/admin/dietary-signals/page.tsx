import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  authenticateAdminSession,
  SUPAVORE_ACCESS_TOKEN_COOKIE,
  SUPAVORE_REFRESH_TOKEN_COOKIE,
} from '@/lib/adminAuth';
import { formatAdminTimestamp } from '@/lib/adminTimestamp';
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin';

type DietarySignalRow = {
  created_at: string;
  dietary_needs: string[] | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  source: string | null;
  user_id: string | null;
};

type SearchParams = Record<string, string | string[] | undefined>;

type PageProps = {
  searchParams?: Promise<SearchParams>;
};

function formatDietaryNeeds(dietaryNeeds: string[] | null) {
  if (!Array.isArray(dietaryNeeds) || dietaryNeeds.length === 0) {
    return 'None';
  }

  return dietaryNeeds.join(', ');
}

function formatCellValue(value: string | null) {
  if (!value || value.trim().length === 0) {
    return '—';
  }

  return value;
}

function formatCreatedAt(value: string) {
  return formatAdminTimestamp(value);
}

function getSearchParamValue(
  searchParams: SearchParams,
  key: string
) {
  const value = searchParams[key];

  if (Array.isArray(value)) {
    return value[0] ?? '';
  }

  return value ?? '';
}

function normalizeText(value: string | null | undefined) {
  return value?.trim().toLowerCase() ?? '';
}

function isWithinDateRange(value: string, startDate: string, endDate: string) {
  const createdAt = new Date(value);

  if (Number.isNaN(createdAt.getTime())) {
    return false;
  }

  if (startDate) {
    const start = new Date(`${startDate}T00:00:00`);

    if (createdAt < start) {
      return false;
    }
  }

  if (endDate) {
    const end = new Date(`${endDate}T23:59:59.999`);

    if (createdAt > end) {
      return false;
    }
  }

  return true;
}

function buildDietaryNeedCounts(signals: DietarySignalRow[]) {
  return signals.reduce<Record<string, number>>((counts, signal) => {
    const dietaryNeeds = Array.isArray(signal.dietary_needs) ? signal.dietary_needs : [];

    for (const dietaryNeed of dietaryNeeds) {
      counts[dietaryNeed] = (counts[dietaryNeed] ?? 0) + 1;
    }

    return counts;
  }, {});
}

function buildCityCounts(signals: DietarySignalRow[]) {
  return signals.reduce<Record<string, number>>((counts, signal) => {
    const city = signal.city?.trim();

    if (!city) {
      return counts;
    }

    counts[city] = (counts[city] ?? 0) + 1;
    return counts;
  }, {});
}

function sortEntriesByCount(entries: Array<[string, number]>) {
  return entries.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

export default async function DietarySignalsPage({ searchParams }: PageProps) {
  const cookieStore = await cookies();
  const authResult = await authenticateAdminSession({
    accessToken: cookieStore.get(SUPAVORE_ACCESS_TOKEN_COOKIE)?.value,
    refreshToken: cookieStore.get(SUPAVORE_REFRESH_TOKEN_COOKIE)?.value,
  });

  if (!authResult.ok) {
    redirect('/login');
  }

  const resolvedSearchParams = (await searchParams) ?? {};
  const dietaryNeedFilter = getSearchParamValue(resolvedSearchParams, 'dietary_need');
  const cityFilter = getSearchParamValue(resolvedSearchParams, 'city');
  const startDate = getSearchParamValue(resolvedSearchParams, 'start');
  const endDate = getSearchParamValue(resolvedSearchParams, 'end');
  const sortBy = getSearchParamValue(resolvedSearchParams, 'sort') || 'newest';

  const supabaseAdmin = createSupabaseAdminClient();
  const { data, error } = await supabaseAdmin
    .from('dietary_request_signals')
    .select(
      'created_at, dietary_needs, city, region, postal_code, source, user_id'
    )
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to load dietary signals: ${error.message}`);
  }

  const signals = (data ?? []) as DietarySignalRow[];
  const availableDietaryNeeds = Array.from(
    new Set(
      signals.flatMap((signal) =>
        Array.isArray(signal.dietary_needs) ? signal.dietary_needs : []
      )
    )
  ).sort((left, right) => left.localeCompare(right));

  const filteredSignals = signals.filter((signal) => {
    if (
      dietaryNeedFilter &&
      !(Array.isArray(signal.dietary_needs) && signal.dietary_needs.includes(dietaryNeedFilter))
    ) {
      return false;
    }

    if (cityFilter && !normalizeText(signal.city).includes(normalizeText(cityFilter))) {
      return false;
    }

    if ((startDate || endDate) && !isWithinDateRange(signal.created_at, startDate, endDate)) {
      return false;
    }

    return true;
  });

  const dietaryNeedCounts = buildDietaryNeedCounts(filteredSignals);
  const cityCounts = buildCityCounts(filteredSignals);
  const topDietaryNeeds = sortEntriesByCount(Object.entries(dietaryNeedCounts)).slice(0, 5);
  const topCities = sortEntriesByCount(Object.entries(cityCounts)).slice(0, 5);

  const sortedSignals = [...filteredSignals].sort((left, right) => {
    if (sortBy === 'dietary_popularity') {
      const leftScore = (Array.isArray(left.dietary_needs) ? left.dietary_needs : []).reduce(
        (total, dietaryNeed) => total + (dietaryNeedCounts[dietaryNeed] ?? 0),
        0
      );
      const rightScore = (Array.isArray(right.dietary_needs) ? right.dietary_needs : []).reduce(
        (total, dietaryNeed) => total + (dietaryNeedCounts[dietaryNeed] ?? 0),
        0
      );

      return (
        rightScore - leftScore ||
        new Date(right.created_at).getTime() - new Date(left.created_at).getTime()
      );
    }

    return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
  });

  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-10 text-zinc-950 sm:px-10 lg:px-16">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <div className="space-y-3">
          <span className="w-fit rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium tracking-wide text-zinc-600">
            Dietary demand review
          </span>
          <div className="space-y-2">
            <h1 className="text-4xl font-semibold tracking-tight text-zinc-950">
              Dietary Signals
            </h1>
            <p className="max-w-2xl text-sm text-zinc-600 sm:text-base">
              Review unmet dietary demand coming from the mobile app.
            </p>
          </div>
        </div>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-zinc-500">Total signals</p>
            <p className="mt-2 text-3xl font-semibold text-zinc-950">
              {filteredSignals.length}
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-zinc-500">Top dietary needs</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {topDietaryNeeds.length > 0 ? (
                topDietaryNeeds.map(([dietaryNeed, count]) => (
                  <span
                    key={dietaryNeed}
                    className="rounded-full bg-zinc-100 px-3 py-1 text-sm text-zinc-700"
                  >
                    {dietaryNeed} ({count})
                  </span>
                ))
              ) : (
                <span className="text-sm text-zinc-500">No signals yet</span>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-zinc-500">Top cities</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {topCities.length > 0 ? (
                topCities.map(([city, count]) => (
                  <span
                    key={city}
                    className="rounded-full bg-zinc-100 px-3 py-1 text-sm text-zinc-700"
                  >
                    {city} ({count})
                  </span>
                ))
              ) : (
                <span className="text-sm text-zinc-500">No city data yet</span>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-2">
              <label
                htmlFor="dietary-need-filter"
                className="text-sm font-medium text-zinc-700"
              >
                Dietary need
              </label>
              <select
                id="dietary-need-filter"
                name="dietary_need"
                defaultValue={dietaryNeedFilter}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
              >
                <option value="">All dietary needs</option>
                {availableDietaryNeeds.map((dietaryNeed) => (
                  <option key={dietaryNeed} value={dietaryNeed}>
                    {dietaryNeed}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <label htmlFor="city-filter" className="text-sm font-medium text-zinc-700">
                City
              </label>
              <input
                id="city-filter"
                name="city"
                type="text"
                defaultValue={cityFilter}
                placeholder="Filter by city"
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none placeholder:text-zinc-400 focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="start-date-filter" className="text-sm font-medium text-zinc-700">
                Start date
              </label>
              <input
                id="start-date-filter"
                name="start"
                type="date"
                defaultValue={startDate}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="end-date-filter" className="text-sm font-medium text-zinc-700">
                End date
              </label>
              <input
                id="end-date-filter"
                name="end"
                type="date"
                defaultValue={endDate}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
              />
            </div>

            <div className="space-y-2">
              <label htmlFor="sort-filter" className="text-sm font-medium text-zinc-700">
                Sort
              </label>
              <select
                id="sort-filter"
                name="sort"
                defaultValue={sortBy}
                className="w-full rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none focus:border-zinc-400 focus:ring-2 focus:ring-zinc-200"
              >
                <option value="newest">Newest first</option>
                <option value="dietary_popularity">Most requested dietary needs</option>
              </select>
            </div>

            <div className="flex items-end gap-3 md:col-span-2 xl:col-span-5">
              <button
                type="submit"
                className="rounded-xl bg-black px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-800"
              >
                Apply filters
              </button>
              <a
                href="/admin/dietary-signals"
                className="rounded-xl border border-zinc-200 px-4 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
              >
                Reset
              </a>
            </div>
          </form>
        </section>

        <section className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-200 text-sm">
              <thead className="bg-zinc-50">
                <tr>
                  <th className="px-4 py-3 text-left font-medium text-zinc-600">
                    Created At
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-600">
                    Dietary Needs
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-600">
                    City
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-600">
                    Region
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-600">
                    Postal Code
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-600">
                    Source
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-600">
                    User ID
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {sortedSignals.length > 0 ? (
                  sortedSignals.map((signal) => (
                    <tr key={`${signal.user_id ?? 'anonymous'}-${signal.created_at}`}>
                      <td className="whitespace-nowrap px-4 py-3 text-zinc-700">
                        {formatCreatedAt(signal.created_at)}
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {formatDietaryNeeds(signal.dietary_needs)}
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {formatCellValue(signal.city)}
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {formatCellValue(signal.region)}
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {formatCellValue(signal.postal_code)}
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {formatCellValue(signal.source)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-zinc-600">
                        {formatCellValue(signal.user_id)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={7}
                      className="px-4 py-10 text-center text-sm text-zinc-500"
                    >
                      No dietary demand signals match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
