import { normalizeOptionalText, normalizeWhitespace } from '@/lib/menuNormalization';
import {
  type RestaurantHoursSyncResult,
} from '@/lib/restaurantHoursSync';

export async function enrichRestaurantHoursViaApi(
  input: {
    restaurantId: string;
    restaurantName: string;
    address?: string | null;
    latitude?: number | null;
    longitude?: number | null;
    force?: boolean;
  }
): Promise<RestaurantHoursSyncResult> {
  const restaurantId = input.restaurantId.trim();
  const restaurantName = normalizeWhitespace(input.restaurantName);
  const address = normalizeOptionalText(input.address);

  if (!restaurantId || !restaurantName || !address) {
    return {
      ok: false,
      restaurantId: restaurantId || 'unknown',
      status: 'update_error',
      message: 'Restaurant hours sync was skipped because restaurant ID, name, or address was missing.',
      rowsReplaced: false,
      metadataUpdated: false,
      manualLockSkipped: false,
    };
  }

  try {
    const response = await fetch('/api/restaurants/enrich-hours', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        restaurantId,
        restaurantName,
        address,
        latitude: input.latitude ?? null,
        longitude: input.longitude ?? null,
        force: input.force === true,
      }),
    });

    const payload = (await response.json()) as
      | RestaurantHoursSyncResult
      | {
          error?: string;
        };

    if (!response.ok) {
      return {
        ok: false,
        restaurantId,
        status: 'update_error',
        message:
          'error' in payload && payload.error
            ? payload.error
            : 'Google Places hours enrichment could not be completed right now.',
        rowsReplaced: false,
        metadataUpdated: false,
        manualLockSkipped: false,
      };
    }

    return payload as RestaurantHoursSyncResult;
  } catch {
    return {
      ok: false,
      restaurantId,
      status: 'update_error',
      message: 'Google Places hours enrichment could not be completed right now.',
      rowsReplaced: false,
      metadataUpdated: false,
      manualLockSkipped: false,
    };
  }
}
