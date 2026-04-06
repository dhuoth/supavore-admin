import 'server-only';

import { normalizeOptionalText, normalizeWhitespace } from '@/lib/menuNormalization';
import { getGoogleServerApiKey } from '@/lib/googleApiKey';

const GOOGLE_PLACES_SEARCH_URL = 'https://places.googleapis.com/v1/places:searchText';
const GOOGLE_PLACES_DETAILS_BASE_URL = 'https://places.googleapis.com/v1/places';
const GOOGLE_PLACES_SEARCH_FIELD_MASK =
  'places.id,places.displayName,places.formattedAddress,places.location';
const GOOGLE_PLACES_DETAILS_FIELD_MASK =
  'id,displayName,regularOpeningHours,currentOpeningHours,utcOffsetMinutes';
const DAY_COUNT = 7;

export type GooglePlaceRestaurantSearchInput = {
  restaurantName: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
};

export type GooglePlaceHoursEnrichmentInput = GooglePlaceRestaurantSearchInput;

export type EnrichedRestaurantHoursWindow = {
  dayOfWeek: number;
  openTimeLocal: string | null;
  closeTimeLocal: string | null;
  isClosed: boolean;
  windowIndex: number;
  source: 'google_places_new';
};

export type EnrichedRestaurantHoursResult = {
  ok: boolean;
  status:
    | 'matched_with_hours'
    | 'matched_no_hours'
    | 'review_required_match'
    | 'no_match'
    | 'low_confidence_match'
    | 'api_error';
  placeId?: string;
  source?: 'google_places_new';
  matchedDisplayName?: string;
  timezone?: string | null;
  matchConfidence?: number | null;
  hours?: EnrichedRestaurantHoursWindow[];
  rawSummary?: {
    regularOpeningHours?: unknown;
    currentOpeningHours?: unknown;
  };
  scoreBreakdown?: {
    rawNameScore: number | null;
    normalizedNameScore: number | null;
    effectiveNameScore: number | null;
    addressScore: number | null;
    distanceScore: number | null;
  };
  candidateFormattedAddress?: string | null;
  candidateLatitude?: number | null;
  candidateLongitude?: number | null;
  note?: string;
};

