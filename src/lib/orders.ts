import { supabase } from "@/lib/supabase";
import type {
  GroupDetails,
  MyOrder,
  Order,
  OrderItem,
  OrderQRCode,
  OrderStatus,
  OrderType,
  PickupWindowSummary,
  SameDayStock,
  PickupType,
} from "@/types/database";

export const ORDER_STATUS_META: Record<
  OrderStatus,
  { label: string; variant: "default" | "urgent" | "neutral" | "success" }
> = {
  pending_payment: { label: "Waiting for payment check", variant: "default" },
  qr_sent: { label: "QR pass sent", variant: "success" },
  picked_up: { label: "Picked up", variant: "success" },
  cancelled: { label: "Cancelled", variant: "neutral" },
};

export const PICKUP_TYPE_LABELS: Record<PickupType, string> = {
  same_day_only: "Same-day only",
  preorder_only: "Preorder only",
  both: "Preorder + same-day",
};

export function orderQuantity(items: OrderItem[] | null): number {
  return (items ?? []).reduce((sum, item) => sum + item.qty, 0);
}

export function orderItemsSummary(items: OrderItem[] | null): string {
  return (items ?? []).map((item) => `${item.qty}x ${item.name}`).join(", ");
}

const NETID_PATTERN = /^[a-z]{2,4}\d{1,5}$/i;

export function isValidNetid(value: string): boolean {
  return NETID_PATTERN.test(value.trim());
}

type AuthedOrderRow = Order & {
  listings: {
    title: string;
    brand: string;
    pickup_info: string | null;
    contact_email: string | null;
    expires_at: string;
    campus_locations: { name: string } | null;
    clubs: { name: string } | null;
    listing_pickup_spots: {
      id: string;
      order_type: OrderType;
      available_start: string | null;
      available_end: string | null;
      campus_locations: { name: string; latitude: number; longitude: number } | null;
      listing_pickup_windows: PickupWindowSummary[] | null;
    }[];
  } | null;
  order_qr_codes: OrderQRCode[];
};

function mapAuthedRow(row: AuthedOrderRow): MyOrder {
  const { listings, order_qr_codes, ...order } = row;
  return {
    ...order,
    listing_title: listings?.title ?? "Listing removed",
    brand: listings?.brand ?? "",
    pickup_info: listings?.pickup_info ?? null,
    location_name: listings?.campus_locations?.name ?? null,
    expires_at: listings?.expires_at ?? order.created_at,
    club_name: listings?.clubs?.name ?? null,
    contact_email: listings?.contact_email ?? null,
    qr_codes: order_qr_codes ?? [],
    // The listing's own pickup spots, for the "Add to calendar" picker
    // (feature 3): same shape get_my_orders (057) returns for the guest path.
    pickup_spots: (listings?.listing_pickup_spots ?? []).flatMap((spot) =>
      spot.campus_locations
        ? [
            {
              id: spot.id,
              order_type: spot.order_type,
              available_start: spot.available_start,
              available_end: spot.available_end,
              location_name: spot.campus_locations.name,
              latitude: Number(spot.campus_locations.latitude),
              longitude: Number(spot.campus_locations.longitude),
              windows: [...(spot.listing_pickup_windows ?? [])].sort(
                (a, b) => new Date(a.start_time).getTime() - new Date(b.start_time).getTime(),
              ),
            },
          ]
        : [],
    ),
  };
}

const AUTHED_ORDER_SELECT =
  "*, listings(title, brand, pickup_info, contact_email, expires_at, campus_locations(name), clubs(name), listing_pickup_spots(id, order_type, available_start, available_end, campus_locations(name, latitude, longitude), listing_pickup_windows(id, start_time, end_time, slot_mode, capacity, split_minutes, note))), order_qr_codes(*)";

/** Signed-in students query by user id (RLS); guests look up via the RPC. */
export async function fetchMyOrders(options: {
  userId?: string | null;
  email?: string | null;
}): Promise<{ orders: MyOrder[]; error: string | null }> {
  if (options.userId) {
    const { data, error } = await supabase
      .from("orders")
      .select(AUTHED_ORDER_SELECT)
      .eq("user_id", options.userId)
      .order("created_at", { ascending: false })
      .returns<AuthedOrderRow[]>();
    if (error) return { orders: [], error: error.message };
    return { orders: (data ?? []).map(mapAuthedRow), error: null };
  }
  if (options.email) {
    const { data, error } = await supabase.rpc("get_my_orders", { p_email: options.email });
    if (error) return { orders: [], error: error.message };
    return { orders: (data as unknown as MyOrder[] | null) ?? [], error: null };
  }
  return { orders: [], error: null };
}

