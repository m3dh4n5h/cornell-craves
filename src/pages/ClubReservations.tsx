import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowLeft, BellRing, Download, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PickupSlot, Reservation } from "@/types/database";

type ListingLite = { id: string; title: string; brand: string; active: boolean };

interface SlotGroup {
  slot: PickupSlot;
  reservations: Reservation[];
}

interface ListingGroup {
  listing: ListingLite;
  slots: SlotGroup[];
}

function formatSlotTime(slot: PickupSlot): string {
  const start = new Date(slot.start_time);
  const end = new Date(slot.end_time);
  const day = start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const timeOptions: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  return `${day}, ${start.toLocaleTimeString("en-US", timeOptions)} to ${end.toLocaleTimeString("en-US", timeOptions)}`;
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function exportCsv(group: ListingGroup): void {
  const header = "name,email,quantity,dietary_notes,confirmed,attended,slot_start,slot_end";
  const rows = group.slots.flatMap(({ slot, reservations }) =>
    reservations.map((reservation) =>
      [
        csvEscape(reservation.user_name),
        csvEscape(reservation.user_email),
        String(reservation.quantity),
        csvEscape(reservation.dietary_notes ?? ""),
        reservation.confirmed ? "yes" : "no",
        reservation.attended ? "yes" : "no",
        slot.start_time,
        slot.end_time,
      ].join(","),
    ),
  );
  const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${group.listing.title.replaceAll(/[^a-z0-9]+/gi, "-").toLowerCase()}-reservations.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function ClubReservations() {
  const { clubId } = useParams<{ clubId: string }>();
  const { user, loading: authLoading } = useAuth();
  const [groups, setGroups] = useState<ListingGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [remindingSlotId, setRemindingSlotId] = useState<string | null>(null);

  const userId = user?.id ?? null;

  const refetch = useCallback(async () => {
    if (!userId) return;
    const { data: listings, error: listingsError } = await supabase
      .from("listings")
      .select("id, title, brand, active")
      .eq("club_id", userId)
      .order("created_at", { ascending: false });
    if (listingsError) {
      toast.error(listingsError.message);
      setLoading(false);
      return;
    }
    const listingIds = (listings ?? []).map((listing) => listing.id);
    if (listingIds.length === 0) {
      setGroups([]);
      setLoading(false);
      return;
    }

    const { data: slots, error: slotsError } = await supabase
      .from("pickup_slots")
      .select("*")
      .in("listing_id", listingIds)
      .order("start_time", { ascending: true });
    if (slotsError) {
      toast.error(slotsError.message);
      setLoading(false);
      return;
    }
    const slotIds = (slots ?? []).map((slot) => slot.id);

    const { data: reservations, error: reservationsError } =
      slotIds.length > 0
        ? await supabase
            .from("reservations")
            .select("*")
            .in("slot_id", slotIds)
            .order("created_at", { ascending: true })
        : { data: [] as Reservation[], error: null };
    if (reservationsError) {
      toast.error(reservationsError.message);
      setLoading(false);
      return;
    }

    const byListing: ListingGroup[] = (listings ?? [])
      .map((listing) => ({
        listing,
        slots: (slots ?? [])
          .filter((slot) => slot.listing_id === listing.id)
          .map((slot) => ({
            slot,
            reservations: (reservations ?? []).filter((reservation) => reservation.slot_id === slot.id),
          })),
      }))
      .filter((group) => group.slots.length > 0);

    setGroups(byListing);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (userId && clubId === userId) void refetch();
  }, [userId, clubId, refetch]);

  if (authLoading) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-10" aria-busy="true" aria-label="Loading reservations">
        <div className="h-9 w-56 animate-pulse rounded-xl bg-border/70" />
        <div className="mt-6 space-y-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-2xl bg-border/40" />
          ))}
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (clubId !== user.id) return <Navigate to={`/club/${user.id}/reservations-manager`} replace />;

  const toggleAttended = async (reservation: Reservation) => {
    setBusyId(reservation.id);
    const { error } = await supabase
      .from("reservations")
      .update({ attended: !reservation.attended })
      .eq("id", reservation.id);
    if (error) {
      toast.error(error.message);
    } else {
      await refetch();
    }
    setBusyId(null);
  };

  const sendReminders = async (slotId: string, count: number) => {
    if (count === 0) {
      toast.error("No reservations on this slot yet.");
      return;
    }
    setRemindingSlotId(slotId);
    const { data, error } = await supabase.functions.invoke("notify-cravings", {
      body: { action: "send_reminders", slot_id: slotId },
    });
    setRemindingSlotId(null);
    if (error) {
      toast.error("Could not send reminders. Is the edge function deployed?");
      return;
    }
    const sent = (data as { sent?: number } | null)?.sent ?? count;
    toast.success(`Reminder emails sent to ${sent} ${sent === 1 ? "person" : "people"}`);
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10">
      <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover-fine:text-ink">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Dashboard
      </Link>
      <h1 className="mt-2 text-2xl font-extrabold tracking-tight">Reservations</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Who is coming, when, and what they need. Mark people as picked up at the table.
      </p>

      {loading ? (
        <div className="mt-8 space-y-3" aria-busy="true">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-2xl bg-border/40" />
          ))}
        </div>
      ) : groups.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={<Users className="size-6" aria-hidden="true" />}
            title="No pickup slots yet"
            body="Add pickup slots when creating or editing a listing. Reservations land here as students grab them."
          />
        </div>
      ) : (
        <div className="mt-8 space-y-8">
          {groups.map((group) => (
            <section key={group.listing.id}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-lg font-bold">
                  {group.listing.title}{" "}
                  <span className="text-sm font-normal text-ink-muted">({group.listing.brand})</span>
                </h2>
                <Button variant="secondary" size="sm" onClick={() => exportCsv(group)}>
                  <Download className="size-3.5" aria-hidden="true" />
                  Export CSV
                </Button>
              </div>

              <div className="mt-3 space-y-3">
                {group.slots.map(({ slot, reservations }) => {
                  const upcoming = new Date(slot.start_time).getTime() > Date.now();
                  return (
                    <div key={slot.id} className="rounded-2xl border border-border bg-surface-raised p-4">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <p className="text-sm font-bold">{formatSlotTime(slot)}</p>
                          <Badge variant={slot.reserved_count >= slot.max_reservations ? "urgent" : "neutral"}>
                            {slot.reserved_count} of {slot.max_reservations}
                          </Badge>
                        </div>
                        {upcoming && (
                          <Button
                            variant="ghost"
                            size="sm"
                            loading={remindingSlotId === slot.id}
                            onClick={() => void sendReminders(slot.id, reservations.length)}
                          >
                            <BellRing className="size-3.5" aria-hidden="true" />
                            Send reminders
                          </Button>
                        )}
                      </div>

                      {reservations.length === 0 ? (
                        <p className="mt-2 text-sm text-ink-muted">No reservations yet.</p>
                      ) : (
                        <ul className="mt-2 divide-y divide-border/60">
                          {reservations.map((reservation) => (
                            <li
                              key={reservation.id}
                              className="flex flex-wrap items-center justify-between gap-2 py-2.5"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-semibold">
                                  {reservation.user_name}{" "}
                                  <span className="font-mono text-xs font-normal text-ink-muted">
                                    {reservation.user_email}
                                  </span>
                                </p>
                                <p className="text-xs text-ink-muted">
                                  {reservation.quantity} {reservation.quantity === 1 ? "item" : "items"}
                                  {reservation.dietary_notes ? `, ${reservation.dietary_notes}` : ""}
                                  {reservation.confirmed ? ", confirmed" : ""}
                                </p>
                              </div>
                              <Button
                                variant={reservation.attended ? "secondary" : "ghost"}
                                size="sm"
                                loading={busyId === reservation.id}
                                onClick={() => void toggleAttended(reservation)}
                                className={cn(reservation.attended && "border-tag-green bg-tag-green/40")}
                              >
                                {reservation.attended ? "Picked up" : "Mark picked up"}
                              </Button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
