import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BadgeCheck,
  BarChart3,
  Compass,
  Copy,
  Hourglass,
  Info,
  LayoutTemplate,
  PackageOpen,
  Plus,
  ReceiptText,
  RotateCcw,
  ShieldQuestion,
  Tag,
  Trash2,
  Undo2,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useClub } from "@/hooks/useClub";
import { useTour } from "@/hooks/useTour";
import { useListings } from "@/hooks/useListings";
import { usePickupAgenda } from "@/hooks/usePickupAgenda";
import { useCountdown } from "@/hooks/useCountdown";
import {
  ItemsEditor,
  parseItemDrafts,
  toItemDrafts,
  type ItemDraft,
} from "@/components/ItemsEditor";
import {
  PickupEditor,
  pickupError,
  type SpotDraft,
  type WindowDraft,
} from "@/components/PickupEditor";
import { SpotMapPreview } from "@/components/SpotMapPreview";
import { EmptyState } from "@/components/EmptyState";
import { GoalProgress } from "@/components/GoalProgress";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { DateTimeField } from "@/components/ui/datetime";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useBrandOptions } from "@/hooks/useBrands";
import { brandInList, useClubBrandStatus } from "@/hooks/useClubBrands";
import { geocodeAddress, type GeocodeResult } from "@/lib/geocode";
import { formatExpiry, formatPrice } from "@/lib/format";
import { itemRemaining } from "@/lib/stock";
import { composeLocal, formatDayKeyShort } from "@/lib/pickup";
import type {
  BrandRequest,
  CampusLocation,
  Club,
  ClubDashboardStats,
  ListingWithClub,
  PickupWindow,
  RecurringTemplate,
  TemplateSpot,
} from "@/types/database";

function toDatetimeLocal(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

/** The local YYYY-MM-DD part of a Date, for seeding a new pickup date. */
function toDateOnly(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1.5 text-xs font-medium text-accent" role="alert">
      {message}
    </p>
  );
}

type PublishMode = "publish" | "draft" | "autopost";

/** A named cause needs a 1-100 donation percentage. */
function causeError(name: string, percent: string): string | undefined {
  if (!name.trim()) return undefined;
  const value = Number.parseInt(percent, 10);
  return Number.isFinite(value) && value >= 1 && value <= 100
    ? undefined
    : "Enter a donation percentage from 1 to 100.";
}

/** An optional club fundraising goal: a dollar amount up to $1,000,000 (055, 059). */
function goalError(goal: string): string | undefined {
  if (!goal.trim()) return undefined;
  const value = Number.parseFloat(goal);
  return Number.isFinite(value) && value > 0 && value <= 1_000_000
    ? undefined
    : "Enter a goal in dollars, like 800.";
}

/**
 * Non-blocking "N other drops on <day>" note (feature 6): the club picks a
 * pickup date, and this shows who else is already live that same day, so they
 * can spread out if they want to. Never blocks publishing.
 *
 * The draft days come straight from the date the club typed (YYYY-MM-DD), so
 * slicing them needs no timezone math. Other clubs' days come from the DB as
 * real instants, so those go through usePickupAgenda's Eastern-aware dayKey.
 */
function DayConflictWarning({
  spots,
  expiresAt,
  otherAgenda,
}: {
  spots: SpotDraft[];
  expiresAt: string;
  otherAgenda: ReturnType<typeof usePickupAgenda>["entries"];
}) {
  const draftDayKeys = useMemo(() => {
    const dates = spots.flatMap((spot) => spot.windows.map((window) => window.date)).filter(Boolean);
    const unique = [...new Set(dates)];
    return unique.length > 0 ? unique : expiresAt ? [expiresAt.slice(0, 10)] : [];
  }, [spots, expiresAt]);

  const conflicts = useMemo(
    () =>
      draftDayKeys
        .map((dayKey) => ({
          dayKey,
          titles: [
            ...new Set(otherAgenda.filter((entry) => entry.dayKey === dayKey).map((entry) => entry.listing.title)),
          ],
        }))
        .filter((day) => day.titles.length > 0),
    [draftDayKeys, otherAgenda],
  );

  if (conflicts.length === 0) return null;

  return (
    <div className="mt-2 space-y-1">
      {conflicts.map(({ dayKey, titles }) => (
        <p key={dayKey} className="flex items-start gap-1.5 text-xs text-ink-muted">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
          {titles.length} other {titles.length === 1 ? "drop" : "drops"} on {formatDayKeyShort(dayKey)}:{" "}
          {titles.join(", ")}
        </p>
      ))}
    </div>
  );
}

// ===========================================================================
// Custom pickup spots: add one, and remove one you added
// ===========================================================================
//
// Two halves of the same idea. A club can put a place on the map that is not
// on the curated campus list, and it can take one back off again. Only its
// own spots: the curated list is shared by every club and is not one club's
// to edit.
//
// Removing is an archive, never a delete. A spot that has ever been used is
// referenced by past listings, orders, map pins and calendar entries, and
// deleting the row would strip the record of where students actually
// collected. Archiving takes it out of the picker and leaves every one of
// those intact. The archive is refused outright while a LIVE drop still uses
// the spot: the club has to take it off that drop first and tell the students
// who already ordered, because moving a pickup location out from under a paid
// order is how someone ends up at an empty table.

