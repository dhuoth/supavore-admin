import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  authenticateAdminSession,
  SUPAVORE_ACCESS_TOKEN_COOKIE,
  SUPAVORE_REFRESH_TOKEN_COOKIE,
} from '@/lib/adminAuth';
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
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export default async function DietarySignalsPage() {
  const cookieStore = await cookies();
  const authResult = await authenticateAdminSession({
    accessToken: cookieStore.get(SUPAVORE_ACCESS_TOKEN_COOKIE)?.value,
    refreshToken: cookieStore.get(SUPAVORE_REFRESH_TOKEN_COOKIE)?.value,
  });

  if (!authResult.ok) {
    redirect('/login');
  }

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
  const totalSignals = signals.length;
  const dietaryNeedCounts = signals.reduce<Record<string, number>>(
    (counts, signal) => {
      const dietaryNeeds = Array.isArray(signal.dietary_needs)
        ? signal.dietary_needs
        : [];

      for (const dietaryNeed of dietaryNeeds) {
        counts[dietaryNeed] = (counts[dietaryNeed] ?? 0) + 1;
      }

      return counts;
    },
    {}
  );

  const topDietaryNeeds = Object.entries(dietaryNeedCounts)
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5);

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

        <section className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-zinc-500">Total signals</p>
            <p className="mt-2 text-3xl font-semibold text-zinc-950">
              {totalSignals}
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-zinc-500">Top requested dietary needs</p>
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
                {signals.length > 0 ? (
                  signals.map((signal) => (
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
                      No dietary demand signals yet.
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
