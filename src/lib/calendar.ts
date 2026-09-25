/**
 * Add-to-calendar helpers: a Google Calendar deep link and an .ics file, both
 * built entirely client-side (no OAuth, no calendar API, no server call).
 *
 * Timezones: every instant here comes in as an ISO string from Postgres
 * (timestamptz) or a JS Date, which already encodes an absolute point in
 * time. `new Date(iso).toISOString()` always renders that instant in UTC
 * regardless of the reader's zone or the time of year, so the DST switch in
 * America/New_York (the app's only timezone, see APP_TIME_ZONE) never has to
 * be handled by hand: there is no wall-clock math to get wrong here.
 */

import { formatEasternDateTime, formatEasternTime } from "@/lib/format";
import type { OrderPickupSpot } from "@/types/database";

export interface CalendarEvent {
  title: string;
  /** ISO instant, start of the event. */
  start: string;
  /** ISO instant, after start. */
  end: string;
  location?: string | null;
  description?: string | null;
}

/** Orders and split groups carry a "pick up by" deadline, not a start time
 * (no structured pickup window on either row). This is how much of a block
 * to show ending at that deadline; the real hours (if the club wrote them)
 * still show up in the event description. */
const DEFAULT_PICKUP_WINDOW_HOURS = 2;

/** Compact UTC stamp both Google Calendar's `dates` param and .ics want. */
function toCompactUtc(iso: string): string {
  return new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/** calendar.google.com/calendar/render?action=TEMPLATE deep link. */
export function googleCalendarUrl(event: CalendarEvent): string {
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: event.title,
    dates: `${toCompactUtc(event.start)}/${toCompactUtc(event.end)}`,
  });
  if (event.location) params.set("location", event.location);
  if (event.description) params.set("details", event.description);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function icsEscape(text: string): string {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n");
}

/** RFC 5545 VCALENDAR/VEVENT text for one event (Apple Calendar, Outlook, etc). */
export function icsContent(event: CalendarEvent, uid: string): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Cornell Craves//Pickup Reminder//EN",
    "CALSCALE:GREGORIAN",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    `DTSTAMP:${toCompactUtc(new Date().toISOString())}`,
    `DTSTART:${toCompactUtc(event.start)}`,
    `DTEND:${toCompactUtc(event.end)}`,
    `SUMMARY:${icsEscape(event.title)}`,
  ];
  if (event.location) lines.push(`LOCATION:${icsEscape(event.location)}`);
  if (event.description) lines.push(`DESCRIPTION:${icsEscape(event.description)}`);
  lines.push("END:VEVENT", "END:VCALENDAR");
  return lines.join("\r\n");
}

