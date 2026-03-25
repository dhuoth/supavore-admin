// lib/menuDeduping.ts

import { buildMenuItemKey } from "./menuValidation";

export type MenuRowLike = {
  restaurant_name: string;
  restaurant_address: string;
  menu_item: string;
  [key: string]: unknown;
};

export function dedupeMenuRows<T extends MenuRowLike>(rows: T[]): T[] {
  const byKey = new Map<string, T>();

  for (const row of rows) {
    const key = buildMenuItemKey({
      restaurant_name: row.restaurant_name,
      restaurant_address: row.restaurant_address,
      menu_item: row.menu_item,
    });

    // keep the last occurrence
    byKey.set(key, row);
  }

  return Array.from(byKey.values());
}
