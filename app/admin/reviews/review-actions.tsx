'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import type {
  RestaurantMergeDisplayNameStrategy,
  RestaurantMergeHoursStrategy,
  RestaurantMergeOnlineOrderingLinkStrategy,
} from '@/lib/restaurantMergeTypes';

export type ReviewResolution =
  | 'approve_candidate_and_sync'
  | 'reject_candidate'
  | 'dismiss_without_change'
  | 'approve_restaurant_merge';

type ReviewActionsProps<TApprove extends ReviewResolution, TReject extends ReviewResolution> = {
  reviewId: string;
  onResolved?: (resolution: TApprove | TReject) => void | Promise<void>;
  approveLabel?: string;
  rejectLabel?: string;
  approveResolution?: TApprove;
  rejectResolution?: TReject;
  mergeParams?: {
    displayNameStrategy?: RestaurantMergeDisplayNameStrategy;
    customDisplayName?: string | null;
    onlineOrderingLinkStrategy?: RestaurantMergeOnlineOrderingLinkStrategy;
    hoursStrategy?: RestaurantMergeHoursStrategy;
  };
};

export function ReviewActions<
  TApprove extends ReviewResolution = 'approve_candidate_and_sync',
  TReject extends ReviewResolution = 'reject_candidate'
>({
  reviewId,
  onResolved,
  approveLabel = 'Approve',
  rejectLabel = 'Reject',
  approveResolution = 'approve_candidate_and_sync' as TApprove,
  rejectResolution = 'reject_candidate' as TReject,
  mergeParams,
}: ReviewActionsProps<TApprove, TReject>) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleResolution = async (resolution: TApprove | TReject) => {
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/reviews/${reviewId}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ resolution, mergeParams }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to resolve review right now.');
      }

      if (onResolved) {
        await onResolved(resolution);
      }

      router.refresh();
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : 'Unable to resolve review.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => handleResolution(approveResolution)}
          disabled={isSubmitting}
          className="inline-flex items-center justify-center rounded-xl bg-black px-3 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
        >
          {isSubmitting ? 'Saving...' : approveLabel}
        </button>
        <button
          type="button"
          onClick={() => handleResolution(rejectResolution)}
          disabled={isSubmitting}
          className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
        >
          {rejectLabel}
        </button>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