/** Triggers a browser download of the .ics file. Side-effecting, not pure. */
export function downloadIcs(event: CalendarEvent, id: string): void {
  const blob = new Blob([icsContent(event, `${id}@cornellcraves.app`)], {
    type: "text/calendar;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `pickup-${id}.ics`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/**
 * A pickup event ending at a deadline instant (orders, split groups): see
 * DEFAULT_PICKUP_WINDOW_HOURS above for why there is no real start time.
 */
export function pickupDeadlineEvent(params: {
  title: string;
  deadline: string;
  location?: string | null;
  description?: string | null;
  hoursBefore?: number;
}): CalendarEvent {
  const end = new Date(params.deadline);
  const start = new Date(end.getTime() - (params.hoursBefore ?? DEFAULT_PICKUP_WINDOW_HOURS) * 3_600_000);
  return {
    title: params.title,
    start: start.toISOString(),
    end: end.toISOString(),
    location: params.location,
    description: params.description,
  };
}

/** Joins the pieces of a pickup event's description, skipping any that are empty. */
export function pickupDescription(parts: {
  pickupInfo?: string | null;
  note?: string | null;
  backupCode?: string | null;
  listingUrl?: string | null;
}): string {
  return [
    parts.pickupInfo?.trim(),
    parts.note?.trim(),
    parts.backupCode ? `Backup pickup code: ${parts.backupCode}` : null,
    parts.listingUrl,
  ]
    .filter((line): line is string => Boolean(line))
    .join("\n");
}

/** One choice the "Add to calendar" button can save: a label to show the
 * buyer, and the event that choice builds. */
export interface CalendarOption {
  key: string;
  label: string;
  event: CalendarEvent;
}

const ORDER_TYPE_CALENDAR_LABEL: Record<OrderPickupSpot["order_type"], string> = {
  same_day: "same-day",
  preorder: "pre-order",
  both: "pre-order or same-day",
};

/** "<Name> (42.44412, -76.48230)": a geocoded pin, not a free-text guess, so
 * the calendar app can place it accurately. */
function spotLocationText(spot: OrderPickupSpot): string {
  return `${spot.location_name} (${spot.latitude.toFixed(5)}, ${spot.longitude.toFixed(5)})`;
}

/**
 * One calendar option per pickup spot the listing offers WITH a fixed
 * start/end window (the club's real, entered timing - see the "Pickup spots"
 * section of the listing form). A drop with a same-day spot and a separate
 * pre-order spot, say, becomes two options; the buyer picks the one that
 * matches their plan. A listing with no such spot (older listings, or a club
 * that left the window blank) falls back to one option built from the "pick
 * up by" deadline, so there is always at least one thing to add - this is the
 * ONLY case that guesses at timing; every spot-based option uses real times.
 *
 * A student with a reservation follows that reservation's own slot instead
 * (see ReservationCard) and never goes through this function at all.
 */
export function pickupCalendarOptions(params: {
  title: string;
  spots?: OrderPickupSpot[] | null;
  fallbackDeadline: string;
  fallbackLocation?: string | null;
  pickupInfo?: string | null;
  backupCode?: string | null;
  listingUrl?: string | null;
}): CalendarOption[] {
  // Migration 060: a spot carries a list of real dates. Each one becomes its
  // own calendar option, so a club running Tuesday and Thursday gives the
  // buyer two entries to choose between rather than one blurred range.
  // Windows win over the spot's legacy single availability pair whenever a
  // spot has any, and the pair is still honoured for drops created before 060.
  const fromWindows: CalendarOption[] = (params.spots ?? []).flatMap((spot) =>
    (spot.windows ?? []).map((window, index) => ({
      key: `${spot.location_name}-${window.id ?? index}`,
      label: `${formatEasternDateTime(window.start_time)} to ${formatEasternTime(window.end_time)}, ${spot.location_name} (${ORDER_TYPE_CALENDAR_LABEL[spot.order_type]})`,
      event: {
        title: params.title,
        start: window.start_time,
        end: window.end_time,
        location: spotLocationText(spot),
        description: pickupDescription({
          pickupInfo: window.note ?? params.pickupInfo,
          backupCode: params.backupCode,
          listingUrl: params.listingUrl,
        }),
      },
    })),
  );
  if (fromWindows.length > 0) return fromWindows;

  const timed = (params.spots ?? []).filter(
    (spot): spot is OrderPickupSpot & { available_start: string; available_end: string } =>
      Boolean(spot.available_start && spot.available_end),
  );

  if (timed.length === 0) {
    return [
      {
        key: "deadline",
        label: "Pickup reminder",
        event: pickupDeadlineEvent({
          title: params.title,
          deadline: params.fallbackDeadline,
          location: params.fallbackLocation,
          description: pickupDescription({
            pickupInfo: params.pickupInfo,
            backupCode: params.backupCode,
            listingUrl: params.listingUrl,
          }),
        }),
      },
    ];
  }

  return timed.map((spot, index) => ({
    key: `${spot.location_name}-${spot.available_start}-${index}`,
    label: `${formatEasternDateTime(spot.available_start)} to ${formatEasternTime(spot.available_end)}, ${spot.location_name} (${ORDER_TYPE_CALENDAR_LABEL[spot.order_type]})`,
    event: {
      title: params.title,
      start: spot.available_start,
      end: spot.available_end,
      location: spotLocationText(spot),
      description: pickupDescription({
        pickupInfo: params.pickupInfo,
        backupCode: params.backupCode,
        listingUrl: params.listingUrl,
      }),
    },
  }));
}
