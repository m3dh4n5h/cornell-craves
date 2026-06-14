import type {
  ListingPickupSpotWithLocation,
  ListingWithClub,
  OrderType,
} from "@/types/database";

/** Human label for a spot's ordering rule (Batch 2 #3). */
export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  same_day: "Same-day pickup",
  preorder: "Pre-order only",
};

/** Short label for tight spots (map popups, feed chips). */
export const ORDER_TYPE_SHORT: Record<OrderType, string> = {
  same_day: "Same-day",
  preorder: "Pre-order",
};

export function listingSpots(listing: ListingWithClub): ListingPickupSpotWithLocation[] {
  return listing.listing_pickup_spots ?? [];
}

/** Distinct order types offered across a listing's spots, in a stable order. */
export function listingOrderTypes(listing: ListingWithClub): OrderType[] {
  const present = new Set(listingSpots(listing).map((spot) => spot.order_type));
  return (["same_day", "preorder"] as OrderType[]).filter((type) => present.has(type));
}

/**
 * The next pickup day at or after now, or null. Listings with no scheduled days
 * return null (the drop runs until it expires).
 */
export function nextPickup(listing: ListingWithClub): Date | null {
  const now = Date.now();
  const upcoming = (listing.pickup_slots ?? [])
    .map((slot) => new Date(slot.end_time).getTime())
    .filter((end) => end >= now)
    .sort((a, b) => a - b);
  return upcoming.length > 0 ? new Date(upcoming[0]) : null;
}

/**
 * Whether the listing has a pickup "happening" — used to decide map pin
 * visibility (#10). A drop with scheduled days only counts while at least one
 * day is today or upcoming; a drop with no scheduled days counts until expiry.
 */
export function hasUpcomingPickup(listing: ListingWithClub): boolean {
  const slots = listing.pickup_slots ?? [];
  if (slots.length === 0) return true;
  return nextPickup(listing) !== null;
}

/** "Today", "Tomorrow", or e.g. "Tue, Jun 17" for a pickup day. */
export function formatPickupDay(date: Date): string {
  const now = new Date();
  if (date.toDateString() === now.toDateString()) return "Today";
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (date.toDateString() === tomorrow.toDateString()) return "Tomorrow";
  return date.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
}
