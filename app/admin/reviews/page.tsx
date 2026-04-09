import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  authenticateAdminSession,
  SUPAVORE_ACCESS_TOKEN_COOKIE,
  SUPAVORE_REFRESH_TOKEN_COOKIE,
} from '@/lib/adminAuth';
import { listPendingReviews } from '@/lib/adminReviewQueue';
import { formatAdminTimestamp } from '@/lib/adminTimestamp';
import { ReviewActions } from '@/app/admin/reviews/review-actions';

function formatScore(value: unknown) {
  return typeof value === 'number' ? value.toFixed(2) : '—';
}

export default async function ReviewsPage() {
  const cookieStore = await cookies();
  const authResult = await authenticateAdminSession({
    accessToken: cookieStore.get(SUPAVORE_ACCESS_TOKEN_COOKIE)?.value,
    refreshToken: cookieStore.get(SUPAVORE_REFRESH_TOKEN_COOKIE)?.value,
  });

  if (!authResult.ok) {
    redirect('/login');
  }

  const reviews = await listPendingReviews();
  const hoursReviews = reviews.filter((review) => review.reviewType === 'restaurant_hours_place_match');
  const duplicateReviews = reviews.filter((review) => review.reviewType === 'restaurant_duplicate_merge');

  return (
    <main className="min-h-screen bg-zinc-50 px-6 py-10 text-zinc-950 sm:px-10 lg:px-16">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-8">
        <div className="space-y-3">
            <span className="w-fit rounded-full border border-zinc-200 bg-white px-3 py-1 text-xs font-medium tracking-wide text-zinc-600">
            Admin review
            </span>
          <div className="space-y-2">
            <h1 className="text-4xl font-semibold tracking-tight text-zinc-950">Reviews</h1>
            <p className="max-w-2xl text-sm text-zinc-600 sm:text-base">
              Review borderline Google Places matches and duplicate restaurant merge suggestions
              before applying changes.
            </p>
          </div>
        </div>

        <section className="grid gap-4 lg:grid-cols-3">
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-zinc-500">Pending reviews</p>
            <p className="mt-2 text-3xl font-semibold text-zinc-950">{reviews.length}</p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-zinc-500">Review type</p>
            <p className="mt-2 text-sm font-medium text-zinc-900">Hours sync and restaurant merges</p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-zinc-500">Scope</p>
            <p className="mt-2 text-sm font-medium text-zinc-900">Pending only</p>
          </div>
        </section>

        <section className="overflow-hidden rounded-3xl border border-zinc-200 bg-white shadow-sm">
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-zinc-200 text-left text-sm">
              <thead className="bg-zinc-50">
                <tr>
                  <th className="px-5 py-4 font-medium text-zinc-600">Restaurant</th>
                  <th className="px-5 py-4 font-medium text-zinc-600">Candidate</th>
                  <th className="px-5 py-4 font-medium text-zinc-600">Review Note</th>
                  <th className="px-5 py-4 font-medium text-zinc-600">Confidence</th>
                  <th className="px-5 py-4 font-medium text-zinc-600">Scores</th>
                  <th className="px-5 py-4 font-medium text-zinc-600">Created</th>
                  <th className="px-5 py-4 font-medium text-zinc-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-100">
                {reviews.length === 0 ? (
                  <tr>
                    <td className="px-5 py-8 text-zinc-500" colSpan={7}>
                      No pending reviews.
                    </td>
                  </tr>
                ) : (
                  reviews.map((review) => {
                    const scoreBreakdown =
                      review.reviewPayload.scoreBreakdown &&
                      typeof review.reviewPayload.scoreBreakdown === 'object'
                        ? (review.reviewPayload.scoreBreakdown as Record<string, unknown>)
                        : {};
                    const isHoursReview = review.reviewType === 'restaurant_hours_place_match';
                    const leftName = isHoursReview
                      ? typeof review.reviewPayload.restaurantName === 'string'
                        ? review.reviewPayload.restaurantName
                        : 'Unknown restaurant'
                      : typeof review.reviewPayload.sourceRestaurantName === 'string'
                        ? review.reviewPayload.sourceRestaurantName
                        : 'Unknown restaurant';
                    const leftAddress = isHoursReview
                      ? typeof review.reviewPayload.restaurantAddress === 'string'
                        ? review.reviewPayload.restaurantAddress
                        : '—'
                      : typeof review.reviewPayload.sourceRestaurantAddress === 'string'
                        ? review.reviewPayload.sourceRestaurantAddress
                        : '—';
                    const rightName = isHoursReview
                      ? typeof review.reviewPayload.matchedDisplayName === 'string'
                        ? review.reviewPayload.matchedDisplayName
                        : '—'
                      : typeof review.reviewPayload.targetRestaurantName === 'string'
                        ? review.reviewPayload.targetRestaurantName
                        : '—';
                    const rightAddress = isHoursReview
                      ? typeof review.reviewPayload.candidateFormattedAddress === 'string'
                        ? review.reviewPayload.candidateFormattedAddress
                        : '—'
                      : typeof review.reviewPayload.targetRestaurantAddress === 'string'
                        ? review.reviewPayload.targetRestaurantAddress
                        : '—';
                    const dependentCounts =
                      review.reviewPayload.dependentCounts &&
                      typeof review.reviewPayload.dependentCounts === 'object'
                        ? (review.reviewPayload.dependentCounts as Record<string, unknown>)
                        : null;

                    return (
                      <tr key={review.id} className="align-top">
                        <td className="px-5 py-4">
                          <p className="font-medium text-zinc-900">{leftName}</p>
                          <p className="mt-1 text-zinc-500">{leftAddress}</p>
                          <Link
                            href="/admin/menu"
                            className="mt-2 inline-block text-xs text-blue-600 underline"
                          >
                            Open Menu Admin
                          </Link>
                        </td>
                        <td className="px-5 py-4">
                          <p className="font-medium text-zinc-900">{rightName}</p>
                          <p className="mt-1 text-zinc-500">{rightAddress}</p>
                          {!isHoursReview && dependentCounts ? (
                            <p className="mt-2 text-xs text-zinc-500">
                              {`${dependentCounts.sourceMenuItems ?? 0} source menu items, ${
                                dependentCounts.sourceHours ?? 0
                              } source hours`}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-5 py-4 text-zinc-700">{review.summary ?? '—'}</td>
                        <td className="px-5 py-4 text-zinc-700">
                          {review.confidence?.toFixed(2) ?? '—'}
                        </td>
                        <td className="px-5 py-4 text-zinc-700">
                          {isHoursReview ? (
                            <>
                              <p>{`raw: ${formatScore(scoreBreakdown.rawNameScore)}`}</p>
                              <p>{`normalized: ${formatScore(scoreBreakdown.normalizedNameScore)}`}</p>
                              <p>{`address: ${formatScore(scoreBreakdown.addressScore)}`}</p>
                              <p>{`distance: ${formatScore(scoreBreakdown.distanceScore)}`}</p>
                            </>
                          ) : (
                            <p>{String(review.reviewPayload.conflictSummary || 'Ready to merge')}</p>
                          )}
                        </td>
                        <td className="px-5 py-4 text-zinc-700">
                          {formatAdminTimestamp(review.createdAt)}
                        </td>
                        <td className="px-5 py-4">
                          {isHoursReview ? (
                            <ReviewActions reviewId={review.id} />
                          ) : (
                            <ReviewActions
                              reviewId={review.id}
                              approveLabel="Merge"
                              rejectLabel="Dismiss"
                              approveResolution="approve_restaurant_merge"
                              rejectResolution="dismiss_without_change"
                            />
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </section>

        <section className="grid gap-4 lg:grid-cols-2">
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-zinc-500">Hours reviews</p>
            <p className="mt-2 text-3xl font-semibold text-zinc-950">{hoursReviews.length}</p>
          </div>
          <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
            <p className="text-sm text-zinc-500">Duplicate merge reviews</p>
            <p className="mt-2 text-3xl font-semibold text-zinc-950">{duplicateReviews.length}</p>
          </div>
        </section>
      </div>
    </main>
  );
}
