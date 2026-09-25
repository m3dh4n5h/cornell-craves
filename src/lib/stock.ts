import type { ListingItem, ListingWithClub } from "@/types/database";

/** Units left for one item, or null when the club set no cap. */
export function itemRemaining(listing: ListingWithClub, item: ListingItem): number | null {
  if (item.stock == null) return null;
  // Fall back to the cap until live counts load; the server still enforces.
  return Math.max(0, listing.stock_left?.[item.name] ?? item.stock);
}

/** Low means under 10 left, or under 20% of the cap. */
export function isLowStock(remaining: number, stock: number): boolean {
  return remaining > 0 && (remaining < 10 || remaining < stock * 0.2);
}

/** Every item on the drop is capped and none are left. */
export function listingSoldOut(listing: ListingWithClub): boolean {
  const items = listing.items ?? [];
  return items.length > 0 && items.every((item) => itemRemaining(listing, item) === 0);
}

/** The lowest-stock item worth flagging on a feed card, if any. */
export function lowestLowItem(
  listing: ListingWithClub,
): { item: ListingItem; remaining: number } | null {
  let best: { item: ListingItem; remaining: number } | null = null;
  for (const item of listing.items ?? []) {
    const remaining = itemRemaining(listing, item);
    if (remaining == null || item.stock == null || !isLowStock(remaining, item.stock)) continue;
    if (!best || remaining < best.remaining) best = { item, remaining };
  }
  return best;
}
