import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowLeft, BadgeCheck, ChevronDown, Download, Inbox, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { orderItemsSummary, ORDER_STATUS_META } from "@/lib/orders";
import { GROUP_STATUS_META, MEMBER_STATUS_META, PAYABLE_GROUP_STATUSES } from "@/lib/groups";
import { formatPrice } from "@/lib/format";
import { QRScanner } from "@/components/QRScanner";
import { DeadlineTimer } from "@/components/DeadlineTimer";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { GroupDetails, Order, OrderQRCode } from "@/types/database";

type OrderRow = Order & { order_qr_codes: OrderQRCode[] };
type ListingLite = { id: string; title: string; brand: string };

type StatusFilter = "all" | "pending_payment" | "qr_sent" | "picked_up";

const STATUS_FILTERS: { id: StatusFilter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "pending_payment", label: "Needs verification" },
  { id: "qr_sent", label: "QR sent" },
  { id: "picked_up", label: "Picked up" },
];

interface ScanResult {
  result: "picked_up" | "already_scanned" | "inactive" | "invalid";
  message: string;
  order?: {
    orderer_name: string;
    listing_title: string;
    items_summary: string;
    total: number;
  };
  holder?: { name: string; email: string; type: string };
}

// The edge function returns the real reason (e.g. "QR_SECRET is not set" or a
// Brevo send error) in its JSON body. supabase-js surfaces a non-2xx as a
// FunctionsHttpError whose `.context` is the Response, so pull the message out
// instead of showing a generic "could not verify" toast (Batch 2 #0).
async function readFnError(error: unknown): Promise<string> {
  const ctx = (error as { context?: Response } | null)?.context;
  if (ctx && typeof ctx.json === "function") {
    try {
      const body = (await ctx.json()) as { error?: string } | null;
      if (body && typeof body.error === "string" && body.error.trim()) return body.error;
    } catch {
      /* body was not JSON; fall through */
    }
  }
  return (error as { message?: string } | null)?.message ?? "Edge function error";
}

