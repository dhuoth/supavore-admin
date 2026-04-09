'use client';

import type { ExecuteRestaurantMergeParams, RestaurantMergePreview } from '@/lib/restaurantMergeTypes';

async function parseJsonResponse<T>(response: Response) {
  const payload = (await response.json().catch(() => null)) as (T & { error?: string }) | null;

  if (!response.ok) {
    throw new Error(payload?.error || 'Unable to complete the request right now.');
  }

  return payload;
}

export async function fetchRestaurantMergePreview(input: {
  sourceRestaurantId: string;
  targetRestaurantId: string;
}) {
  const response = await fetch('/api/admin/restaurants/merge-preview', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  return parseJsonResponse<RestaurantMergePreview>(response);
}

export async function createRestaurantDuplicateMergeReview(input: {
  sourceRestaurantId: string;
  targetRestaurantId: string;
}) {
  const response = await fetch('/api/admin/restaurants/duplicate-review', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  return parseJsonResponse<{ preview: RestaurantMergePreview }>(response);
}

export async function mergeRestaurants(input: ExecuteRestaurantMergeParams & { reviewId?: string }) {
  const response = await fetch('/api/admin/restaurants/merge', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });

  return parseJsonResponse<Record<string, unknown>>(response);
}
