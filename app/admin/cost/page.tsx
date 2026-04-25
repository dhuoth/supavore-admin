import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import Link from 'next/link';
import {
  authenticateAdminSession,
  SUPAVORE_ACCESS_TOKEN_COOKIE,
  SUPAVORE_REFRESH_TOKEN_COOKIE,
} from '@/lib/adminAuth';
import {
  getSupabaseStats,
  getGoogleApiProxyStats,
  LIMITS,
  type TableStat,
} from '@/lib/usageStats';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number) {
  return new Intl.NumberFormat('en-US').format(n);
}

function fmtUsd(n: number) {
  return n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`;
}

function fmtTs(iso: string) {
  return new Date(iso).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZoneName: 'short',
  });
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-sm font-semibold uppercase tracking-widest text-zinc-400">{title}</h2>
      {subtitle && <p className="mt-0.5 text-xs text-zinc-400">{subtitle}</p>}
    </div>
  );
}

function Card({ children, className = '' }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm ${className}`}>
      {children}
    </div>
  );
}

function UsageBar({ usedPct, label }: { usedPct: number; label: string }) {
  const pct = Math.min(100, usedPct);
  const color =
    pct >= 90 ? '#ef4444' : pct >= 70 ? '#f59e0b' : '#10b981';
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-zinc-500">
        <span>{label}</span>
        <span>{pct.toFixed(1)}%</span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
        <div
          className="h-1.5 rounded-full transition-all"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function StatusDot({ ok }: { ok: boolean }) {
  return (
    <span
      className="inline-block h-2 w-2 rounded-full"
      style={{ backgroundColor: ok ? '#10b981' : '#f59e0b' }}
    />
  );
}

function ExternalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="inline-flex items-center gap-1 text-xs text-zinc-500 underline-offset-2 hover:text-zinc-800 hover:underline"
    >
      {children}
      <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
      </svg>
    </a>
  );
}

function TableRow({ stat }: { stat: TableStat }) {
  return (
    <div className="flex items-center justify-between py-2 text-sm">
      <span className="text-zinc-600">{stat.label}</span>
      <span className="tabular-nums font-medium text-zinc-900">{fmt(stat.count)}</span>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2 text-sm">
      <span className="text-zinc-500">{label}</span>
      <span className="font-medium text-zinc-900">{value}</span>
    </div>
  );
}

