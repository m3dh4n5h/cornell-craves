import { brandInitials } from "@/lib/brands";
import { cn } from "@/lib/utils";
import type { PickupType } from "@/types/database";

const PIN_TYPE_LABELS: Record<PickupType, string> = {
  same_day_only: "Same-day",
  preorder_only: "Preorder",
  both: "Pre + same-day",
};

/**
 * Saffron campus pin, rendered as plain DOM inside a MapLibre <Marker>. Styles
 * live in index.css (.craves-pin) so the look stays on the design system. A
 * count bubble appears when several drops share one location, and a small badge
 * under the pin shows the location's pickup type.
 */
export function BrandPin({
  brand,
  count,
  active,
  pickupType = "both",
}: {
  brand: string;
  count: number;
  active: boolean;
  pickupType?: PickupType;
}) {
  return (
    <div className={cn("craves-pin", active && "craves-pin-active")}>
      {brandInitials(brand)}
      {count > 1 && <span className="craves-pin-count">{count}</span>}
      <span className="craves-pin-type">{PIN_TYPE_LABELS[pickupType]}</span>
    </div>
  );
}
