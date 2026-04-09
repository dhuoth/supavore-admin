import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import {
  authenticateAdminSession,
  SUPAVORE_ACCESS_TOKEN_COOKIE,
  SUPAVORE_REFRESH_TOKEN_COOKIE,
} from '@/lib/adminAuth';
import {
  clearRestaurantDuplicateMergeReview,
  resolveRestaurantDuplicateMergeReview,
} from '@/lib/adminReviewQueue';
import { executeRestaurantMerge } from '@/lib/restaurantMerge';
import type {
  RestaurantMergeDisplayNameStrategy,
  RestaurantMergeHoursStrategy,
  RestaurantMergeOnlineOrderingLinkStrategy,
} from '@/lib/restaurantMergeTypes';

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
        displayNameStrategy?: RestaurantMergeDisplayNameStrategy;
        customDisplayName?: string | null;
        onlineOrderingLinkStrategy?: RestaurantMergeOnlineOrderingLinkStrategy;
        hoursStrategy?: RestaurantMergeHoursStrategy;
        reviewId?: string;
      }
    | null;

  if (!body?.sourceRestaurantId || !body?.targetRestaurantId) {
    return NextResponse.json(
      { error: 'Source and target restaurant IDs are required.' },
      { status: 400 }
    );
  }

  try {
    if (body.reviewId) {
      const result = await resolveRestaurantDuplicateMergeReview({
        reviewId: body.reviewId,
        resolution: 'approve_restaurant_merge',
        reviewerUserId: authResult.user.id,
        mergeParams: {
          displayNameStrategy: body.displayNameStrategy,
          customDisplayName: body.customDisplayName,
          onlineOrderingLinkStrategy: body.onlineOrderingLinkStrategy,
          hoursStrategy: body.hoursStrategy,
        },
      });

      return NextResponse.json(result);
    }

    const result = await executeRestaurantMerge({
      sourceRestaurantId: body.sourceRestaurantId,
      targetRestaurantId: body.targetRestaurantId,
      displayNameStrategy: body.displayNameStrategy,
      customDisplayName: body.customDisplayName,
      onlineOrderingLinkStrategy: body.onlineOrderingLinkStrategy,
      hoursStrategy: body.hoursStrategy,
    });

    await clearRestaurantDuplicateMergeReview(body.sourceRestaurantId).catch(() => null);

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Unable to merge restaurants right now.',
      },
      { status: 500 }
    );
  }
}
