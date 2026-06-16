import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { openVenmo } from "@/lib/venmo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { brandInitials, brandTint } from "@/lib/brands";
import { cn } from "@/lib/utils";
import type { MyReservation } from "@/types/database";

export function formatSlot(reservation: MyReservation): string {
  const start = new Date(reservation.start_time);
  const end = new Date(reservation.end_time);
  const day = start.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  const timeOptions: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };
  return `${day}, ${start.toLocaleTimeString("en-US", timeOptions)} to ${end.toLocaleTimeString("en-US", timeOptions)}`;
}

function canConfirm(reservation: MyReservation): boolean {
  const start = new Date(reservation.start_time).getTime();
  const now = Date.now();
  return !reservation.confirmed && start > now && start <= now + 24 * 3_600_000;
}

export function ReservationCard({
  reservation,
  email,
  past,
  onChanged,
}: {
  reservation: MyReservation;
  email: string;
  past: boolean;
  onChanged: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const [busy, setBusy] = useState(false);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [receiptOpen, setReceiptOpen] = useState(false);

  const confirm = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("confirm_reservation", {
      p_reservation_id: reservation.id,
      p_email: email,
    });
    setBusy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Attendance confirmed. See you there!");
    onChanged();
  };

  const cancel = async () => {
    if (!confirmingCancel) {
      setConfirmingCancel(true);
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("cancel_reservation", {
      p_reservation_id: reservation.id,
      p_email: email,
    });
    setBusy(false);
    setConfirmingCancel(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Reservation cancelled");
    onChanged();
  };

  const note = `Cornell Craves pickup: ${reservation.listing_title}`;

  return (
    <div className={cn("rounded-2xl border border-border bg-surface-raised p-4", past && "opacity-70")}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-12 shrink-0 items-center justify-center rounded-xl font-display text-base font-extrabold text-ink/80",
            brandTint(reservation.brand),
          )}
          aria-hidden="true"
        >
          {brandInitials(reservation.brand)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-bold">{reservation.listing_title}</h3>
          <p className="truncate text-sm text-ink-muted">
            {formatSlot(reservation)}
            {reservation.location_name ? `, ${reservation.location_name}` : ""}
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            {reservation.quantity} {reservation.quantity === 1 ? "item" : "items"}, {reservation.club_name}
            {reservation.dietary_notes ? `, note: ${reservation.dietary_notes}` : ""}
          </p>
        </div>
        {past ? (
          <Badge variant={reservation.attended ? "success" : "neutral"}>
            {reservation.attended ? "Picked up" : "Ended"}
          </Badge>
        ) : (
          <Badge variant={reservation.confirmed ? "success" : "default"}>
            {reservation.confirmed ? "Confirmed" : "Reserved"}
          </Badge>
        )}
      </div>

      {!past && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {canConfirm(reservation) && (
            <Button size="sm" loading={busy} onClick={() => void confirm()}>
              Confirm attendance
            </Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setReceiptOpen((open) => !open)}
            aria-expanded={receiptOpen}
          >
            Receipt
            <ChevronDown
              className={cn("size-3.5 transition-transform duration-150", receiptOpen && "rotate-180")}
              aria-hidden="true"
            />
          </Button>
          <Button
            variant={confirmingCancel ? "destructive" : "ghost"}
            size="sm"
            disabled={busy}
            onClick={() => void cancel()}
          >
            {confirmingCancel ? "Confirm cancel" : "Cancel"}
          </Button>
        </div>
      )}

      <AnimatePresence>
        {receiptOpen && !past && (
          <motion.div
            initial={reduceMotion ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-3 rounded-xl bg-surface p-3">
              <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">Pay {reservation.club_name}</p>
              {reservation.venmo ? (
                <Button size="sm" className="mt-2" onClick={() => openVenmo(reservation.venmo!, note)}>
                  Pay with Venmo
                </Button>
              ) : (
                <p className="mt-2 text-sm text-ink-muted">No Venmo on file for this club.</p>
              )}
              {reservation.zelle_phone && (
                <p className="mt-2 text-sm text-ink-muted">
                  Zelle <span className="ml-1 font-mono text-ink">{reservation.zelle_phone}</span>
                </p>
              )}
              <p className="mt-2 text-xs text-ink-muted">
                Show your payment screen at pickup. The club has your reservation under this email.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
