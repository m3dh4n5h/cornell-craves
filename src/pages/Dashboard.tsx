import { useEffect, useState, type FormEvent } from "react";
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
import { BRANDS } from "@/lib/brands";
import { formatExpiry } from "@/lib/format";
import type { CampusLocation, Club, ListingWithClub, PickupSlot } from "@/types/database";

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
}

function slotDraftValid(draft: SlotDraft): boolean {
  if (!draft.start || !draft.end) return false;
  if (new Date(draft.end).getTime() <= new Date(draft.start).getTime()) return false;
  const max = Number.parseInt(draft.max, 10);
  return Number.isFinite(max) && max >= 1 && max >= draft.reserved;
}

function SlotsEditor({
  slots,
  onChange,
}: {
  slots: SlotDraft[];
  onChange: (slots: SlotDraft[]) => void;
}) {
  const update = (index: number, patch: Partial<SlotDraft>) => {
    onChange(slots.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)));
  };

  const addSlot = () => {
    const base = new Date(Date.now() + 24 * 3_600_000);
    base.setMinutes(0, 0, 0);
    const end = new Date(base.getTime() + 3_600_000);
    onChange([...slots, { start: toDatetimeLocal(base), end: toDatetimeLocal(end), max: "10", reserved: 0 }]);
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
          <div className="min-w-40 flex-1">
            <Label htmlFor={`slot-start-${index}`} className="mb-1 text-xs">
              Starts
            </Label>
            <Input
              id={`slot-start-${index}`}
              type="datetime-local"
              value={slot.start}
              onChange={(e) => update(index, { start: e.target.value })}
              className="h-10"
            />
          </div>
          <div className="min-w-40 flex-1">
            <Label htmlFor={`slot-end-${index}`} className="mb-1 text-xs">
              Ends
            </Label>
            <Input
              id={`slot-end-${index}`}
              type="datetime-local"
              value={slot.end}
              onChange={(e) => update(index, { end: e.target.value })}
              className="h-10"
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

interface ListingFormProps {
  club: Club;
  initial: ListingWithClub | null;
  locations: CampusLocation[];
  onSaved: () => void;
  onCancel: () => void;
}

function ListingForm({ club, initial, locations, onSaved, onCancel }: ListingFormProps) {
  const [brand, setBrand] = useState(initial?.brand ?? "");
  const [title, setTitle] = useState(initial?.title ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [items, setItems] = useState<ItemDraft[]>(toItemDrafts(initial?.items ?? null));
  const [pickupInfo, setPickupInfo] = useState(initial?.pickup_info ?? "");
  const [locationId, setLocationId] = useState(initial?.pickup_location_id ?? "");
  const [expiresAt, setExpiresAt] = useState(
    initial
      ? toDatetimeLocal(new Date(initial.expires_at))
      : toDatetimeLocal(new Date(Date.now() + 6 * 3_600_000)),
  );
  const [slots, setSlots] = useState<SlotDraft[]>([]);
  const [originalSlots, setOriginalSlots] = useState<PickupSlot[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);

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
  };
  const hasErrors = Object.values(errors).some(Boolean);

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
      };
      const { error } = draft.id
        ? await supabase.from("pickup_slots").update(payload).eq("id", draft.id)
        : await supabase.from("pickup_slots").insert(payload);
      if (error) return error.message;
    }
    return null;
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setShowErrors(true);
    if (hasErrors) return;

    setSubmitting(true);
    const payload = {
      brand: brand.trim(),
      title: title.trim(),
      description: description.trim() || null,
      items: parseItemDrafts(items),
      pickup_info: pickupInfo.trim() || null,
      pickup_location_id: locationId || null,
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

    const slotError = listingId ? await syncSlots(listingId) : null;
    setSubmitting(false);
    if (slotError) {
      toast.error(`Listing saved, but slots failed: ${slotError}`);
    } else {
      toast.success(initial ? "Listing updated" : "Your drop is live");
    }
    onSaved();
  };

  return (
    <form
      onSubmit={handleSubmit}
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
            {BRANDS.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
          <FieldError message={showErrors ? errors.brand : undefined} />
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
        <Label>Items, prices, dietary tags</Label>
        <ItemsEditor items={items} onChange={setItems} />
        <FieldError message={showErrors ? errors.items : undefined} />
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="pickup-location">Pickup spot (shows on the map)</Label>
          <select
            id="pickup-location"
            value={locationId}
            onChange={(e) => setLocationId(e.target.value)}
            className="h-11 w-full rounded-xl border border-border bg-surface-raised px-3 text-base text-ink focus-visible:border-primary-dark focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary/40"
          >
            <option value="">No map pin</option>
            {locations.map((location) => (
              <option key={location.id} value={location.id}>
                {location.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label htmlFor="pickup">Pickup details (optional)</Label>
          <Input
            id="pickup"
            value={pickupInfo}
            onChange={(e) => setPickupInfo(e.target.value)}
            placeholder="Duffield atrium, 5 to 8 pm"
          />
        </div>
      </div>

      <div className="mt-5">
        <Label>Pickup slots</Label>
        <SlotsEditor slots={slots} onChange={setSlots} />
        <FieldError message={showErrors ? errors.slots : undefined} />
      </div>

      <div className="mt-6 flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={submitting}>
          {initial ? "Save changes" : "Publish drop"}
        </Button>
      </div>
    </form>
  );
}

function ListingRow({
  listing,
  busy,
  onEdit,
  onToggleActive,
}: {
  listing: ListingWithClub;
  busy: boolean;
  onEdit: () => void;
  onToggleActive: () => void;
}) {
  const timeLeft = useCountdown(listing.expires_at);
  const status = timeLeft.expired
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
        <Button variant="secondary" size="sm" onClick={onEdit}>
          Edit
        </Button>
        <Button variant="ghost" size="sm" loading={busy} onClick={onToggleActive}>
          {listing.active ? "Deactivate" : "Reactivate"}
        </Button>
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

  // "create" opens an empty form; a listing id opens that listing for editing.
  const [formMode, setFormMode] = useState<"closed" | "create" | string>("closed");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [locations, setLocations] = useState<CampusLocation[]>([]);

  useEffect(() => {
    let cancelled = false;
    void supabase
      .from("campus_locations")
      .select("*")
      .order("name")
      .then(({ data }) => {
        if (!cancelled) setLocations(data ?? []);
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
                onEdit={() => setFormMode(listing.id)}
                onToggleActive={() => void toggleActive(listing)}
              />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
