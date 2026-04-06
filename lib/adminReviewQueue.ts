import 'server-only';

import { enrichRestaurantHoursFromApprovedGooglePlace } from '@/lib/googlePlacesHours';
import {
  getRestaurantHoursForAdmin,
  persistRestaurantHoursResult,
  type RestaurantHoursSyncResult,
} from '@/lib/restaurantHoursSync';
import { createSupabaseAdminClient } from '@/lib/supabaseAdmin';

export type AdminReviewStatus = 'pending' | 'approved' | 'rejected' | 'dismissed';
export type AdminReviewType = 'restaurant_hours_place_match';

export type AdminReviewQueueItem = {
  id: string;
  reviewType: AdminReviewType;
  entityType: string;
  entityId: string;
  status: AdminReviewStatus;
  priority: string;
  source: string | null;
  summary: string | null;
  confidence: number | null;
  reviewPayload: Record<string, unknown>;
  decisionPayload: Record<string, unknown> | null;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  resolvedBy: string | null;
};

type AdminReviewQueueRow = {
  id: string;
  review_type: AdminReviewType;
  entity_type: string;
  entity_id: string;
  status: AdminReviewStatus;
  priority: string;
  source: string | null;
  summary: string | null;
  confidence: number | null;
  review_payload: Record<string, unknown>;
  decision_payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
};

type QueueDependencies = {
  listReviews: (status?: AdminReviewStatus) => Promise<AdminReviewQueueRow[]>;
  getReviewById: (reviewId: string) => Promise<AdminReviewQueueRow | null>;
  upsertPendingReview: (input: {
    reviewType: AdminReviewType;
    entityType: string;
    entityId: string;
    priority: string;
    source: string | null;
    summary: string | null;
    confidence: number | null;
    reviewPayload: Record<string, unknown>;
  }) => Promise<string | null>;
  clearPendingReview: (reviewType: AdminReviewType, entityType: string, entityId: string) => Promise<string | null>;
  resolveReview: (reviewId: string, input: {
    status: Exclude<AdminReviewStatus, 'pending'>;
    decisionPayload: Record<string, unknown>;
    resolvedBy?: string | null;
  }) => Promise<string | null>;
};

function createQueueDependencies(): QueueDependencies {
  const supabaseAdmin = createSupabaseAdminClient();

  return {
    async listReviews(status) {
      let query = supabaseAdmin
        .from('admin_review_queue')
        .select(
          'id, review_type, entity_type, entity_id, status, priority, source, summary, confidence, review_payload, decision_payload, created_at, updated_at, resolved_at, resolved_by'
        )
        .order('created_at', { ascending: false });

      if (status) {
        query = query.eq('status', status);
      }

      const { data, error } = await query;

      if (error) {
        throw error;
      }

      return (data as AdminReviewQueueRow[] | null) ?? [];
    },
    async getReviewById(reviewId) {
      const { data, error } = await supabaseAdmin
        .from('admin_review_queue')
        .select(
          'id, review_type, entity_type, entity_id, status, priority, source, summary, confidence, review_payload, decision_payload, created_at, updated_at, resolved_at, resolved_by'
        )
        .eq('id', reviewId)
        .maybeSingle();

      if (error) {
        throw error;
      }

      return (data as AdminReviewQueueRow | null) ?? null;
    },
    async upsertPendingReview(input) {
      const { data: existing, error: existingError } = await supabaseAdmin
        .from('admin_review_queue')
        .select('id')
        .eq('review_type', input.reviewType)
        .eq('entity_type', input.entityType)
        .eq('entity_id', input.entityId)
        .eq('status', 'pending')
        .maybeSingle();

      if (existingError) {
        return existingError.message;
      }

      if (existing?.id) {
        const { error } = await supabaseAdmin
          .from('admin_review_queue')
          .update({
            priority: input.priority,
            source: input.source,
            summary: input.summary,
            confidence: input.confidence,
            review_payload: input.reviewPayload,
            decision_payload: null,
            resolved_at: null,
            resolved_by: null,
          })
          .eq('id', existing.id);

        return error?.message ?? null;
      }

      const { error } = await supabaseAdmin.from('admin_review_queue').insert({
        review_type: input.reviewType,
        entity_type: input.entityType,
        entity_id: input.entityId,
        status: 'pending',
        priority: input.priority,
        source: input.source,
        summary: input.summary,
        confidence: input.confidence,
        review_payload: input.reviewPayload,
      });

      return error?.message ?? null;
    },
    async clearPendingReview(reviewType, entityType, entityId) {
      const { error } = await supabaseAdmin
        .from('admin_review_queue')
        .delete()
        .eq('review_type', reviewType)
        .eq('entity_type', entityType)
        .eq('entity_id', entityId)
        .eq('status', 'pending');

      return error?.message ?? null;
    },
    async resolveReview(reviewId, input) {
      const { error } = await supabaseAdmin
        .from('admin_review_queue')
        .update({
          status: input.status,
          decision_payload: input.decisionPayload,
          resolved_at: new Date().toISOString(),
          resolved_by: input.resolvedBy ?? null,
        })
        .eq('id', reviewId);

      return error?.message ?? null;
    },
  };
}

function toQueueItem(row: AdminReviewQueueRow): AdminReviewQueueItem {
  return {
    id: row.id,
    reviewType: row.review_type,
    entityType: row.entity_type,
    entityId: row.entity_id,
    status: row.status,
    priority: row.priority,
    source: row.source,
    summary: row.summary,
    confidence: row.confidence,
    reviewPayload: row.review_payload,
    decisionPayload: row.decision_payload,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
  };
}