function CustomSpotManager({
  locations,
  clubId,
  customName,
  customAddress,
  findingAddress,
  foundLocation,
  addingLocation,
  onNameChange,
  onAddressChange,
  onFind,
  onConfirm,
  onCancelFound,
  onLocationsChanged,
  onSpotRemoved,
}: {
  locations: CampusLocation[];
  clubId: string;
  customName: string;
  customAddress: string;
  findingAddress: boolean;
  foundLocation: GeocodeResult | null;
  addingLocation: boolean;
  onNameChange: (value: string) => void;
  onAddressChange: (value: string) => void;
  onFind: () => void;
  onConfirm: () => void;
  onCancelFound: () => void;
  onLocationsChanged: (location: CampusLocation) => void;
  onSpotRemoved: (locationId: string) => void;
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ name: string; listings: { id: string; title: string }[] } | null>(
    null,
  );

  const mine = locations.filter((location) => location.created_by === clubId);

  const archive = async (location: CampusLocation) => {
    setBusyId(location.id);
    const { data, error } = await supabase.rpc("archive_campus_location", {
      p_location_id: location.id,
    });
    setBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    const result = data as { ok: boolean; blocking_listings?: { id: string; title: string }[] };
    if (!result.ok) {
      setBlocked({ name: location.name, listings: result.blocking_listings ?? [] });
      return;
    }
    onLocationsChanged({ ...location, archived_at: new Date().toISOString() });
    onSpotRemoved(location.id);
    toast.success(`"${location.name}" removed from your spots.`);
  };

  const restore = async (location: CampusLocation) => {
    setBusyId(location.id);
    const { error } = await supabase.rpc("restore_campus_location", { p_location_id: location.id });
    setBusyId(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    onLocationsChanged({ ...location, archived_at: null });
    toast.success(`"${location.name}" is back in your list.`);
  };

  return (
    <details className="mt-2.5 rounded-xl border border-border/70 p-3">
      <summary className="cursor-pointer text-sm font-semibold">Your own pickup spots</summary>

      {mine.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {mine.map((location) => (
            <li
              key={location.id}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 px-2.5 py-2"
            >
              <span className="min-w-0 flex-1 truncate text-sm">
                {location.name}
                {location.archived_at && (
                  <span className="ml-2 text-xs text-ink-muted">(removed)</span>
                )}
              </span>
              {location.archived_at ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  loading={busyId === location.id}
                  onClick={() => void restore(location)}
                >
                  <Undo2 className="size-4" aria-hidden="true" />
                  Put back
                </Button>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-ink-muted"
                  loading={busyId === location.id}
                  onClick={() => void archive(location)}
                  aria-label={`Remove ${location.name} from your spots`}
                >
                  <Trash2 className="size-4" aria-hidden="true" />
                  Remove
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {blocked && (
        <div className="mt-3 rounded-xl border border-accent/40 bg-accent/10 p-3">
          <p className="text-sm font-bold">"{blocked.name}" is still in use</p>
          <p className="mt-1 text-xs text-ink-muted">
            Take it off these live drops first, and let anyone who already ordered know where to go
            instead. Your Orders page exports every buyer's pickup details as a CSV you can email
            from. Once the drops end, you can remove the spot.
          </p>
          <ul className="mt-2 space-y-1">
            {blocked.listings.map((listing) => (
              <li key={listing.id} className="text-xs font-semibold">
                {listing.title}
              </li>
            ))}
          </ul>
          <Button type="button" variant="ghost" size="sm" className="mt-2" onClick={() => setBlocked(null)}>
            Got it
          </Button>
        </div>
      )}

      <p className="mt-3 text-xs text-ink-muted">
        Not on the campus list? Add a name and street address; we place it on the map for you. Only
        your club sees the spots you add.
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        <Input
          value={customName}
          onChange={(e) => onNameChange(e.target.value)}
          placeholder="North campus loading dock"
          aria-label="Custom spot name"
          className="h-10"
          disabled={Boolean(foundLocation)}
        />
        <Input
          value={customAddress}
          onChange={(e) => onAddressChange(e.target.value)}
          placeholder="107 Jessup Rd, Ithaca, NY"
          aria-label="Street address"
          className="h-10"
          disabled={Boolean(foundLocation)}
        />
      </div>
      {!foundLocation ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="mt-2"
          loading={findingAddress}
          onClick={onFind}
        >
          <Plus className="size-4" aria-hidden="true" />
          Find address
        </Button>
      ) : (
        <div className="mt-3 rounded-xl border border-primary-dark/40 bg-primary/10 p-3">
          <p className="text-sm font-bold">Is this the right spot?</p>
          <p className="mt-1 text-sm text-ink-muted">{foundLocation.displayName}</p>
          <div className="mt-2.5 overflow-hidden rounded-lg border border-border">
            <SpotMapPreview
              latitude={foundLocation.lat}
              longitude={foundLocation.lng}
              label={customName.trim() || foundLocation.displayName}
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" size="sm" loading={addingLocation} onClick={onConfirm}>
              Confirm and add spot
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={addingLocation}
              onClick={onCancelFound}
            >
              Not it, search again
            </Button>
          </div>
        </div>
      )}
    </details>
  );
}

interface ListingFormProps {
  club: Club;
  initial: ListingWithClub | null;
  /** Prefill a NEW listing from this one (Duplicate). Ignored when editing. */
  duplicateOf?: ListingWithClub | null;
  /** Brands approved one-time for this club, on top of the global list. */
  approvedForClub: string[];
  locations: CampusLocation[];
  onLocationAdded: (location: CampusLocation) => void;
  onBrandRequested: () => void;
  onSaved: () => void;
  onCancel: () => void;
}

function ListingForm({
  club,
  initial,
  duplicateOf = null,
  approvedForClub,
  locations,
  onLocationAdded,
  onBrandRequested,
  onSaved,
  onCancel,
}: ListingFormProps) {
  // Editing uses the listing itself; duplicating copies its fields into a new one.
  const source = initial ?? duplicateOf;
  const [brand, setBrand] = useState(source?.brand ?? "");
  const [title, setTitle] = useState(source?.title ?? "");
  const [description, setDescription] = useState(source?.description ?? "");
  const [items, setItems] = useState<ItemDraft[]>(toItemDrafts(source?.items ?? null));
  // One tree: pickup spot -> dates -> bookable slots (migration 060). This
  // replaced the old free-text "pickup details", the "hours per day" textarea
  // and the separate "pickup days" list, which between them let one drop
  // describe its pickup three different ways.
  const [spots, setSpots] = useState<SpotDraft[]>([]);
  /** Spot and window ids that existed when the form loaded, to diff on save. */
  const [originalSpotIds, setOriginalSpotIds] = useState<string[]>([]);
  const [originalWindowIds, setOriginalWindowIds] = useState<string[]>([]);
  const [originalSlotIds, setOriginalSlotIds] = useState<string[]>([]);
  const [pickupLoaded, setPickupLoaded] = useState(false);
  // The club carries a physical pile to the table and sells it on the day.
  // Separate from a spot's order type, which only says which tables take
  // walk-ups at all, and separate from the per-item pre-order cap (054).
  const [sameDayEnabled, setSameDayEnabled] = useState(source?.same_day_enabled ?? false);
  // Contact email for questions about this drop. Prefilled from the club's
  // account setting so nobody retypes it on every listing, still overridable
  // here because a specific drop may have a specific officer running it.
  const [contactEmail, setContactEmail] = useState(
    source?.contact_email ?? club.listing_contact_email ?? club.email ?? "",
  );
  // Show the "which member recommended you?" question on the order form (#2).
  const [recommenderEnabled, setRecommenderEnabled] = useState(source?.recommender_enabled ?? false);
  // Optional cause + percentage of earnings donated (build spec 5 #9).
  const [causeName, setCauseName] = useState(source?.cause_name ?? "");
  const [causePercent, setCausePercent] = useState(
    source?.cause_percent != null ? String(source.cause_percent) : "",
  );
  // Optional club fundraising goal, independent of any cause (058), private to the club by default (059).
  const [goalAmount, setGoalAmount] = useState(
    source?.goal_amount != null ? String(source.goal_amount) : "",
  );
  // Private by default: only the club sees the bar unless it opts in (059).
  const [goalPublic, setGoalPublic] = useState(source?.goal_public ?? false);
  const [expiresAt, setExpiresAt] = useState(
    initial
      ? toDatetimeLocal(new Date(initial.expires_at))
      : toDatetimeLocal(new Date(Date.now() + 6 * 3_600_000)),
  );
  // Same-day conflict warning (feature 6): other clubs' live drops sharing a
  // pickup day with this one. Non-blocking, purely informational.
  const { entries: otherAgenda } = usePickupAgenda({ excludeListingId: initial?.id });
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  /** A template already exists for this brand; the club decides what to do. */
  const [templateClash, setTemplateClash] = useState<RecurringTemplate | null>(null);
  // Request-a-brand (#17): brands not in the merged list can be sent to admin.
  const brandOptions = useBrandOptions();
  const [requestingBrand, setRequestingBrand] = useState(false);
  const [requestedBrands, setRequestedBrands] = useState<string[]>([]);
  // Add a custom pickup location by name + address, geocoded via Nominatim
  // (#4). Two steps, not one: geocoding only FINDS a candidate pin, which the
  // club has to look at and confirm before it is saved, so a stray "Ithaca"
  // match somewhere else in the country never quietly becomes a pickup spot.
  const [customName, setCustomName] = useState("");
  const [customAddress, setCustomAddress] = useState("");
  const [findingAddress, setFindingAddress] = useState(false);
  const [foundLocation, setFoundLocation] = useState<GeocodeResult | null>(null);
  const [addingLocation, setAddingLocation] = useState(false);

  const findAddress = async () => {
    if (customName.trim().length < 2 || customAddress.trim().length < 4) {
      toast.error("Enter a name and a full street address.");
      return;
    }
    setFindingAddress(true);
    const geo = await geocodeAddress(customAddress.trim());
    setFindingAddress(false);
    if (!geo) {
      toast.error("Couldn't find that address. Try adding \"Ithaca, NY\".");
      return;
    }
    setFoundLocation(geo);
  };

  const confirmCustomLocation = async () => {
    if (!foundLocation) return;
    setAddingLocation(true);
    const { data, error } = await supabase.rpc("add_campus_location", {
      p_name: customName.trim(),
      p_lat: foundLocation.lat,
      p_lng: foundLocation.lng,
      // The geocoder's own resolved address, not what the club typed: it is
      // the canonical form (unit/city/state spelled out), and it is exactly
      // what they just confirmed matches the pin.
      p_description: foundLocation.displayName,
    });
    setAddingLocation(false);
    if (error || !data) {
      toast.error(error?.message ?? "Could not save the spot");
      return;
    }
    const location = data as CampusLocation;
    onLocationAdded(location);
    setSpots((previous) => [
      ...previous,
      { locationId: location.id, orderType: "preorder", windows: [], sameDay: {} },
    ]);
    setCustomName("");
    setCustomAddress("");
    setFoundLocation(null);
    toast.success(`Added "${location.name}". It's selected as a pickup spot below.`);
  };

  const initialId = initial?.id ?? null;

  /**
   * Load the drop's pickup tree for editing: spots, each spot's dates, and the
   * bookable slots those dates generated. One effect rather than three so the
   * form never renders a half-built tree (a spot whose dates have not arrived
   * looks, to the club, exactly like a spot with no dates).
   *
   * Slots left over from before migration 060 have no window_id. They are
   * hung on their spot's matching window when one exists and otherwise left
   * alone: quietly re-homing a slot could move a student's booked pickup to a
   * different building.
   */
  useEffect(() => {
    if (!initialId) {
      setPickupLoaded(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      const [spotsResult, windowsResult, slotsResult, stockResult] = await Promise.all([
        supabase
          .from("listing_pickup_spots")
          .select("*")
          .eq("listing_id", initialId)
          .order("created_at", { ascending: true }),
        supabase
          .from("listing_pickup_windows")
          .select("*")
          .eq("listing_id", initialId)
          .order("start_time", { ascending: true }),
        supabase
          .from("pickup_slots")
          .select("*")
          .eq("listing_id", initialId)
          .order("start_time", { ascending: true }),
        supabase
          .from("listing_same_day_stock")
          .select("spot_id, item_name, quantity")
          .eq("listing_id", initialId),
      ]);
      if (cancelled) return;

      const spotRows = spotsResult.data ?? [];
      const windowRows = (windowsResult.data ?? []) as PickupWindow[];
      const slotRows = slotsResult.data ?? [];
      const stockRows = stockResult.data ?? [];

      setOriginalSpotIds(spotRows.map((row) => row.id));
      setOriginalWindowIds(windowRows.map((row) => row.id));
      setOriginalSlotIds(slotRows.map((row) => row.id));

      setSpots(
        spotRows.map((spot) => ({
          id: spot.id,
          locationId: spot.location_id,
          orderType: spot.order_type,
          sameDay: Object.fromEntries(
            stockRows
              .filter((row) => row.spot_id === spot.id)
              .map((row) => [row.item_name, String(row.quantity)]),
          ),
          windows: windowRows
            .filter((window) => window.spot_id === spot.id)
            .map<WindowDraft>((window) => {
              const start = new Date(window.start_time);
              const end = new Date(window.end_time);
              const mine = slotRows.filter((slot) => slot.window_id === window.id);
              return {
                id: window.id,
                date: toDateOnly(start),
                startMinutes: start.getHours() * 60 + start.getMinutes(),
                endMinutes: end.getHours() * 60 + end.getMinutes(),
                slotMode: window.slot_mode,
                capacity:
                  window.slot_mode === "capacity"
                    ? String(window.capacity ?? mine[0]?.max_reservations ?? "")
                    : "",
                splitMinutes: window.split_minutes,
                note: window.note ?? "",
                slots:
                  window.slot_mode === "split"
                    ? mine.map((slot) => {
                        const slotStart = new Date(slot.start_time);
                        const slotEnd = new Date(slot.end_time);
                        return {
                          id: slot.id,
                          startMinutes: slotStart.getHours() * 60 + slotStart.getMinutes(),
                          endMinutes: slotEnd.getHours() * 60 + slotEnd.getMinutes(),
                          max: String(slot.max_reservations),
                          reserved: slot.reserved_count,
                        };
                      })
                    : [],
              };
            }),
        })),
      );
      setPickupLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [initialId]);

  const itemNames = useMemo(
    () => parseItemDrafts(items).map((item) => item.name),
    [items],
  );
  // Archived spots keep resolving on the listings that already use them, but
  // they are not offered for a new one.
  const activeLocations = useMemo(
    () => locations.filter((location) => !location.archived_at),
    [locations],
  );
  const errors = {
    brand: brand.trim() ? undefined : "Pick the brand you are selling.",
    title: title.trim() ? undefined : "Give the drop a title.",
    contactEmail: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactEmail.trim())
      ? undefined
      : "Enter a contact email buyers can reach you at.",
    items:
      parseItemDrafts(items).length > 0
        ? undefined
        : "Add at least one item with a name.",
    expiresAt: !expiresAt
      ? "Set when the drop ends."
      : new Date(expiresAt).getTime() <= Date.now()
        ? "The end time has to be in the future."
        : undefined,
    spots: pickupError(spots),
    cause: causeError(causeName, causePercent),
    goal: goalError(goalAmount),
  };
  const hasErrors = Object.values(errors).some(Boolean);

  /**
   * Write the whole pickup tree: spots, their dates, the slots those dates
   * generate, and the same-day pile at each table.
   *
   * Order matters and is not negotiable. Rows are written parents first
   * (spot -> window -> slot) because each child carries its parent's id, and
   * removals go last, because deleting a spot cascades to its windows and
   * their slots - doing that first would delete rows this pass is about to
   * re-create, and a student's reservation with them.
   *
   * A slot that already has reservations is never deleted here. The form
   * blocks removing one, so reaching this code with bookings on a vanished
   * slot means something is out of step, and leaving the row is the safe way
   * to be wrong: the student still has a pickup.
   */
  const syncPickup = async (listingId: string): Promise<string | null> => {
    const filled = spots.filter((spot) => spot.locationId);
    const keptSpotIds = new Set<string>();
    const keptWindowIds = new Set<string>();
    const keptSlotIds = new Set<string>();

    for (const spot of filled) {
      const spotPayload = {
        listing_id: listingId,
        location_id: spot.locationId,
        order_type: spot.orderType,
      };
      let spotId = spot.id ?? null;
      if (spotId) {
        const { error } = await supabase
          .from("listing_pickup_spots")
          .update(spotPayload)
          .eq("id", spotId);
        if (error) return error.message;
      } else {
        const { data, error } = await supabase
          .from("listing_pickup_spots")
          .insert(spotPayload)
          .select("id")
          .single();
        if (error || !data) return error?.message ?? "Could not save a pickup spot";
        spotId = data.id;
      }
      keptSpotIds.add(spotId);

      for (const window of spot.windows) {
        const startIso = new Date(composeLocal(window.date, window.startMinutes)).toISOString();
        const endIso = new Date(composeLocal(window.date, window.endMinutes)).toISOString();
        const windowPayload = {
          listing_id: listingId,
          spot_id: spotId,
          start_time: startIso,
          end_time: endIso,
          slot_mode: window.slotMode,
          capacity:
            window.slotMode === "capacity" ? Number.parseInt(window.capacity, 10) : null,
          split_minutes: window.slotMode === "split" ? window.splitMinutes : null,
          note: window.note.trim() || null,
        };
        let windowId = window.id ?? null;
        if (windowId) {
          const { error } = await supabase
            .from("listing_pickup_windows")
            .update(windowPayload)
            .eq("id", windowId);
          if (error) return error.message;
        } else {
          const { data, error } = await supabase
            .from("listing_pickup_windows")
            .insert(windowPayload)
            .select("id")
            .single();
          if (error || !data) return error?.message ?? "Could not save a pickup date";
          windowId = data.id;
        }
        keptWindowIds.add(windowId);

        // 'open' has nothing to book. 'capacity' is one slot covering the
        // whole window, which is what makes every existing reservation path
        // (reserve_slot, the student's calendar, the club's QR gating) work
        // on it unchanged. 'split' is one slot per piece.
        const slotRows =
          window.slotMode === "capacity"
            ? [
                {
                  start: startIso,
                  end: endIso,
                  max: Number.parseInt(window.capacity, 10),
                  id: undefined as string | undefined,
                },
              ]
            : window.slotMode === "split"
              ? window.slots.map((slot) => ({
                  start: new Date(composeLocal(window.date, slot.startMinutes)).toISOString(),
                  end: new Date(composeLocal(window.date, slot.endMinutes)).toISOString(),
                  max: Number.parseInt(slot.max, 10),
                  id: slot.id,
                }))
              : [];

        for (const row of slotRows) {
          const slotPayload = {
            listing_id: listingId,
            window_id: windowId,
            start_time: row.start,
            end_time: row.end,
            max_reservations: row.max,
            location_id: spot.locationId,
          };
          if (row.id) {
            const { error } = await supabase
              .from("pickup_slots")
              .update(slotPayload)
              .eq("id", row.id);
            if (error) return error.message;
            keptSlotIds.add(row.id);
          } else {
            const { data, error } = await supabase
              .from("pickup_slots")
              .insert(slotPayload)
              .select("id")
              .single();
            if (error || !data) return error?.message ?? "Could not save a pickup slot";
            keptSlotIds.add(data.id);
          }
        }
      }

      // Same-day counts, per item at this table. A blank or zero box means
      // "not selling this here on the day", which is a removal, not a zero
      // row, so record_walk_up_sale's "set a count first" guard still bites.
      const stockRows = sameDayEnabled
        ? itemNames
            .map((name) => ({ name, quantity: Number.parseInt(spot.sameDay[name] ?? "", 10) }))
            .filter((row) => Number.isFinite(row.quantity) && row.quantity > 0)
        : [];
      const { error: clearError } = await supabase
        .from("listing_same_day_stock")
        .delete()
        .eq("spot_id", spotId)
        .not("item_name", "in", `(${stockRows.map((row) => `"${row.name.replace(/"/g, '""')}"`).join(",") || '""'})`);
      if (clearError) return clearError.message;
      if (stockRows.length > 0) {
        const { error } = await supabase.from("listing_same_day_stock").upsert(
          stockRows.map((row) => ({
            listing_id: listingId,
            spot_id: spotId,
            item_name: row.name,
            quantity: row.quantity,
            updated_at: new Date().toISOString(),
          })),
          { onConflict: "spot_id,item_name" },
        );
        if (error) return error.message;
      }
    }

    // Removals last: a spot delete cascades to its windows and their slots.
    const goneSlots = originalSlotIds.filter((id) => !keptSlotIds.has(id));
    if (goneSlots.length > 0) {
      const { error } = await supabase
        .from("pickup_slots")
        .delete()
        .in("id", goneSlots)
        .eq("reserved_count", 0);
      if (error) return error.message;
    }
    const goneWindows = originalWindowIds.filter((id) => !keptWindowIds.has(id));
    if (goneWindows.length > 0) {
      const { error } = await supabase
        .from("listing_pickup_windows")
        .delete()
        .in("id", goneWindows);
      if (error) return error.message;
    }
    const goneSpots = originalSpotIds.filter((id) => !keptSpotIds.has(id));
    if (goneSpots.length > 0) {
      const { error } = await supabase.from("listing_pickup_spots").delete().in("id", goneSpots);
      if (error) return error.message;
    }
    return null;
  };

  /**
   * Goals live in the private listing_goals table (059), written only by the
   * owning club. Set a goal: upsert. Clear it on an existing drop: delete.
   */
  const syncGoal = async (listingId: string): Promise<string | null> => {
    if (goalAmount.trim()) {
      const { error } = await supabase.from("listing_goals").upsert(
        {
          listing_id: listingId,
          goal_amount: Math.round(Number.parseFloat(goalAmount) * 100) / 100,
          goal_public: goalPublic,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "listing_id" },
      );
      return error?.message ?? null;
    }
    if (initial?.goal_amount != null) {
      const { error } = await supabase.from("listing_goals").delete().eq("listing_id", listingId);
      return error?.message ?? null;
    }
    return null;
  };

  const handleSubmit = async (mode: PublishMode) => {
    setShowErrors(true);
    if (hasErrors) return;

    setSubmitting(true);
    // Mirror the first spot into the legacy single column for back-compat reads.
    const firstSpot = spots.find((spot) => spot.locationId)?.locationId ?? null;
    const payload = {
      brand: brand.trim(),
      title: title.trim(),
      description: description.trim() || null,
      items: parseItemDrafts(items),
      pickup_location_id: firstSpot,
      contact_email: contactEmail.trim(),
      recommender_enabled: recommenderEnabled,
      same_day_enabled: sameDayEnabled,
      cause_name: causeName.trim() || null,
      cause_percent: causeName.trim() ? Number.parseInt(causePercent, 10) : null,
      // Unapproved brands can't go live: keep as a draft or auto-post on approval (#7).
      active: mode === "publish",
      draft: mode === "draft",
      auto_post_on_brand: mode === "autopost",
      expires_at: new Date(expiresAt).toISOString(),
    };

    let listingId = initial?.id ?? null;
    if (initial) {
      const { error } = await supabase.from("listings").update(payload).eq("id", initial.id);
      if (error) {
        setSubmitting(false);
        toast.error(error.message);
        return;
      }
    } else {
      const { data, error } = await supabase
        .from("listings")
        .insert({ ...payload, club_id: club.id })
        .select("id")
        .single();
      if (error || !data) {
        setSubmitting(false);
        toast.error(error?.message ?? "Could not create the listing");
        return;
      }
      listingId = data.id;
    }

    // Held-back brands need an admin request on file so it can be approved.
    // Already-postable brands skip this - saving an approved brand as a draft
    // shouldn't file a redundant request.
    if (mode !== "publish" && !isPostable) {
      await supabase.rpc("request_brand", { p_name: brand.trim() }).then(
        () => onBrandRequested(),
        () => {},
      );
    }

    const pickupSyncError = listingId ? await syncPickup(listingId) : null;
    const goalSyncError = listingId && !pickupSyncError ? await syncGoal(listingId) : null;
    setSubmitting(false);
    if (pickupSyncError) {
      toast.error(`Listing saved, but pickup failed: ${pickupSyncError}`);
    } else if (goalSyncError) {
      toast.error(`Listing saved, but the goal failed: ${goalSyncError}`);
    } else if (mode === "draft") {
      toast.success(
        isPostable ? "Saved as a draft." : "Saved as a draft. Publish it once the brand is approved.",
      );
    } else if (mode === "autopost") {
      toast.success("Saved. It posts automatically once an admin approves the brand.");
    } else {
      toast.success(initial ? "Listing updated" : "Your drop is live");
    }
    onSaved();
  };

  const trimmedBrand = brand.trim();
  const isKnownBrand = brandOptions.some(
    (option) => option.toLowerCase() === trimmedBrand.toLowerCase(),
  );
  // Postable = in the global list OR approved one-time for THIS club (040).
  // This is what fixes the old "approve once did nothing next time" loop: a
  // one-time approval now unlocks the brand for every future drop the club posts.
  const isPostable = isKnownBrand || brandInList(trimmedBrand, approvedForClub);
  const approvedJustForClub = isPostable && !isKnownBrand;
  const brandRequested = requestedBrands.some(
    (name) => name.toLowerCase() === trimmedBrand.toLowerCase(),
  );

  const requestBrand = async () => {
    setRequestingBrand(true);
    const { error } = await supabase.rpc("request_brand", { p_name: trimmedBrand });
    setRequestingBrand(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setRequestedBrands((previous) => [...previous, trimmedBrand]);
    onBrandRequested();
    toast.success("Brand requested. An admin will review adding it to the list.");
  };

  // ===================== Save as template =====================
  //
  // A template is this listing minus its calendar. Dates are deliberately not
  // stored: a template reused in three weeks would otherwise carry
  // three-week-old dates, and a club posting from it would publish a drop
  // whose pickup already happened. Windows keep their shape instead - which
  // day of the run, and what time of day - and posting from the template asks
  // for the first pickup day and rebuilds real timestamps from that.

  /** The earliest pickup date across every spot; day offsets count from it. */
  const firstPickupDate = useMemo(() => {
    const dates = spots.flatMap((spot) => spot.windows.map((window) => window.date)).filter(Boolean);
    return dates.length > 0 ? dates.sort()[0] : "";
  }, [spots]);

  const buildPickupConfig = (): TemplateSpot[] =>
    spots
      .filter((spot) => spot.locationId)
      .map((spot) => ({
        location_id: spot.locationId,
        order_type: spot.orderType,
        windows: spot.windows.map((window) => ({
          day_offset: firstPickupDate
            ? Math.round(
                (new Date(`${window.date}T12:00:00`).getTime() -
                  new Date(`${firstPickupDate}T12:00:00`).getTime()) /
                  86_400_000,
              )
            : 0,
          start_minutes: window.startMinutes,
          end_minutes: window.endMinutes,
          slot_mode: window.slotMode,
          capacity: window.slotMode === "capacity" ? Number.parseInt(window.capacity, 10) || null : null,
          split_minutes: window.slotMode === "split" ? window.splitMinutes : null,
          note: window.note.trim() || null,
        })),
        same_day_stock: itemNames
          .map((name) => ({ item_name: name, quantity: Number.parseInt(spot.sameDay[name] ?? "", 10) }))
          .filter((row) => Number.isFinite(row.quantity) && row.quantity > 0),
      }));

  const templatePayload = () => ({
    club_id: club.id,
    name: title.trim() || brand.trim(),
    brand: brand.trim(),
    items: parseItemDrafts(items),
    description: description.trim() || null,
    // A template saved from a listing is a one-off to post on demand, not a
    // schedule. The club turns on recurrence on the Templates page if it
    // wants one, which keeps "save this setup" from silently creating a
    // drop that posts itself every week.
    mode: "one_time" as const,
    frequency: "weekly" as const,
    is_active: true,
    auto_active: false,
    next_run_date: null,
    contact_email: contactEmail.trim() || null,
    cause_name: causeName.trim() || null,
    cause_percent: causeName.trim() ? Number.parseInt(causePercent, 10) : null,
    goal_amount: goalAmount.trim() ? Math.round(Number.parseFloat(goalAmount) * 100) / 100 : null,
    goal_public: goalPublic,
    recommender_enabled: recommenderEnabled,
    same_day_enabled: sameDayEnabled,
    duration_hours: expiresAt
      ? Math.max(1, Math.round((new Date(expiresAt).getTime() - Date.now()) / 3_600_000))
      : null,
    pickup_config: buildPickupConfig(),
  });

  const writeTemplate = async (replaceId: string | null) => {
    setSavingTemplate(true);
    const payload = templatePayload();
    const { error } = replaceId
      ? await supabase.from("recurring_templates").update(payload).eq("id", replaceId)
      : await supabase.from("recurring_templates").insert(payload);
    setSavingTemplate(false);
    setTemplateClash(null);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(
      replaceId
        ? "Template replaced. Post from it any time on your Templates page."
        : "Saved as a template. Post from it any time on your Templates page.",
    );
  };

  const saveAsTemplate = async () => {
    setShowErrors(true);
    if (errors.brand || errors.title || errors.items || errors.spots) {
      toast.error("Fix the highlighted fields before saving a template.");
      return;
    }
    setSavingTemplate(true);
    // Same brand, same club: almost always the club redoing a setup it already
    // saved, so ask rather than quietly stacking near-identical templates.
    const { data } = await supabase
      .from("recurring_templates")
      .select("*")
      .eq("club_id", club.id)
      .ilike("brand", brand.trim())
      .limit(1);
    setSavingTemplate(false);
    const existing = (data ?? [])[0] as RecurringTemplate | undefined;
    if (existing) {
      setTemplateClash(existing);
      return;
    }
    await writeTemplate(null);
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        // Enter submits only when the brand is approved; otherwise the club
        // picks draft vs auto-post explicitly below.
        if (isPostable) void handleSubmit("publish");
      }}
      noValidate
      className="rounded-2xl border border-border bg-surface-raised p-5"
    >
      <h2 className="text-lg font-bold">
        {initial ? "Edit listing" : duplicateOf ? `New listing (copied from "${duplicateOf.title}")` : "New listing"}
      </h2>
      {duplicateOf && (
        <p className="mt-1 text-xs text-ink-muted">
          Items, prices, and details copied over. Pickup spots, dates and times start fresh; set a new
          end time below.
        </p>
      )}

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="brand">Brand</Label>
          <Combobox
            id="brand"
            value={brand}
            onChange={setBrand}
            options={brandOptions}
            invalid={showErrors && Boolean(errors.brand)}
            placeholder="Krispy Kreme"
            emptyHint="Not in the list yet. Keep typing, then request it below."
          />
          <FieldError message={showErrors ? errors.brand : undefined} />
          {approvedJustForClub && (
            <p className="mt-1.5 flex items-center gap-1 text-xs font-medium text-primary-dark">
              <BadgeCheck className="size-3.5" aria-hidden="true" />
              Approved for your club. You can publish this brand any time.
            </p>
          )}
          {trimmedBrand.length >= 2 && !isPostable && (
            <div className="mt-1.5 text-xs text-ink-muted">
              {brandRequested ? (
                <span className="font-medium text-primary-dark">
                  Requested. Save below and it's queued for admin review.
                </span>
              ) : (
                <>
                  Not in the list?{" "}
                  <button
                    type="button"
                    onClick={() => void requestBrand()}
                    disabled={requestingBrand}
                    className="font-semibold text-primary-dark underline-offset-2 hover-fine:underline disabled:opacity-60"
                  >
                    Request "{trimmedBrand}" for everyone
                  </button>
                </>
              )}
            </div>
          )}
        </div>
        <div>
          <Label htmlFor="expires-at">Ends at</Label>
          <DateTimeField
            id="expires-at"
            value={expiresAt}
            invalid={showErrors && Boolean(errors.expiresAt)}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
          <FieldError message={showErrors ? errors.expiresAt : undefined} />
        </div>
      </div>

      <div className="mt-5">
        <Label htmlFor="title">Title</Label>
        <Input
          id="title"
          value={title}
          invalid={showErrors && Boolean(errors.title)}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Dozen drop outside Duffield"
        />
        <FieldError message={showErrors ? errors.title : undefined} />
      </div>

      <div className="mt-5">
        <Label htmlFor="description">Description (optional)</Label>
        <Textarea
          id="description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What are you raising money for? Any flavors or limits worth knowing?"
          className="min-h-28"
        />
      </div>

      <div className="mt-5">
        <Label htmlFor="contact-email">Contact email</Label>
        <Input
          id="contact-email"
          type="email"
          value={contactEmail}
          invalid={showErrors && Boolean(errors.contactEmail)}
          onChange={(e) => setContactEmail(e.target.value)}
          placeholder="club-officer@cornell.edu"
        />
        <p className="mt-1.5 text-xs text-ink-muted">
          Shown on this listing so buyers can reach you about it. Enter it fresh for each drop.
        </p>
        <FieldError message={showErrors ? errors.contactEmail : undefined} />
      </div>

      <div className="mt-5">
        <Label>Items, prices, dietary tags</Label>
        <ItemsEditor items={items} onChange={setItems} />
        <FieldError message={showErrors ? errors.items : undefined} />
      </div>

      <div className="mt-5">
        <Label>Pickup: where, when, and how many</Label>
        <p className="mb-2 mt-1 text-xs text-ink-muted">
          Each spot below shows on the map and carries its own dates. Run one table on several
          days, or several tables on the same day, at whatever times suit each one.
        </p>
        {!pickupLoaded ? (
          <p className="text-xs text-ink-muted">Loading this drop's pickup dates...</p>
        ) : (
          <PickupEditor
            spots={spots}
            locations={activeLocations}
            itemNames={itemNames}
            sameDayEnabled={sameDayEnabled}
            defaultDate={expiresAt ? expiresAt.slice(0, 10) : toDateOnly(new Date())}
            onChange={setSpots}
          />
        )}
        <FieldError message={showErrors ? errors.spots : undefined} />
        <DayConflictWarning spots={spots} expiresAt={expiresAt} otherAgenda={otherAgenda} />

        <CustomSpotManager
          locations={locations}
          clubId={club.id}
          customName={customName}
          customAddress={customAddress}
          findingAddress={findingAddress}
          foundLocation={foundLocation}
          addingLocation={addingLocation}
          onNameChange={setCustomName}
          onAddressChange={setCustomAddress}
          onFind={() => void findAddress()}
          onConfirm={() => void confirmCustomLocation()}
          onCancelFound={() => setFoundLocation(null)}
          onLocationsChanged={onLocationAdded}
          onSpotRemoved={(locationId) =>
            setSpots((previous) => previous.filter((spot) => spot.locationId !== locationId))
          }
        />
      </div>

      <div className="mt-5 rounded-2xl border border-border/70 p-3.5">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={sameDayEnabled}
            onChange={(e) => setSameDayEnabled(e.target.checked)}
            className="mt-0.5 size-5 shrink-0 accent-(--color-primary-dark)"
          />
          <span>
            <span className="block text-sm font-semibold">
              Sell at the table on the day (same-day stock)
            </span>
            <span className="block text-xs text-ink-muted">
              Track how many of each item you are carrying to each same-day spot. Walk-up sales get
              recorded on your Orders page and count toward your revenue and goal, the same as a
              pre-order. Separate from the pre-order limits you set on each item above.
            </span>
          </span>
        </label>
        {sameDayEnabled && itemNames.length === 0 && (
          <p className="mt-2 text-xs text-ink-muted">Add an item above and the counts appear on each same-day spot.</p>
        )}
        {sameDayEnabled &&
          itemNames.length > 0 &&
          !spots.some((spot) => spot.orderType === "same_day" || spot.orderType === "both") && (
            <p className="mt-2 text-xs text-ink-muted">
              No spot takes walk-ups yet. Set one to "Same-day pickup" or "Pre-order &amp; same-day"
              above to enter its counts.
            </p>
          )}
      </div>

      <div className="mt-5">
        <Label>Cause / donation (optional)</Label>
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <Input
            value={causeName}
            onChange={(e) => setCauseName(e.target.value)}
            placeholder="e.g. Ithaca Food Bank"
            aria-label="Cause name"
          />
          <div className="flex items-center gap-2">
            <Input
              value={causePercent}
              onChange={(e) => setCausePercent(e.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              placeholder="50"
              aria-label="Percent of earnings donated"
              className="w-20 font-mono"
              disabled={!causeName.trim()}
            />
            <span className="text-sm text-ink-muted">% of earnings</span>
          </div>
        </div>
        <FieldError message={showErrors ? errors.cause : undefined} />
        <p className="mt-1.5 text-xs text-ink-muted">
          Drops with a cause are pinned to the top of the feed.
        </p>
      </div>

      <div className="mt-5">
        <Label>Club fundraising goal (optional)</Label>
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-36">
            <span
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-ink-muted"
              aria-hidden="true"
            >
              $
            </span>
            <Input
              value={goalAmount}
              onChange={(e) => setGoalAmount(e.target.value.replace(/[^\d.]/g, ""))}
              inputMode="decimal"
              placeholder="800"
              aria-label="Fundraising goal in dollars, optional"
              className="pl-7 font-mono"
            />
          </div>
          <span className="text-sm text-ink-muted">for your club</span>
        </div>
        <p className="mt-1.5 text-xs text-ink-muted">
          How much your club wants to raise from this drop. You always see a progress bar of
          confirmed payments on your dashboard.
        </p>
        <label className="mt-2.5 flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={goalPublic}
            onChange={(e) => setGoalPublic(e.target.checked)}
            disabled={!goalAmount.trim()}
            className="mt-0.5 size-5 shrink-0 accent-(--color-primary-dark) disabled:opacity-50"
          />
          <span>
            <span className="block text-sm font-semibold">Show the progress bar to students</span>
            <span className="block text-xs text-ink-muted">
              Off: only your club sees it. On: students see how much you have raised toward the goal.
            </span>
          </span>
        </label>
        <FieldError message={showErrors ? errors.goal : undefined} />
      </div>

      <div className="mt-5 rounded-2xl border border-border/70 p-3.5">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={recommenderEnabled}
            onChange={(e) => setRecommenderEnabled(e.target.checked)}
            className="mt-0.5 size-5 shrink-0 accent-(--color-primary-dark)"
          />
          <span>
            <span className="block text-sm font-semibold">
              Ask "which member recommended you?" on the order form
            </span>
            <span className="block text-xs text-ink-muted">
              {club.member_options.length > 0
                ? `Buyers pick from your ${club.member_options.length} member ${club.member_options.length === 1 ? "name" : "names"}. Edit the list on your Account page.`
                : "Add member names on your Account page first, or the dropdown will be empty."}
            </span>
          </span>
        </label>
      </div>

      {trimmedBrand && !isPostable && (
        <p className="mt-6 rounded-xl bg-primary/15 p-3 text-xs text-ink">
          "{trimmedBrand}" needs admin approval before it can go live. Save it as a draft, or have
          it post automatically once the brand is approved.
          {initial?.active &&
            " Heads up: this listing is currently live; saving with an unapproved brand takes it off the feed until approval."}
        </p>
      )}

      {templateClash && (
        <div className="mt-5 rounded-2xl border border-primary-dark/40 bg-primary/10 p-3.5">
          <p className="text-sm font-bold">
            You already have a "{templateClash.brand}" template
          </p>
          <p className="mt-1 text-xs text-ink-muted">
            It is called "{templateClash.name}". Replace it with this setup, or keep both and pick
            between them when you post.
          </p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              loading={savingTemplate}
              onClick={() => void writeTemplate(templateClash.id)}
            >
              Replace it
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              loading={savingTemplate}
              onClick={() => void writeTemplate(null)}
            >
              Keep both
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              disabled={savingTemplate}
              onClick={() => setTemplateClash(null)}
            >
              Cancel
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          type="button"
          variant="secondary"
          loading={savingTemplate && !templateClash}
          onClick={() => void saveAsTemplate()}
        >
          <LayoutTemplate className="size-4" aria-hidden="true" />
          Save as template
        </Button>
        <Button
          type="button"
          variant="secondary"
          loading={submitting}
          onClick={() => void handleSubmit("draft")}
        >
          Save as draft
        </Button>
        {isPostable ? (
          <Button type="button" loading={submitting} onClick={() => void handleSubmit("publish")}>
            {initial ? "Save changes" : "Publish drop"}
          </Button>
        ) : (
          <Button type="button" loading={submitting} onClick={() => void handleSubmit("autopost")}>
            Auto-post when approved
          </Button>
        )}
      </div>
    </form>
  );
}

function ListingRow({
  listing,
  busy,
  canPost,
  onEdit,
  onDuplicate,
  onToggleActive,
  onRelaunch,
  onEndNow,
  onPost,
  onDelete,
}: {
  listing: ListingWithClub;
  busy: boolean;
  canPost: boolean;
  onEdit: () => void;
  onDuplicate: () => void;
  onToggleActive: () => void;
  onRelaunch: () => void;
  onEndNow: () => void;
  onPost: () => void;
  onDelete: () => void;
}) {
  const timeLeft = useCountdown(listing.expires_at);
  const cappedItems = (listing.items ?? []).flatMap((item) => {
    const remaining = itemRemaining(listing, item);
    return remaining == null || item.stock == null
      ? []
      : [{ name: item.name, remaining, stock: item.stock }];
  });
  const held = listing.draft || listing.auto_post_on_brand;
  const live = listing.active && !timeLeft.expired && !held;
  const status = listing.draft
    ? canPost
      ? { variant: "success" as const, label: "Approved, ready to post" }
      : { variant: "neutral" as const, label: "Draft, awaiting brand" }
    : listing.auto_post_on_brand
      ? { variant: "neutral" as const, label: "Posts on approval" }
      : timeLeft.expired
        ? { variant: "urgent" as const, label: "Ended" }
        : listing.active
          ? { variant: "success" as const, label: "Live" }
          : { variant: "neutral" as const, label: "Inactive" };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface-raised p-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-base font-bold">{listing.title}</h3>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
        <p className="mt-0.5 truncate text-sm text-ink-muted">
          {listing.brand}, ends {formatExpiry(listing.expires_at)}
          {listing.review_count > 0 &&
            `, rated ${Number(listing.avg_rating).toFixed(1)} (${listing.review_count})`}
        </p>
        {cappedItems.length > 0 && (
          <p className="mt-1 truncate text-xs text-ink-muted">
            {cappedItems
              .map(({ name, remaining, stock }) =>
                remaining === 0 ? `${name} sold out` : `${name} ${remaining} of ${stock} left`,
              )
              .join(", ")}
          </p>
        )}
        {listing.goal_amount != null && (
          <GoalProgress
            compact
            goal={Number(listing.goal_amount)}
            raised={listing.goal_raised ?? 0}
            className="mt-2 w-64 max-w-full"
          />
        )}
      </div>
      {/* min-w-0 (not shrink-0) so the group can compress and wrap its buttons
          on narrow screens instead of overflowing the card; on >=sm it sits
          compactly to the right like before. */}
      <div className="flex min-w-0 flex-wrap items-center gap-2 max-sm:w-full sm:shrink-0">
        {canPost && (
          <Button size="sm" loading={busy} onClick={onPost}>
            Post now
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={onEdit}>
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDuplicate}
          aria-label={`Duplicate ${listing.title}`}
        >
          <Copy className="size-3.5" aria-hidden="true" />
          Duplicate
        </Button>
        {/* Deactivate/Reactivate only makes sense while the clock is running:
            the feed and order form both require a future end time, so flipping
            `active` on an ENDED drop changed nothing. Ended drops get Relaunch
            instead, which reopens them with a fresh window. */}
        {!held && !timeLeft.expired && (
          <Button variant="ghost" size="sm" loading={busy} onClick={onToggleActive}>
            {listing.active ? "Deactivate" : "Reactivate"}
          </Button>
        )}
        {!held && timeLeft.expired && (
          <Button variant="secondary" size="sm" loading={busy} onClick={onRelaunch}>
            <RotateCcw className="size-3.5" aria-hidden="true" />
            Relaunch
          </Button>
        )}
        {live && (
          <Button variant="ghost" size="sm" loading={busy} onClick={onEndNow} className="text-accent">
            End now
          </Button>
        )}
        {held && (
          <Button variant="ghost" size="sm" loading={busy} onClick={onDelete} className="text-accent">
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-1 break-words font-display text-xl font-extrabold sm:text-2xl">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-muted">{sub}</p>}
    </div>
  );
}

/** The club's private brand situation: what's approved for them, what's waiting. */
function BrandStatusPanel({
  approvedForClub,
  requests,
}: {
  approvedForClub: string[];
  requests: BrandRequest[];
}) {
  const pending = requests.filter((request) => request.status === "pending");
  const rejected = requests.filter((request) => request.status === "rejected").slice(0, 3);
  if (approvedForClub.length === 0 && pending.length === 0 && rejected.length === 0) return null;

  return (
    <section className="mt-6 rounded-2xl border border-border bg-surface-raised p-4">
      <h2 className="flex items-center gap-2 text-sm font-bold">
        <Tag className="size-4 text-primary-dark" aria-hidden="true" />
        Your brands
      </h2>
      {approvedForClub.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Approved for your club
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {approvedForClub.map((name) => (
              <Badge key={name} variant="success">
                <BadgeCheck className="size-3" aria-hidden="true" />
                {name}
              </Badge>
            ))}
          </div>
        </div>
      )}
      {pending.length > 0 && (
        <div className="mt-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Waiting on admin
          </p>
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {pending.map((request) => (
              <Badge key={request.id} variant="neutral">
                <Hourglass className="size-3" aria-hidden="true" />
                {request.requested_name}
              </Badge>
            ))}
          </div>
        </div>
      )}
      {rejected.length > 0 && (
        <p className="mt-3 text-xs text-ink-muted">
          Not approved: {rejected.map((request) => request.requested_name).join(", ")}. You can
          re-request from the listing form if things change.
        </p>
      )}
    </section>
  );
}

function DashboardSkeleton() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10" aria-busy="true" aria-label="Loading dashboard">
      <div className="h-9 w-56 animate-pulse rounded-xl bg-border/70" />
      <div className="mt-8 space-y-3">
        {Array.from({ length: 3 }, (_, index) => (
          <div key={index} className="h-20 animate-pulse rounded-2xl bg-border/40" />
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { user, loading: authLoading } = useAuth();
  const { club, loading: clubLoading } = useClub();
  const { open: openTour } = useTour();
  const {
    listings,
    loading: listingsLoading,
    refetch,
  } = useListings({ clubId: user?.id, enabled: Boolean(user) });
  const reduceMotion = useReducedMotion();
  const brandOptions = useBrandOptions();
  const {
    approvedForClub,
    requests: brandRequests,
    refetch: refetchBrands,
  } = useClubBrandStatus(user?.id);

  // "create" opens an empty form; a listing id opens that listing for editing.
  const [formMode, setFormMode] = useState<"closed" | "create" | string>("closed");
  // When set (and formMode is "create"), the form prefills from this listing.
  const [duplicateOf, setDuplicateOf] = useState<ListingWithClub | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [locations, setLocations] = useState<CampusLocation[]>([]);
  const [stats, setStats] = useState<ClubDashboardStats | null>(null);

  const userId = user?.id ?? null;

  const refetchStats = useCallback(async () => {
    if (!userId) return;
    const { data } = await supabase.rpc("club_dashboard_stats");
    setStats((data as ClubDashboardStats | null) ?? null);
  }, [userId]);

  useEffect(() => {
    void refetchStats();
  }, [refetchStats]);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    // Curated list (created_by null) plus this club's own added spots (#4).
    void supabase
      .from("campus_locations")
      .select("*")
      .or(`created_by.is.null,created_by.eq.${userId}`)
      .order("name")
      .then(({ data }) => {
        if (!cancelled) setLocations(data ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  /**
   * A campus location was added, archived or restored. Upsert by id rather
   * than append: archiving calls this with a location that is already in the
   * list, and appending would show the club two copies of its own spot.
   */
  const addLocation = (location: CampusLocation) => {
    setLocations((previous) =>
      (previous.some((existing) => existing.id === location.id)
        ? previous.map((existing) => (existing.id === location.id ? location : existing))
        : [...previous, location]
      ).sort((a, b) => a.name.localeCompare(b.name)),
    );
  };

  if (authLoading || (user && clubLoading)) {
    return <DashboardSkeleton />;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (!club) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16">
        <EmptyState
          icon={<ShieldQuestion className="size-6" aria-hidden="true" />}
          title="No club profile found"
          body="This account is not linked to a club. Register a club to start posting fundraisers."
        />
      </div>
    );
  }

  if (!club.approved) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16">
        <div className="rounded-2xl border border-border bg-surface-raised p-8 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/20">
            <Hourglass className="size-6 text-primary-dark" aria-hidden="true" />
          </div>
          <h1 className="mt-5 text-2xl font-extrabold">Hang tight, {club.name}</h1>
          <p className="mt-3 text-sm text-ink-muted">
            Your club is waiting on admin approval. You will get a welcome email the moment
            you are cleared to post drops.
          </p>
          {/* Waiting is the ideal moment to learn the tools. Nothing in the
              walkthrough needs an approved club, because none of it is real. */}
          <Button variant="secondary" className="mt-5 w-full" onClick={() => openTour("club")}>
            <Compass className="size-4" aria-hidden="true" />
            Walk through the club tools
          </Button>
        </div>
      </div>
    );
  }

  const editingListing =
    formMode !== "closed" && formMode !== "create"
      ? (listings.find((listing) => listing.id === formMode) ?? null)
      : null;

  const brandApproved = (brandName: string) =>
    brandOptions.some((option) => option.toLowerCase() === brandName.trim().toLowerCase()) ||
    brandInList(brandName, approvedForClub);

  // A draft can be posted when its CURRENT brand is approved: globally, one-time
  // for this club (durable since migration 040), or tagged on the listing by an
  // admin decision. Changing the brand to anything else drops authorization -
  // and the database trigger enforces the same rule server-side.
  const canPostDraft = (listing: ListingWithClub) =>
    listing.draft &&
    (brandApproved(listing.brand) ||
      (listing.approved_brand != null &&
        listing.brand.trim().toLowerCase() === listing.approved_brand.trim().toLowerCase()));

  // Publish a draft whose brand has since been approved (build spec 5 follow-up).
  const publishDraft = async (listing: ListingWithClub) => {
    setBusyId(listing.id);
    const { error } = await supabase
      .from("listings")
      .update({ active: true, draft: false, auto_post_on_brand: false })
      .eq("id", listing.id);
    if (error) {
      toast.error(error.message);
    } else {
      if (new Date(listing.expires_at).getTime() <= Date.now()) {
        toast.warning("Posted, but the end time already passed. Edit it to set a new end time.");
      } else {
        toast.success("Draft published. It's live on the feed.");
      }
      await Promise.all([refetch(), refetchStats()]);
    }
    setBusyId(null);
  };

  // Sold out or done early? End the drop on the spot (expiry = now).
  const endNow = async (listing: ListingWithClub) => {
    if (!window.confirm(`End "${listing.title}" now? It leaves the feed immediately.`)) return;
    setBusyId(listing.id);
    const { error } = await supabase
      .from("listings")
      .update({ expires_at: new Date().toISOString() })
      .eq("id", listing.id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Drop ended. Buyers with open orders can still pick up.");
      await Promise.all([refetch(), refetchStats()]);
    }
    setBusyId(null);
  };

  const deleteDraft = async (listing: ListingWithClub) => {
    if (!window.confirm(`Delete the draft "${listing.title}"? This can't be undone.`)) return;
    setBusyId(listing.id);
    const { error } = await supabase.from("listings").delete().eq("id", listing.id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Draft deleted.");
      await refetch();
    }
    setBusyId(null);
  };

  const toggleActive = async (listing: ListingWithClub) => {
    setBusyId(listing.id);
    const { error } = await supabase
      .from("listings")
      .update({ active: !listing.active })
      .eq("id", listing.id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success(
        listing.active
          ? "Listing deactivated. It is hidden from the feed until you reactivate it."
          : "Listing reactivated and back on the feed.",
      );
      await refetch();
    }
    setBusyId(null);
  };

  // An ENDED drop can't come back by flipping `active`: the feed and the order
  // form both require a future end time, so the old Reactivate button silently
  // did nothing. Relaunch reopens it properly with a fresh 48-hour window
  // (same listing, so reviews, Q&A, and past orders stay attached).
  const relaunch = async (listing: ListingWithClub) => {
    const until = new Date(Date.now() + 48 * 3_600_000);
    if (
      !window.confirm(
        `Relaunch "${listing.title}"? It returns to the feed and takes orders until ${formatExpiry(until.toISOString())}. You can change the end time with Edit afterwards.`,
      )
    ) {
      return;
    }
    setBusyId(listing.id);
    const { error } = await supabase
      .from("listings")
      .update({ active: true, expires_at: until.toISOString() })
      .eq("id", listing.id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success("Drop relaunched for 48 hours. Edit it to fine-tune the end time.");
      await Promise.all([refetch(), refetchStats()]);
    }
    setBusyId(null);
  };

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">{club.name}</h1>
          <p className="mt-1 text-sm text-ink-muted">Manage your fundraiser drops.</p>
        </div>
        {formMode === "closed" && (
          <Button
            onClick={() => {
              setDuplicateOf(null);
              setFormMode("create");
            }}
          >
            <Plus className="size-4" aria-hidden="true" />
            New listing
          </Button>
        )}
      </div>

      {stats && (
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatCard label="Revenue" value={formatPrice(Number(stats.revenue))} sub="verified payments" />
          <StatCard
            label="To verify"
            value={String(stats.orders_pending)}
            sub={stats.orders_pending > 0 ? "orders awaiting payment check" : "all orders verified"}
          />
          <StatCard
            label="Live drops"
            value={String(stats.live_drops)}
            sub={stats.held_drops > 0 ? `${stats.held_drops} held for brand approval` : undefined}
          />
          <StatCard
            label="Reservations"
            value={String(stats.upcoming_reservations)}
            sub="upcoming pickups"
          />
        </div>
      )}

      <div className="mt-4 flex flex-wrap gap-2">
        <Link to={`/club/${club.id}/orders-dashboard`}>
          <Button variant="secondary" size="sm">
            <ReceiptText className="size-3.5" aria-hidden="true" />
            Orders
          </Button>
        </Link>
        <Link to={`/club/${club.id}/analytics`}>
          <Button variant="secondary" size="sm">
            <BarChart3 className="size-3.5" aria-hidden="true" />
            Analytics
          </Button>
        </Link>
        <Link to={`/club/${club.id}/templates`}>
          <Button variant="secondary" size="sm">
            <LayoutTemplate className="size-3.5" aria-hidden="true" />
            Templates
          </Button>
        </Link>
        <Link to={`/club/${club.id}/reservations-manager`}>
          <Button variant="secondary" size="sm">
            <Users className="size-3.5" aria-hidden="true" />
            Reservations
          </Button>
        </Link>
        {/* Replayable club walkthrough. Simulated end to end, so tapping through
            it never touches a real drop, order, or payment. */}
        <Button variant="ghost" size="sm" onClick={() => openTour("club")}>
          <Compass className="size-3.5" aria-hidden="true" />
          How this works
        </Button>
      </div>

      <AnimatePresence mode="wait">
        {formMode !== "closed" && (
          <motion.div
            key={formMode === "create" && duplicateOf ? `dup-${duplicateOf.id}` : formMode}
            initial={reduceMotion ? false : { opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.1 } }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="mt-6"
          >
            <ListingForm
              club={club}
              initial={editingListing}
              duplicateOf={formMode === "create" ? duplicateOf : null}
              approvedForClub={approvedForClub}
              locations={locations}
              onLocationAdded={addLocation}
              onBrandRequested={() => void refetchBrands()}
              onSaved={() => {
                setFormMode("closed");
                setDuplicateOf(null);
                void refetch();
                void refetchStats();
              }}
              onCancel={() => {
                setFormMode("closed");
                setDuplicateOf(null);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <BrandStatusPanel approvedForClub={approvedForClub} requests={brandRequests} />

      <section className="mt-8">
        <h2 className="text-lg font-bold">Your listings</h2>
        {listingsLoading ? (
          <div className="mt-4 space-y-3" aria-busy="true" aria-label="Loading listings">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="h-20 animate-pulse rounded-2xl bg-border/40" />
            ))}
          </div>
        ) : listings.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              icon={<PackageOpen className="size-6" aria-hidden="true" />}
              title="No listings yet"
              body="Post your first drop and it shows up on the feed instantly. Cravers who picked your brand get an email."
              actionLabel="Create your first listing"
              onAction={() => setFormMode("create")}
            />
          </div>
        ) : (
          <div className="mt-4 space-y-3">
            {listings.map((listing) => (
              <ListingRow
                key={listing.id}
                listing={listing}
                busy={busyId === listing.id}
                canPost={canPostDraft(listing)}
                onEdit={() => {
                  setDuplicateOf(null);
                  setFormMode(listing.id);
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                onDuplicate={() => {
                  setDuplicateOf(listing);
                  setFormMode("create");
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                onToggleActive={() => void toggleActive(listing)}
                onRelaunch={() => void relaunch(listing)}
                onEndNow={() => void endNow(listing)}
                onPost={() => void publishDraft(listing)}
                onDelete={() => void deleteDraft(listing)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
