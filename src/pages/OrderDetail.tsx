import { useCallback, useEffect, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, SearchX } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { fetchMyOrders, ORDER_STATUS_META } from "@/lib/orders";
import { formatPrice } from "@/lib/format";
import { QRCodeView } from "@/components/QRCodeView";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MyOrder } from "@/types/database";

const STATUS_EXPLAINER: Record<MyOrder["status"], string> = {
  pending_payment:
    "Pay the club with the details you entered. Once they verify your payment, both QR passes are emailed and appear here.",
  qr_sent: "Payment verified. Show a QR pass below at pickup.",
  picked_up: "This order has been picked up. All done!",
  cancelled: "This order was cancelled and the club will not fulfill it.",
};

export default function OrderDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user, isGoogleUser, loading: authLoading } = useAuth();
  const [order, setOrder] = useState<MyOrder | null>(null);
  const [loading, setLoading] = useState(true);
  const [togglingProxy, setTogglingProxy] = useState(false);

  const load = useCallback(async () => {
    if (!id || !user) return;
    setLoading(true);
    const { orders, error } = await fetchMyOrders({ userId: user.id });
    if (error) toast.error(error);
    setOrder(orders.find((entry) => entry.id === id) ?? null);
    setLoading(false);
  }, [id, user]);

  useEffect(() => {
    if (!authLoading && user) void load();
  }, [authLoading, user, load]);

  // v4: order details require a Google student account.
  if (!authLoading && (!user || !isGoogleUser)) {
    return <Navigate to="/login" replace />;
  }

  if (authLoading || loading) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-8" aria-busy="true" aria-label="Loading order">
        <div className="h-9 w-32 animate-pulse rounded-xl bg-border/60" />
        <div className="mt-6 space-y-4">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-2xl bg-border/40" />
          ))}
        </div>
      </div>
    );
  }

  if (!order) {
    return (
      <div className="mx-auto w-full max-w-xl px-4 py-12">
        <EmptyState
          icon={<SearchX className="size-6" aria-hidden="true" />}
          title="Order not found"
          body="This order is not on your account. It may have been placed with a different Google account."
          actionLabel="Go to my orders"
          onAction={() => navigate("/orders")}
        />
      </div>
    );
  }

  const status = ORDER_STATUS_META[order.status];
  const ordererQr = order.qr_codes.find((qr) => qr.user_type === "orderer");
  const proxyQr = order.qr_codes.find((qr) => qr.user_type === "proxy");

  const toggleProxy = async () => {
    if (!proxyQr) return;
    setTogglingProxy(true);
    const { error } = await supabase.rpc("set_proxy_qr_active", {
      p_order_id: order.id,
      p_email: order.orderer_email,
      p_active: !proxyQr.is_active,
    });
    setTogglingProxy(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(proxyQr.is_active ? "Proxy pass disabled" : "Proxy pass re-enabled");
    await load();
  };

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8">
      <Button variant="ghost" size="sm" onClick={() => navigate("/orders")} className="-ml-2 text-ink-muted">
        <ArrowLeft className="size-4" aria-hidden="true" />
        My orders
      </Button>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold tracking-tight">{order.listing_title}</h1>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>
      <p className="mt-2 text-sm text-ink-muted">{STATUS_EXPLAINER[order.status]}</p>

      <section className="mt-6 rounded-2xl border border-border bg-surface-raised p-4">
        <h2 className="text-base font-bold">Order</h2>
        <ul className="mt-1 divide-y divide-border/60 text-sm">
          {order.items_json.map((item) => (
            <li key={item.name} className="flex justify-between gap-3 py-2">
              <span>
                {item.qty}x {item.name}
              </span>
              <span className="font-mono">{formatPrice(item.price * item.qty)}</span>
            </li>
          ))}
          <li className="flex justify-between gap-3 py-2 font-bold">
            <span>Total</span>
            <span className="font-mono">{formatPrice(Number(order.total))}</span>
          </li>
        </ul>
        <p className="mt-2 text-xs text-ink-muted">
          Paying with{" "}
          {order.payment_method === "both"
            ? "Venmo or Zelle"
            : order.payment_method === "venmo"
              ? "Venmo"
              : "Zelle"}
          {order.payment_details_json.venmo && (
            <span className="ml-1 font-mono">@{order.payment_details_json.venmo.replace(/^@/, "")}</span>
          )}
          {order.payment_details_json.zelle && (
            <span className="ml-1 font-mono">{order.payment_details_json.zelle}</span>
          )}
        </p>
        {(order.location_name || order.pickup_info) && (
          <p className="mt-1 text-xs text-ink-muted">
            Pickup: {order.location_name ?? order.pickup_info}
          </p>
        )}
      </section>

      {order.payment_verified && order.status !== "cancelled" ? (
        <section className="mt-4 rounded-2xl border border-border bg-surface-raised p-4">
          <h2 className="text-base font-bold">Pickup passes</h2>
          <p className="mt-1 text-xs text-ink-muted">
            Show one of these at the table. Each pass works once.
          </p>
          <div className="mt-4 flex flex-wrap gap-6">
            {ordererQr?.qr_encrypted && (
              <div>
                <QRCodeView
                  token={ordererQr.qr_encrypted}
                  label={`Your pass${ordererQr.scanned_at ? " (used)" : ""}`}
                  disabled={Boolean(ordererQr.scanned_at)}
                />
              </div>
            )}
            {proxyQr?.qr_encrypted && order.proxy_name && (
              <div>
                <QRCodeView
                  token={proxyQr.qr_encrypted}
                  label={`${order.proxy_name}'s pass${proxyQr.scanned_at ? " (used)" : ""}`}
                  disabled={!proxyQr.is_active || Boolean(proxyQr.scanned_at)}
                />
                {!proxyQr.scanned_at && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="mt-2"
                    loading={togglingProxy}
                    onClick={() => void toggleProxy()}
                  >
                    {proxyQr.is_active ? "Disable proxy pass" : "Re-enable proxy pass"}
                  </Button>
                )}
              </div>
            )}
          </div>
          {ordererQr?.qr_encrypted && (
            <details className="mt-4">
              <summary className="cursor-pointer text-xs font-semibold text-ink-muted">
                Scanner not working? Show the pass code
              </summary>
              <p className="mt-2 break-all rounded-xl bg-surface p-3 font-mono text-xs text-ink-muted">
                {ordererQr.qr_encrypted}
              </p>
            </details>
          )}
        </section>
      ) : (
        order.status === "pending_payment" && (
          <section className="mt-4 rounded-2xl border border-dashed border-border bg-surface-raised p-4">
            <h2 className="text-base font-bold">Pickup passes</h2>
            <p className="mt-1 text-sm text-ink-muted">
              Your QR pass {order.proxy_name ? "and your proxy's pass " : ""}will be emailed
              once the club verifies your payment.
            </p>
          </section>
        )
      )}

      {order.proxy_name && (
        <section className="mt-4 rounded-2xl border border-border bg-surface-raised p-4">
          <h2 className="text-base font-bold">Proxy pickup</h2>
          <p className="mt-1 text-sm text-ink-muted">
            {order.proxy_name}, {order.proxy_email}
            {order.proxy_netid ? `, ${order.proxy_netid}` : ""}
          </p>
        </section>
      )}

      {order.status === "picked_up" && order.picked_up_by_name && (
        <section className="mt-4 rounded-2xl border border-border bg-surface-raised p-4">
          <h2 className="text-base font-bold">Picked up</h2>
          <p className="mt-1 text-sm text-ink-muted">
            By {order.picked_up_by_name} ({order.picked_up_by_email})
            {order.picked_up_at &&
              ` on ${new Date(order.picked_up_at).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })}`}
          </p>
        </section>
      )}
    </div>
  );
}
