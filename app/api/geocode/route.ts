import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { authenticateAdminSession, SUPAVORE_ACCESS_TOKEN_COOKIE, SUPAVORE_REFRESH_TOKEN_COOKIE } from '@/lib/adminAuth';
import { geocodeRestaurantLocation } from '@/lib/geocoding';
import { normalizeRestaurantLocationInput } from '@/lib/restaurantLocation';

export async function POST(request: Request) {
  const cookieStore = await cookies();
  const authResult = await authenticateAdminSession({
    accessToken: cookieStore.get(SUPAVORE_ACCESS_TOKEN_COOKIE)?.value,
    refreshToken: cookieStore.get(SUPAVORE_REFRESH_TOKEN_COOKIE)?.value,
  });

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.status === 403 ? 'Forbidden' : 'Unauthorized' },
      { status: authResult.status }
    );
  }

  try {
    const body = (await request.json()) as {
      address?: string | null;
      city?: string | null;
      region?: string | null;
      postalCode?: string | null;
    };

    const result = await geocodeRestaurantLocation(normalizeRestaurantLocationInput(body));
    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      {
        ok: false,
        warning: 'Restaurant location saved, but geocoding could not be completed right now.',
      },
      { status: 200 }
    );
  }
}
