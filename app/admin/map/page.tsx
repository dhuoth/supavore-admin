import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  authenticateAdminSession,
  SUPAVORE_ACCESS_TOKEN_COOKIE,
  SUPAVORE_REFRESH_TOKEN_COOKIE,
} from '@/lib/adminAuth';
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin';
import { CoverageMap } from './coverage-map';

type RestaurantCoverageRow = {
  id: string;
  name: string | null;
  city: string | null;
  region: string | null;
  postal_code: string | null;
  latitude: number | null;
  longitude: number | null;
};

function formatCount(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

export default async function AdminMapPage() {
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
    .from('restaurants')
    .select('id, name, city, region, postal_code, latitude, longitude')
    .order('name', { ascending: true });

  if (error) {
    throw new Error(`Failed to load restaurant coverage: ${error.message}`);
  }

  const restaurants = (data ?? []) as RestaurantCoverageRow[];
  const mappedRestaurants = restaurants
    .filter((restaurant) => restaurant.latitude !== null && restaurant.longitude !== null)
    .map((restaurant) => ({
      id: restaurant.id,
      name: restaurant.name?.trim() || 'Unnamed restaurant',
      city: restaurant.city,
      region: restaurant.region,
      postalCode: restaurant.postal_code,
      latitude: restaurant.latitude as number,
      longitude: restaurant.longitude as number,
    }));
  const restaurantsMissingCoordinates = restaurants.length - mappedRestaurants.length;
  const browserGoogleMapsKey = process.env.GOOGLE_MAPS_GEOCODING_API_KEY ?? null;

  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-10 text-zinc-950 sm:px-10 lg:px-16">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <div className="space-y-3">
          <span className="w-fit rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium tracking-wide text-zinc-600">
            Coverage visibility
          </span>
          <div className="space-y-2">
            <h1 className="text-4xl font-semibold tracking-tight text-zinc-950">
              Restaurant Coverage Map
            </h1>
            <p className="max-w-3xl text-sm text-zinc-600 sm:text-base">
              Review current restaurant density across the coverage footprint. This view is based on
              the existing `restaurants` location data, not coverage requests.
            </p>
          </div>
        </div>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-zinc-500">Total restaurants</p>
            <p className="mt-2 text-3xl font-semibold text-zinc-950">
              {formatCount(restaurants.length)}
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-zinc-500">Mapped restaurants</p>
            <p className="mt-2 text-3xl font-semibold text-zinc-950">
              {formatCount(mappedRestaurants.length)}
            </p>
          </div>

          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-zinc-500">Missing coordinates</p>
            <p className="mt-2 text-3xl font-semibold text-zinc-950">
              {formatCount(restaurantsMissingCoordinates)}
            </p>
          </div>
        </section>

        <section className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <div className="mb-4 flex flex-col gap-2">
            <h2 className="text-lg font-semibold text-zinc-950">Current coverage density</h2>
            <p className="text-sm text-zinc-600">
              Heat intensity increases where more restaurant coordinates overlap. If heatmap support
              is unavailable at runtime, the page falls back to plotted coverage points.
            </p>
          </div>

          {mappedRestaurants.length > 0 ? (
            <CoverageMap apiKey={browserGoogleMapsKey} points={mappedRestaurants} />
          ) : (
            <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50 px-6 py-12 text-center text-sm text-zinc-500">
              No restaurants currently have latitude/longitude data, so there is nothing to render
              on the coverage map yet.
            </div>
          )}
        </section>
      </div>
    </main>
  );
}
