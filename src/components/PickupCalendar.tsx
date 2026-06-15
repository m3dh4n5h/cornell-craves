import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CalendarX2, Check, Minus, Plus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { getSavedEmail, setSavedEmail } from "@/lib/local";
import { EmptyState } from "@/components/EmptyState";
import { GoogleButton } from "@/components/GoogleButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { ListingWithClub, PickupSlot } from "@/types/database";

/** A slot with its per-day pickup location embedded (build spec 5 #5). */
type SlotRow = PickupSlot & { campus_locations: { name: string } | null };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function dayKey(iso: string): string {
  return new Date(iso).toDateString();
}

function formatDay(iso: string): { weekday: string; date: string } {
  const date = new Date(iso);
  return {
    weekday: date.toLocaleDateString("en-US", { weekday: "short" }),
    date: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
  };
}

function formatTimeRange(slot: PickupSlot): string {
  // All times render in the viewer's browser timezone.
  const options: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  const start = new Date(slot.start_time).toLocaleTimeString("en-US", options);
  const end = new Date(slot.end_time).toLocaleTimeString("en-US", options);
  return `${start} to ${end}`;
}

interface PickupCalendarProps {
  listing: ListingWithClub;
}

export function PickupCalendar({ listing }: PickupCalendarProps) {
  const reduceMotion = useReducedMotion();
  const { user, isGoogleUser } = useAuth();
  const [slots, setSlots] = useState<SlotRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedSlotId, setSelectedSlotId] = useState<string | null>(null);

  const { profile } = useProfile();
  const [name, setName] = useState("");
  const [email, setEmail] = useState(getSavedEmail);
  const [emailHydrated, setEmailHydrated] = useState(false);
  const [quantity, setQuantity] = useState(1);

  // Signed-in students reserve under their account email so /reservations
  // finds everything without a lookup.
  useEffect(() => {
    if (emailHydrated || !profile) return;
    if (profile.cornell_email) setEmail(profile.cornell_email);
    const fullName = `${profile.first_name} ${profile.last_name}`.trim();
    if (fullName) setName((previous) => previous || fullName);
    setEmailHydrated(true);
  }, [profile, emailHydrated]);
  const [dietaryNotes, setDietaryNotes] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reserved, setReserved] = useState<SlotRow | null>(null);

  const refetch = useCallback(async () => {
    const { data, error } = await supabase
      .from("pickup_slots")
      .select("*, campus_locations(name)")
      .eq("listing_id", listing.id)
      .gt("end_time", new Date().toISOString())
      .order("start_time", { ascending: true })
      .returns<SlotRow[]>();
    if (error) {
      toast.error("Could not load pickup slots");
    } else {
      setSlots(data ?? []);
    }
    setLoading(false);
  }, [listing.id]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  const days = useMemo(() => {
    const seen = new Map<string, string>();
    for (const slot of slots) {
      const key = dayKey(slot.start_time);
      if (!seen.has(key)) seen.set(key, slot.start_time);
    }
    return [...seen.entries()].map(([key, iso]) => ({ key, iso }));
  }, [slots]);

  const activeDay = selectedDay ?? days[0]?.key ?? null;
  const daySlots = slots.filter((slot) => dayKey(slot.start_time) === activeDay);
  const selectedSlot = slots.find((slot) => slot.id === selectedSlotId) ?? null;

  const nameError = name.trim().length >= 2 ? undefined : "Enter your name.";
  const emailError = EMAIL_PATTERN.test(email.trim()) ? undefined : "Enter a valid email address.";

  const reserve = async (event: FormEvent) => {
    event.preventDefault();
    if (!selectedSlot) return;
    setShowErrors(true);
    if (nameError || emailError) return;

    setSubmitting(true);
    const { error } = await supabase.rpc("create_reservation", {
      p_slot_id: selectedSlot.id,
      p_email: email.trim().toLowerCase(),
      p_name: name.trim(),
      p_quantity: quantity,
      p_dietary_notes: dietaryNotes.trim() || null,
    });
    setSubmitting(false);

    if (error) {
      toast.error(error.message);
      return;
    }
    setSavedEmail(email);
    setReserved(selectedSlot);
    setSlots((previous) =>
      previous.map((slot) =>
        slot.id === selectedSlot.id ? { ...slot, reserved_count: slot.reserved_count + 1 } : slot,
      ),
    );
    toast.success("Pickup reserved");
  };

  if (loading) {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Loading pickup schedule">
        <div className="flex gap-2">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="h-16 w-20 animate-pulse rounded-2xl bg-border/40" />
          ))}
        </div>
        <div className="h-32 animate-pulse rounded-2xl bg-border/40" />
      </div>
    );
  }

  if (slots.length > 0 && (!user || !isGoogleUser)) {
    return (
      <div className="rounded-2xl border border-border bg-surface-raised p-6 text-center">
        <h3 className="text-base font-bold">Sign in to reserve a pickup</h3>
        <p className="mt-1.5 text-sm text-ink-muted">
          Reserving a slot takes a Google account so the club knows who is coming and can
          email you a reminder.
        </p>
        <div className="mx-auto mt-4 max-w-xs">
          <GoogleButton label="Sign in to reserve" redirectPath={`/listing/${listing.id}/schedule`} />
        </div>
      </div>
    );
  }

  if (slots.length === 0) {
    return (
      <EmptyState
        icon={<CalendarX2 className="size-6" aria-hidden="true" />}
        title="No pickup scheduling for this drop"
        body="This club has not set pickup slots. Check the pickup info on the listing and just show up."
      />
    );
  }

  if (reserved) {
    return (
      <motion.div
        initial={reduceMotion ? false : { opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
        className="rounded-2xl border border-border bg-surface-raised p-6 text-center"
      >
        <div className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-tag-green">
          <Check className="size-6 text-ink" aria-hidden="true" />
        </div>
        <h3 className="mt-4 text-xl font-extrabold">Pickup reserved</h3>
        <p className="mt-2 text-sm text-ink-muted">
          {formatDay(reserved.start_time).weekday} {formatDay(reserved.start_time).date},{" "}
          {formatTimeRange(reserved)}
          {reserved.campus_locations?.name ? ` at ${reserved.campus_locations.name}` : ""}. A
          confirmation email is on its way to {email.trim().toLowerCase()}.
        </p>
        <p className="mt-2 text-sm text-ink-muted">
          Manage it anytime under{" "}
          <a href="/reservations" className="font-semibold text-primary-dark underline-offset-2 hover-fine:underline">
            My pickups
          </a>
          .
        </p>
      </motion.div>
    );
  }

  return (
    <div>
      {/* Inline day strip, no modal. */}
      <div
        className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
        role="radiogroup"
        aria-label="Pickup day"
      >
        {days.map(({ key, iso }) => {
          const { weekday, date } = formatDay(iso);
          const isActive = key === activeDay;
          return (
            <button
              key={key}
              type="button"
              role="radio"
              aria-checked={isActive}
              onClick={() => {
                setSelectedDay(key);
                setSelectedSlotId(null);
              }}
              className={cn(
                "flex shrink-0 flex-col items-center rounded-2xl border px-4 py-2 transition-colors duration-150 [transition-timing-function:var(--ease-out)] active:scale-[0.97]",
                isActive
                  ? "border-ink bg-ink text-surface-raised"
                  : "border-border bg-surface-raised hover-fine:border-primary",
              )}
            >
              <span className="text-xs font-semibold uppercase tracking-wide opacity-80">{weekday}</span>
              <span className="text-sm font-bold">{date}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-4 grid gap-2 sm:grid-cols-2">
        {daySlots.map((slot) => {
          const spotsLeft = slot.max_reservations - slot.reserved_count;
          const full = spotsLeft <= 0;
          const started = new Date(slot.start_time).getTime() <= Date.now();
          const isSelected = slot.id === selectedSlotId;
          return (
            <button
              key={slot.id}
              type="button"
              disabled={full || started}
              aria-pressed={isSelected}
              onClick={() => setSelectedSlotId(isSelected ? null : slot.id)}
              className={cn(
                "flex items-center justify-between gap-3 rounded-2xl border p-3.5 text-left transition-colors duration-150 [transition-timing-function:var(--ease-out)] active:scale-[0.98] disabled:pointer-events-none disabled:opacity-45",
                isSelected
                  ? "border-primary-dark bg-primary/15"
                  : "border-border bg-surface-raised hover-fine:border-primary",
              )}
            >
              <span className="min-w-0">
                <span className="block text-sm font-bold">{formatTimeRange(slot)}</span>
                {slot.campus_locations?.name && (
                  <span className="block truncate text-xs text-ink-muted">
                    {slot.campus_locations.name}
                  </span>
                )}
              </span>
              <span className={cn("shrink-0 text-xs font-semibold", full ? "text-accent" : "text-ink-muted")}>
                {full ? "Full" : started ? "Started" : `${spotsLeft} of ${slot.max_reservations} left`}
              </span>
            </button>
          );
        })}
      </div>

      {selectedSlot && (
        <motion.form
          onSubmit={reserve}
          noValidate
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.25, ease: [0.23, 1, 0.32, 1] }}
          className="mt-4 rounded-2xl border border-border bg-surface-raised p-4"
        >
          <h3 className="text-base font-bold">
            Reserve {formatTimeRange(selectedSlot)}
            {selectedSlot.campus_locations?.name && (
              <span className="font-normal text-ink-muted"> at {selectedSlot.campus_locations.name}</span>
            )}
          </h3>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="reserve-name">Name</Label>
              <Input
                id="reserve-name"
                value={name}
                invalid={showErrors && Boolean(nameError)}
                onChange={(e) => setName(e.target.value)}
                placeholder="Your name"
                autoComplete="name"
              />
              {showErrors && nameError && (
                <p className="mt-1.5 text-xs font-medium text-accent" role="alert">
                  {nameError}
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="reserve-email">Email</Label>
              <Input
                id="reserve-email"
                type="email"
                value={email}
                invalid={showErrors && Boolean(emailError)}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="netid@cornell.edu"
                autoComplete="email"
              />
              {showErrors && emailError && (
                <p className="mt-1.5 text-xs font-medium text-accent" role="alert">
                  {emailError}
                </p>
              )}
            </div>
          </div>

          <div className="mt-4">
            <Label htmlFor="reserve-quantity">How many items are you grabbing?</Label>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                aria-label="Decrease quantity"
                disabled={quantity <= 1}
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                className="px-3"
              >
                <Minus className="size-4" aria-hidden="true" />
              </Button>
              <span id="reserve-quantity" className="w-8 text-center font-mono text-lg font-bold" aria-live="polite">
                {quantity}
              </span>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                aria-label="Increase quantity"
                disabled={quantity >= 20}
                onClick={() => setQuantity((q) => Math.min(20, q + 1))}
                className="px-3"
              >
                <Plus className="size-4" aria-hidden="true" />
              </Button>
            </div>
          </div>

          <div className="mt-4">
            <Label htmlFor="reserve-notes">Dietary notes (optional)</Label>
            <Textarea
              id="reserve-notes"
              value={dietaryNotes}
              onChange={(e) => setDietaryNotes(e.target.value)}
              placeholder="Allergies or requests the club should know about"
              maxLength={300}
              className="min-h-16"
            />
          </div>

          <Button type="submit" size="lg" className="mt-5 w-full" loading={submitting}>
            Reserve this slot
          </Button>
          <p className="mt-2 text-center text-xs text-ink-muted">
            Free to reserve. Pay {listing.clubs?.name ?? "the club"} at pickup or via Venmo ahead of time.
          </p>
        </motion.form>
      )}
    </div>
  );
}