export async function listPendingReviews(
  reviewType?: AdminReviewType,
  dependencies: QueueDependencies = createQueueDependencies()
) {
  const rows = await dependencies.listReviews('pending');
  const filteredRows = reviewType ? rows.filter((row) => row.review_type === reviewType) : rows;
  return filteredRows.map(toQueueItem);
}

export async function getReviewById(
  reviewId: string,
  dependencies: QueueDependencies = createQueueDependencies()
) {
  const row = await dependencies.getReviewById(reviewId);
  return row ? toQueueItem(row) : null;
}

export async function upsertHoursPlaceMatchReview(
  input: {
    restaurantId: string;
    summary: string | null;
    confidence: number | null;
    reviewPayload: Record<string, unknown>;
  },
  dependencies: QueueDependencies = createQueueDependencies()
) {
  return dependencies.upsertPendingReview({
    reviewType: 'restaurant_hours_place_match',
    entityType: 'restaurant',
    entityId: input.restaurantId,
    priority: input.confidence !== null && input.confidence < 0.6 ? 'high' : 'normal',
    source: 'google_places_new',
    summary: input.summary,
    confidence: input.confidence,
    reviewPayload: input.reviewPayload,
  });
}

export async function clearHoursPlaceMatchReview(
  restaurantId: string,
  dependencies: QueueDependencies = createQueueDependencies()
) {
  return dependencies.clearPendingReview('restaurant_hours_place_match', 'restaurant', restaurantId);
}

export async function resolveHoursPlaceReview(
  params: {
    reviewId: string;
    resolution: 'approve_candidate_and_sync' | 'reject_candidate' | 'dismiss_without_change';
    reviewerUserId?: string | null;
  },
  dependencies: QueueDependencies = createQueueDependencies()
) {
  const review = await dependencies.getReviewById(params.reviewId);

  if (!review) {
    throw new Error('Review item not found.');
  }

  if (review.review_type !== 'restaurant_hours_place_match') {
    throw new Error('Unsupported review type.');
  }

  if (review.status !== 'pending') {
    throw new Error('Review item has already been resolved.');
  }

  const restaurantId = review.entity_id;
  const payload = review.review_payload;

  if (params.resolution === 'approve_candidate_and_sync') {
    const placeId = typeof payload.placeId === 'string' ? payload.placeId : '';

    if (!placeId) {
      throw new Error('Review item is missing a candidate place ID.');
    }

    const approvedResult = await enrichRestaurantHoursFromApprovedGooglePlace({
      placeId,
      matchedDisplayName: typeof payload.matchedDisplayName === 'string' ? payload.matchedDisplayName : null,
      matchConfidence: typeof review.confidence === 'number' ? review.confidence : null,
      candidateFormattedAddress:
        typeof payload.candidateFormattedAddress === 'string' ? payload.candidateFormattedAddress : null,
      candidateLatitude:
        typeof payload.candidateLatitude === 'number' ? payload.candidateLatitude : null,
      candidateLongitude:
        typeof payload.candidateLongitude === 'number' ? payload.candidateLongitude : null,
      scoreBreakdown:
        payload.scoreBreakdown && typeof payload.scoreBreakdown === 'object'
          ? (payload.scoreBreakdown as {
              rawNameScore: number | null;
              normalizedNameScore: number | null;
              effectiveNameScore: number | null;
              addressScore: number | null;
              distanceScore: number | null;
            })
          : undefined,
    });
    const syncResult = await persistRestaurantHoursResult({
      restaurantId,
      result: approvedResult,
      force: true,
    });

    const resolveError = await dependencies.resolveReview(params.reviewId, {
      status: 'approved',
      decisionPayload: {
        resolution: params.resolution,
        syncStatus: syncResult.status,
      },
      resolvedBy: params.reviewerUserId ?? null,
    });

    if (resolveError) {
      throw new Error(resolveError);
    }

    return syncResult;
  }

  if (params.resolution === 'reject_candidate') {
    const currentRecord = await getRestaurantHoursForAdmin(restaurantId);

    if (!currentRecord) {
      throw new Error('Restaurant not found for review rejection.');
    }

    const rejectSyncResult = await persistRestaurantHoursResult({
      restaurantId,
      result: {
        ok: false,
        status: 'low_confidence_match',
        placeId: typeof payload.placeId === 'string' ? payload.placeId : undefined,
        source: 'google_places_new',
        matchedDisplayName:
          typeof payload.matchedDisplayName === 'string' ? payload.matchedDisplayName : undefined,
        matchConfidence: typeof review.confidence === 'number' ? review.confidence : null,
        timezone: currentRecord.timezone,
        note: 'Admin rejected the Google Places candidate for review.',
      },
      force: false,
    });

    const resolveError = await dependencies.resolveReview(params.reviewId, {
      status: 'rejected',
      decisionPayload: {
        resolution: params.resolution,
      },
      resolvedBy: params.reviewerUserId ?? null,
    });

    if (resolveError) {
      throw new Error(resolveError);
    }

    return rejectSyncResult;
  }

  const resolveError = await dependencies.resolveReview(params.reviewId, {
    status: 'dismissed',
    decisionPayload: {
      resolution: params.resolution,
    },
    resolvedBy: params.reviewerUserId ?? null,
  });

  if (resolveError) {
    throw new Error(resolveError);
  }

  return {
    ok: true,
    restaurantId,
    status: 'low_confidence_match',
    message: 'Review item dismissed without changing restaurant hours.',
    rowsReplaced: false,
    metadataUpdated: false,
    manualLockSkipped: false,
  } satisfies RestaurantHoursSyncResult;
}
