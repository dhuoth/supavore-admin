import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  authenticateAdminSession,
  SUPAVORE_ACCESS_TOKEN_COOKIE,
  SUPAVORE_REFRESH_TOKEN_COOKIE,
} from '@/lib/adminAuth';
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin';

type CoverageRequestRow = {
  created_at: string;
  first_name: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
  source: string | null;
  user_id: string | null;
};

type SearchParams = Record<string, string | string[] | undefined>;

type PageProps = {
  searchParams?: Promise<SearchParams>;
};

function formatCellValue(value: string | null) {
  if (!value || value.trim().length === 0) {
    return '—';
  }

  return value;
}

function formatCreatedAt(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function formatCoordinates(latitude: number | null, longitude: number | null) {
  if (latitude === null || longitude === null) {
    return '—';
  }

  return `${latitude.toFixed(4)}, ${longitude.toFixed(4)}`;
}

function getSearchParamValue(searchParams: SearchParams, key: string) {
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

function buildCityCounts(requests: CoverageRequestRow[]) {
  return requests.reduce<Record<string, number>>((counts, request) => {
    const city = request.city?.trim();

    if (!city) {
      return counts;
    }

    counts[city] = (counts[city] ?? 0) + 1;
    return counts;
  }, {});
}

function buildPostalCodeCounts(requests: CoverageRequestRow[]) {
  return requests.reduce<Record<string, number>>((counts, request) => {
    const postalCode = request.postal_code?.trim();

    if (!postalCode) {
      return counts;
    }

    counts[postalCode] = (counts[postalCode] ?? 0) + 1;
    return counts;
  }, {});
}

function sortEntriesByCount(entries: Array<[string, number]>) {
  return entries.sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

export default async function CoverageRequestsPage({ searchParams }: PageProps) {
  const cookieStore = await cookies();
  const authResult = await authenticateAdminSession({
    accessToken: cookieStore.get(SUPAVORE_ACCESS_TOKEN_COOKIE)?.value,
    refreshToken: cookieStore.get(SUPAVORE_REFRESH_TOKEN_COOKIE)?.value,
  });

  if (!authResult.ok) {
    redirect('/login');
  }

  const resolvedSearchParams = (await searchParams) ?? {};
  const cityFilter = getSearchParamValue(resolvedSearchParams, 'city');
  const postalCodeFilter = getSearchParamValue(resolvedSearchParams, 'postal_code');
  const startDate = getSearchParamValue(resolvedSearchParams, 'start');
  const endDate = getSearchParamValue(resolvedSearchParams, 'end');
  const sortBy = getSearchParamValue(resolvedSearchParams, 'sort') || 'newest';

  const supabaseAdmin = createSupabaseAdminClient();
  const { data, error } = await supabaseAdmin
    .from('coverage_requests')
    .select(
      'created_at, first_name, city, region, postal_code, latitude, longitude, source, user_id'
    )
    .order('created_at', { ascending: false });

  if (error) {
    throw new Error(`Failed to load coverage requests: ${error.message}`);
  }

  const requests = (data ?? []) as CoverageRequestRow[];
  const filteredRequests = requests.filter((request) => {
    if (cityFilter && !normalizeText(request.city).includes(normalizeText(cityFilter))) {
      return false;
    }

    if (
      postalCodeFilter &&
      !normalizeText(request.postal_code).includes(normalizeText(postalCodeFilter))
    ) {
      return false;
    }

    if ((startDate || endDate) && !isWithinDateRange(request.created_at, startDate, endDate)) {
      return false;
    }

    return true;
  });

  const cityCounts = buildCityCounts(filteredRequests);
  const postalCodeCounts = buildPostalCodeCounts(filteredRequests);
  const topCities = sortEntriesByCount(Object.entries(cityCounts)).slice(0, 5);
  const topPostalCodes = sortEntriesByCount(Object.entries(postalCodeCounts)).slice(0, 5);
  const requestsWithCoordinates = filteredRequests.filter(
    (request) => request.latitude !== null && request.longitude !== null
  ).length;

  const sortedRequests = [...filteredRequests].sort((left, right) => {
    if (sortBy === 'city_popularity') {
      const leftCity = left.city?.trim() ?? '';
      const rightCity = right.city?.trim() ?? '';
      const leftScore = leftCity ? (cityCounts[leftCity] ?? 0) : 0;
      const rightScore = rightCity ? (cityCounts[rightCity] ?? 0) : 0;

      return (
        rightScore - leftScore ||
        new Date(right.created_at).getTime() - new Date(left.created_at).getTime() ||
        leftCity.localeCompare(rightCity)
      );
    }

    return new Date(right.created_at).getTime() - new Date(left.created_at).getTime();
  });

  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-10 text-zinc-950 sm:px-10 lg:px-16">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <div className="space-y-3">
          <span className="w-fit rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium tracking-wide text-zinc-600">
            Coverage demand review
          </span>
          <div className="space-y-2">
            <h1 className="text-4xl font-semibold tracking-tight text-zinc-950">
              Coverage Requests
            </h1>
            <p className="max-w-2xl text-sm text-zinc-600 sm:text-base">
              Review no-coverage requests coming from the mobile app.
            </p>
          </div>
        </div>

        <section className="grid gap-4 lg:grid-cols-4">
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-zinc-500">Total requests</p>
            <p className="mt-2 text-3xl font-semibold text-zinc-950">
              {filteredRequests.length}
            </p>
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

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-zinc-500">Top postal codes</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {topPostalCodes.length > 0 ? (
                topPostalCodes.map(([postalCode, count]) => (
                  <span
                    key={postalCode}
                    className="rounded-full bg-zinc-100 px-3 py-1 text-sm text-zinc-700"
                  >
                    {postalCode} ({count})
                  </span>
                ))
              ) : (
                <span className="text-sm text-zinc-500">No postal code data yet</span>
              )}
            </div>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-zinc-500">Requests with coordinates</p>
            <p className="mt-2 text-3xl font-semibold text-zinc-950">
              {requestsWithCoordinates}
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <form className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
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
              <label htmlFor="postal-code-filter" className="text-sm font-medium text-zinc-700">
                Postal code
              </label>
              <input
                id="postal-code-filter"
                name="postal_code"
                type="text"
                defaultValue={postalCodeFilter}
                placeholder="Filter by postal code"
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
                <option value="city_popularity">Most requested cities</option>
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
                href="/admin/coverage-requests"
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
                    First Name
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
                    Coordinates
                  </th>
                  <th className="px-4 py-3 text-left font-medium text-zinc-600">
                    User ID
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {sortedRequests.length > 0 ? (
                  sortedRequests.map((request) => (
                    <tr
                      key={`${request.user_id ?? 'anonymous'}-${request.created_at}-${request.postal_code ?? 'no-postal'}`}
                    >
                      <td className="whitespace-nowrap px-4 py-3 text-zinc-700">
                        {formatCreatedAt(request.created_at)}
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {formatCellValue(request.first_name)}
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {formatCellValue(request.city)}
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {formatCellValue(request.region)}
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {formatCellValue(request.postal_code)}
                      </td>
                      <td className="px-4 py-3 text-zinc-700">
                        {formatCellValue(request.source)}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3 font-mono text-xs text-zinc-600">
                        {formatCoordinates(request.latitude, request.longitude)}
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-zinc-600">
                        {formatCellValue(request.user_id)}
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-4 py-10 text-center text-sm text-zinc-500"
                    >
                      No coverage requests match the current filters.
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
