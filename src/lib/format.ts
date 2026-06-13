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

export function formatExpiry(expiresAt: string): string {
  const date = new Date(expiresAt);
  const now = new Date();
  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
  const sameDay = date.toDateString() === now.toDateString();
  if (sameDay) return `Today at ${time}`;
  const tomorrow = new Date(now);
  tomorrow.setDate(now.getDate() + 1);
  if (date.toDateString() === tomorrow.toDateString()) return `Tomorrow at ${time}`;
  const day = date.toLocaleDateString("en-US", { month: "short", day: "numeric" });
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
