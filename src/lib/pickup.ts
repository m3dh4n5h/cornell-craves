import type {
  ListingPickupSpotWithLocation,
  ListingWithClub,
  OrderType,
  PickupType,
} from "@/types/database";

/** The availability fields a spot carries (subset of ListingPickupSpot). */
export interface SpotAvailability {
  available_start: string | null;
  available_end: string | null;
  hours_note: string | null;
}

/** True when a spot's availability window covers more than one calendar day. */
export function spotSpansMultipleDays(spot: SpotAvailability): boolean {
  if (!spot.available_start || !spot.available_end) return false;
  return new Date(spot.available_start).toDateString() !== new Date(spot.available_end).toDateString();
}

/**
 * Text describing when a spot's pickup is available. A multi-day window shows
 * ONLY the club's per-day hours note (never the raw datetime range); a
 * single-day window shows its timing.
 */
export function spotHoursText(spot: SpotAvailability): string {
  if (spotSpansMultipleDays(spot)) return spot.hours_note?.trim() ?? "";
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  if (spot.available_start && spot.available_end) {
    return `${fmt(spot.available_start)} – ${fmt(spot.available_end)}`;
  }
  if (spot.available_end) return `Until ${fmt(spot.available_end)}`;
  if (spot.available_start) return `From ${fmt(spot.available_start)}`;
  return "";
}

/** Human label for a spot's ordering rule (Batch 2 #3, Tranche 4 #5). */
export const ORDER_TYPE_LABEL: Record<OrderType, string> = {
  same_day: "Same-day pickup",
  preorder: "Pre-order only",
  both: "Pre-order & same-day",
};

/** Short label for tight spots (map popups, feed chips). */
export const ORDER_TYPE_SHORT: Record<OrderType, string> = {
  same_day: "Same-day",
  preorder: "Pre-order",
  both: "Pre-order + same-day",
};

/** Badge variant per order type, shared across feed/detail/map. */
export const ORDER_TYPE_BADGE: Record<OrderType, "success" | "default" | "neutral"> = {
  same_day: "success",
  preorder: "default",
  both: "neutral",
};

/** Map an order type to the campus-location PickupType used for pin colour. */
export const ORDER_TYPE_TO_PICKUP_TYPE: Record<OrderType, PickupType> = {
  same_day: "same_day_only",
  preorder: "preorder_only",
  both: "both",
};

export function listingSpots(listing: ListingWithClub): ListingPickupSpotWithLocation[] {
  return listing.listing_pickup_spots ?? [];
}

/** Distinct order types offered across a listing's spots, in a stable order. */
export function listingOrderTypes(listing: ListingWithClub): OrderType[] {
  const present = new Set(listingSpots(listing).map((spot) => spot.order_type));
  return (["same_day", "preorder", "both"] as OrderType[]).filter((type) => present.has(type));
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
 * Whether the listing has a pickup "happening" - used to decide map pin
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
