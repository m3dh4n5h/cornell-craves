import { useEffect, useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  BarChart3,
  Hourglass,
  LayoutTemplate,
  PackageOpen,
  Plus,
  ReceiptText,
  ShieldQuestion,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useClub } from "@/hooks/useClub";
import { useListings } from "@/hooks/useListings";
import { useCountdown } from "@/hooks/useCountdown";
import {
  ItemsEditor,
  parseItemDrafts,
  toItemDrafts,
  type ItemDraft,
} from "@/components/ItemsEditor";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useBrandOptions } from "@/hooks/useBrands";
import { geocodeAddress } from "@/lib/geocode";
import { formatExpiry } from "@/lib/format";
import type {
  CampusLocation,
  Club,
  ListingPickupSpot,
  ListingWithClub,
  OrderType,
  PickupSlot,
} from "@/types/database";

function toDatetimeLocal(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1.5 text-xs font-medium text-accent" role="alert">
      {message}
    </p>
  );
}

interface SlotDraft {
  id?: string;
  start: string;
  end: string;
  max: string;
  reserved: number;
  locationId: string;
}

function slotDraftValid(draft: SlotDraft): boolean {
  if (!draft.start || !draft.end) return false;
  if (new Date(draft.end).getTime() <= new Date(draft.start).getTime()) return false;
  const max = Number.parseInt(draft.max, 10);
  return Number.isFinite(max) && max >= 1 && max >= draft.reserved;
}

function SlotsEditor({
  slots,
  locations,
  onChange,
}: {
  slots: SlotDraft[];
  locations: CampusLocation[];
  onChange: (slots: SlotDraft[]) => void;
}) {
  const update = (index: number, patch: Partial<SlotDraft>) => {
    onChange(slots.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)));
  };

  const addSlot = () => {
    const base = new Date(Date.now() + 24 * 3_600_000);
    base.setMinutes(0, 0, 0);
    const end = new Date(base.getTime() + 3_600_000);
    onChange([
      ...slots,
      { start: toDatetimeLocal(base), end: toDatetimeLocal(end), max: "10", reserved: 0, locationId: "" },
    ]);
  };

  return (
    <div className="space-y-2">
      {slots.length === 0 && (
        <p className="text-xs text-ink-muted">
          Optional. Add pickup windows and students reserve spots instead of mobbing your table.
        </p>
      )}
      {slots.map((slot, index) => (
        <div key={slot.id ?? `new-${index}`} className="flex flex-wrap items-end gap-2 rounded-xl border border-border/70 p-2.5">
          <div className="min-w-0 flex-1 basis-full sm:basis-40">
            <Label htmlFor={`slot-start-${index}`} className="mb-1 text-xs">
              Starts
            </Label>
            <Input
              id={`slot-start-${index}`}
              type="datetime-local"
              value={slot.start}
              onChange={(e) => update(index, { start: e.target.value })}
              className="h-10 w-full"
            />
          </div>
          <div className="min-w-0 flex-1 basis-full sm:basis-40">
            <Label htmlFor={`slot-end-${index}`} className="mb-1 text-xs">
              Ends
            </Label>
            <Input
              id={`slot-end-${index}`}
              type="datetime-local"
              value={slot.end}
              onChange={(e) => update(index, { end: e.target.value })}
              className="h-10 w-full"
            />
          </div>
          <div className="w-24">
            <Label htmlFor={`slot-max-${index}`} className="mb-1 text-xs">
              Spots
            </Label>
            <Input
              id={`slot-max-${index}`}
              inputMode="numeric"
              value={slot.max}
              onChange={(e) => update(index, { max: e.target.value })}
              className="h-10 font-mono"
            />
          </div>
          <div className="min-w-0 flex-1 basis-full sm:basis-44">
            <Label htmlFor={`slot-location-${index}`} className="mb-1 text-xs">
              Pickup spot for this day
            </Label>
            <select
              id={`slot-location-${index}`}
              value={slot.locationId}
              onChange={(e) => update(index, { locationId: e.target.value })}
              className={SELECT_CLASS}
            >
              <option value="">No specific spot</option>
              {locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          </div>
          {slot.reserved > 0 ? (
            <Badge variant="default" className="mb-2.5">
              {slot.reserved} reserved
            </Badge>
          ) : (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange(slots.filter((_, i) => i !== index))}
              aria-label={`Remove slot ${index + 1}`}
              className="mb-0.5 px-2.5 text-ink-muted"
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          )}
        </div>
      ))}
      <Button type="button" variant="secondary" size="sm" onClick={addSlot} disabled={slots.length >= 12}>
        <Plus className="size-4" aria-hidden="true" />
        Add pickup slot
      </Button>
    </div>
  );
}

