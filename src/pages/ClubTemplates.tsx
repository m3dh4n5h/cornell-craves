import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, LayoutTemplate, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import {
  ItemsEditor,
  parseItemDrafts,
  toItemDrafts,
  type ItemDraft,
} from "@/components/ItemsEditor";
import { TemplateCard } from "@/components/TemplateCard";
import { EmptyState } from "@/components/EmptyState";
import { LocationCombobox } from "@/components/LocationCombobox";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { DateTimeField } from "@/components/ui/datetime";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useBrandOptions } from "@/hooks/useBrands";
import { brandInList, useClubBrandStatus } from "@/hooks/useClubBrands";
import { formatMinutes, splitWindow } from "@/lib/pickup";
import { cn } from "@/lib/utils";
import type { CampusLocation, RecurringTemplate } from "@/types/database";

const FREQUENCIES = [
  { id: "weekly", label: "Weekly" },
  { id: "biweekly", label: "Every 2 weeks" },
  { id: "monthly", label: "Monthly" },
] as const;

function toDatetimeLocal(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours(),
  )}:${pad(date.getMinutes())}`;
}

function advanceDate(from: string | null, frequency: RecurringTemplate["frequency"]): string {
  const base = from ? new Date(`${from}T00:00:00`) : new Date();
  if (frequency === "weekly") base.setDate(base.getDate() + 7);
  else if (frequency === "biweekly") base.setDate(base.getDate() + 14);
  else base.setMonth(base.getMonth() + 1);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${base.getFullYear()}-${pad(base.getMonth() + 1)}-${pad(base.getDate())}`;
}

interface TemplateFormProps {
  clubId: string;
  initial: RecurringTemplate | null;
  onSaved: () => void;
  onCancel: () => void;
}

