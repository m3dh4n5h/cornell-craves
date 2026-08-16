import { useCallback, useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Copy, ReceiptText, Ticket, Users } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useProfile";
import { GoogleButton } from "@/components/GoogleButton";
import { ReservationCard } from "@/components/ReservationCard";
import { fetchMyOrders, orderQuantity, ORDER_STATUS_META } from "@/lib/orders";
import { GROUP_STATUS_META, PAYABLE_GROUP_STATUSES } from "@/lib/groups";
import { formatPrice, formatEasternDateTime } from "@/lib/format";
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
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type { GroupDetails, MyOrder, MyReservation } from "@/types/database";

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

function GroupCard({
  group,
  userId,
  defaultHandles,
  onChanged,
}: {
  group: GroupDetails;
  userId: string;
  /** Profile prefills for the payment-handle field. */
  defaultHandles: { venmo: string; zelle: string };
  onChanged: () => void;
}) {
  const status = GROUP_STATUS_META[group.status];
  const payable = PAYABLE_GROUP_STATUSES.includes(group.status);
  const myPaid = group.my_status === "paid";
  const myMember = group.members.find((member) => member.user_id === userId);
  const [inviteEmails, setInviteEmails] = useState("");
  const [inviting, setInviting] = useState(false);
  // Each member declares Venmo or Zelle for THEIR share (migration 043).
  const [payMethod, setPayMethod] = useState<"venmo" | "zelle" | null>(
    myMember?.payment_method ?? null,
  );
  const [payHandle, setPayHandle] = useState(myMember?.payment_handle ?? "");
  const [savingPay, setSavingPay] = useState(false);

  const pickMethod = (method: "venmo" | "zelle") => {
    setPayMethod(method);
    setPayHandle((previous) => {
      const other = method === "venmo" ? "zelle" : "venmo";
      // Prefill from the profile unless they already typed something custom.
      if (!previous.trim() || previous === defaultHandles[other]) {
        return defaultHandles[method] || previous;
      }
      return previous;
    });
  };

  const savePayment = async () => {
    if (!payMethod) {
      toast.error("Pick Venmo or Zelle first.");
      return;
    }
    if (!payHandle.trim()) {
      toast.error(
        payMethod === "venmo" ? "Enter your Venmo username." : "Enter your Zelle email or phone.",
      );
      return;
    }
    setSavingPay(true);
    const { error } = await supabase.rpc("set_group_member_payment", {
      p_group_id: group.id,
      p_method: payMethod,
      p_handle: payHandle.trim(),
    });
    setSavingPay(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Saved. The club will match your payment to these details.");
    onChanged();
  };

  const copyZelle = async () => {
    if (!group.club_zelle) return;
    try {
      await navigator.clipboard.writeText(group.club_zelle);
      toast.success("Zelle number copied");
    } catch {
      toast.error("Could not copy, long-press the number instead");
    }
  };

  const unverifiedCount = group.members.filter((member) => member.status !== "paid").length;

  // Any member of a filling group can invite others (Tranche 4 #6).
  const inviteByEmail = async () => {
    const emails = [
      ...new Set(
        inviteEmails
          .split(/[,\n;]+/)
          .map((entry) => entry.trim().toLowerCase())
          .filter((entry) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(entry)),
      ),
    ];
    if (emails.length === 0) {
      toast.error("Add at least one valid email.");
      return;
    }
    setInviting(true);
    const { error } = await supabase.rpc("invite_to_group", {
      p_group_id: group.id,
      p_emails: emails,
    });
    setInviting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setInviteEmails("");
    toast.success("Invites sent.");
  };

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
            {group.status === "filling" && (
              <DeadlineTimer deadline={group.deadline} prefix="Fills within" />
            )}
            {group.status === "full" && group.order_deadline && (
              <DeadlineTimer deadline={group.order_deadline} prefix="Orders close in" />
            )}
            {payable && <DeadlineTimer deadline={group.deadline} prefix="Pay within" />}
          </div>
        </div>
      </div>

      {/* When you only pay: reinforced on every card until payment opens. */}
      {(group.status === "filling" || group.status === "full") && (
        <p className="mt-3 rounded-xl bg-primary/10 px-3 py-2.5 text-xs text-ink">
          {group.status === "filling"
            ? `You'll only pay once all ${group.total_people} spots fill and ${group.club_name} closes ordering. Nothing to pay yet — check back here for the status.`
            : `Your group is full. You'll pay your ${formatPrice(Number(group.share_amount))} share once ${group.club_name} closes ordering${group.order_deadline ? ` (by ${formatEasternDateTime(group.order_deadline)})` : ""}. We'll email you and update this page — nothing to do yet.`}
        </p>
      )}

      <div className="mt-4">
        <GroupMembers group={group} currentUserId={userId} />
      </div>

      {group.status === "filling" && (
        <div className="mt-4 space-y-3">
          {group.visibility === "public" && group.open_token && (
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                Share link (anyone can fill a spot)
              </p>
              <GroupInviteLink token={group.open_token} />
            </div>
          )}
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">
              Invite by email
            </p>
            <div className="flex gap-2">
              <Input
                value={inviteEmails}
                onChange={(e) => setInviteEmails(e.target.value)}
                placeholder="friend@cornell.edu"
                aria-label="Invite by email"
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                loading={inviting}
                onClick={() => void inviteByEmail()}
              >
                Invite
              </Button>
            </div>
          </div>
        </div>
      )}

      {payable && !myPaid && (
        <div className="mt-4 rounded-xl bg-primary/15 p-3">
          <p className="text-sm font-semibold">
            Ordering is closed — pay {group.club_name} {formatPrice(Number(group.share_amount))} now.
            The club verifies your share.
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            You have until {formatEasternDateTime(group.deadline)}. If anyone in the group misses the
            window it cancels; anyone who already paid gets refunded by the club directly.
          </p>

          {/* Where the money goes: the club's handles, visible to EVERY member. */}
          <div className="mt-2 space-y-2">
            {group.club_venmo && (
              <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-raised px-3 py-2">
                <p className="min-w-0 truncate text-xs text-ink-muted">
                  Venmo{" "}
                  <span className="ml-1 font-mono text-sm text-ink">
                    @{group.club_venmo.replace(/^@/, "")}
                  </span>
                </p>
                <Button
                  size="sm"
                  className="shrink-0"
                  onClick={() =>
                    openVenmo(group.club_venmo!, `Cornell Craves split: ${group.item_name}`)
                  }
                >
                  Pay my share
                </Button>
              </div>
            )}
            {group.club_zelle && (
              <div className="flex items-center justify-between gap-2 rounded-lg bg-surface-raised px-3 py-2">
                <p className="min-w-0 truncate text-xs text-ink-muted">
                  Zelle <span className="ml-1 font-mono text-sm text-ink">{group.club_zelle}</span>
                </p>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void copyZelle()}
                  aria-label="Copy Zelle number"
                  className="shrink-0 px-2.5 text-ink-muted"
                >
                  <Copy className="size-4" aria-hidden="true" />
                </Button>
              </div>
            )}
            {!group.club_venmo && !group.club_zelle && (
              <p className="text-xs text-ink-muted">
                This club has not added payment handles yet; check the listing page or contact
                them directly.
              </p>
            )}
          </div>

          {/* Each member says how THEY are paying, so the club can match it. */}
          <div className="mt-3 border-t border-border/60 pt-3">
            <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">
              How are you paying your share?
            </p>
            <div className="mt-1.5 flex gap-2" role="radiogroup" aria-label="Your payment method">
              {/* Only offer a method the club actually collects - matching the
                  pay buttons above, so a member can never declare "Zelle" to a
                  club that only takes Venmo (or vice versa). */}
              {(["venmo", "zelle"] as const)
                .filter((method) => (method === "venmo" ? group.club_venmo : group.club_zelle))
                .map((method) => (
                <button
                  key={method}
                  type="button"
                  role="radio"
                  aria-checked={payMethod === method}
                  onClick={() => pickMethod(method)}
                  className={cn(
                    "min-h-9 rounded-full border px-3.5 py-1.5 text-xs font-semibold capitalize transition-colors duration-150 [transition-timing-function:var(--ease-out)] active:scale-[0.97]",
                    payMethod === method
                      ? "border-ink bg-ink text-surface-raised"
                      : "border-border bg-surface-raised text-ink hover-fine:border-primary",
                  )}
                >
                  {method}
                </button>
              ))}
            </div>
            {payMethod && (
              <div className="mt-2 flex gap-2">
                <Input
                  value={payHandle}
                  onChange={(e) => setPayHandle(e.target.value)}
                  placeholder={payMethod === "venmo" ? "@your-venmo" : "netid@cornell.edu or phone"}
                  aria-label={payMethod === "venmo" ? "Your Venmo username" : "Your Zelle email or phone"}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={savingPay}
                  onClick={() => void savePayment()}
                >
                  Save
                </Button>
              </div>
            )}
            <p className="mt-1.5 text-xs text-ink-muted">
              {myMember?.payment_method
                ? `Saved: ${myMember.payment_method === "venmo" ? "Venmo" : "Zelle"}${myMember.payment_handle ? `, ${myMember.payment_handle}` : ""}. The club matches your payment to this.`
                : "Tell the club which handle the money comes from so they can verify you faster."}
            </p>
          </div>
        </div>
      )}

      {/* Passes unlock only once EVERY member's share is verified, matching the
          email behavior. Until then, a verified member sees a waiting note. */}
      {myPaid && group.status !== "paid" && group.status !== "canceled" && (
        <div className="mt-4 rounded-xl border border-dashed border-border p-3 text-sm text-ink-muted">
          Your share is verified. Your QR pass and pickup code unlock (and are emailed) once the
          club verifies everyone
          {unverifiedCount > 0 &&
            `, ${unverifiedCount} ${unverifiedCount === 1 ? "member" : "members"} to go`}
          .
        </div>
      )}

      {myPaid && group.status === "paid" && group.my_qr && (
        <div className="mt-4">
          <QRCodeView token={group.my_qr} label="Your pickup pass (yours only)" />
          {group.my_pickup_code && (
            <details className="mt-3">
              <summary className="cursor-pointer text-xs font-semibold text-ink-muted">
                Scanner not working? Show the pass code
              </summary>
              <p className="mt-2 text-xs text-ink-muted">
                Read this {group.my_pickup_code.length}-character code to the club. It is the
                same one in your email.
              </p>
              <p className="mt-1.5 rounded-xl bg-surface p-3 text-center font-mono text-lg font-bold tracking-[0.2em] text-ink">
                {group.my_pickup_code}
              </p>
            </details>
          )}
        </div>
      )}

      {group.status === "canceled" && (
        <p className="mt-3 text-xs text-ink-muted">
          This split was canceled — it either didn't fill in time or someone didn't pay within the
          window.{" "}
          {myPaid ? (
            <>
              You had already paid, so {group.club_name} owes you a refund — contact them directly,
              since Cornell Craves never held your money.
            </>
          ) : (
            <>You were not charged.</>
          )}{" "}
          The club can reactivate it; you'll get an email if that happens.
        </p>
      )}
    </div>
  );
}

