import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  authenticateAdminSession,
  SUPAVORE_ACCESS_TOKEN_COOKIE,
  SUPAVORE_REFRESH_TOKEN_COOKIE,
} from '@/lib/adminAuth';
import { upsertRestaurantDuplicateMergeReview } from '@/lib/adminReviewQueue';

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

  const body = (await request.json().catch(() => null)) as
    | {
        sourceRestaurantId?: string;
        targetRestaurantId?: string;
      }
    | null;

  if (!body?.sourceRestaurantId || !body?.targetRestaurantId) {
    return NextResponse.json(
      { error: 'Source and target restaurant IDs are required.' },
      { status: 400 }
    );
  }

  try {
    const preview = await upsertRestaurantDuplicateMergeReview({
      sourceRestaurantId: body.sourceRestaurantId,
      targetRestaurantId: body.targetRestaurantId,
    });

    return NextResponse.json({ preview });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unable to queue duplicate review right now.',
      },
      { status: 500 }
    );
  }
}
