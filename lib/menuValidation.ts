// lib/menuValidation.ts

export type DietaryTag =
  | "Vegan"
  | "Vegetarian"
  | "Gluten-free"
  | "No Nuts"
  | "None"
  | "Unknown";

const EXCLUSIVE_TAGS: DietaryTag[] = ["None", "Unknown"];

export function normalizeString(value?: string) {
  if (!value) return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function normalizePrice(value: string | number | null | undefined): number {
  const num = parseFloat(String(value));
  if (isNaN(num)) return 0;
  return Math.round(num * 100) / 100;
}

export function normalizeDietaryTags(input: string[]): DietaryTag[] {
  if (!input || input.length === 0) return ["Unknown"];

  const cleaned = input.map((t) => normalizeString(t)) as DietaryTag[];

  const hasExclusive = cleaned.some((t) => EXCLUSIVE_TAGS.includes(t));

  if (hasExclusive) {
    return cleaned.filter((t) => EXCLUSIVE_TAGS.includes(t));
  }

  return [...new Set(cleaned)];
}

export function buildMenuItemKey(params: {
  restaurant_name: string;
  restaurant_address: string;
  menu_item: string;
}) {
  return [
    normalizeString(params.restaurant_name),
    normalizeString(params.restaurant_address),
    normalizeString(params.menu_item),
  ].join("::");
}
