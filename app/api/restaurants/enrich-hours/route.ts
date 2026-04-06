import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  authenticateAdminSession,
  SUPAVORE_ACCESS_TOKEN_COOKIE,
  SUPAVORE_REFRESH_TOKEN_COOKIE,
} from '@/lib/adminAuth';
import { syncRestaurantHoursFromGoogle } from '@/lib/restaurantHoursSync';
import { normalizeOptionalText, normalizeWhitespace } from '@/lib/menuNormalization';

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
      restaurantId?: string | null;
      restaurantName?: string | null;
      address?: string | null;
      latitude?: number | null;
      longitude?: number | null;
      force?: boolean | null;
    };

    if (!body.restaurantId?.trim()) {
      return NextResponse.json({ error: 'Missing restaurantId.' }, { status: 400 });
    }

    const result = await syncRestaurantHoursFromGoogle({
      restaurantId: body.restaurantId.trim(),
      restaurantName: normalizeWhitespace(body.restaurantName),
      address: normalizeOptionalText(body.address),
      latitude: typeof body.latitude === 'number' ? body.latitude : null,
      longitude: typeof body.longitude === 'number' ? body.longitude : null,
      force: body.force === true,
    });

    return NextResponse.json(result);
  } catch {
    return NextResponse.json(
      {
        error: 'Google Places hours enrichment could not be completed right now.',
      },
      { status: 500 }
    );
  }
}
