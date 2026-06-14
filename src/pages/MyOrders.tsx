import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { ReceiptText, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { fetchMyOrders, orderQuantity, ORDER_STATUS_META } from "@/lib/orders";
import { GROUP_STATUS_META, PAYABLE_GROUP_STATUSES } from "@/lib/groups";
import { formatPrice } from "@/lib/format";
import { brandInitials, brandTint } from "@/lib/brands";
import { openVenmo } from "@/lib/venmo";
import { GroupMembers } from "@/components/GroupMembers";
import { GroupInviteLink } from "@/components/GroupInviteLink";
import { GroupInvitationCard } from "@/components/GroupInvitationCard";
import { DeadlineTimer } from "@/components/DeadlineTimer";
import { QRCodeView } from "@/components/QRCodeView";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GroupDetails, MyOrder } from "@/types/database";

function OrderCard({ order, onCancelled }: { order: MyOrder; onCancelled: () => void }) {
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [busy, setBusy] = useState(false);
  const status = ORDER_STATUS_META[order.status];
  const placed = new Date(order.created_at).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

  const cancel = async () => {
    if (!confirmingCancel) {
      setConfirmingCancel(true);
      return;
    }
    setBusy(true);
    const { error } = await supabase.rpc("cancel_order", {
      p_order_id: order.id,
      p_email: order.orderer_email,
    });
    setBusy(false);
    setConfirmingCancel(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Order cancelled");
    onCancelled();
  };

  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-12 shrink-0 items-center justify-center rounded-xl font-display text-base font-extrabold text-ink/80",
            brandTint(order.brand),
          )}
          aria-hidden="true"
        >
          {brandInitials(order.brand)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-bold">{order.listing_title}</h3>
          <p className="truncate text-sm text-ink-muted">
            {orderQuantity(order.items_json)} {orderQuantity(order.items_json) === 1 ? "item" : "items"},{" "}
            <span className="font-mono">{formatPrice(Number(order.total))}</span>, placed {placed}
          </p>
          {order.proxy_name && (
            <p className="mt-0.5 text-xs text-ink-muted">Proxy: {order.proxy_name}</p>
          )}
          <Badge variant={status.variant} className="mt-2">
            {status.label}
          </Badge>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link to={`/orders/${order.id}`}>
          <Button variant="secondary" size="sm">
            {order.payment_verified ? "Details and QR pass" : "Details"}
          </Button>
        </Link>
        {order.status === "pending_payment" && (
          <Button
            variant={confirmingCancel ? "destructive" : "ghost"}
            size="sm"
            loading={busy}
            onClick={() => void cancel()}
          >
            {confirmingCancel ? "Confirm cancel" : "Cancel"}
          </Button>
        )}
      </div>
    </div>
  );
}

function GroupCard({ group, userId }: { group: GroupDetails; userId: string }) {
  const status = GROUP_STATUS_META[group.status];
  const isCreator = group.created_by === userId;
  const payable = PAYABLE_GROUP_STATUSES.includes(group.status);
  const myPaid = group.my_status === "paid";

  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4">
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "flex size-12 shrink-0 items-center justify-center rounded-xl font-display text-base font-extrabold text-ink/80",
            brandTint(group.brand),
          )}
          aria-hidden="true"
        >
          {brandInitials(group.brand)}
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-bold">
            {group.item_name}
            <span className="ml-1.5 text-sm font-normal text-ink-muted">split {group.total_people} ways</span>
          </h3>
          <p className="truncate text-sm text-ink-muted">
            {group.listing_title}, {group.club_name}
          </p>
          <p className="mt-1 text-sm">
            Your share:{" "}
            <span className="font-mono font-bold">{formatPrice(Number(group.share_amount))}</span>
            {group.units_per_person != null && group.units_per_person > 0 && (
              <span className="text-ink-muted">
                {" "}
                for {group.units_per_person} {group.units_per_person === 1 ? "unit" : "units"}
              </span>
            )}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant={status.variant}>{status.label}</Badge>
            {(group.status === "filling" || payable) && <DeadlineTimer deadline={group.deadline} prefix={group.status === "filling" ? "Fills within" : "Pay within"} />}
          </div>
        </div>
      </div>

      <div className="mt-4">
        <GroupMembers group={group} currentUserId={userId} />
      </div>

      {group.status === "filling" && isCreator && group.open_token && (
        <div className="mt-4">
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
            Invite link
          </p>
          <GroupInviteLink token={group.open_token} />
        </div>
      )}

      {payable && !myPaid && (
        <div className="mt-4 rounded-xl bg-primary/15 p-3">
          <p className="text-sm font-semibold">
            Pay {group.club_name} {formatPrice(Number(group.share_amount))}, then the club marks
            you paid and emails your QR pass.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {group.club_venmo && (
              <Button
                size="sm"
                onClick={() =>
                  openVenmo(group.club_venmo!, `Cornell Craves split: ${group.item_name}`)
                }
              >
                Pay my share on Venmo
              </Button>
            )}
            {group.club_zelle && (
              <span className="text-xs text-ink-muted">
                Zelle <span className="font-mono text-ink">{group.club_zelle}</span>
              </span>
            )}
          </div>
        </div>
      )}

      {myPaid && group.my_qr && group.status !== "canceled" && (
        <div className="mt-4">
          <QRCodeView token={group.my_qr} label="Your pickup pass (yours only)" />
        </div>
      )}

      {group.status === "canceled" && (
        <p className="mt-3 text-xs text-ink-muted">
          The payment window closed before everyone paid. The club can reactivate it; you
          will get an email if that happens.
        </p>
      )}
    </div>
  );
}