export default function MyOrders() {
  const navigate = useNavigate();
  const { user, isGoogleUser, loading: authLoading } = useAuth();
  const { profile } = useProfile();
  const [orders, setOrders] = useState<MyOrder[]>([]);
  const [groups, setGroups] = useState<GroupDetails[]>([]);
  const [invites, setInvites] = useState<(GroupDetails & { invite_token: string })[]>([]);
  const [reservations, setReservations] = useState<MyReservation[]>([]);
  const [loading, setLoading] = useState(true);

  const userId = user?.id ?? null;
  // Pickup reservations are looked up by the account's Cornell email.
  const reservationEmail = (profile?.cornell_email || user?.email || "").toLowerCase();

  const load = useCallback(async () => {
    if (!userId) return;
    setLoading(true);
    const [ordersResult, groupsResult, invitesResult, reservationsResult] = await Promise.all([
      fetchMyOrders({ userId }),
      supabase.rpc("get_my_groups"),
      supabase.rpc("get_my_group_invites"),
      reservationEmail
        ? supabase.rpc("get_my_reservations", { p_email: reservationEmail })
        : Promise.resolve({ data: [] }),
    ]);
    if (ordersResult.error) toast.error(ordersResult.error);
    setOrders(ordersResult.orders);
    setGroups(((groupsResult.data as unknown as GroupDetails[]) ?? []).filter(Boolean));
    setInvites(
      ((invitesResult.data as unknown as (GroupDetails & { invite_token: string })[]) ?? []).filter(
        Boolean,
      ),
    );
    setReservations((reservationsResult.data as MyReservation[] | null) ?? []);
    setLoading(false);
  }, [userId, reservationEmail]);

  useEffect(() => {
    if (userId) void load();
  }, [userId, load]);

  // v4: orders require a Google student account. Stays on this route (rather
  // than redirecting to /login) so the Orders tab keeps showing active while
  // they sign in.
  if (!authLoading && (!user || !isGoogleUser)) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16">
        <div className="rounded-2xl border border-border bg-surface-raised p-6 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/20">
            <ReceiptText className="size-6 text-primary-dark" aria-hidden="true" />
          </div>
          <h1 className="mt-5 text-xl font-extrabold tracking-tight">Sign in to see your orders</h1>
          <p className="mt-2 text-sm text-ink-muted">
            Solo orders, split groups, and pickup passes all live here, tied to your Google
            account.
          </p>
          <div className="mt-5">
            <GoogleButton label="Sign in to see orders" redirectPath="/orders" />
          </div>
        </div>
      </div>
    );
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

  const now = Date.now();
  const upcomingReservations = reservations.filter((r) => new Date(r.end_time).getTime() > now);
  const pastReservations = reservations
    .filter((r) => new Date(r.end_time).getTime() <= now)
    .sort((a, b) => new Date(b.start_time).getTime() - new Date(a.start_time).getTime());

  const isEmpty =
    orders.length === 0 &&
    groups.length === 0 &&
    invites.length === 0 &&
    reservations.length === 0;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-10">
      <h1 className="text-2xl font-extrabold tracking-tight">Orders &amp; pickups</h1>
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
                  <GroupCard
                    key={group.id}
                    group={group}
                    userId={user!.id}
                    defaultHandles={{
                      venmo: profile?.venmo_id ?? "",
                      zelle: profile?.zelle_id ?? "",
                    }}
                    onChanged={() => void load()}
                  />
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

          {reservations.length > 0 && (
            <section className="mt-8">
              <h2 className="flex items-center gap-2 text-lg font-bold">
                <Ticket className="size-5 text-primary-dark" aria-hidden="true" />
                Pickup reservations
              </h2>
              {upcomingReservations.length > 0 && (
                <div className="mt-3 space-y-3">
                  {upcomingReservations.map((reservation) => (
                    <ReservationCard
                      key={reservation.id}
                      reservation={reservation}
                      email={reservationEmail}
                      past={false}
                      onChanged={() => void load()}
                    />
                  ))}
                </div>
              )}
              {pastReservations.length > 0 && (
                <>
                  <h3 className="mt-5 text-sm font-semibold text-ink-muted">Past</h3>
                  <div className="mt-2 space-y-3">
                    {pastReservations.map((reservation) => (
                      <ReservationCard
                        key={reservation.id}
                        reservation={reservation}
                        email={reservationEmail}
                        past
                        onChanged={() => void load()}
                      />
                    ))}
                  </div>
                </>
              )}
            </section>
          )}
        </>
      )}
    </div>
  );
}