interface SpotDraft {
  id?: string;
  locationId: string;
  orderType: OrderType;
  availableStart: string;
  availableEnd: string;
}

type PublishMode = "publish" | "draft" | "autopost";

/** Spots are optional, but no two may point at the same campus location, and a
 * spot's availability window must end after it starts. */
function spotsError(spots: SpotDraft[]): string | undefined {
  const picked = spots.map((spot) => spot.locationId).filter(Boolean);
  if (new Set(picked).size !== picked.length) {
    return "Each pickup spot must be a different campus location.";
  }
  for (const spot of spots) {
    if (
      spot.availableStart &&
      spot.availableEnd &&
      new Date(spot.availableEnd).getTime() <= new Date(spot.availableStart).getTime()
    ) {
      return "Each spot's availability must end after it starts.";
    }
  }
  return undefined;
}

/** A named cause needs a 1–100 donation percentage. */
function causeError(name: string, percent: string): string | undefined {
  if (!name.trim()) return undefined;
  const value = Number.parseInt(percent, 10);
  return Number.isFinite(value) && value >= 1 && value <= 100
    ? undefined
    : "Enter a donation percentage from 1 to 100.";
}

const SELECT_CLASS =
  "h-10 w-full rounded-xl border border-border bg-surface-raised px-3 text-sm text-ink focus-visible:border-primary-dark focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary/40";

function SpotsEditor({
  spots,
  locations,
  onChange,
}: {
  spots: SpotDraft[];
  locations: CampusLocation[];
  onChange: (spots: SpotDraft[]) => void;
}) {
  const update = (index: number, patch: Partial<SpotDraft>) => {
    onChange(spots.map((spot, i) => (i === index ? { ...spot, ...patch } : spot)));
  };

  const addSpot = () => {
    onChange([
      ...spots,
      { locationId: "", orderType: "preorder", availableStart: "", availableEnd: "" },
    ]);
  };

  return (
    <div className="space-y-2">
      {spots.length === 0 && (
        <p className="text-xs text-ink-muted">
          Optional. Add one or more campus spots so this drop shows on the map. Tag each as
          pre-order or same-day, and set when pickup is available there.
        </p>
      )}
      {spots.map((spot, index) => (
        <div
          key={spot.id ?? `new-${index}`}
          className="rounded-xl border border-border/70 p-2.5"
        >
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-0 flex-1 basis-full sm:basis-44">
              <Label htmlFor={`spot-location-${index}`} className="mb-1 text-xs">
                Campus spot
              </Label>
              <select
                id={`spot-location-${index}`}
                value={spot.locationId}
                onChange={(e) => update(index, { locationId: e.target.value })}
                className={SELECT_CLASS}
              >
                <option value="">Pick a location</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="min-w-0 flex-1 basis-full sm:basis-36">
              <Label htmlFor={`spot-type-${index}`} className="mb-1 text-xs">
                Ordering
              </Label>
              <select
                id={`spot-type-${index}`}
                value={spot.orderType}
                onChange={(e) => update(index, { orderType: e.target.value as OrderType })}
                className={SELECT_CLASS}
              >
                <option value="preorder">Pre-order only</option>
                <option value="same_day">Same-day pickup</option>
                <option value="both">Pre-order &amp; same-day</option>
              </select>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onChange(spots.filter((_, i) => i !== index))}
              aria-label={`Remove pickup spot ${index + 1}`}
              className="mb-0.5 px-2.5 text-ink-muted"
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <div className="min-w-0">
              <Label htmlFor={`spot-from-${index}`} className="mb-1 text-xs">
                Available from
              </Label>
              <Input
                id={`spot-from-${index}`}
                type="datetime-local"
                value={spot.availableStart}
                onChange={(e) => update(index, { availableStart: e.target.value })}
                className="h-10 w-full"
              />
            </div>
            <div className="min-w-0">
              <Label htmlFor={`spot-until-${index}`} className="mb-1 text-xs">
                Available until
              </Label>
              <Input
                id={`spot-until-${index}`}
                type="datetime-local"
                value={spot.availableEnd}
                onChange={(e) => update(index, { availableEnd: e.target.value })}
                className="h-10 w-full"
              />
            </div>
          </div>
          <p className="mt-1 text-[11px] text-ink-muted">
            The map shows this spot's pin only between these times. Leave blank to show it the
            whole drop.
          </p>
        </div>
      ))}
      <Button type="button" variant="secondary" size="sm" onClick={addSpot} disabled={spots.length >= 8}>
        <Plus className="size-4" aria-hidden="true" />
        Add pickup spot
      </Button>
    </div>
  );
}

