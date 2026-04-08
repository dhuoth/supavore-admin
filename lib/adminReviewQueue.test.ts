import test from 'node:test';
import assert from 'node:assert/strict';
import {
  getReviewById,
  listPendingReviews,
  resolveHoursPlaceReview,
} from '@/lib/adminReviewQueue';

const sampleReview = {
  id: 'review-1',
  review_type: 'restaurant_hours_place_match' as const,
  entity_type: 'restaurant',
  entity_id: 'restaurant-1',
  status: 'pending' as const,
  priority: 'normal',
  source: 'google_places_new',
  summary: 'Needs review.',
  confidence: 0.67,
  review_payload: {
    restaurantName: "Bludso's",
    matchedDisplayName: "Bludso's BBQ",
  },
  decision_payload: null,
  created_at: '2026-04-06T20:00:00.000Z',
  updated_at: '2026-04-06T20:00:00.000Z',
  resolved_at: null,
  resolved_by: null,
};

test('listPendingReviews returns pending review queue items for the requested type', async () => {
  const reviews = await listPendingReviews('restaurant_hours_place_match', {
    async listReviews() {
      return [sampleReview];
    },
    async getReviewById() {
      return null;
    },
    async upsertPendingReview() {
      return null;
    },
    async clearPendingReview() {
      return null;
    },
    async resolveReview() {
      return null;
    },
    async enrichApprovedGooglePlace() {
      throw new Error('not used');
    },
    async getRestaurantHoursRecord() {
      return null;
    },
    async persistHoursResult() {
      throw new Error('not used');
    },
  });

  assert.equal(reviews.length, 1);
  assert.equal(reviews[0]?.id, 'review-1');
  assert.equal(reviews[0]?.reviewPayload.matchedDisplayName, "Bludso's BBQ");
});

test('getReviewById returns a normalized review queue item', async () => {
  const review = await getReviewById('review-1', {
    async listReviews() {
      return [];
    },
    async getReviewById() {
      return sampleReview;
    },
    async upsertPendingReview() {
      return null;
    },
    async clearPendingReview() {
      return null;
    },
    async resolveReview() {
      return null;
    },
    async enrichApprovedGooglePlace() {
      throw new Error('not used');
    },
    async getRestaurantHoursRecord() {
      return null;
    },
    async persistHoursResult() {
      throw new Error('not used');
    },
  });

  assert.equal(review?.id, 'review-1');
  assert.equal(review?.status, 'pending');
  assert.equal(review?.confidence, 0.67);
});

test('resolveHoursPlaceReview rejects a low-confidence candidate through the shared queue path', async () => {
  let resolvedPayload:
    | {
        status: 'approved' | 'rejected' | 'dismissed';
        decisionPayload: Record<string, unknown>;
        resolvedBy?: string | null;
      }
    | null = null;

  const result = await resolveHoursPlaceReview(
    {
      reviewId: 'review-1',
      resolution: 'reject_candidate',
      reviewerUserId: 'admin-1',
    },
    {
      async listReviews() {
        return [];
      },
      async getReviewById() {
        return sampleReview;
      },
      async upsertPendingReview() {
        return null;
      },
      async clearPendingReview() {
        return null;
      },
      async resolveReview(_reviewId, input) {
        resolvedPayload = input;
        return null;
      },
      async enrichApprovedGooglePlace() {
        throw new Error('not used');
      },
      async getRestaurantHoursRecord() {
        return {
          restaurantId: 'restaurant-1',
          googlePlaceId: null,
          hoursSource: null,
          hoursLastSyncedAt: null,
          hoursSyncStatus: null,
          hoursMatchConfidence: null,
          hoursNotes: null,
          timezone: 'UTC-07:00',
          placeNameFromSource: null,
          hoursIsManuallyManaged: false,
          pendingReviewId: 'review-1',
          pendingReviewSummary: 'Needs review.',
          pendingReviewConfidence: 0.67,
          pendingReviewPayload: sampleReview.review_payload,
          hours: [],
        };
      },
      async persistHoursResult() {
        return {
          ok: true,
          restaurantId: 'restaurant-1',
          status: 'low_confidence_match',
          message: 'Admin rejected the Google Places candidate for review.',
          rowsReplaced: false,
          metadataUpdated: true,
          manualLockSkipped: false,
        };
      },
    }
  );

  assert.equal(result.status, 'low_confidence_match');
  assert.equal(result.ok, true);
  assert.equal(resolvedPayload?.status, 'rejected');
  assert.equal(resolvedPayload?.decisionPayload.resolution, 'reject_candidate');
});