/* ------------------------------------------------------------------ *
 * Per-drop purchase list
 *
 * What a club has to walk into the restaurant and buy for one drop. It is
 * deliberately NOT the same question as revenue analytics: a split group is
 * several people paying for ONE physical item, so it contributes
 * `item_quantity` units no matter how many ways it was split, and an order
 * that is not paid for yet still has to be bought if the club intends to
 * honour it. Cancelled orders and canceled groups contribute nothing.
 * ------------------------------------------------------------------ */

export interface ItemDemandRow {
  name: string;
  /** Units behind money the club has already verified. */
  confirmed: number;
  /** Units behind orders that are placed but not paid/verified yet. */
  pending: number;
  /** Ordered units: confirmed + pending. Excludes the same-day pile. */
  total: number;
  confirmedRevenue: number;
  pendingRevenue: number;
  /**
   * Units the club plans to carry to its same-day tables (migration 060),
   * summed across every spot. This is stock to BUY, not stock anyone ordered,
   * so it is kept apart from `total` and only joined at `toBuy`.
   */
  sameDay: number;
  /** What to actually purchase: ordered units plus the same-day pile. */
  toBuy: number;
}

export interface DropDemand {
  rows: ItemDemandRow[];
  confirmedUnits: number;
  pendingUnits: number;
  totalUnits: number;
  confirmedRevenue: number;
  pendingRevenue: number;
  /** Same-day units to bring, summed across items and spots. */
  sameDayUnits: number;
  /** Everything to buy for this drop: ordered units plus the same-day pile. */
  toBuyUnits: number;
  /** Units already sold at a table, drawn from the same-day pile. */
  walkUpUnits: number;
  /** Money taken at the table, already collected and already handed over. */
  walkUpRevenue: number;
  /** Solo orders counted (cancelled excluded). */
  orderCount: number;
  /** Split groups counted (canceled excluded). */
  splitCount: number;
  /** Sales recorded at a table (migration 060). */
  walkUpCount: number;
}

type DemandOrder = Pick<Order, "status" | "payment_verified" | "items_json" | "walk_up">;
type DemandGroup = Pick<
  GroupDetails,
  "item_name" | "item_price" | "share_amount" | "status" | "members"
>;

/** Same-day units per item, summed over spots, from the same_day_stock RPC. */
export type SameDayPile = Pick<SameDayStock, "item_name" | "quantity">;

