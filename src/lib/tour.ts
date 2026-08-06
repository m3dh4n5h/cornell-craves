/**
 * Shared vocabulary for the three simulated walkthroughs, plus the
 * localStorage fallback used when migration 045 has not been applied (or the
 * visitor is signed out).
 *
 * Everything a tutorial shows is FAKE. It never reads or writes a listing, an
 * order, a club, or a real user. That is deliberate: a brand-new account has no
 * data, so a tour anchored to real UI would show an empty screen on the exact
 * run that matters most.
 */

import type { TourKey, TourStatus } from "@/types/database";

export type { TourKey, TourStatus };

/**
 * Bump this to re-offer every tour to everyone (the version is stored per row,
 * so a change here invalidates previously-seen tours without a migration).
 */
export const TOUR_VERSION = "v1";

export const TOUR_KEYS: TourKey[] = ["student", "club", "admin"];

export const TOUR_META: Record<
  TourKey,
  { label: string; blurb: string; minutes: string }
> = {
  student: {
    label: "Student walkthrough",
    blurb:
      "Find a drop, order it, split it with friends, and pick it up with a QR pass.",
    minutes: "3 min",
  },
  club: {
    label: "Club walkthrough",
    blurb:
      "Post a drop, get a brand approved, verify payments, scan passes, and read your numbers.",
    minutes: "4 min",
  },
  admin: {
    label: "Admin walkthrough",
    blurb: "Approve clubs and brands, moderate drops, and read platform-wide insights.",
    minutes: "2 min",
  },
};

function storageKey(userId: string | null, tour: TourKey): string {
  return `craves:tour:${TOUR_VERSION}:${tour}:${userId ?? "anon"}`;
}

/** Local mirror of the server flag. Silently no-ops in private mode. */
export function readLocalTourSeen(userId: string | null, tour: TourKey): boolean {
  try {
    return localStorage.getItem(storageKey(userId, tour)) !== null;
  } catch {
    return false;
  }
}

export function writeLocalTourSeen(
  userId: string | null,
  tour: TourKey,
  status: TourStatus,
): void {
  try {
    localStorage.setItem(storageKey(userId, tour), status);
  } catch {
    /* storage unavailable */
  }
}

export function clearLocalTourSeen(userId: string | null, tour: TourKey): void {
  try {
    localStorage.removeItem(storageKey(userId, tour));
  } catch {
    /* storage unavailable */
  }
}

/**
 * Which tour an account should be offered on first run. Admins get the admin
 * tour, club owners the club tour, everyone else the student tour. `null` while
 * the role is still loading, so the host never guesses.
 */
export function tourForRole({
  isAdmin,
  hasClub,
}: {
  isAdmin: boolean;
  hasClub: boolean;
}): TourKey {
  if (hasClub) return "club";
  if (isAdmin) return "admin";
  return "student";
}
