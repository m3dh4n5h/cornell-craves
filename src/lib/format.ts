import type { ListingItem } from "@/types/database";

export function formatPrice(price: number): string {
  if (!Number.isFinite(price)) return "$0";
  return Number.isInteger(price) ? `$${price}` : `$${price.toFixed(2)}`;
}

export function priceRange(items: ListingItem[]): string | null {
  const prices = items
    .map((item) => item.price)
    .filter((price) => Number.isFinite(price) && price >= 0);
  if (prices.length === 0) return null;
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  return min === max ? formatPrice(min) : `${formatPrice(min)} to ${formatPrice(max)}`;
}

// Everything time-related in Cornell Craves is Ithaca time. Pin every display
// to America/New_York so it reads the same for a student checking from another
// timezone, and so it follows the EST/EDT switch automatically (the IANA zone
// carries the DST rules; we never hardcode an offset). Deadlines themselves are
// timestamptz instants computed with fixed intervals (e.g. now() + 24h), so the
// 24-hour windows stay exactly 24 real hours across a clock change.
export const APP_TIME_ZONE = "America/New_York";

/** Calendar day (YYYY-MM-DD) an instant falls on in Eastern time. */
function easternDayKey(date: Date): string {
  return date.toLocaleDateString("en-CA", { timeZone: APP_TIME_ZONE });
}

/** Eastern-time clock, e.g. "4:30 PM ET". */
export function formatEasternTime(iso: string | number | Date): string {
  const time = new Date(iso).toLocaleTimeString("en-US", {
    timeZone: APP_TIME_ZONE,
    hour: "numeric",
    minute: "2-digit",
  });
  return `${time} ET`;
}

/** Eastern-time date + clock, e.g. "Jul 24 at 4:30 PM ET". */
export function formatEasternDateTime(iso: string | number | Date): string {
  const date = new Date(iso);
  const day = date.toLocaleDateString("en-US", {
    timeZone: APP_TIME_ZONE,
    month: "short",
    day: "numeric",
  });
  return `${day} at ${formatEasternTime(date)}`;
}

export function formatExpiry(expiresAt: string): string {
  const date = new Date(expiresAt);
  const now = new Date();
  const time = formatEasternTime(date);
  const dayKey = easternDayKey(date);
  if (dayKey === easternDayKey(now)) return `Today at ${time}`;
  const tomorrow = new Date(now.getTime() + 24 * 3_600_000);
  if (dayKey === easternDayKey(tomorrow)) return `Tomorrow at ${time}`;
  const day = date.toLocaleDateString("en-US", {
    timeZone: APP_TIME_ZONE,
    month: "short",
    day: "numeric",
  });
  return `${day} at ${time}`;
}

export interface TimeLeft {
  expired: boolean;
  urgent: boolean;
  label: string;
}

export function getTimeLeft(expiresAt: string): TimeLeft {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (Number.isNaN(ms) || ms <= 0) {
    return { expired: true, urgent: false, label: "Ended" };
  }
  const totalMinutes = Math.floor(ms / 60_000);
  const days = Math.floor(totalMinutes / 1_440);
  const hours = Math.floor((totalMinutes % 1_440) / 60);
  const minutes = totalMinutes % 60;
  let label: string;
  if (days > 0) {
    label = `${days}d ${hours}h left`;
  } else if (hours > 0) {
    label = `${hours}h ${minutes}m left`;
  } else if (minutes >= 1) {
    label = `${minutes}m left`;
  } else {
    label = "Under a minute left";
  }
  return { expired: false, urgent: ms < 2 * 3_600_000, label };
}