export default function MyOrders() {
  const navigate = useNavigate();
  const { user, isGoogleUser, loading: authLoading } = useAuth();
  const [orders, setOrders] = useState<MyOrder[]>([]);
  const [groups, setGroups] = useState<GroupDetails[]>([]);
  const [invites, setInvites] = useState<(GroupDetails & { invite_token: string })[]>([]);
  const [loading, setLoading] = useState(true);

  const userId = user?.id ?? null;

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const [ordersResult, groupsResult, invitesResult] = await Promise.all([
      fetchMyOrders({ userId }),
      supabase.rpc("get_my_groups"),
      supabase.rpc("get_my_group_invites"),
    ]);
    if (ordersResult.error) toast.error(ordersResult.error);
    setOrders(ordersResult.orders);
    setGroups(((groupsResult.data as unknown as GroupDetails[]) ?? []).filter(Boolean));
    setInvites(
      ((invitesResult.data as unknown as (GroupDetails & { invite_token: string })[]) ?? []).filter(
        Boolean,
      ),
    );
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (userId) void load();
  }, [userId, load]);

  // v4: orders require a Google student account.
  if (!authLoading && (!user || !isGoogleUser)) {
    return <Navigate to="/login?intent=student&next=/orders" replace />;
  }

  if (authLoading || loading) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-10" aria-busy="true" aria-label="Loading orders">
        <div className="h-9 w-40 animate-pulse rounded-xl bg-border/70" />
        <div className="mt-8 space-y-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-2xl bg-border/40" />
          ))}
        </div>
      </div>
    );
  }

  const isEmpty = orders.length === 0 && groups.length === 0 && invites.length === 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-extrabold tracking-tight">My orders</h1>
      <p className="mt-1 text-sm text-ink-muted">{user?.email}</p>

      {isEmpty ? (
        <div className="mt-8">
          <EmptyState
            icon={<ReceiptText className="size-6" aria-hidden="true" />}
            title="No orders yet"
            body="Find a drop on the feed, order solo or split with friends, and track everything here."
            actionLabel="Browse the feed"
            onAction={() => navigate("/")}
          />
        </div>
      ) : (
        <>
          {invites.length > 0 && (
            <section className="mt-8">
              <h2 className="text-lg font-bold">Invitations</h2>
              <div className="mt-3 space-y-3">
                {invites.map((invite) => (
                  <GroupInvitationCard
                    key={invite.invite_token}
                    invite={invite}
                    onResponded={() => void load()}
                  />
                ))}
              </div>
            </section>
          )}

          {groups.length > 0 && (
            <section className="mt-8">
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <Users className="size-5 text-primary-dark" aria-hidden="true" />
                Group orders
              </h2>
              <div className="mt-3 space-y-3">
                {groups.map((group) => (
                  <GroupCard key={group.id} group={group} userId={user!.id} />
                ))}
              </div>
            </section>
          )}

          {orders.length > 0 && (
            <section className="mt-8">
              <h2 className="text-lg font-bold">Solo orders</h2>
              <div className="mt-3 space-y-3">
                {orders.map((order) => (
                  <OrderCard key={order.id} order={order} onCancelled={() => void load()} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}
