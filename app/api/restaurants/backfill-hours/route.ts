import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  authenticateAdminSession,
  SUPAVORE_ACCESS_TOKEN_COOKIE,
  SUPAVORE_REFRESH_TOKEN_COOKIE,
} from '@/lib/adminAuth';
import { backfillRestaurantHoursOnServer } from '@/lib/restaurantHoursBackfillServer';

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
      limit?: unknown;
      offset?: unknown;
      force?: unknown;
    };

    const result = await backfillRestaurantHoursOnServer({
      restaurantIds: Array.isArray(body.restaurantIds)
        ? body.restaurantIds.filter((value): value is string => typeof value === 'string')
        : undefined,
      limit: typeof body.limit === 'number' ? body.limit : undefined,
      offset: typeof body.offset === 'number' ? body.offset : undefined,
      force: body.force === true,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Unable to backfill restaurant operating hours right now.',
      },
      { status: 500 }
    );
  }
}
