export const dietaryOptions = [
  'Vegan',
  'Vegetarian',
  'Gluten-Free',
  'No Nuts',
  'None',
  'Unknown',
] as const;

export type DietaryOption = (typeof dietaryOptions)[number];
export type DietaryComplianceInput = DietaryOption[] | string | null | undefined;

const standardDietaryOptions: DietaryOption[] = [
  'Vegan',
  'Vegetarian',
  'Gluten-Free',
  'No Nuts',
];

const lowercaseWords = new Set(['and', 'or', 'of', 'the', 'with', 'in', 'on']);
const asciiPunctuationMap: Record<string, string> = {
  '‘': "'",
  '’': "'",
  '‚': "'",
  '‛': "'",
  '“': '"',
  '”': '"',
  '„': '"',
  '‟': '"',
  '–': '-',
  '—': '-',
  '―': '-',
  '‐': '-',
  '…': '...',
};
const asciiLetterMap: Record<string, string> = {
  'ß': 'ss',
  'Æ': 'AE',
  'æ': 'ae',
  'Ø': 'O',
  'ø': 'o',
  'Œ': 'OE',
  'œ': 'oe',
  'Ð': 'D',
  'ð': 'd',
  'Þ': 'TH',
  'þ': 'th',
  'Ł': 'L',
  'ł': 'l',
};

export function normalizeWhitespace(value: string | null | undefined) {
  if (!value) return '';
  return value.trim().replace(/\s+/g, ' ');
}

export function toTitleCase(value: string | null | undefined) {
  const normalizedValue = normalizeWhitespace(value);

  if (!normalizedValue) return '';

  return normalizedValue
    .split(' ')
    .map((word, index) => {
      const loweredWord = word.toLowerCase();

      if (index > 0 && lowercaseWords.has(loweredWord)) {
        return loweredWord;
      }

      return loweredWord
        .split('-')
        .map((segment) =>
          segment ? `${segment.charAt(0).toUpperCase()}${segment.slice(1)}` : segment
        )
        .join('-');
    })
    .join(' ');
}

export function normalizeOptionalText(value: string | null | undefined) {
  const normalizedValue = normalizeWhitespace(value);
  return normalizedValue ? normalizedValue : null;
}

export function normalizeAsciiText(value: string | null | undefined) {
  const normalizedValue = normalizeWhitespace(value);

  if (!normalizedValue) return '';

  return Array.from(normalizedValue)
    .map((character) => asciiPunctuationMap[character] ?? asciiLetterMap[character] ?? character)
    .join('')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x00-\x7F]/g, '');
}

export function normalizeRestaurantDisplayName(value: string | null | undefined) {
  return toTitleCase(normalizeAsciiText(value));
}

function canonicalizeRestaurantIdentityPart(
  value: string | null | undefined,
  options?: { isAddress?: boolean }
) {
  const asciiValue = normalizeAsciiText(value)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/'/g, '')
    .replace(/[^\w\s]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');

  if (!asciiValue || !options?.isAddress) {
    return asciiValue;
  }

  const addressTokenMap: Record<string, string> = {
    street: 'st',
    avenue: 'ave',
    boulevard: 'blvd',
    road: 'rd',
    drive: 'dr',
    lane: 'ln',
    place: 'pl',
    court: 'ct',
    suite: 'ste',
    unit: 'unit',
    apartment: 'apt',
    north: 'n',
    south: 's',
    east: 'e',
    west: 'w',
  };

  return asciiValue
    .split(' ')
    .map((token) => addressTokenMap[token] ?? token)
    .join(' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function canonicalizeRestaurantIdentity(
  name: string | null | undefined,
  address: string | null | undefined
) {
  const normalizedName = canonicalizeRestaurantIdentityPart(name);
  const normalizedAddress = canonicalizeRestaurantIdentityPart(address, { isAddress: true });

  if (!normalizedName && !normalizedAddress) {
    return null;
  }

  return `${normalizedName}::${normalizedAddress}`;
}

export function normalizePrice(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === '') return null;

  const parsedValue = Number(value);

  if (Number.isNaN(parsedValue)) return null;

  return Math.round(parsedValue * 100) / 100;
}

export function canonicalizeDietaryCompliance(values: DietaryComplianceInput) {
  const rawValues = Array.isArray(values)
    ? values
    : typeof values === 'string'
      ? values.split(',')
      : [];

  const canonicalValueMap = new Map<string, DietaryOption>(
    dietaryOptions.map((option) => [
      normalizeWhitespace(option).toLowerCase().replace(/-/g, ' '),
      option,
    ])
  );

  const uniqueValues = new Set<DietaryOption>();

  rawValues.forEach((value) => {
    const normalizedValue = normalizeWhitespace(value).toLowerCase().replace(/-/g, ' ');
    const canonicalValue = canonicalValueMap.get(normalizedValue);

    if (canonicalValue) {
      uniqueValues.add(canonicalValue);
    }
  });

  if (uniqueValues.has('None')) {
    return ['None'] as DietaryOption[];
  }

  if (uniqueValues.has('Unknown')) {
    return ['Unknown'] as DietaryOption[];
  }

  return dietaryOptions.filter(
    (option) => standardDietaryOptions.includes(option) && uniqueValues.has(option)
  );
}

export function serializeDietaryCompliance(values: DietaryComplianceInput) {
  const canonicalValues = canonicalizeDietaryCompliance(values);
  return canonicalValues.length > 0 ? canonicalValues.join(', ') : null;
}

export function normalizeRestaurantPayload(payload: {
  restaurantName: string | null | undefined;
  restaurantAddress: string | null | undefined;
  restaurantCity?: string | null | undefined;
  restaurantRegion?: string | null | undefined;
  restaurantPostalCode?: string | null | undefined;
  onlineOrderingLink: string | null | undefined;
}) {
  return {
    name: normalizeRestaurantDisplayName(payload.restaurantName),
    address: normalizeOptionalText(payload.restaurantAddress),
    city: normalizeOptionalText(toTitleCase(payload.restaurantCity)),
    region: normalizeOptionalText(payload.restaurantRegion)?.toUpperCase() ?? null,
    postalCode: normalizeOptionalText(payload.restaurantPostalCode)?.toUpperCase() ?? null,
    onlineOrderingLink: normalizeOptionalText(payload.onlineOrderingLink),
  };
}

export function normalizeMenuItemPayload(payload: {
  menuItem: string | null | undefined;
  basePrice: string | number | null | undefined;
  priceWithModification: string | number | null | undefined;
  recommendedModification: string | null | undefined;
  ingredients: string | null | undefined;
  dietaryCompliance: DietaryComplianceInput;
  noModifications: boolean;
}) {
  return {
    name: toTitleCase(payload.menuItem),
    basePrice: normalizePrice(payload.basePrice),
    priceWithModification: normalizePrice(payload.priceWithModification),
    recommendedModification: payload.noModifications
      ? null
      : normalizeOptionalText(toTitleCase(payload.recommendedModification)),
    ingredients: normalizeOptionalText(payload.ingredients),
    dietaryCompliance: serializeDietaryCompliance(payload.dietaryCompliance),
  };
}