type GooglePlaceSearchResponse = {
  places?: GoogleSearchPlace[];
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

type GoogleSearchPlace = {
  id?: string;
  displayName?: {
    text?: string;
    languageCode?: string;
  };
  formattedAddress?: string;
  location?: {
    latitude?: number;
    longitude?: number;
  };
};

type GooglePlaceDetailsResponse = {
  id?: string;
  displayName?: {
    text?: string;
    languageCode?: string;
  };
  regularOpeningHours?: GoogleOpeningHours;
  currentOpeningHours?: GoogleOpeningHours;
  utcOffsetMinutes?: number;
  error?: {
    code?: number;
    message?: string;
    status?: string;
  };
};

type GoogleOpeningHours = {
  openNow?: boolean;
  periods?: GoogleOpeningPeriod[];
  weekdayDescriptions?: string[];
};

type GoogleOpeningPeriod = {
  open?: GoogleOpeningHoursPoint;
  close?: GoogleOpeningHoursPoint;
};

type GoogleOpeningHoursPoint = {
  day?: number;
  hour?: number;
  minute?: number;
};

type GooglePlaceSearchCandidate = {
  placeId: string;
  displayName: string | null;
  formattedAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  confidence: number;
  rawNameScore: number;
  normalizedNameScore: number;
  effectiveNameScore: number;
  addressScore: number;
  distanceScore: number | null;
  reasons: string[];
};

type GooglePlaceMatchDecision = 'matched' | 'review_required_match' | 'low_confidence_match';

const GENERIC_RESTAURANT_TOKENS = new Set([
  'bbq',
  'barbecue',
  'restaurant',
  'grill',
  'cafe',
  'kitchen',
  'taqueria',
  'eatery',
  'bar',
  'house',
  'co',
  'company',
]);

function normalizeForMatch(value: string | null | undefined) {
  return normalizeWhitespace(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/['`’]s\b/g, 's')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeRestaurantCoreName(value: string | null | undefined) {
  const normalizedValue = normalizeForMatch(value);

  if (!normalizedValue) {
    return '';
  }

  return normalizedValue
    .split(' ')
    .filter((token) => token && !GENERIC_RESTAURANT_TOKENS.has(token))
    .join(' ')
    .trim();
}

function buildBigrams(value: string) {
  if (value.length < 2) {
    return new Set(value ? [value] : []);
  }

  const bigrams = new Set<string>();

  for (let index = 0; index < value.length - 1; index += 1) {
    bigrams.add(value.slice(index, index + 2));
  }

  return bigrams;
}

function diceCoefficient(left: string, right: string) {
  if (!left || !right) {
    return 0;
  }

  if (left === right) {
    return 1;
  }

  const leftBigrams = buildBigrams(left);
  const rightBigrams = buildBigrams(right);
  let overlap = 0;

  for (const token of leftBigrams) {
    if (rightBigrams.has(token)) {
      overlap += 1;
    }
  }

  return (2 * overlap) / (leftBigrams.size + rightBigrams.size);
}

function tokenContainmentScore(left: string, right: string) {
  if (!left || !right) {
    return 0;
  }

  const leftTokens = new Set(left.split(' ').filter(Boolean));
  const rightTokens = new Set(right.split(' ').filter(Boolean));

  if (!leftTokens.size || !rightTokens.size) {
    return 0;
  }

  let overlap = 0;

  for (const token of leftTokens) {
    if (rightTokens.has(token)) {
      overlap += 1;
    }
  }

  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function similarityScore(left: string | null | undefined, right: string | null | undefined) {
  const normalizedLeft = normalizeForMatch(left);
  const normalizedRight = normalizeForMatch(right);

  if (!normalizedLeft || !normalizedRight) {
    return 0;
  }

  return Math.max(
    diceCoefficient(normalizedLeft, normalizedRight),
    tokenContainmentScore(normalizedLeft, normalizedRight)
  );
}

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

function distanceInMeters(
  latitudeA: number,
  longitudeA: number,
  latitudeB: number,
  longitudeB: number
) {
  const earthRadiusMeters = 6371000;
  const deltaLatitude = toRadians(latitudeB - latitudeA);
  const deltaLongitude = toRadians(longitudeB - longitudeA);
  const latitudeARadians = toRadians(latitudeA);
  const latitudeBRadians = toRadians(latitudeB);
  const a =
    Math.sin(deltaLatitude / 2) ** 2 +
    Math.sin(deltaLongitude / 2) ** 2 * Math.cos(latitudeARadians) * Math.cos(latitudeBRadians);

  return 2 * earthRadiusMeters * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function distanceScore(
  expectedLatitude: number | null | undefined,
  expectedLongitude: number | null | undefined,
  candidateLatitude: number | null,
  candidateLongitude: number | null
) {
  if (
    expectedLatitude === null ||
    expectedLatitude === undefined ||
    expectedLongitude === null ||
    expectedLongitude === undefined ||
    candidateLatitude === null ||
    candidateLongitude === null
  ) {
    return null;
  }

  const meters = distanceInMeters(
    expectedLatitude,
    expectedLongitude,
    candidateLatitude,
    candidateLongitude
  );

  if (meters <= 75) {
    return 1;
  }

  if (meters <= 250) {
    return 0.9;
  }

  if (meters <= 1000) {
    return 0.6;
  }

  if (meters <= 5000) {
    return 0.2;
  }

  return 0;
}

function buildSearchTextQuery(input: GooglePlaceRestaurantSearchInput) {
  return [normalizeOptionalText(input.restaurantName), normalizeOptionalText(input.address)]
    .filter(Boolean)
    .join(', ');
}

function roundConfidence(value: number) {
  return Math.round(value * 1000) / 1000;
}

function formatPointTime(point?: GoogleOpeningHoursPoint) {
  if (
    point?.hour === undefined ||
    point?.minute === undefined ||
    Number.isNaN(point.hour) ||
    Number.isNaN(point.minute)
  ) {
    return null;
  }

  const hours = String(point.hour).padStart(2, '0');
  const minutes = String(point.minute).padStart(2, '0');

  return `${hours}:${minutes}:00`;
}

function toDayIndex(day: number | undefined) {
  if (day === undefined || day < 0 || day >= DAY_COUNT) {
    return null;
  }

  return day;
}

function buildClosedDayWindows(openDays: Set<number>) {
  const windows: EnrichedRestaurantHoursWindow[] = [];

  for (let dayOfWeek = 0; dayOfWeek < DAY_COUNT; dayOfWeek += 1) {
    if (openDays.has(dayOfWeek)) {
      continue;
    }

    windows.push({
      dayOfWeek,
      openTimeLocal: null,
      closeTimeLocal: null,
      isClosed: true,
      windowIndex: 0,
      source: 'google_places_new',
    });
  }

  return windows;
}

function normalizeHours(periods: GoogleOpeningPeriod[] | undefined) {
  if (!periods?.length) {
    return [];
  }

  const windowsByDay = new Map<number, EnrichedRestaurantHoursWindow[]>();
  const openDays = new Set<number>();

  for (const period of periods) {
    const dayOfWeek = toDayIndex(period.open?.day);

    if (dayOfWeek === null) {
      continue;
    }

    openDays.add(dayOfWeek);
    const nextWindows = windowsByDay.get(dayOfWeek) ?? [];

    nextWindows.push({
      dayOfWeek,
      openTimeLocal: formatPointTime(period.open),
      closeTimeLocal: formatPointTime(period.close),
      isClosed: false,
      windowIndex: nextWindows.length,
      source: 'google_places_new',
    });
    windowsByDay.set(dayOfWeek, nextWindows);
  }

  const windows = Array.from(windowsByDay.entries())
    .sort(([leftDay], [rightDay]) => leftDay - rightDay)
    .flatMap(([, dayWindows]) => dayWindows);

  return [...windows, ...buildClosedDayWindows(openDays)].sort((left, right) => {
    if (left.dayOfWeek !== right.dayOfWeek) {
      return left.dayOfWeek - right.dayOfWeek;
    }

    return left.windowIndex - right.windowIndex;
  });
}

function buildTimezone(utcOffsetMinutes: number | undefined) {
  if (utcOffsetMinutes === undefined || Number.isNaN(utcOffsetMinutes)) {
    return null;
  }

  const sign = utcOffsetMinutes >= 0 ? '+' : '-';
  const absoluteMinutes = Math.abs(utcOffsetMinutes);
  const hours = String(Math.floor(absoluteMinutes / 60)).padStart(2, '0');
  const minutes = String(absoluteMinutes % 60).padStart(2, '0');

  return `UTC${sign}${hours}:${minutes}`;
}

function toApiErrorResult(note: string, placeId?: string) {
  return {
    ok: false,
    status: 'api_error' as const,
    placeId,
    source: 'google_places_new' as const,
    matchConfidence: null,
    timezone: null,
    note,
  };
}

function buildScoreBreakdown(candidate: GooglePlaceSearchCandidate) {
  return {
    rawNameScore: candidate.rawNameScore,
    normalizedNameScore: candidate.normalizedNameScore,
    effectiveNameScore: candidate.effectiveNameScore,
    addressScore: candidate.addressScore,
    distanceScore: candidate.distanceScore,
  };
}

function scoreCandidate(
  input: GooglePlaceRestaurantSearchInput,
  place: GoogleSearchPlace
): GooglePlaceSearchCandidate | null {
  const placeId = normalizeOptionalText(place.id);

  if (!placeId) {
    return null;
  }

  const displayName = normalizeOptionalText(place.displayName?.text);
  const formattedAddress = normalizeOptionalText(place.formattedAddress);
  const rawNameScore = similarityScore(input.restaurantName, displayName);
  const normalizedNameScore = similarityScore(
    normalizeRestaurantCoreName(input.restaurantName),
    normalizeRestaurantCoreName(displayName)
  );
  const effectiveNameScore = Math.max(rawNameScore, normalizedNameScore);
  const addressScore = input.address
    ? similarityScore(input.address, formattedAddress)
    : 0;
  const locationScore = distanceScore(
    input.latitude,
    input.longitude,
    place.location?.latitude ?? null,
    place.location?.longitude ?? null
  );
  const confidence = roundConfidence(
    effectiveNameScore * 0.62 +
      addressScore * 0.23 +
      (locationScore === null ? 0 : locationScore * 0.15)
  );
  const reasons = [
    `rawName=${rawNameScore.toFixed(2)}`,
    `normalizedName=${normalizedNameScore.toFixed(2)}`,
    `address=${addressScore.toFixed(2)}`,
    locationScore === null ? null : `distance=${locationScore.toFixed(2)}`,
  ].filter((value): value is string => Boolean(value));

  return {
    placeId,
    displayName,
    formattedAddress,
    latitude: place.location?.latitude ?? null,
    longitude: place.location?.longitude ?? null,
    confidence,
    rawNameScore,
    normalizedNameScore,
    effectiveNameScore,
    addressScore,
    distanceScore: locationScore,
    reasons,
  };
}

function classifyCandidate(candidate: GooglePlaceSearchCandidate): GooglePlaceMatchDecision {
  const distanceScore = candidate.distanceScore ?? 0;

  if (
    distanceScore >= 0.9 &&
    candidate.addressScore >= 0.75 &&
    candidate.effectiveNameScore >= 0.7 &&
    candidate.rawNameScore >= 0.55
  ) {
    return 'matched';
  }

  if (
    distanceScore >= 0.9 &&
    candidate.addressScore >= 0.7 &&
    candidate.effectiveNameScore >= 0.5 &&
    candidate.rawNameScore >= 0.4
  ) {
    return 'review_required_match';
  }

  return 'low_confidence_match';
}

export async function searchGooglePlaceForRestaurant(
  input: GooglePlaceRestaurantSearchInput
): Promise<
  | {
      ok: true;
      status: 'matched' | 'no_match' | 'review_required_match' | 'low_confidence_match';
      candidate?: GooglePlaceSearchCandidate;
      note?: string;
    }
  | {
      ok: false;
      status: 'api_error';
      note: string;
    }
> {
  const apiKey = getGoogleServerApiKey();

  if (!apiKey) {
    return {
      ok: false,
      status: 'api_error',
      note: 'Google Places could not run because the server API key is not configured.',
    };
  }

  const textQuery = buildSearchTextQuery(input);

  if (!textQuery) {
    return {
      ok: true,
      status: 'no_match',
      note: 'Google Places search was skipped because restaurant name and address were empty.',
    };
  }

  try {
    const response = await fetch(GOOGLE_PLACES_SEARCH_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Goog-Api-Key': apiKey,
        'X-Goog-FieldMask': GOOGLE_PLACES_SEARCH_FIELD_MASK,
      },
      body: JSON.stringify({
        textQuery,
      }),
      cache: 'no-store',
    });

    if (!response.ok) {
      return {
        ok: false,
        status: 'api_error',
        note: `Google Places text search failed with HTTP ${response.status}.`,
      };
    }

    const payload = (await response.json()) as GooglePlaceSearchResponse;
    const candidates = (payload.places ?? [])
      .map((place) => scoreCandidate(input, place))
      .filter((candidate): candidate is GooglePlaceSearchCandidate => Boolean(candidate))
      .sort((left, right) => right.confidence - left.confidence);

    if (!candidates.length) {
      return {
        ok: true,
        status: 'no_match',
        note: 'Google Places text search returned no candidate restaurants.',
      };
    }

    const bestCandidate = candidates[0];
    const matchDecision = classifyCandidate(bestCandidate);

    if (matchDecision === 'review_required_match') {
      return {
        ok: true,
        status: 'review_required_match',
        candidate: bestCandidate,
        note: `Google Places candidate should be reviewed (${bestCandidate.reasons.join(', ')}).`,
      };
    }

    if (matchDecision === 'low_confidence_match') {
      return {
        ok: true,
        status: 'low_confidence_match',
        candidate: bestCandidate,
        note: `Google Places candidate was below the confidence threshold (${bestCandidate.reasons.join(', ')}).`,
      };
    }

    return {
      ok: true,
      status: 'matched',
      candidate: bestCandidate,
    };
  } catch {
    return {
      ok: false,
      status: 'api_error',
      note: 'Google Places text search could not be completed right now.',
    };
  }
}

export async function getGooglePlaceHours(placeId: string): Promise<
  | {
      ok: true;
      placeId: string;
      displayName: string | null;
      regularOpeningHours?: GoogleOpeningHours;
      currentOpeningHours?: GoogleOpeningHours;
      timezone: string | null;
    }
  | {
      ok: false;
      status: 'api_error';
      note: string;
    }
> {
  const apiKey = getGoogleServerApiKey();

  if (!apiKey) {
    return {
      ok: false,
      status: 'api_error',
      note: 'Google Places details could not run because the server API key is not configured.',
    };
  }

  try {
    const response = await fetch(
      `${GOOGLE_PLACES_DETAILS_BASE_URL}/${encodeURIComponent(placeId)}`,
      {
        method: 'GET',
        headers: {
          'X-Goog-Api-Key': apiKey,
          'X-Goog-FieldMask': GOOGLE_PLACES_DETAILS_FIELD_MASK,
        },
        cache: 'no-store',
      }
    );

    if (!response.ok) {
      return {
        ok: false,
        status: 'api_error',
        note: `Google Places details failed with HTTP ${response.status}.`,
      };
    }

    const payload = (await response.json()) as GooglePlaceDetailsResponse;

    return {
      ok: true,
      placeId: normalizeOptionalText(payload.id) ?? placeId,
      displayName: normalizeOptionalText(payload.displayName?.text),
      regularOpeningHours: payload.regularOpeningHours,
      currentOpeningHours: payload.currentOpeningHours,
      timezone: buildTimezone(payload.utcOffsetMinutes),
    };
  } catch {
    return {
      ok: false,
      status: 'api_error',
      note: 'Google Places details could not be completed right now.',
    };
  }
}

export async function enrichRestaurantHoursFromApprovedGooglePlace(params: {
  placeId: string;
  matchedDisplayName?: string | null;
  matchConfidence?: number | null;
  candidateFormattedAddress?: string | null;
  candidateLatitude?: number | null;
  candidateLongitude?: number | null;
  scoreBreakdown?: EnrichedRestaurantHoursResult['scoreBreakdown'];
}): Promise<EnrichedRestaurantHoursResult> {
  const detailsResult = await getGooglePlaceHours(params.placeId);

  if (!detailsResult.ok) {
    return toApiErrorResult(detailsResult.note, params.placeId);
  }

  const normalizedHours = normalizeHours(detailsResult.regularOpeningHours?.periods);
  const rawSummary = {
    regularOpeningHours: detailsResult.regularOpeningHours ?? undefined,
    currentOpeningHours: detailsResult.currentOpeningHours ?? undefined,
  };

  if (!normalizedHours.length) {
    return {
      ok: false,
      status: 'matched_no_hours',
      placeId: detailsResult.placeId,
      source: 'google_places_new',
      matchedDisplayName: detailsResult.displayName ?? params.matchedDisplayName ?? undefined,
      timezone: detailsResult.timezone,
      matchConfidence: params.matchConfidence ?? null,
      rawSummary,
      scoreBreakdown: params.scoreBreakdown,
      candidateFormattedAddress: params.candidateFormattedAddress ?? null,
      candidateLatitude: params.candidateLatitude ?? null,
      candidateLongitude: params.candidateLongitude ?? null,
      note: 'Approved Google Places candidate did not return usable structured weekly hours.',
    };
  }

  return {
    ok: true,
    status: 'matched_with_hours',
    placeId: detailsResult.placeId,
    source: 'google_places_new',
    matchedDisplayName: detailsResult.displayName ?? params.matchedDisplayName ?? undefined,
    timezone: detailsResult.timezone,
    matchConfidence: params.matchConfidence ?? null,
    hours: normalizedHours,
    rawSummary,
    scoreBreakdown: params.scoreBreakdown,
    candidateFormattedAddress: params.candidateFormattedAddress ?? null,
    candidateLatitude: params.candidateLatitude ?? null,
    candidateLongitude: params.candidateLongitude ?? null,
  };
}

export async function enrichRestaurantHoursFromGoogle(
  input: GooglePlaceHoursEnrichmentInput
): Promise<EnrichedRestaurantHoursResult> {
  const normalizedInput = {
    restaurantName: normalizeWhitespace(input.restaurantName),
    address: normalizeOptionalText(input.address),
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
  };
  const searchResult = await searchGooglePlaceForRestaurant(normalizedInput);

  if (!searchResult.ok) {
    console.warn('Google hours enrichment API error during search.', {
      restaurantName: normalizedInput.restaurantName,
      note: searchResult.note,
    });

    return toApiErrorResult(searchResult.note);
  }

  if (searchResult.status === 'no_match') {
    console.info('Google hours enrichment found no place match.', {
      restaurantName: normalizedInput.restaurantName,
    });

    return {
      ok: false,
      status: 'no_match',
      source: 'google_places_new',
      matchConfidence: null,
      timezone: null,
      note: searchResult.note,
    };
  }

  if (searchResult.status === 'review_required_match' && searchResult.candidate) {
    console.info('Google hours enrichment flagged a place candidate for admin review.', {
      restaurantName: normalizedInput.restaurantName,
      placeId: searchResult.candidate.placeId,
      confidence: searchResult.candidate.confidence,
    });

    return {
      ok: false,
      status: 'review_required_match',
      placeId: searchResult.candidate.placeId,
      source: 'google_places_new',
      matchedDisplayName: searchResult.candidate.displayName ?? undefined,
      matchConfidence: searchResult.candidate.confidence ?? null,
      timezone: null,
      scoreBreakdown: buildScoreBreakdown(searchResult.candidate),
      candidateFormattedAddress: searchResult.candidate.formattedAddress,
      candidateLatitude: searchResult.candidate.latitude,
      candidateLongitude: searchResult.candidate.longitude,
      note: searchResult.note,
    };
  }

  if (searchResult.status === 'low_confidence_match' || !searchResult.candidate) {
    console.info('Google hours enrichment rejected a low-confidence place match.', {
      restaurantName: normalizedInput.restaurantName,
      placeId: searchResult.candidate?.placeId,
      confidence: searchResult.candidate?.confidence ?? null,
    });

    return {
      ok: false,
      status: 'low_confidence_match',
      placeId: searchResult.candidate?.placeId,
      source: 'google_places_new',
      matchedDisplayName: searchResult.candidate?.displayName ?? undefined,
      matchConfidence: searchResult.candidate?.confidence ?? null,
      timezone: null,
      scoreBreakdown: searchResult.candidate ? buildScoreBreakdown(searchResult.candidate) : undefined,
      candidateFormattedAddress: searchResult.candidate?.formattedAddress,
      candidateLatitude: searchResult.candidate?.latitude,
      candidateLongitude: searchResult.candidate?.longitude,
      note: searchResult.note,
    };
  }

  const detailsResult = await getGooglePlaceHours(searchResult.candidate.placeId);

  if (!detailsResult.ok) {
    console.warn('Google hours enrichment API error during details lookup.', {
      restaurantName: normalizedInput.restaurantName,
      placeId: searchResult.candidate.placeId,
      note: detailsResult.note,
    });

    return toApiErrorResult(detailsResult.note, searchResult.candidate.placeId);
  }

  const normalizedHours = normalizeHours(detailsResult.regularOpeningHours?.periods);
  const rawSummary = {
    regularOpeningHours: detailsResult.regularOpeningHours ?? undefined,
    currentOpeningHours: detailsResult.currentOpeningHours ?? undefined,
  };

  if (!normalizedHours.length) {
    console.info('Google hours enrichment matched a place without usable structured hours.', {
      restaurantName: normalizedInput.restaurantName,
      placeId: detailsResult.placeId,
    });

    return {
      ok: false,
      status: 'matched_no_hours',
      placeId: detailsResult.placeId,
      source: 'google_places_new',
      matchedDisplayName: detailsResult.displayName ?? searchResult.candidate.displayName ?? undefined,
      timezone: detailsResult.timezone,
      matchConfidence: searchResult.candidate.confidence,
      rawSummary,
      scoreBreakdown: buildScoreBreakdown(searchResult.candidate),
      candidateFormattedAddress: searchResult.candidate.formattedAddress,
      candidateLatitude: searchResult.candidate.latitude,
      candidateLongitude: searchResult.candidate.longitude,
      note: 'Google Places matched a restaurant but did not return usable structured weekly hours.',
    };
  }

  console.info('Google hours enrichment matched a restaurant with structured hours.', {
    restaurantName: normalizedInput.restaurantName,
    placeId: detailsResult.placeId,
  });

  return {
    ok: true,
    status: 'matched_with_hours',
    placeId: detailsResult.placeId,
    source: 'google_places_new',
    matchedDisplayName: detailsResult.displayName ?? searchResult.candidate.displayName ?? undefined,
    timezone: detailsResult.timezone,
    matchConfidence: searchResult.candidate.confidence,
    hours: normalizedHours,
    rawSummary,
    scoreBreakdown: buildScoreBreakdown(searchResult.candidate),
    candidateFormattedAddress: searchResult.candidate.formattedAddress,
    candidateLatitude: searchResult.candidate.latitude,
    candidateLongitude: searchResult.candidate.longitude,
  };
}
