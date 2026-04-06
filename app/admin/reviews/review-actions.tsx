'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function ReviewActions({ reviewId }: { reviewId: string }) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleResolution = async (
    resolution: 'approve_candidate_and_sync' | 'reject_candidate'
  ) => {
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch(`/api/admin/reviews/${reviewId}/resolve`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ resolution }),
      });
      const payload = (await response.json()) as { error?: string };

      if (!response.ok) {
        throw new Error(payload.error || 'Unable to resolve review right now.');
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
          onClick={() => handleResolution('approve_candidate_and_sync')}
          disabled={isSubmitting}
          className="inline-flex items-center justify-center rounded-xl bg-black px-3 py-2 text-sm font-medium text-white transition hover:bg-neutral-800 disabled:cursor-not-allowed disabled:bg-zinc-400"
        >
          {isSubmitting ? 'Saving...' : 'Approve'}
        </button>
        <button
          type="button"
          onClick={() => handleResolution('reject_candidate')}
          disabled={isSubmitting}
          className="inline-flex items-center justify-center rounded-xl border border-zinc-200 bg-white px-3 py-2 text-sm font-medium text-zinc-700 transition hover:bg-zinc-50 disabled:cursor-not-allowed disabled:bg-zinc-100 disabled:text-zinc-400"
        >
          Reject
        </button>
      </div>
      {error ? <p className="text-xs text-red-600">{error}</p> : null}
    </div>
  );
}
