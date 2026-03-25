import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { authenticateAdminSession, SUPAVORE_ACCESS_TOKEN_COOKIE, SUPAVORE_REFRESH_TOKEN_COOKIE } from '@/lib/adminAuth';
import { backfillRestaurantLocationsOnServer } from '@/lib/restaurantLocationBackfillServer';

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
    const body = (await request.json().catch(() => ({}))) as {
      restaurantIds?: unknown;
    };
    const restaurantIds = Array.isArray(body.restaurantIds)
      ? body.restaurantIds.filter((value): value is string => typeof value === 'string')
      : undefined;

    const result = await backfillRestaurantLocationsOnServer(restaurantIds);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Unable to backfill restaurant locations right now.',
      },
      { status: 500 }
    );
  }
}