export function summarizeDropDemand(
  orders: DemandOrder[],
  groups: DemandGroup[],
  sameDay: SameDayPile[] = [],
): DropDemand {
  const rows = new Map<string, ItemDemandRow>();
  const bump = (name: string, units: number, revenue: number, confirmed: boolean) => {
    if (units <= 0) return;
    const row = rows.get(name) ?? {
      name,
      confirmed: 0,
      pending: 0,
      total: 0,
      confirmedRevenue: 0,
      pendingRevenue: 0,
      sameDay: 0,
      toBuy: 0,
    };
    if (confirmed) {
      row.confirmed += units;
      row.confirmedRevenue += revenue;
    } else {
      row.pending += units;
      row.pendingRevenue += revenue;
    }
    row.total += units;
    rows.set(name, row);
  };

  let orderCount = 0;
  let walkUpCount = 0;
  let walkUpUnits = 0;
  let walkUpRevenue = 0;
  for (const order of orders) {
    if (order.status === "cancelled") continue;
    // A walk-up (migration 060) was sold OUT OF the same-day pile the club
    // already bought and already carried to the table. Counting it as demand
    // would tell the club to go buy another box of something it has just
    // handed over, so it is tracked separately and never reaches `bump`.
    if (order.walk_up) {
      walkUpCount += 1;
      for (const line of order.items_json ?? []) {
        const qty = Number(line.qty) || 0;
        walkUpUnits += qty;
        walkUpRevenue += Number(line.price) * qty;
      }
      continue;
    }
    orderCount += 1;
    for (const line of order.items_json ?? []) {
      const qty = Number(line.qty) || 0;
      bump(line.name, qty, Number(line.price) * qty, order.payment_verified);
    }
  }

  let splitCount = 0;
  for (const group of groups) {
    if (group.status === "canceled") continue;
    splitCount += 1;
    // Exactly one box, however many ways it split. `item_quantity` is the count
    // of units INSIDE the box (a dozen = 12, per migration 009) and drives
    // units_per_person, so using it here would tell the club to buy twelve
    // dozens when four students are sharing one.
    const units = 1;
    const paidShares = group.members.filter((member) => member.status === "paid").length;
    const collected = paidShares * Number(group.share_amount);
    // "Confirmed" for a split means the club has every share in hand; a
    // half-paid group is still money it might have to refund.
    const settled = group.status === "paid";
    // Unsettled groups report the item's full price as money still expected;
    // shares already collected sit in that same pending bucket, because the
    // club may yet have to refund them if the group falls through.
    bump(group.item_name, units, settled ? collected : Number(group.item_price), settled);
  }

  // The same-day pile: stock to buy that nobody ordered. Items that ONLY
  // appear here (a club bringing something it takes no pre-orders for) still
  // need a row, or they would be missing from the shopping list entirely.
  for (const pile of sameDay) {
    const quantity = Number(pile.quantity) || 0;
    if (quantity <= 0) continue;
    const row = rows.get(pile.item_name) ?? {
      name: pile.item_name,
      confirmed: 0,
      pending: 0,
      total: 0,
      confirmedRevenue: 0,
      pendingRevenue: 0,
      sameDay: 0,
      toBuy: 0,
    };
    row.sameDay += quantity;
    rows.set(pile.item_name, row);
  }
  for (const row of rows.values()) row.toBuy = row.total + row.sameDay;

  const list = [...rows.values()].sort(
    (a, b) => b.toBuy - a.toBuy || a.name.localeCompare(b.name),
  );
  return {
    rows: list,
    confirmedUnits: list.reduce((sum, row) => sum + row.confirmed, 0),
    pendingUnits: list.reduce((sum, row) => sum + row.pending, 0),
    totalUnits: list.reduce((sum, row) => sum + row.total, 0),
    confirmedRevenue: list.reduce((sum, row) => sum + row.confirmedRevenue, 0),
    pendingRevenue: list.reduce((sum, row) => sum + row.pendingRevenue, 0),
    sameDayUnits: list.reduce((sum, row) => sum + row.sameDay, 0),
    toBuyUnits: list.reduce((sum, row) => sum + row.toBuy, 0),
    walkUpUnits,
    walkUpRevenue,
    orderCount,
    splitCount,
    walkUpCount,
  };
}

/** Plain-text version of a purchase list, for the clipboard. */
export function demandToText(
  title: string,
  demand: DropDemand,
  scope: "all" | "confirmed",
): string {
  // The copied list is what someone reads out at the counter, so the same-day
  // pile has to be in the number they say out loud, not a footnote under it.
  const orderedOf = (row: ItemDemandRow) => (scope === "confirmed" ? row.confirmed : row.total);
  const lines = [
    `${title} — what to buy`,
    scope === "confirmed" ? "Verified (paid) orders only" : "Every order placed, paid or not",
    ...(demand.sameDayUnits > 0 ? ["Includes stock to sell at the table"] : []),
    "",
    ...demand.rows
      .map((row) => ({
        name: row.name,
        qty: orderedOf(row) + row.sameDay,
        ordered: orderedOf(row),
        sameDay: row.sameDay,
      }))
      .filter((row) => row.qty > 0)
      .map((row) =>
        row.sameDay > 0
          ? `${row.qty}x ${row.name}  (${row.ordered} ordered + ${row.sameDay} for the table)`
          : `${row.qty}x ${row.name}`,
      ),
  ];
  const ordered = scope === "confirmed" ? demand.confirmedUnits : demand.totalUnits;
  const total = ordered + demand.sameDayUnits;
  lines.push("", `Total: ${total} ${total === 1 ? "item" : "items"}`);
  if (demand.sameDayUnits > 0) {
    lines.push(`  ${ordered} ordered ahead, ${demand.sameDayUnits} to sell at the table`);
  }
  if (demand.walkUpUnits > 0) {
    lines.push(
      `  (${demand.walkUpUnits} already sold at the table, not counted again above)`,
    );
  }
  return lines.join("\n");
}
