import { easternDayKey } from "@/lib/format";
import type {
  ListingPickupSpotWithLocation,
  ListingWithClub,
  OrderType,
  PickupSlot,
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

// ===================== Campus-wide pickup agenda =====================
//
// Shared by the "This week on campus" page and the club form's same-day
// conflict warning: one instance per listing per pickup occasion, and the
// Eastern calendar day it falls on.

/** The minimal slot columns both callers below need. */
export type PickupSlotLite = Pick<PickupSlot, "id" | "listing_id" | "start_time" | "end_time" | "location_id">;

export interface PickupAgendaEntry {
  listing: ListingWithClub;
  slotId: string | null;
  start: Date;
  end: Date;
  locationName: string | null;
  /** Eastern calendar day (YYYY-MM-DD) `start` falls on. */
  dayKey: string;
}

/** The listing's own spot matching a slot's location, or its first spot,
 * or null (falls back to the listing's free-text pickup_info at render time). */
function spotLocationName(listing: ListingWithClub, locationId: string | null): string | null {
  const spots = listing.listing_pickup_spots ?? [];
  const match = (locationId ? spots.find((spot) => spot.location_id === locationId) : null) ?? spots[0];
  return match?.campus_locations?.name ?? null;
}

/**
 * One agenda entry per scheduled pickup_slots row within [from, from+days).
 * A listing with no scheduled slots (most drops: they just run until they
 * expire) gets exactly one entry, on its expiry day, matching how
 * hasUpcomingPickup() above already treats slot-less listings.
 */
export function buildPickupAgenda(
  listings: ListingWithClub[],
  slotsByListing: Map<string, PickupSlotLite[]>,
  from: Date = new Date(),
  days = 7,
): PickupAgendaEntry[] {
  const windowEnd = new Date(from.getTime() + days * 86_400_000);
  const entries: PickupAgendaEntry[] = [];

  for (const listing of listings) {
    const slots = slotsByListing.get(listing.id) ?? [];
    if (slots.length > 0) {
      for (const slot of slots) {
        const start = new Date(slot.start_time);
        if (start < from || start > windowEnd) continue;
        entries.push({
          listing,
          slotId: slot.id,
          start,
          end: new Date(slot.end_time),
          locationName: spotLocationName(listing, slot.location_id),
          dayKey: easternDayKey(start),
        });
      }
    } else {
      const end = new Date(listing.expires_at);
      if (end < from || end > windowEnd) continue;
      entries.push({
        listing,
        slotId: null,
        start: end,
        end,
        locationName: spotLocationName(listing, null),
        dayKey: easternDayKey(end),
      });
    }
  }

  return entries.sort((a, b) => a.start.getTime() - b.start.getTime());
}

export interface PickupAgendaDay {
  dayKey: string;
  date: Date;
  entries: PickupAgendaEntry[];
}

/** Groups a flat agenda (already sorted by start) into day buckets, in order. */
export function groupAgendaByDay(entries: PickupAgendaEntry[]): PickupAgendaDay[] {
  const byDay = new Map<string, PickupAgendaEntry[]>();
  for (const entry of entries) {
    const list = byDay.get(entry.dayKey);
    if (list) list.push(entry);
    else byDay.set(entry.dayKey, [entry]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([dayKey, dayEntries]) => ({ dayKey, date: dayEntries[0].start, entries: dayEntries }));
}

/** "Oct 3" for a YYYY-MM-DD day key (noon avoids any UTC-parsing day shift). */
export function formatDayKeyShort(dayKey: string): string {
  return new Date(`${dayKey}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}
