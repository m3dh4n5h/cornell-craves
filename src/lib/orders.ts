import { supabase } from "@/lib/supabase";
import type {
  GroupDetails,
  MyOrder,
  Order,
  OrderItem,
  OrderQRCode,
  OrderStatus,
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
  };
}

const AUTHED_ORDER_SELECT =
  "*, listings(title, brand, pickup_info, contact_email, expires_at, campus_locations(name), clubs(name)), order_qr_codes(*)";

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
  total: number;
  confirmedRevenue: number;
  pendingRevenue: number;
}

export interface DropDemand {
  rows: ItemDemandRow[];
  confirmedUnits: number;
  pendingUnits: number;
  totalUnits: number;
  confirmedRevenue: number;
  pendingRevenue: number;
  /** Solo orders counted (cancelled excluded). */
  orderCount: number;
  /** Split groups counted (canceled excluded). */
  splitCount: number;
}

type DemandOrder = Pick<Order, "status" | "payment_verified" | "items_json">;
type DemandGroup = Pick<
  GroupDetails,
  "item_name" | "item_price" | "share_amount" | "status" | "members"
>;

export function summarizeDropDemand(orders: DemandOrder[], groups: DemandGroup[]): DropDemand {
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
  for (const order of orders) {
    if (order.status === "cancelled") continue;
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

  const list = [...rows.values()].sort(
    (a, b) => b.total - a.total || a.name.localeCompare(b.name),
  );
  return {
    rows: list,
    confirmedUnits: list.reduce((sum, row) => sum + row.confirmed, 0),
    pendingUnits: list.reduce((sum, row) => sum + row.pending, 0),
    totalUnits: list.reduce((sum, row) => sum + row.total, 0),
    confirmedRevenue: list.reduce((sum, row) => sum + row.confirmedRevenue, 0),
    pendingRevenue: list.reduce((sum, row) => sum + row.pendingRevenue, 0),
    orderCount,
    splitCount,
  };
}

/** Plain-text version of a purchase list, for the clipboard. */
export function demandToText(
  title: string,
  demand: DropDemand,
  scope: "all" | "confirmed",
): string {
  const lines = [
    `${title} — what to buy`,
    scope === "confirmed" ? "Verified (paid) orders only" : "Every order placed, paid or not",
    "",
    ...demand.rows
      .map((row) => ({ name: row.name, qty: scope === "confirmed" ? row.confirmed : row.total }))
      .filter((row) => row.qty > 0)
      .map((row) => `${row.qty}x ${row.name}`),
  ];
  const total = scope === "confirmed" ? demand.confirmedUnits : demand.totalUnits;
  lines.push("", `Total: ${total} ${total === 1 ? "item" : "items"}`);
  return lines.join("\n");
}