function AlertBanner({ message }: { message: string }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3">
      <span className="mt-0.5 text-amber-500">⚠</span>
      <p className="text-xs text-amber-800">{message}</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function CostPage() {
  // Auth gate
  const cookieStore = await cookies();
  const authResult = await authenticateAdminSession({
    accessToken: cookieStore.get(SUPAVORE_ACCESS_TOKEN_COOKIE)?.value,
    refreshToken: cookieStore.get(SUPAVORE_REFRESH_TOKEN_COOKIE)?.value,
  });
  if (!authResult.ok) {
    redirect('/login');
  }

  // Fetch stats concurrently
  const [supabaseStats, googleStats] = await Promise.all([
    getSupabaseStats(),
    getGoogleApiProxyStats(),
  ]);

  // Derived values
  const authUserPct = (supabaseStats.authUserCount / LIMITS.supabase.mau) * 100;

  const totalGoogleEstCost =
    googleStats.estGeocodingCostUsd + googleStats.estPlacesCostUsd;
  // What fraction of the $200 monthly credit has been consumed lifetime?
  // (These are lifetime estimates, not monthly, but useful for perspective.)
  const googleCreditUsedPct = Math.min(100, (totalGoogleEstCost / LIMITS.google.monthlyCredit) * 100);

  const restaurantGeocodedPct =
    googleStats.totalRestaurants > 0
      ? (googleStats.restaurantsGeocoded / googleStats.totalRestaurants) * 100
      : 0;
  const restaurantHoursPct =
    googleStats.totalRestaurants > 0
      ? (googleStats.restaurantsWithHours / googleStats.totalRestaurants) * 100
      : 0;

  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-10 text-zinc-950 sm:px-10 lg:px-16">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-10">

        {/* ── Header ── */}
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div className="space-y-2">
            <Link href="/" className="text-xs text-zinc-400 hover:text-zinc-600">
              ← Admin home
            </Link>
            <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 sm:text-4xl">
              Cost &amp; Usage
            </h1>
            <p className="text-sm text-zinc-500">
              Live data as of {fmtTs(supabaseStats.fetchedAt)} · Refreshes on each page load
            </p>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5">
            <StatusDot ok={true} />
            <span className="text-xs font-medium text-emerald-700">All services on free tier</span>
          </div>
        </div>

        {/* ── Cost summary strip ── */}
        <div className="grid gap-4 sm:grid-cols-3">
          {[
            { label: 'Estimated spend today', value: '$0.00', note: 'Anthropic — all free tier' },
            { label: 'Estimated spend this month', value: '$0.00', note: 'Google credit covers usage' },
            { label: 'Lifetime Google API est.', value: fmtUsd(totalGoogleEstCost), note: 'Based on enriched restaurant count' },
          ].map(({ label, value, note }) => (
            <Card key={label} className="flex flex-col gap-1">
              <p className="text-xs text-zinc-400">{label}</p>
              <p className="text-2xl font-semibold tabular-nums text-zinc-950">{value}</p>
              <p className="text-xs text-zinc-400">{note}</p>
            </Card>
          ))}
        </div>

        {/* ── Supabase ── */}
        <section>
          <SectionHeader
            title="Supabase"
            subtitle="Shared backend — used by both admin and mobile"
          />
          <div className="grid gap-4 sm:grid-cols-2">

            {/* Auth users */}
            <Card>
              <div className="mb-4 flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-700">Monthly Active Users</span>
                <ExternalLink href="https://supabase.com/dashboard/project/_/auth/users">
                  Supabase Auth
                </ExternalLink>
              </div>
              <p className="mb-3 text-3xl font-semibold tabular-nums text-zinc-950">
                {fmt(supabaseStats.authUserCount)}
                <span className="ml-1 text-base font-normal text-zinc-400">
                  / {fmt(LIMITS.supabase.mau)}
                </span>
              </p>
              <UsageBar usedPct={authUserPct} label={`${authUserPct.toFixed(2)}% of free tier`} />
              <p className="mt-3 text-xs text-zinc-400">
                Free tier: {fmt(LIMITS.supabase.mau)} MAU · Well within limit
              </p>
            </Card>

            {/* DB size */}
            <Card>
              <div className="mb-4 flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-700">Database Storage</span>
                <ExternalLink href="https://supabase.com/dashboard/project/_/settings/billing">
                  Supabase Billing
                </ExternalLink>
              </div>
              <p className="mb-1 text-3xl font-semibold tabular-nums text-zinc-950">
                ~7.8 MB
                <span className="ml-1 text-base font-normal text-zinc-400">
                  / {LIMITS.supabase.dbMb} MB
                </span>
              </p>
              <p className="mb-3 text-xs text-zinc-400">Last observed — check Supabase dashboard for live size</p>
              <UsageBar usedPct={(7.8 / LIMITS.supabase.dbMb) * 100} label="~1.6% of free tier" />
              <p className="mt-3 text-xs text-zinc-400">
                Free tier: {LIMITS.supabase.dbMb} MB · {LIMITS.supabase.egressGb} GB egress/mo ·{' '}
                {LIMITS.supabase.storageGb} GB file storage
              </p>
            </Card>

            {/* Table row counts */}
            <Card className="sm:col-span-2">
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-700">Table Row Counts</span>
                <ExternalLink href="https://supabase.com/dashboard/project/_/editor">
                  Table Editor
                </ExternalLink>
              </div>
              <div className="divide-y divide-zinc-100">
                {supabaseStats.tables.map((stat) => (
                  <TableRow key={stat.table} stat={stat} />
                ))}
              </div>
            </Card>
          </div>
        </section>

        {/* ── Google APIs ── */}
        <section>
          <SectionHeader
            title="Google APIs"
            subtitle={`$${LIMITS.google.monthlyCredit}/month free credit · Admin only — mobile uses device GPS and Apple/Google Maps deep-links`}
          />
          <div className="grid gap-4 sm:grid-cols-2">

            {/* Places API */}
            <Card>
              <div className="mb-4 flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-700">Places API (New)</span>
                <ExternalLink href="https://console.cloud.google.com/google/maps-apis/api-list">
                  Google Cloud Console
                </ExternalLink>
              </div>
              <p className="text-xs text-zinc-400 mb-3">
                Used by admin for restaurant hours enrichment (Text Search + Place Details)
              </p>
              <div className="divide-y divide-zinc-100">
                <InfoRow
                  label="Restaurants with hours"
                  value={`${fmt(googleStats.restaurantsWithHours)} / ${fmt(googleStats.totalRestaurants)}`}
                />
                <InfoRow
                  label="Est. lifetime API calls"
                  value={`${fmt(googleStats.estPlacesCalls)} calls`}
                />
                <InfoRow
                  label="Est. lifetime cost"
                  value={
                    <span className={totalGoogleEstCost > 150 ? 'text-red-600' : 'text-zinc-900'}>
                      {fmtUsd(googleStats.estPlacesCostUsd)}
                    </span>
                  }
                />
              </div>
              <div className="mt-3 space-y-1.5">
                <UsageBar
                  usedPct={restaurantHoursPct}
                  label={`${restaurantHoursPct.toFixed(0)}% of restaurants enriched`}
                />
              </div>
              <p className="mt-3 text-xs text-zinc-400">
                Pricing: ${LIMITS.google.placesTextSearchPer1k}/1k calls · 2 calls per restaurant ·{' '}
                Each enrichment run is additive — only new restaurants cost
              </p>
            </Card>

            {/* Geocoding API */}
            <Card>
              <div className="mb-4 flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-700">Geocoding API</span>
                <ExternalLink href="https://console.cloud.google.com/google/maps-apis/api-list">
                  Google Cloud Console
                </ExternalLink>
              </div>
              <p className="text-xs text-zinc-400 mb-3">
                Used by admin for restaurant location backfill
              </p>
              <div className="divide-y divide-zinc-100">
                <InfoRow
                  label="Restaurants geocoded"
                  value={`${fmt(googleStats.restaurantsGeocoded)} / ${fmt(googleStats.totalRestaurants)}`}
                />
                <InfoRow
                  label="Est. lifetime API calls"
                  value={`${fmt(googleStats.estGeocodingCalls)} calls`}
                />
                <InfoRow
                  label="Est. lifetime cost"
                  value={fmtUsd(googleStats.estGeocodingCostUsd)}
                />
              </div>
              <div className="mt-3 space-y-1.5">
                <UsageBar
                  usedPct={restaurantGeocodedPct}
                  label={`${restaurantGeocodedPct.toFixed(0)}% of restaurants geocoded`}
                />
              </div>
              <p className="mt-3 text-xs text-zinc-400">
                Pricing: ${LIMITS.google.geocodingPer1k}/1k calls · 1 call per restaurant ·{' '}
                Very low cost — {fmt(Math.floor(LIMITS.google.monthlyCredit / (LIMITS.google.geocodingPer1k / 1000)))} restaurants geocodable on $200 credit
              </p>
            </Card>

            {/* Google credit summary */}
            <Card className="sm:col-span-2">
              <div className="mb-4 flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-700">$200 Monthly Credit — Utilization Estimate</span>
                <ExternalLink href="https://console.cloud.google.com/billing">
                  Google Billing
                </ExternalLink>
              </div>
              <div className="mb-4 grid gap-4 sm:grid-cols-3">
                <div>
                  <p className="text-xs text-zinc-400 mb-1">Places API est. (lifetime)</p>
                  <p className="text-xl font-semibold tabular-nums">{fmtUsd(googleStats.estPlacesCostUsd)}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-400 mb-1">Geocoding API est. (lifetime)</p>
                  <p className="text-xl font-semibold tabular-nums">{fmtUsd(googleStats.estGeocodingCostUsd)}</p>
                </div>
                <div>
                  <p className="text-xs text-zinc-400 mb-1">Total vs $200 credit</p>
                  <p className="text-xl font-semibold tabular-nums">{fmtUsd(totalGoogleEstCost)}</p>
                </div>
              </div>
              <UsageBar
                usedPct={googleCreditUsedPct}
                label={`${googleCreditUsedPct.toFixed(1)}% of $${LIMITS.google.monthlyCredit} monthly credit (lifetime est.)`}
              />
              <p className="mt-3 text-xs text-zinc-400">
                ⚠ These are rough lifetime estimates based on restaurant counts, not actual API billing.
                Actual usage depends on how many enrichment runs have been triggered.
                Check Google Cloud Console for live billing data.
              </p>
              {googleCreditUsedPct > 50 && (
                <div className="mt-3">
                  <AlertBanner message="Heads up: lifetime estimated spend is above 50% of the monthly credit. Consider enabling Google Cloud billing alerts at console.cloud.google.com/billing." />
                </div>
              )}
            </Card>
          </div>
        </section>

        {/* ── Infrastructure ── */}
        <section>
          <SectionHeader title="Infrastructure" subtitle="Hosting and build services" />
          <div className="grid gap-4 sm:grid-cols-2">

            {/* Vercel */}
            <Card>
              <div className="mb-4 flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-700">Vercel (Web Admin)</span>
                <ExternalLink href="https://vercel.com/dashboard">
                  Vercel Dashboard
                </ExternalLink>
              </div>
              <div className="mb-3 flex items-center gap-2">
                <StatusDot ok={true} />
                <span className="text-sm font-medium text-emerald-700">{LIMITS.vercel.plan}</span>
              </div>
              <div className="divide-y divide-zinc-100">
                <InfoRow label="Bandwidth limit" value={`${LIMITS.vercel.bandwidthGb} GB / month`} />
                <InfoRow label="Build minutes" value={`${fmt(LIMITS.vercel.buildMinutes)} min / month`} />
                <InfoRow label="Charges" value="None unless bandwidth exceeded" />
              </div>
            </Card>

            {/* Expo / EAS */}
            <Card>
              <div className="mb-4 flex items-center justify-between">
                <span className="text-sm font-medium text-zinc-700">Expo / EAS (Mobile)</span>
                <ExternalLink href="https://expo.dev/accounts/[account]/settings/billing">
                  Expo Dashboard
                </ExternalLink>
              </div>
              <div className="mb-3 flex items-center gap-2">
                <StatusDot ok={true} />
                <span className="text-sm font-medium text-emerald-700">{LIMITS.expo.plan} tier</span>
              </div>
              <div className="divide-y divide-zinc-100">
                <InfoRow label="EAS Builds" value={`${LIMITS.expo.easBuildsPerMonth} / month free`} />
                <InfoRow label="OTA Updates" value="Unlimited on free tier" />
                <InfoRow label="Charges" value="None at current usage" />
              </div>
            </Card>
          </div>
        </section>

        {/* ── Quick links ── */}
        <section>
          <SectionHeader title="Billing Dashboards" subtitle="All in one place — check these for the real numbers" />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              {
                name: 'Supabase',
                href: 'https://supabase.com/dashboard/project/_/settings/billing',
                desc: 'DB size, egress, MAU',
              },
              {
                name: 'Google Cloud',
                href: 'https://console.cloud.google.com/billing',
                desc: 'Places API, Geocoding',
              },
              {
                name: 'Vercel',
                href: 'https://vercel.com/dashboard',
                desc: 'Bandwidth, builds',
              },
              {
                name: 'Expo',
                href: 'https://expo.dev',
                desc: 'EAS builds, updates',
              },
            ].map(({ name, href, desc }) => (
              <a
                key={name}
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                className="flex flex-col gap-1 rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-zinc-300 hover:bg-zinc-50"
              >
                <span className="text-sm font-medium text-zinc-900">{name} ↗</span>
                <span className="text-xs text-zinc-400">{desc}</span>
              </a>
            ))}
          </div>
        </section>

      </div>
    </main>
  );
}