interface ListingFormProps {
  club: Club;
  initial: ListingWithClub | null;
  locations: CampusLocation[];
  onLocationAdded: (location: CampusLocation) => void;
  onSaved: () => void;
  onCancel: () => void;
}

function ListingForm({
  club,
  initial,
  locations,
  onLocationAdded,
  onSaved,
  onCancel,
}: ListingFormProps) {
  const [brand, setBrand] = useState(initial?.brand ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [items, setItems] = useState<ItemDraft[]>(toItemDrafts(initial?.items ?? null));
  const [pickupInfo, setPickupInfo] = useState(initial?.pickup_info ?? "");
  // Multiple pickup spots, each with its own order type (Batch 2 #2/#3/#5).
  const [spots, setSpots] = useState<SpotDraft[]>([]);
  const [originalSpots, setOriginalSpots] = useState<ListingPickupSpot[]>([]);
  // Contact email is per-listing and required on every drop (Batch 2 #1). On
  // edit it loads the existing value; on a new listing it starts blank.
  const [contactEmail, setContactEmail] = useState(initial?.contact_email ?? "");
  // Show the "which member recommended you?" question on the order form (#2).
  const [recommenderEnabled, setRecommenderEnabled] = useState(initial?.recommender_enabled ?? false);
  // Optional cause + percentage of earnings donated (build spec 5 #9).
  const [causeName, setCauseName] = useState(initial?.cause_name ?? "");
  const [causePercent, setCausePercent] = useState(
    initial?.cause_percent != null ? String(initial.cause_percent) : "",
  );
  const [expiresAt, setExpiresAt] = useState(
    initial
      ? toDatetimeLocal(new Date(initial.expires_at))
      : toDatetimeLocal(new Date(Date.now() + 6 * 3_600_000)),
  );
  const [slots, setSlots] = useState<SlotDraft[]>([]);
  const [originalSlots, setOriginalSlots] = useState<PickupSlot[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // Request-a-brand (#17): brands not in the merged list can be sent to admin.
  const brandOptions = useBrandOptions();
  const [requestingBrand, setRequestingBrand] = useState(false);
  const [requestedBrands, setRequestedBrands] = useState<string[]>([]);
  // Add a custom pickup location by name + address, geocoded via Nominatim (#4).
  const [customName, setCustomName] = useState("");
  const [customAddress, setCustomAddress] = useState("");
  const [addingLocation, setAddingLocation] = useState(false);

  const addCustomLocation = async () => {
    const name = customName.trim();
    const address = customAddress.trim();
    if (name.length < 2 || address.length < 4) {
      toast.error("Enter a name and a full street address.");
      return;
    }
    setAddingLocation(true);
    const geo = await geocodeAddress(address);
    if (!geo) {
      setAddingLocation(false);
      toast.error("Couldn't find that address. Try adding \"Ithaca, NY\".");
      return;
    }
    const { data, error } = await supabase.rpc("add_campus_location", {
      p_name: name,
      p_lat: geo.lat,
      p_lng: geo.lng,
      p_description: address,
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
      { locationId: location.id, orderType: "preorder", availableStart: "", availableEnd: "" },
    ]);
    setCustomName("");
    setCustomAddress("");
    toast.success(`Added "${location.name}". It's selected as a pickup spot below.`);
  };

  const initialId = initial?.id ?? null;

  useEffect(() => {
    if (!initialId) return;
    let cancelled = false;
    void supabase
      .from("pickup_slots")
      .select("*")
      .eq("listing_id", initialId)
      .order("start_time", { ascending: true })
      .then(({ data }) => {
        if (cancelled || !data) return;
        setOriginalSlots(data);
        setSlots(
          data.map((slot) => ({
            id: slot.id,
            start: toDatetimeLocal(new Date(slot.start_time)),
            end: toDatetimeLocal(new Date(slot.end_time)),
            max: String(slot.max_reservations),
            reserved: slot.reserved_count,
            locationId: slot.location_id ?? "",
          })),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [initialId]);

  // Load existing pickup spots so the club can edit them later (#5).
  useEffect(() => {
    if (!initialId) return;
    let cancelled = false;
    void supabase
      .from("listing_pickup_spots")
      .select("*")
      .eq("listing_id", initialId)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        if (cancelled || !data) return;
        setOriginalSpots(data);
        setSpots(
          data.map((spot) => ({
            id: spot.id,
            locationId: spot.location_id,
            orderType: spot.order_type,
            availableStart: spot.available_start ? toDatetimeLocal(new Date(spot.available_start)) : "",
            availableEnd: spot.available_end ? toDatetimeLocal(new Date(spot.available_end)) : "",
          })),
        );
      });
    return () => {
      cancelled = true;
    };
  }, [initialId]);

  const filledSlots = slots.filter((slot) => slot.start || slot.end);
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
    slots: filledSlots.every(slotDraftValid)
      ? undefined
      : "Every pickup slot needs a start, an end after it, and at least as many spots as already reserved.",
    spots: spotsError(spots),
    cause: causeError(causeName, causePercent),
  };
  const hasErrors = Object.values(errors).some(Boolean);

  const syncSpots = async (listingId: string): Promise<string | null> => {
    const filled = spots.filter((spot) => spot.locationId);
    const keptIds = new Set(filled.map((spot) => spot.id).filter(Boolean));

    for (const original of originalSpots) {
      if (!keptIds.has(original.id)) {
        const { error } = await supabase.from("listing_pickup_spots").delete().eq("id", original.id);
        if (error) return error.message;
      }
    }
    for (const draft of filled) {
      const payload = {
        listing_id: listingId,
        location_id: draft.locationId,
        order_type: draft.orderType,
        available_start: draft.availableStart ? new Date(draft.availableStart).toISOString() : null,
        available_end: draft.availableEnd ? new Date(draft.availableEnd).toISOString() : null,
      };
      const { error } = draft.id
        ? await supabase.from("listing_pickup_spots").update(payload).eq("id", draft.id)
        : await supabase.from("listing_pickup_spots").insert(payload);
      if (error) return error.message;
    }
    return null;
  };

  const syncSlots = async (listingId: string): Promise<string | null> => {
    const validDrafts = filledSlots.filter(slotDraftValid);
    const keptIds = new Set(validDrafts.map((draft) => draft.id).filter(Boolean));

    for (const original of originalSlots) {
      if (!keptIds.has(original.id) && original.reserved_count === 0) {
        const { error } = await supabase.from("pickup_slots").delete().eq("id", original.id);
        if (error) return error.message;
      }
    }
    for (const draft of validDrafts) {
      const payload = {
        listing_id: listingId,
        start_time: new Date(draft.start).toISOString(),
        end_time: new Date(draft.end).toISOString(),
        max_reservations: Number.parseInt(draft.max, 10),
        location_id: draft.locationId || null,
      };
      const { error } = draft.id
        ? await supabase.from("pickup_slots").update(payload).eq("id", draft.id)
        : await supabase.from("pickup_slots").insert(payload);
      if (error) return error.message;
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
      pickup_info: pickupInfo.trim() || null,
      pickup_location_id: firstSpot,
      contact_email: contactEmail.trim(),
      recommender_enabled: recommenderEnabled,
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
    if (mode !== "publish") {
      await supabase.rpc("request_brand", { p_name: brand.trim() }).then(
        () => {},
        () => {},
      );
    }

    const slotError = listingId ? await syncSlots(listingId) : null;
    const spotError = listingId && !slotError ? await syncSpots(listingId) : null;
    setSubmitting(false);
    if (slotError) {
      toast.error(`Listing saved, but slots failed: ${slotError}`);
    } else if (spotError) {
      toast.error(`Listing saved, but pickup spots failed: ${spotError}`);
    } else if (mode === "draft") {
      toast.success("Saved as a draft. Publish it once the brand is approved.");
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
    toast.success("Brand requested. An admin will review adding it to the list.");
  };

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        // Enter submits only when the brand is approved; otherwise the club
        // picks draft vs auto-post explicitly below.
        if (isKnownBrand) void handleSubmit("publish");
      }}
      noValidate
      className="rounded-2xl border border-border bg-surface-raised p-5"
    >
      <h2 className="text-lg font-bold">{initial ? "Edit listing" : "New listing"}</h2>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="brand">Brand</Label>
          <Input
            id="brand"
            list="brand-options"
            value={brand}
            invalid={showErrors && Boolean(errors.brand)}
            onChange={(e) => setBrand(e.target.value)}
            placeholder="Krispy Kreme"
          />
          <datalist id="brand-options">
            {brandOptions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
          <FieldError message={showErrors ? errors.brand : undefined} />
          {trimmedBrand.length >= 2 && !isKnownBrand && (
            <div className="mt-1.5 text-xs text-ink-muted">
              {brandRequested ? (
                <span className="font-medium text-primary-dark">
                  Requested. You can still post with this brand now.
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
          <Input
            id="expires-at"
            type="datetime-local"
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
        <Label>Pickup spots (show on the map)</Label>
        <SpotsEditor spots={spots} locations={locations} onChange={setSpots} />
        <FieldError message={showErrors ? errors.spots : undefined} />
        <details className="mt-2 rounded-xl border border-border/70 p-3">
          <summary className="cursor-pointer text-sm font-semibold">Add a custom spot</summary>
          <p className="mt-2 text-xs text-ink-muted">
            Not in the list? Add a name and street address; we place it on the map for you.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <Input
              value={customName}
              onChange={(e) => setCustomName(e.target.value)}
              placeholder="Spot name (e.g. Phi Psi house)"
              aria-label="Custom spot name"
              className="h-10"
            />
            <Input
              value={customAddress}
              onChange={(e) => setCustomAddress(e.target.value)}
              placeholder="312 Thurston Ave, Ithaca NY"
              aria-label="Street address"
              className="h-10"
            />
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-2"
            loading={addingLocation}
            onClick={() => void addCustomLocation()}
          >
            <Plus className="size-4" aria-hidden="true" />
            Find &amp; add spot
          </Button>
        </details>
      </div>

      <div className="mt-5">
        <Label htmlFor="pickup">Pickup details (optional)</Label>
        <Input
          id="pickup"
          value={pickupInfo}
          onChange={(e) => setPickupInfo(e.target.value)}
          placeholder="Duffield atrium, 5 to 8 pm"
        />
      </div>

      <div className="mt-5">
        <Label>Pickup days</Label>
        <SlotsEditor slots={slots} locations={locations} onChange={setSlots} />
        <FieldError message={showErrors ? errors.slots : undefined} />
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
        <p className="mt-1.5 text-xs text-ink-muted">
          Drops with a cause are pinned to the top of the feed.
        </p>
        <FieldError message={showErrors ? errors.cause : undefined} />
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

      {trimmedBrand && !isKnownBrand && (
        <p className="mt-6 rounded-xl bg-primary/15 p-3 text-xs text-ink">
          "{trimmedBrand}" needs admin approval before it can go live. Save it as a draft, or have
          it post automatically once the brand is approved.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        {isKnownBrand ? (
          <Button type="button" loading={submitting} onClick={() => void handleSubmit("publish")}>
            {initial ? "Save changes" : "Publish drop"}
          </Button>
        ) : (
          <>
            <Button
              type="button"
              variant="secondary"
              loading={submitting}
              onClick={() => void handleSubmit("draft")}
            >
              Save as draft
            </Button>
            <Button type="button" loading={submitting} onClick={() => void handleSubmit("autopost")}>
              Auto-post when approved
            </Button>
          </>
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
  onToggleActive,
  onPost,
}: {
  listing: ListingWithClub;
  busy: boolean;
  canPost: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
  onPost: () => void;
}) {
  const timeLeft = useCountdown(listing.expires_at);
  const held = listing.draft || listing.auto_post_on_brand;
  const status = listing.draft
    ? { variant: "neutral" as const, label: "Draft" }
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
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {canPost && (
          <Button size="sm" loading={busy} onClick={onPost}>
            Post now
          </Button>
        )}
        <Button variant="secondary" size="sm" onClick={onEdit}>
          Edit
        </Button>
        {!held && (
          <Button variant="ghost" size="sm" loading={busy} onClick={onToggleActive}>
            {listing.active ? "Deactivate" : "Reactivate"}
          </Button>
        )}
      </div>
    </div>
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
  const {
    listings,
    loading: listingsLoading,
    refetch,
  } = useListings({ clubId: user?.id, enabled: Boolean(user) });
  const reduceMotion = useReducedMotion();
  const brandOptions = useBrandOptions();

  // "create" opens an empty form; a listing id opens that listing for editing.
  const [formMode, setFormMode] = useState<"closed" | "create" | string>("closed");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [locations, setLocations] = useState<CampusLocation[]>([]);

  const userId = user?.id ?? null;
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

  const addLocation = (location: CampusLocation) => {
    setLocations((previous) =>
      [...previous, location].sort((a, b) => a.name.localeCompare(b.name)),
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
        </div>
      </div>
    );
  }

  const editingListing =
    formMode !== "closed" && formMode !== "create"
      ? (listings.find((listing) => listing.id === formMode) ?? null)
      : null;

  const brandApproved = (brandName: string) =>
    brandOptions.some((option) => option.toLowerCase() === brandName.trim().toLowerCase());

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
      toast.success("Draft published. It's live on the feed.");
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
      toast.success(listing.active ? "Listing deactivated" : "Listing reactivated");
      await refetch();
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
          <Button onClick={() => setFormMode("create")}>
            <Plus className="size-4" aria-hidden="true" />
            New listing
          </Button>
        )}
      </div>

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
      </div>

      <AnimatePresence mode="wait">
        {formMode !== "closed" && (
          <motion.div
            key={formMode}
            initial={reduceMotion ? false : { opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.1 } }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="mt-6"
          >
            <ListingForm
              club={club}
              initial={editingListing}
              locations={locations}
              onLocationAdded={addLocation}
              onSaved={() => {
                setFormMode("closed");
                void refetch();
              }}
              onCancel={() => setFormMode("closed")}
            />
          </motion.div>
        )}
      </AnimatePresence>

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
                canPost={listing.draft && brandApproved(listing.brand)}
                onEdit={() => setFormMode(listing.id)}
                onToggleActive={() => void toggleActive(listing)}
                onPost={() => void publishDraft(listing)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
