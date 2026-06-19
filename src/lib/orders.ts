import { supabase } from "@/lib/supabase";
import type {
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