function TemplateForm({ clubId, initial, onSaved, onCancel }: TemplateFormProps) {
  // Merged list (built-ins + admin-deployed brands), same as the listing form.
  const templateBrandOptions = useBrandOptions();
  const [name, setName] = useState(initial?.name ?? "");
  const [brand, setBrand] = useState(initial?.brand ?? "");
  const [description, setDescription] = useState(initial?.description ?? "");
  const [items, setItems] = useState<ItemDraft[]>(toItemDrafts(initial?.items ?? null));
  const [mode, setMode] = useState<RecurringTemplate["mode"]>(initial?.mode ?? "one_time");
  const [frequency, setFrequency] = useState<RecurringTemplate["frequency"]>(initial?.frequency ?? "weekly");
  const [nextRunDate, setNextRunDate] = useState(initial?.next_run_date ?? "");
  // Fields a template picked up when it was saved from a listing (migration
  // 060). They are editable here so a template stays a living setup rather
  // than a snapshot the club has to re-save from the dashboard to change.
  const [contactEmail, setContactEmail] = useState(initial?.contact_email ?? "");
  const [causeName, setCauseName] = useState(initial?.cause_name ?? "");
  const [causePercent, setCausePercent] = useState(
    initial?.cause_percent != null ? String(initial.cause_percent) : "",
  );
  const [goalAmount, setGoalAmount] = useState(
    initial?.goal_amount != null ? String(initial.goal_amount) : "",
  );
  const [goalPublic, setGoalPublic] = useState(initial?.goal_public ?? false);
  const [recommenderEnabled, setRecommenderEnabled] = useState(initial?.recommender_enabled ?? false);
  const [sameDayEnabled, setSameDayEnabled] = useState(initial?.same_day_enabled ?? false);
  const [durationHours, setDurationHours] = useState(
    initial?.duration_hours != null ? String(initial.duration_hours) : "6",
  );
  // Pickup shape is set by "Save as template" on the listing form, where the
  // full editor lives. Here it is shown and can be cleared, which is the one
  // change that makes sense without rebuilding the whole spot/date tree.
  const [pickupConfig, setPickupConfig] = useState(initial?.pickup_config ?? []);
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const errors = {
    name: name.trim() ? undefined : "Name the template (it becomes the listing title).",
    brand: brand.trim() ? undefined : "Pick the brand.",
    items: parseItemDrafts(items).length > 0 ? undefined : "Add at least one item with a name.",
  };
  const hasErrors = Object.values(errors).some(Boolean);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setShowErrors(true);
    if (hasErrors) return;
    setSubmitting(true);
    const payload = {
      name: name.trim(),
      brand: brand.trim(),
      description: description.trim() || null,
      items: parseItemDrafts(items),
      mode,
      frequency,
      next_run_date: mode === "auto" ? nextRunDate || null : null,
      // Auto-recurring stays off until the club explicitly activates it.
      auto_active: initial?.auto_active ?? false,
      contact_email: contactEmail.trim() || null,
      cause_name: causeName.trim() || null,
      cause_percent: causeName.trim() ? Number.parseInt(causePercent, 10) || null : null,
      goal_amount: goalAmount.trim() ? Math.round(Number.parseFloat(goalAmount) * 100) / 100 : null,
      goal_public: goalPublic,
      recommender_enabled: recommenderEnabled,
      same_day_enabled: sameDayEnabled,
      duration_hours: Number.parseInt(durationHours, 10) || null,
      pickup_config: pickupConfig,
    };
    const { error } = initial
      ? await supabase.from("recurring_templates").update(payload).eq("id", initial.id)
      : await supabase.from("recurring_templates").insert({ ...payload, club_id: clubId });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(initial ? "Template updated" : "Template saved");
    onSaved();
  };

  return (
    <form onSubmit={submit} noValidate className="rounded-2xl border border-border bg-surface-raised p-5">
      <h2 className="text-lg font-bold">{initial ? "Edit template" : "New template"}</h2>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="template-name">Template name</Label>
          <Input
            id="template-name"
            value={name}
            invalid={showErrors && Boolean(errors.name)}
            onChange={(e) => setName(e.target.value)}
            placeholder="Friday dozen drop"
          />
          {showErrors && errors.name && (
            <p className="mt-1.5 text-xs font-medium text-accent" role="alert">
              {errors.name}
            </p>
          )}
        </div>
        <div>
          <Label htmlFor="template-brand">Brand</Label>
          <Combobox
            id="template-brand"
            value={brand}
            onChange={setBrand}
            options={templateBrandOptions}
            invalid={showErrors && Boolean(errors.brand)}
            placeholder="Krispy Kreme"
            emptyHint="Not in the list yet. New brands go through admin review when you post."
          />
          {showErrors && errors.brand && (
            <p className="mt-1.5 text-xs font-medium text-accent" role="alert">
              {errors.brand}
            </p>
          )}
        </div>
      </div>

      <div className="mt-5">
        <Label htmlFor="template-description">Description (optional)</Label>
        <Textarea
          id="template-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Carried over to every listing posted from this template."
        />
      </div>

      <div className="mt-5">
        <Label>Items and prices</Label>
        <ItemsEditor items={items} onChange={setItems} />
        {showErrors && errors.items && (
          <p className="mt-1.5 text-xs font-medium text-accent" role="alert">
            {errors.items}
          </p>
        )}
      </div>

      <div className="mt-5">
        <Label>How is it posted?</Label>
        <div className="mt-1.5 grid gap-2 sm:grid-cols-2">
          {(
            [
              { id: "one_time", title: "One-time", body: "You relaunch it by hand each time." },
              { id: "auto", title: "Auto-recurring", body: "Recurs on a schedule once you turn it on." },
            ] as const
          ).map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={mode === option.id}
              onClick={() => setMode(option.id)}
              className={cn(
                "rounded-xl border px-3 py-2.5 text-left transition-colors duration-150 [transition-timing-function:var(--ease-out)] active:scale-[0.98]",
                mode === option.id
                  ? "border-primary-dark bg-surface-raised"
                  : "border-border bg-surface-raised/60 hover-fine:border-primary",
              )}
            >
              <span className="block text-sm font-bold">{option.title}</span>
              <span className="block text-xs text-ink-muted">{option.body}</span>
            </button>
          ))}
        </div>
      </div>

      {mode === "auto" && (
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div>
            <Label>Frequency</Label>
            <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Frequency">
              {FREQUENCIES.map(({ id, label }) => (
                <button
                  key={id}
                  type="button"
                  role="radio"
                  aria-checked={frequency === id}
                  onClick={() => setFrequency(id)}
                  className={cn(
                    "rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors duration-150 [transition-timing-function:var(--ease-out)] active:scale-[0.97]",
                    frequency === id
                      ? "border-ink bg-ink text-surface-raised"
                      : "border-border text-ink-muted hover-fine:border-primary",
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div>
            <Label htmlFor="template-next-run">First run date (optional)</Label>
            <DateTimeField
              id="template-next-run"
              type="date"
              value={nextRunDate}
              onChange={(e) => setNextRunDate(e.target.value)}
            />
          </div>
        </div>
      )}

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="template-contact">Contact email (optional)</Label>
          <Input
            id="template-contact"
            type="email"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            placeholder="Leave blank to use your account setting"
          />
        </div>
        <div>
          <Label htmlFor="template-duration">Drop runs for (hours)</Label>
          <Input
            id="template-duration"
            value={durationHours}
            onChange={(e) => setDurationHours(e.target.value.replace(/[^\d]/g, ""))}
            inputMode="numeric"
            className="font-mono"
            placeholder="6"
          />
        </div>
      </div>

      <div className="mt-5 grid gap-5 sm:grid-cols-2">
        <div>
          <Label htmlFor="template-cause">Cause (optional)</Label>
          <div className="flex items-center gap-2">
            <Input
              id="template-cause"
              value={causeName}
              onChange={(e) => setCauseName(e.target.value)}
              placeholder="e.g. Ithaca Food Bank"
            />
            <Input
              value={causePercent}
              onChange={(e) => setCausePercent(e.target.value.replace(/[^\d]/g, ""))}
              inputMode="numeric"
              aria-label="Percent of earnings donated"
              className="w-20 font-mono"
              disabled={!causeName.trim()}
              placeholder="50"
            />
            <span className="shrink-0 text-sm text-ink-muted">%</span>
          </div>
        </div>
        <div>
          <Label htmlFor="template-goal">Fundraising goal (optional)</Label>
          <Input
            id="template-goal"
            value={goalAmount}
            onChange={(e) => setGoalAmount(e.target.value.replace(/[^\d.]/g, ""))}
            inputMode="decimal"
            className="font-mono"
            placeholder="800"
          />
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={goalPublic}
              onChange={(e) => setGoalPublic(e.target.checked)}
              disabled={!goalAmount.trim()}
              className="size-4 accent-(--color-primary-dark) disabled:opacity-50"
            />
            Show the progress bar to students
          </label>
        </div>
      </div>

      <div className="mt-5 space-y-2.5">
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={recommenderEnabled}
            onChange={(e) => setRecommenderEnabled(e.target.checked)}
            className="mt-0.5 size-5 shrink-0 accent-(--color-primary-dark)"
          />
          <span className="text-sm">Ask "which member recommended you?" on the order form</span>
        </label>
        <label className="flex cursor-pointer items-start gap-3">
          <input
            type="checkbox"
            checked={sameDayEnabled}
            onChange={(e) => setSameDayEnabled(e.target.checked)}
            className="mt-0.5 size-5 shrink-0 accent-(--color-primary-dark)"
          />
          <span className="text-sm">Sell at the table on the day (same-day stock)</span>
        </label>
      </div>

      {pickupConfig.length > 0 && (
        <div className="mt-5 rounded-xl border border-border/70 bg-surface p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">
            Saved pickup setup
          </p>
          <ul className="mt-1.5 space-y-1">
            {pickupConfig.map((spot, index) => (
              <li key={`${spot.location_id}-${index}`} className="text-xs text-ink-muted">
                {(spot.windows ?? []).length} {(spot.windows ?? []).length === 1 ? "date" : "dates"}
                {" at one spot: "}
                {(spot.windows ?? [])
                  .map(
                    (window) =>
                      `day ${window.day_offset + 1}, ${formatMinutes(window.start_minutes)} to ${formatMinutes(window.end_minutes)}`,
                  )
                  .join("; ")}
              </li>
            ))}
          </ul>
          <p className="mt-1.5 text-[11px] text-ink-muted">
            Spots and dates are set by "Save as template" on the listing form, where the full
            editor lives. Posting from this template asks for the first pickup day.
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-1.5 text-ink-muted"
            onClick={() => setPickupConfig([])}
          >
            Clear saved pickup
          </Button>
        </div>
      )}

      <div className="mt-6 flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" loading={submitting}>
          {initial ? "Save changes" : "Save template"}
        </Button>
      </div>
    </form>
  );
}

interface PostPanelProps {
  template: RecurringTemplate;
  locations: CampusLocation[];
  onPosted: () => void;
  onCancel: () => void;
}

function PostPanel({ template, locations, onPosted, onCancel }: PostPanelProps) {
  // Everything auto-fills from the template; the club confirms the date/time and
  // can edit any field before it posts (build spec 5 #8).
  const [title, setTitle] = useState(template.name);
  const [brand, setBrand] = useState(template.brand);
  const [description, setDescription] = useState(template.description ?? "");
  const [items, setItems] = useState<ItemDraft[]>(toItemDrafts(template.items));
  const [expiresAt, setExpiresAt] = useState(
    toDatetimeLocal(new Date(Date.now() + (template.duration_hours ?? 6) * 3_600_000)),
  );
  const [locationId, setLocationId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // A template saved from a listing carries its pickup SHAPE, not dates
  // (migration 060). The club names the first pickup day here and the shape is
  // rebuilt against it, so a template made in June still posts June-relative
  // pickups in October rather than resurrecting June's calendar.
  const pickupConfig = template.pickup_config ?? [];
  const [firstPickupDate, setFirstPickupDate] = useState(() => {
    const tomorrow = new Date(Date.now() + 86_400_000);
    const pad = (value: number) => String(value).padStart(2, "0");
    return `${tomorrow.getFullYear()}-${pad(tomorrow.getMonth() + 1)}-${pad(tomorrow.getDate())}`;
  });

  // Same publish gate as the dashboard form: global brands plus this club's
  // one-time approvals. Unapproved brands are held instead of silently posted
  // (the launch path used to skip the gate entirely - the database now also
  // blocks it, so we hold the listing and file the request up front).
  const brandOptions = useBrandOptions();
  const { approvedForClub } = useClubBrandStatus(template.club_id);
  const trimmedBrand = brand.trim();
  const isPostable =
    brandOptions.some((option) => option.toLowerCase() === trimmedBrand.toLowerCase()) ||
    brandInList(trimmedBrand, approvedForClub);

  /**
   * Turn the template's pickup shape into real rows on the new listing.
   *
   * Offsets become dates against `firstPickupDate`, and minutes-past-midnight
   * become local times. Windows that ration pickup materialise their slots
   * exactly as the listing form does, so a template that had 20-minute slots
   * posts with 20-minute slots and not an empty schedule.
   */
  const rebuildPickup = async (listingId: string): Promise<string | null> => {
    for (const spot of pickupConfig) {
      const { data: spotRow, error: spotError } = await supabase
        .from("listing_pickup_spots")
        .insert({
          listing_id: listingId,
          location_id: spot.location_id,
          order_type: spot.order_type,
        })
        .select("id")
        .single();
      if (spotError || !spotRow) return spotError?.message ?? "Could not create a pickup spot";

      for (const window of spot.windows ?? []) {
        const day = new Date(`${firstPickupDate}T12:00:00`);
        day.setDate(day.getDate() + window.day_offset);
        const pad = (value: number) => String(value).padStart(2, "0");
        const dateOnly = `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
        const at = (minutes: number) =>
          new Date(
            `${dateOnly}T${pad(Math.floor(minutes / 60))}:${pad(minutes % 60)}`,
          ).toISOString();
        const startIso = at(window.start_minutes);
        const endIso = at(window.end_minutes);

        const { data: windowRow, error: windowError } = await supabase
          .from("listing_pickup_windows")
          .insert({
            listing_id: listingId,
            spot_id: spotRow.id,
            start_time: startIso,
            end_time: endIso,
            slot_mode: window.slot_mode,
            capacity: window.slot_mode === "capacity" ? window.capacity : null,
            split_minutes: window.slot_mode === "split" ? window.split_minutes : null,
            note: window.note,
          })
          .select("id")
          .single();
        if (windowError || !windowRow) return windowError?.message ?? "Could not create a pickup date";

        if (window.slot_mode === "capacity" && window.capacity) {
          const { error } = await supabase.from("pickup_slots").insert({
            listing_id: listingId,
            window_id: windowRow.id,
            start_time: startIso,
            end_time: endIso,
            max_reservations: window.capacity,
            location_id: spot.location_id,
          });
          if (error) return error.message;
        }
        if (window.slot_mode === "split" && window.split_minutes) {
          const pieces = splitWindow(window.start_minutes, window.end_minutes, window.split_minutes);
          const { error } = await supabase.from("pickup_slots").insert(
            pieces.map((piece) => ({
              listing_id: listingId,
              window_id: windowRow.id,
              start_time: at(piece.startMinutes),
              end_time: at(piece.endMinutes),
              // The template records the interval, not each slot's capacity.
              // 10 is the listing form's own default, and the club edits the
              // drop if it wants different numbers.
              max_reservations: 10,
              location_id: spot.location_id,
            })),
          );
          if (error) return error.message;
        }
      }

      if (template.same_day_enabled && (spot.same_day_stock ?? []).length > 0) {
        const { error } = await supabase.from("listing_same_day_stock").insert(
          spot.same_day_stock.map((row) => ({
            listing_id: listingId,
            spot_id: spotRow.id,
            item_name: row.item_name,
            quantity: row.quantity,
          })),
        );
        if (error) return error.message;
      }
    }
    return null;
  };

  const post = async (event: FormEvent) => {
    event.preventDefault();
    if (!title.trim() || !brand.trim() || parseItemDrafts(items).length === 0) {
      toast.error("Title, brand, and at least one item are required.");
      return;
    }
    if (!expiresAt || new Date(expiresAt).getTime() <= Date.now()) {
      toast.error("Pick an end time in the future.");
      return;
    }
    setSubmitting(true);
    const { data: created, error } = await supabase
      .from("listings")
      .insert({
        club_id: template.club_id,
        brand: brand.trim(),
        title: title.trim(),
        description: description.trim() || null,
        items: parseItemDrafts(items),
        pickup_location_id: locationId || pickupConfig[0]?.location_id || null,
        contact_email: template.contact_email,
        recommender_enabled: template.recommender_enabled,
        same_day_enabled: template.same_day_enabled,
        cause_name: template.cause_name,
        cause_percent: template.cause_percent,
        expires_at: new Date(expiresAt).toISOString(),
        active: isPostable,
        draft: !isPostable,
      })
      .select("id")
      .single();
    if (error || !created) {
      setSubmitting(false);
      toast.error(error?.message ?? "Could not create the listing");
      return;
    }
    const pickupError = await rebuildPickup(created.id);
    if (pickupError) {
      setSubmitting(false);
      toast.error(`Drop created, but its pickup dates failed: ${pickupError}`);
      onPosted();
      return;
    }
    if (template.goal_amount != null) {
      await supabase.from("listing_goals").upsert(
        {
          listing_id: created.id,
          goal_amount: template.goal_amount,
          goal_public: template.goal_public,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "listing_id" },
      );
    }
    if (!isPostable) {
      await supabase.rpc("request_brand", { p_name: brand.trim() }).then(
        () => {},
        () => {},
      );
    }
    if (template.mode === "auto") {
      await supabase
        .from("recurring_templates")
        .update({ next_run_date: advanceDate(template.next_run_date, template.frequency) })
        .eq("id", template.id);
    }
    setSubmitting(false);
    if (isPostable) {
      toast.success(`"${title.trim()}" is live on the feed`);
    } else {
      toast.info(
        `"${trimmedBrand}" needs admin approval first. Saved as a draft on your dashboard and the request is filed.`,
      );
    }
    onPosted();
  };

  return (
    <form onSubmit={post} className="rounded-2xl border border-primary-dark/40 bg-primary/10 p-4">
      <h3 className="text-base font-bold">Post from "{template.name}"</h3>
      <p className="mt-1 text-xs text-ink-muted">
        Pre-filled from your template. Set the date and time, tweak anything, then publish.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="post-title">Title</Label>
          <Input id="post-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="post-brand">Brand</Label>
          <Combobox
            id="post-brand"
            value={brand}
            onChange={setBrand}
            options={brandOptions}
            emptyHint="Not in the list yet. Unapproved brands save as a draft for admin review."
          />
        </div>
      </div>
      <div className="mt-4">
        <Label htmlFor="post-description">Description (optional)</Label>
        <Textarea
          id="post-description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <div className="mt-4">
        <Label>Items and prices</Label>
        <ItemsEditor items={items} onChange={setItems} />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="post-expires">Ends at (date &amp; time)</Label>
          <DateTimeField
            id="post-expires"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
          />
        </div>
        <div>
          {pickupConfig.length > 0 ? (
            <>
              <Label htmlFor="post-first-day">First pickup day</Label>
              <DateTimeField
                id="post-first-day"
                type="date"
                value={firstPickupDate}
                onChange={(e) => setFirstPickupDate(e.target.value)}
              />
            </>
          ) : (
            <>
              <Label htmlFor="post-location">Pickup location (optional)</Label>
              <LocationCombobox
                id="post-location"
                locationId={locationId}
                locations={locations}
                onChange={setLocationId}
                placeholder="No map pin"
              />
            </>
          )}
        </div>
      </div>

      {pickupConfig.length > 0 && (
        <div className="mt-4 rounded-xl border border-border/70 bg-surface p-3">
          <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">
            Pickup from this template
          </p>
          <ul className="mt-1.5 space-y-1">
            {pickupConfig.map((spot, spotIndex) => {
              const name =
                locations.find((location) => location.id === spot.location_id)?.name ??
                "A pickup spot";
              return (
                <li key={`${spot.location_id}-${spotIndex}`} className="text-xs text-ink-muted">
                  <span className="font-semibold text-ink">{name}</span>
                  {": "}
                  {(spot.windows ?? [])
                    .map(
                      (window) =>
                        `day ${window.day_offset + 1}, ${formatMinutes(window.start_minutes)} to ${formatMinutes(window.end_minutes)}`,
                    )
                    .join("; ") || "no dates saved"}
                </li>
              );
            })}
          </ul>
          <p className="mt-1.5 text-[11px] text-ink-muted">
            Day 1 is the date above. You can change any of it on the drop once it is posted.
          </p>
        </div>
      )}
      {trimmedBrand.length >= 2 && !isPostable && (
        <p className="mt-4 rounded-xl bg-primary/15 p-3 text-xs text-ink">
          "{trimmedBrand}" isn't approved yet, so this saves as a draft on your dashboard and files
          the brand request for admin review.
        </p>
      )}
      <div className="mt-4 flex justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={submitting}>
          {isPostable ? "Publish drop" : "Save & request brand"}
        </Button>
      </div>
    </form>
  );
}

export default function ClubTemplates() {
  const { clubId } = useParams<{ clubId: string }>();
  const { user, loading: authLoading } = useAuth();
  const reduceMotion = useReducedMotion();
  const [templates, setTemplates] = useState<RecurringTemplate[]>([]);
  const [locations, setLocations] = useState<CampusLocation[]>([]);
  const [loading, setLoading] = useState(true);
  const [formMode, setFormMode] = useState<"closed" | "create" | string>("closed");
  const [postingId, setPostingId] = useState<string | null>(null);

  const userId = user?.id ?? null;

  const refetch = useCallback(async () => {
    if (!userId) return;
    const [templatesResult, locationsResult] = await Promise.all([
      supabase
        .from("recurring_templates")
        .select("*")
        .eq("club_id", userId)
        .order("created_at", { ascending: false })
        .returns<RecurringTemplate[]>(),
      supabase
        .from("campus_locations")
        .select("*")
        .or(`created_by.is.null,created_by.eq.${userId}`)
        .order("name"),
    ]);
    if (templatesResult.error) {
      toast.error(templatesResult.error.message);
    } else {
      setTemplates(templatesResult.data ?? []);
    }
    setLocations(locationsResult.data ?? []);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (userId && clubId === userId) void refetch();
  }, [userId, clubId, refetch]);

  if (authLoading) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-10" aria-busy="true" aria-label="Loading templates">
        <div className="h-9 w-48 animate-pulse rounded-xl bg-border/70" />
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 2 }, (_, index) => (
            <div key={index} className="h-44 animate-pulse rounded-2xl bg-border/40" />
          ))}
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (clubId !== user.id) return <Navigate to={`/club/${user.id}/templates`} replace />;

  const editingTemplate =
    formMode !== "closed" && formMode !== "create"
      ? (templates.find((template) => template.id === formMode) ?? null)
      : null;

  const toggleActive = async (template: RecurringTemplate) => {
    const { error } = await supabase
      .from("recurring_templates")
      .update({ is_active: !template.is_active })
      .eq("id", template.id);
    if (error) {
      toast.error(error.message);
    } else {
      toast.success(template.is_active ? "Template paused" : "Template resumed");
      await refetch();
    }
  };

  // Explicitly turn auto-recurring on/off. Turning it on also opens the post
  // flow so the club sets the first run's date/time right away (build spec 5 #8).
  const toggleAuto = async (template: RecurringTemplate) => {
    const next = !template.auto_active;
    const { error } = await supabase
      .from("recurring_templates")
      .update({ auto_active: next })
      .eq("id", template.id);
    if (error) {
      toast.error(error.message);
      return;
    }
    await refetch();
    if (next) {
      toast.success("Auto-posting on. Schedule the first drop below.");
      setPostingId(template.id);
    } else {
      toast.success("Auto-posting off.");
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10">
      <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover-fine:text-ink">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Dashboard
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Templates</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Save a fundraiser once, then relaunch it in seconds, by hand or on a schedule.
          </p>
        </div>
        {formMode === "closed" && (
          <Button onClick={() => setFormMode("create")}>
            <Plus className="size-4" aria-hidden="true" />
            New template
          </Button>
        )}
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
            <TemplateForm
              clubId={user.id}
              initial={editingTemplate}
              onSaved={() => {
                setFormMode("closed");
                void refetch();
              }}
              onCancel={() => setFormMode("closed")}
            />
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="mt-6 grid gap-3 sm:grid-cols-2" aria-busy="true">
          {Array.from({ length: 2 }, (_, index) => (
            <div key={index} className="h-44 animate-pulse rounded-2xl bg-border/40" />
          ))}
        </div>
      ) : templates.length === 0 && formMode === "closed" ? (
        <div className="mt-8">
          <EmptyState
            icon={<LayoutTemplate className="size-6" aria-hidden="true" />}
            title="No templates yet"
            body="If you run the same fundraiser every week, save it as a template and skip the form next time."
            actionLabel="Create your first template"
            onAction={() => setFormMode("create")}
          />
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          <AnimatePresence>
            {postingId && (
              <motion.div
                initial={reduceMotion ? false : { opacity: 0, scale: 0.97 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.1 } }}
                transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
              >
                <PostPanel
                  template={templates.find((template) => template.id === postingId)!}
                  locations={locations}
                  onPosted={() => {
                    setPostingId(null);
                    void refetch();
                  }}
                  onCancel={() => setPostingId(null)}
                />
              </motion.div>
            )}
          </AnimatePresence>
          <div className="grid gap-3 sm:grid-cols-2">
            {templates.map((template) => (
              <TemplateCard
                key={template.id}
                template={template}
                busy={false}
                onPost={() => setPostingId(template.id)}
                onEdit={() => setFormMode(template.id)}
                onToggleActive={() => void toggleActive(template)}
                onToggleAuto={() => void toggleAuto(template)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
