import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  authenticateAdminSession,
  SUPAVORE_ACCESS_TOKEN_COOKIE,
  SUPAVORE_REFRESH_TOKEN_COOKIE,
} from '@/lib/adminAuth';
import {
  getRestaurantHoursForAdmin,
  updateRestaurantHoursManually,
} from '@/lib/restaurantHoursSync';

async function authenticate() {
  const cookieStore = await cookies();

  return authenticateAdminSession({
    accessToken: cookieStore.get(SUPAVORE_ACCESS_TOKEN_COOKIE)?.value,
    refreshToken: cookieStore.get(SUPAVORE_REFRESH_TOKEN_COOKIE)?.value,
  });
}

export async function GET(request: Request) {
  const authResult = await authenticate();

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.status === 403 ? 'Forbidden' : 'Unauthorized' },
      { status: authResult.status }
    );
  }

  const restaurantId = new URL(request.url).searchParams.get('restaurantId')?.trim();

  if (!restaurantId) {
    return NextResponse.json({ error: 'Missing restaurantId.' }, { status: 400 });
  }

  try {
    const record = await getRestaurantHoursForAdmin(restaurantId);

    if (!record) {
      return NextResponse.json({ error: 'Restaurant not found.' }, { status: 404 });
    }

    return NextResponse.json(record);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Unable to load restaurant operating hours right now.',
      },
      { status: 500 }
    );
  }
}

async function handleManualSave(request: Request) {
  const authResult = await authenticate();

  if (!authResult.ok) {
    return NextResponse.json(
      { error: authResult.status === 403 ? 'Forbidden' : 'Unauthorized' },
      { status: authResult.status }
    );
  }

  const body = (await request.json().catch(() => null)) as
    | {
        restaurantId?: string;
        hours?: Array<{
          dayOfWeek?: number;
          openTimeLocal?: string | null;
          closeTimeLocal?: string | null;
          isClosed?: boolean;
          windowIndex?: number;
          source?: string | null;
        }>;
        note?: string | null;
      }
    | null;

  const restaurantId = body?.restaurantId?.trim();

  if (!restaurantId || !Array.isArray(body?.hours)) {
    return NextResponse.json({ error: 'Invalid restaurant hours payload.' }, { status: 400 });
  }

  try {
    const result = await updateRestaurantHoursManually({
      restaurantId,
      hours: body.hours.map((window) => ({
        dayOfWeek: typeof window.dayOfWeek === 'number' ? window.dayOfWeek : -1,
        openTimeLocal:
          typeof window.openTimeLocal === 'string' || window.openTimeLocal === null
            ? window.openTimeLocal
            : null,
        closeTimeLocal:
          typeof window.closeTimeLocal === 'string' || window.closeTimeLocal === null
            ? window.closeTimeLocal
            : null,
        isClosed: window.isClosed === true,
        windowIndex: typeof window.windowIndex === 'number' ? window.windowIndex : 0,
        source: typeof window.source === 'string' || window.source === null ? window.source : null,
      })),
      note: typeof body.note === 'string' || body.note === null ? body.note : null,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : 'Unable to save restaurant operating hours right now.',
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  return handleManualSave(request);
}

export async function POST(request: Request) {
  return handleManualSave(request);
}
