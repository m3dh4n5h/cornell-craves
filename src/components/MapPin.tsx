import L from "leaflet";
import { brandInitials } from "@/lib/brands";
import type { PickupType } from "@/types/database";

const PIN_TYPE_LABELS: Record<PickupType, string> = {
  same_day_only: "Same-day",
  preorder_only: "Preorder",
  both: "Pre + same-day",
};

/**
 * Saffron campus pin rendered as a Leaflet divIcon. Styles live in index.css
 * (.craves-pin) so the map look stays on the design system, not Leaflet
 * defaults. A count bubble appears when several drops share one location, and
 * a small badge under the pin shows the location's pickup type.
 */
export function createBrandPin(
  brand: string,
  count: number,
  active: boolean,
  pickupType: PickupType = "both",
): L.DivIcon {
  const countBadge = count > 1 ? `<span class="craves-pin-count">${count}</span>` : "";
  const typeBadge = `<span class="craves-pin-type">${PIN_TYPE_LABELS[pickupType]}</span>`;
  return L.divIcon({
    className: "craves-pin-wrapper",
    html: `<div class="craves-pin${active ? " craves-pin-active" : ""}">${brandInitials(brand)}${countBadge}${typeBadge}</div>`,
    iconSize: [36, 60],
    iconAnchor: [18, 44],
  });
}
