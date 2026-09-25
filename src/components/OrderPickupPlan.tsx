import { CalendarCheck, CalendarClock, MapPinned } from "lucide-react";
import { formatWindowRange, slotModeSummary } from "@/lib/pickup";
import type { MyOrder } from "@/types/database";

/**
 * When and where this order is collected.
 *
 * Before migration 060 an order showed one line of free text (`pickup_info`)
 * and, at best, a single location name. A drop that ran two tables on three
 * days had no way to say so, so the buyer had to go back to the listing and
 * work it out. This shows the club's actual dates per spot, and puts any slot
 * the buyer booked at the top, because a booked time overrides everything
 * else: if you reserved 11:20 at Duffield, the other windows are noise.
 */
export function OrderPickupPlan({ order }: { order: MyOrder }) {
  const booked = order.my_reservations ?? [];
  const spots = (order.pickup_spots ?? []).filter(
    (spot) => (spot.windows?.length ?? 0) > 0 || spot.available_start,
  );

  if (booked.length === 0 && spots.length === 0) {
    if (!order.location_name && !order.pickup_info) return null;
    return (
      <p className="mt-1 text-xs text-ink-muted">
        Pickup: {order.location_name ?? order.pickup_info}
      </p>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-border/70 p-3">
      <p className="text-xs font-bold uppercase tracking-wide text-ink-muted">Pickup</p>

      {booked.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {booked.map((reservation) => (
            <li key={reservation.slot_id} className="flex items-start gap-2 text-sm">
              <CalendarCheck className="mt-0.5 size-4 shrink-0 text-primary-dark" aria-hidden="true" />
              <span>
                <span className="font-bold">
                  {formatWindowRange(reservation.start_time, reservation.end_time)}
                </span>
                {reservation.location_name && (
                  <span className="text-ink-muted"> at {reservation.location_name}</span>
                )}
                <span className="block text-xs text-ink-muted">
                  Your booked slot. Turn up in this window.
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}

      {booked.length === 0 &&
        spots.map((spot) => (
          <div key={spot.id ?? spot.location_name} className="mt-2">
            <p className="flex items-center gap-1.5 text-sm font-semibold">
              <MapPinned className="size-4 shrink-0 text-primary-dark" aria-hidden="true" />
              {spot.location_name}
            </p>
            <ul className="ml-5 mt-1 space-y-1">
              {(spot.windows ?? []).map((window) => (
                <li key={window.id} className="flex items-start gap-1.5 text-xs text-ink-muted">
                  <CalendarClock className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                  <span>
                    <span className="font-semibold text-ink">
                      {formatWindowRange(window.start_time, window.end_time)}
                    </span>
                    <span className="block">{slotModeSummary(window)}</span>
                    {window.note && <span className="block">{window.note}</span>}
                  </span>
                </li>
              ))}
              {(spot.windows ?? []).length === 0 && spot.available_start && spot.available_end && (
                <li className="text-xs text-ink-muted">
                  {formatWindowRange(spot.available_start, spot.available_end)}
                </li>
              )}
            </ul>
          </div>
        ))}

      {order.pickup_info && <p className="mt-2 text-xs text-ink-muted">{order.pickup_info}</p>}
    </div>
  );
}