function csvEscape(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleString("en-US", {
    timeZone: "America/New_York",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** How many buyers still owe payment in a listing section (solo + split). */
function owedCount(orders: OrderRow[], groups: GroupDetails[]): number {
  const solo = orders.filter((order) => order.status === "pending_payment").length;
  const split = groups.reduce(
    (sum, group) => sum + group.members.filter((member) => member.status === "pending_payment").length,
    0,
  );
  return solo + split;
}

function qrStatus(order: OrderRow): string {
  if (order.status === "cancelled") return "Cancelled";
  if (!order.payment_verified) return "No QR yet";
  const scanned = order.order_qr_codes.find((qr) => qr.scanned_at);
  if (scanned) return `Used (${scanned.user_type})`;
  return "QR sent";
}

function OrderCard({
  order,
  verifying,
  onVerify,
}: {
  order: OrderRow;
  verifying: boolean;
  onVerify: () => void;
}) {
  const status = ORDER_STATUS_META[order.status];
  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold">
            {order.orderer_name}
            {order.orderer_netid && (
              <span className="ml-1.5 font-mono text-xs font-normal text-ink-muted">
                {order.orderer_netid}
              </span>
            )}
          </p>
          <p className="truncate font-mono text-xs text-ink-muted">{order.orderer_email}</p>
        </div>
        <Badge variant={status.variant}>{status.label}</Badge>
      </div>

      <p className="mt-2 text-sm">
        {orderItemsSummary(order.items_json)}{" "}
        <span className="font-mono font-bold">{formatPrice(Number(order.total))}</span>
      </p>
      <p className="mt-1 text-xs text-ink-muted">
        Pays via {order.payment_method === "both" ? "Venmo or Zelle" : order.payment_method}
        {order.payment_details_json.venmo && (
          <span className="ml-1 font-mono">@{order.payment_details_json.venmo}</span>
        )}
        {order.payment_details_json.zelle && (
          <span className="ml-1 font-mono">{order.payment_details_json.zelle}</span>
        )}
        <span className="mx-1">/</span>
        {qrStatus(order)}
        {order.proxy_name && (
          <>
            <span className="mx-1">/</span>proxy: {order.proxy_name}
          </>
        )}
      </p>
      {order.picked_up_by_name && (
        <p className="mt-1 text-xs text-ink-muted">
          Picked up by {order.picked_up_by_name} ({order.picked_up_by_email})
        </p>
      )}
      <p className="mt-1 text-[11px] text-ink-muted">
        Ordered {fmtDateTime(order.created_at)}
        {order.picked_up_at ? ` · Picked up ${fmtDateTime(order.picked_up_at)}` : ""}
      </p>

      {order.status === "pending_payment" && (
        <Button size="sm" className="mt-3" loading={verifying} onClick={onVerify}>
          <BadgeCheck className="size-3.5" aria-hidden="true" />
          Verify payment
        </Button>
      )}
    </div>
  );
}

function SplitGroupCard({
  group,
  busyId,
  onVerifyMember,
  onReactivate,
}: {
  group: GroupDetails;
  busyId: string | null;
  onVerifyMember: (memberId: string) => void;
  onReactivate: (groupId: string) => void;
}) {
  const status = GROUP_STATUS_META[group.status];
  const payable = PAYABLE_GROUP_STATUSES.includes(group.status);
  return (
    <div className="rounded-2xl border border-dashed border-border bg-surface-raised p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-bold">
            Split: {group.item_name}{" "}
            <span className="font-normal text-ink-muted">split {group.total_people} ways</span>
          </p>
          <p className="mt-0.5 text-xs text-ink-muted">
            <span className="font-mono font-bold text-ink">
              {formatPrice(Number(group.share_amount))}
            </span>{" "}
            per person, {formatPrice(Number(group.item_price))} total
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={status.variant}>{status.label}</Badge>
          {(group.status === "filling" || payable) && (
            <DeadlineTimer deadline={group.deadline} prefix="Deadline" />
          )}
        </div>
      </div>

      <ul className="mt-3 divide-y divide-border/60" aria-live="polite">
        {group.members.map((member) => {
          const meta = MEMBER_STATUS_META[member.status];
          return (
            <li key={member.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span className="text-sm font-semibold">
                {member.name}
                {member.is_creator && (
                  <span className="ml-1 text-xs font-normal text-ink-muted">started it</span>
                )}
              </span>
              <span className="flex items-center gap-2">
                {member.scanned_at ? (
                  <Badge variant="success">Picked up</Badge>
                ) : (
                  <Badge variant={meta.variant}>{meta.label}</Badge>
                )}
                {payable && member.status === "pending_payment" && (
                  <Button
                    size="sm"
                    loading={busyId === member.id}
                    onClick={() => onVerifyMember(member.id)}
                  >
                    <BadgeCheck className="size-3.5" aria-hidden="true" />
                    Verify share
                  </Button>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {group.status === "canceled" && (
        <Button
          variant="secondary"
          size="sm"
          className="mt-3"
          loading={busyId === group.id}
          onClick={() => onReactivate(group.id)}
        >
          Reactivate group
        </Button>
      )}
    </div>
  );
}

export default function ClubOrders() {
  const { clubId } = useParams<{ clubId: string }>();
  const { user, loading: authLoading } = useAuth();
  const [listings, setListings] = useState<ListingLite[]>([]);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [groups, setGroups] = useState<GroupDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [listingFilter, setListingFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [groupBusyId, setGroupBusyId] = useState<string | null>(null);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  // Listing sections are collapsible (#15); a listing id in this set is closed.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const toggleSection = (listingId: string) =>
    setCollapsed((previous) => {
      const next = new Set(previous);
      if (next.has(listingId)) next.delete(listingId);
      else next.add(listingId);
      return next;
    });

  const userId = user?.id ?? null;

  const refetch = useCallback(async () => {
    if (!userId) return;
    const { data: ownListings, error: listingsError } = await supabase
      .from("listings")
      .select("id, title, brand")
      .eq("club_id", userId)
      .order("created_at", { ascending: false });
    if (listingsError) {
      toast.error(listingsError.message);
      setLoading(false);
      return;
    }
    const ids = (ownListings ?? []).map((listing) => listing.id);
    setListings(ownListings ?? []);

    if (ids.length === 0) {
      setOrders([]);
      setLoading(false);
      return;
    }
    const [ordersResult, groupsResult] = await Promise.all([
      supabase
        .from("orders")
        .select("*, order_qr_codes(*)")
        .in("listing_id", ids)
        .order("created_at", { ascending: false })
        .returns<OrderRow[]>(),
      supabase.rpc("get_club_groups"),
    ]);
    if (ordersResult.error) {
      toast.error(ordersResult.error.message);
    } else {
      setOrders(ordersResult.data ?? []);
    }
    setGroups(((groupsResult.data as unknown as GroupDetails[]) ?? []).filter(Boolean));
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    if (userId && clubId === userId) void refetch();
  }, [userId, clubId, refetch]);

  const listingsWithOrders = useMemo(
    () => listings.filter((listing) => orders.some((order) => order.listing_id === listing.id)),
    [listings, orders],
  );

  const filtered = orders.filter((order) => {
    if (listingFilter && order.listing_id !== listingFilter) return false;
    if (statusFilter !== "all" && order.status !== statusFilter) return false;
    return true;
  });

  // Group everything under its listing (#15). Filters above narrow what each
  // section shows; split-order groups follow the listing filter too.
  const visibleGroups = groups.filter(
    (group) => !listingFilter || group.listing_id === listingFilter,
  );
  const sections = listings
    .map((listing) => ({
      listing,
      sectionOrders: filtered.filter((order) => order.listing_id === listing.id),
      sectionGroups: visibleGroups.filter((group) => group.listing_id === listing.id),
    }))
    .filter((section) => section.sectionOrders.length > 0 || section.sectionGroups.length > 0);

  if (authLoading) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-10" aria-busy="true" aria-label="Loading orders">
        <div className="h-9 w-40 animate-pulse rounded-xl bg-border/70" />
        <div className="mt-6 space-y-3">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-2xl bg-border/40" />
          ))}
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (clubId !== user.id) return <Navigate to={`/club/${user.id}/orders-dashboard`} replace />;

  const verifyGroupMember = async (memberId: string) => {
    setGroupBusyId(memberId);
    const { error } = await supabase.functions.invoke("notify-cravings", {
      body: { action: "verify_group_payment", member_id: memberId },
    });
    setGroupBusyId(null);
    if (error) {
      toast.error(`Verify failed: ${await readFnError(error)}`);
      return;
    }
    toast.success("Member marked paid. Their QR pass is on its way.");
    await refetch();
  };

  const reactivateGroup = async (groupId: string) => {
    setGroupBusyId(groupId);
    const { error } = await supabase.functions.invoke("notify-cravings", {
      body: { action: "reactivate_group", group_id: groupId },
    });
    setGroupBusyId(null);
    if (error) {
      toast.error(`Reactivate failed: ${await readFnError(error)}`);
      return;
    }
    toast.success("Group reactivated. Members have 24 hours to pay.");
    await refetch();
  };

  const verifyPayment = async (order: OrderRow) => {
    setVerifyingId(order.id);
    const { error } = await supabase.functions.invoke("notify-cravings", {
      body: { action: "verify_payment", order_id: order.id },
    });
    setVerifyingId(null);
    if (error) {
      toast.error(`Verify failed: ${await readFnError(error)}`);
      return;
    }
    toast.success(`Payment verified. QR ${order.proxy_name ? "passes" : "pass"} emailed.`);
    await refetch();
  };

  const handleToken = async (token: string) => {
    setScanBusy(true);
    setScanResult(null);
    const { data, error } = await supabase.functions.invoke("notify-cravings", {
      body: { action: "scan_qr", token },
    });
    setScanBusy(false);
    if (error) {
      setScanResult({ result: "invalid", message: `Scan failed: ${await readFnError(error)}` });
      return;
    }
    setScanResult(data as ScanResult);
    await refetch();
  };

  const exportCsv = () => {
    const listingTitle = (id: string) => listings.find((listing) => listing.id === id)?.title ?? "";
    // One column per distinct item name; each row holds that person's quantity (#17).
    const itemNames = [
      ...new Set(filtered.flatMap((order) => (order.items_json ?? []).map((line) => line.name))),
    ].sort((a, b) => a.localeCompare(b));
    const baseHeaders = [
      "name",
      "email",
      "netid",
      "listing",
      "amount_paid",
      "payment_method",
      "payment_details",
      "status",
      "picked_up_by",
      "ordered_at",
      "picked_up_at",
    ];
    const header = [...baseHeaders, ...itemNames].map(csvEscape).join(",");
    const rows = filtered.map((order) => {
      const qtyByName = new Map<string, number>();
      for (const line of order.items_json ?? []) {
        qtyByName.set(line.name, (qtyByName.get(line.name) ?? 0) + Number(line.qty));
      }
      const base = [
        csvEscape(order.orderer_name),
        csvEscape(order.orderer_email),
        csvEscape(order.orderer_netid ?? ""),
        csvEscape(listingTitle(order.listing_id)),
        formatPrice(Number(order.total)),
        order.payment_method,
        csvEscape(
          [
            order.payment_details_json.venmo ? `venmo @${order.payment_details_json.venmo}` : "",
            order.payment_details_json.zelle ? `zelle ${order.payment_details_json.zelle}` : "",
          ]
            .filter(Boolean)
            .join("; "),
        ),
        order.status,
        csvEscape(
          order.picked_up_by_name ? `${order.picked_up_by_name} (${order.picked_up_by_email})` : "",
        ),
        order.created_at,
        order.picked_up_at ?? "",
      ];
      const itemCols = itemNames.map((name) => String(qtyByName.get(name) ?? 0));
      return [...base, ...itemCols].join(",");
    });
    const blob = new Blob([[header, ...rows].join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "cornell-craves-orders.csv";
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10">
      <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover-fine:text-ink">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Dashboard
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Orders</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Verify payments to send QR passes, scan them at pickup.
          </p>
        </div>
        <Button variant="secondary" size="sm" onClick={exportCsv} disabled={filtered.length === 0}>
          <Download className="size-3.5" aria-hidden="true" />
          Export CSV
        </Button>
      </div>

      {/* Scanner + result */}
      <div className="mt-6">
        <QRScanner onToken={(token) => void handleToken(token)} busy={scanBusy} />
        {scanResult && (
          <div
            role="status"
            className={cn(
              "mt-3 rounded-2xl border p-4",
              scanResult.result === "picked_up"
                ? "border-tag-green bg-tag-green/30"
                : "border-accent/40 bg-accent/10",
            )}
          >
            <p className="flex items-center gap-2 text-sm font-bold">
              {scanResult.result === "picked_up" ? (
                <BadgeCheck className="size-4" aria-hidden="true" />
              ) : (
                <TriangleAlert className="size-4 text-accent" aria-hidden="true" />
              )}
              {scanResult.message}
            </p>
            {scanResult.order && (
              <p className="mt-1 text-sm text-ink-muted">
                {scanResult.order.orderer_name}: {scanResult.order.items_summary} (
                {formatPrice(Number(scanResult.order.total))}), {scanResult.order.listing_title}
              </p>
            )}
            {scanResult.holder && (
              <p className="mt-0.5 text-xs text-ink-muted">
                Pass holder: {scanResult.holder.name} ({scanResult.holder.email}), {scanResult.holder.type}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Filters */}
      {listingsWithOrders.length > 1 && (
        <div className="mt-6 -mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <button
            type="button"
            onClick={() => setListingFilter(null)}
            aria-pressed={listingFilter === null}
            className={cn(
              "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors duration-150 [transition-timing-function:var(--ease-out)]",
              listingFilter === null ? "bg-ink text-surface-raised" : "border border-border text-ink-muted",
            )}
          >
            All listings
          </button>
          {listingsWithOrders.map((listing) => (
            <button
              key={listing.id}
              type="button"
              onClick={() => setListingFilter(listing.id === listingFilter ? null : listing.id)}
              aria-pressed={listingFilter === listing.id}
              className={cn(
                "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors duration-150 [transition-timing-function:var(--ease-out)]",
                listingFilter === listing.id
                  ? "bg-ink text-surface-raised"
                  : "border border-border text-ink-muted",
              )}
            >
              {listing.title}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2" role="radiogroup" aria-label="Filter by status">
        {STATUS_FILTERS.map(({ id: filterId, label }) => (
          <button
            key={filterId}
            type="button"
            role="radio"
            aria-checked={statusFilter === filterId}
            onClick={() => setStatusFilter(filterId)}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors duration-150 [transition-timing-function:var(--ease-out)]",
              statusFilter === filterId
                ? "bg-ink text-surface-raised"
                : "border border-border text-ink-muted hover-fine:border-primary",
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Orders + split orders, grouped under each listing (#15) */}
      {loading ? (
        <div className="mt-6 space-y-3" aria-busy="true">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="h-28 animate-pulse rounded-2xl bg-border/40" />
          ))}
        </div>
      ) : sections.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={<Inbox className="size-6" aria-hidden="true" />}
            title="No orders here"
            body="Orders land in this dashboard the moment students place them on your listings."
          />
        </div>
      ) : (
        <div className="mt-6 space-y-4">
          {sections.map(({ listing, sectionOrders, sectionGroups }) => {
            const open = !collapsed.has(listing.id);
            const owed = owedCount(sectionOrders, sectionGroups);
            const orderCount = sectionOrders.length;
            return (
              <section key={listing.id} className="rounded-2xl border border-border bg-surface">
                <button
                  type="button"
                  onClick={() => toggleSection(listing.id)}
                  aria-expanded={open}
                  className="flex w-full items-center justify-between gap-3 rounded-2xl px-4 py-3 text-left hover-fine:bg-ink/[0.03]"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-bold">{listing.title}</span>
                    <span className="mt-0.5 block text-xs text-ink-muted">
                      {listing.brand}, {orderCount} {orderCount === 1 ? "order" : "orders"}
                      {sectionGroups.length > 0 &&
                        `, ${sectionGroups.length} split ${sectionGroups.length === 1 ? "order" : "orders"}`}
                    </span>
                  </span>
                  <span className="flex shrink-0 items-center gap-2">
                    {owed > 0 && <Badge variant="urgent">{owed} owe payment</Badge>}
                    <ChevronDown
                      className={cn(
                        "size-4 text-ink-muted transition-transform duration-150",
                        open && "rotate-180",
                      )}
                      aria-hidden="true"
                    />
                  </span>
                </button>

                {open && (
                  <div className="space-y-3 px-3 pb-3">
                    {sectionOrders.map((order) => (
                      <OrderCard
                        key={order.id}
                        order={order}
                        verifying={verifyingId === order.id}
                        onVerify={() => void verifyPayment(order)}
                      />
                    ))}
                    {sectionGroups.map((group) => (
                      <SplitGroupCard
                        key={group.id}
                        group={group}
                        busyId={groupBusyId}
                        onVerifyMember={(memberId) => void verifyGroupMember(memberId)}
                        onReactivate={(groupId) => void reactivateGroup(groupId)}
                      />
                    ))}
                    {sectionOrders.length === 0 && sectionGroups.length === 0 && (
                      <p className="px-1 py-2 text-xs text-ink-muted">
                        No orders match the current status filter.
                      </p>
                    )}
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
