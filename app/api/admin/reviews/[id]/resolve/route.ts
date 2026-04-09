import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  authenticateAdminSession,
  SUPAVORE_ACCESS_TOKEN_COOKIE,
  SUPAVORE_REFRESH_TOKEN_COOKIE,
} from '@/lib/adminAuth';
import { resolveAdminReview } from '@/lib/adminReviewQueue';
import type {
  RestaurantMergeDisplayNameStrategy,
  RestaurantMergeHoursStrategy,
  RestaurantMergeOnlineOrderingLinkStrategy,
} from '@/lib/restaurantMergeTypes';

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
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
        resolution?:
          | 'approve_candidate_and_sync'
          | 'reject_candidate'
          | 'dismiss_without_change'
          | 'approve_restaurant_merge';
        mergeParams?: {
          displayNameStrategy?: RestaurantMergeDisplayNameStrategy;
          customDisplayName?: string | null;
          onlineOrderingLinkStrategy?: RestaurantMergeOnlineOrderingLinkStrategy;
          hoursStrategy?: RestaurantMergeHoursStrategy;
        };
      }
    | null;

  if (
    body?.resolution !== 'approve_candidate_and_sync' &&
    body?.resolution !== 'reject_candidate' &&
    body?.resolution !== 'dismiss_without_change' &&
    body?.resolution !== 'approve_restaurant_merge'
  ) {
    return NextResponse.json({ error: 'Invalid review resolution.' }, { status: 400 });
  }

  try {
    const { id } = await context.params;
    const result = await resolveAdminReview({
      reviewId: id,
      resolution: body.resolution,
      reviewerUserId: authResult.user.id,
      mergeParams: body.mergeParams,
    });

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unable to resolve review right now.',
      },
      { status: 500 }
    );
  }
}
