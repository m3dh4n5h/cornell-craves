import { useCallback, useEffect, useMemo, useState } from "react";
import { Navigate } from "react-router-dom";
import { AlertTriangle, Compass, Eye, EyeOff, Inbox, PackageOpen, RefreshCw, ShieldX, Tag } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useTour } from "@/hooks/useTour";
import { formatExpiry, formatPrice } from "@/lib/format";
import {
  PeakHeatmap,
  RevenueLineChart,
  type RevenuePoint,
} from "@/components/AnalyticsChart";
import { EmptyState } from "@/components/EmptyState";
import { AdminRoster } from "@/components/admin/AdminRoster";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import type {
  AdminBrandRequest,
  AdminBrandRevenue,
  AdminClub,
  AdminClubBrandApproval,
  AdminGlobalBrand,
  AdminInsights,
  AdminListing,
  AdminOverview,
} from "@/types/database";

type BrandDecision = "one_time" | "global" | "reject";
type TabId =
  | "insights"
  | "approvals"
  | "requests"
  | "listings"
  | "clubs"
  | "revenue"
  | "brands"
  // Owner only. Filtered out of TABS entirely for a regular admin, so it is not
  // merely disabled - it does not exist in their console.
  | "admins";

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-1 break-words font-display text-xl font-extrabold sm:text-2xl">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-muted">{sub}</p>}
    </div>
  );
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function BrandRequestRow({
  request,
  busy,
  onDecide,
}: {
  request: AdminBrandRequest;
  busy: boolean;
  onDecide: (name: string, action: BrandDecision) => void;
}) {
  const [name, setName] = useState(request.requested_name);

  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-bold">{request.club_name}</p>
            {request.held_listings > 0 && (
              <Badge variant="neutral">
                {request.held_listings} {request.held_listings === 1 ? "drop" : "drops"} waiting
              </Badge>
            )}
          </div>
          <p className="mt-0.5 truncate text-xs text-ink-muted">
            {request.club_email} <span className="mx-1">/</span> requested {formatDay(request.created_at)}
          </p>
        </div>
        <div className="w-full sm:w-56">
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            aria-label="Brand name (rename to fix spelling)"
            placeholder="Brand name"
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button size="sm" loading={busy} onClick={() => onDecide(name, "global")}>
          Deploy to all
        </Button>
        <Button variant="secondary" size="sm" disabled={busy} onClick={() => onDecide(name, "one_time")}>
          Approve once
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => onDecide(name, "reject")}>
          Reject
        </Button>
      </div>
    </div>
  );
}

function ClubRow({
  club,
  busy,
  confirmingReject,
  onApprove,
  onRevoke,
  onReject,
}: {
  club: AdminClub;
  busy: boolean;
  confirmingReject: boolean;
  onApprove: () => void;
  onRevoke: () => void;
  onReject: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-base font-bold">{club.name}</h3>
            <Badge variant={club.approved ? "success" : "urgent"}>
              {club.approved ? "Approved" : "Pending"}
            </Badge>
          </div>
          <p className="mt-0.5 truncate text-xs text-ink-muted">
            {club.email} <span className="mx-1">/</span>
            <span className="font-mono">{club.venmo ? `@${club.venmo.replace(/^@/, "")}` : "no Venmo"}</span>
            <span className="mx-1">/</span> joined {formatDay(club.created_at)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {club.approved ? (
            <Button variant="secondary" size="sm" loading={busy} onClick={onRevoke}>
              Suspend
            </Button>
          ) : (
            <Button size="sm" loading={busy} onClick={onApprove}>
              Approve
            </Button>
          )}
          <Button
            variant={confirmingReject ? "destructive" : "ghost"}
            size="sm"
            disabled={busy}
            onClick={onReject}
          >
            {confirmingReject ? "Confirm delete" : "Delete"}
          </Button>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-4 text-xs text-ink-muted">
        <span>
          <span className="font-mono font-bold text-ink">{formatPrice(Number(club.revenue))}</span> revenue
        </span>
        <span>
          <span className="font-mono font-bold text-ink">{club.orders}</span> orders
        </span>
        <span>
          <span className="font-mono font-bold text-ink">{club.active_listings}</span> live /{" "}
          {club.listings} all-time drops
        </span>
      </div>
    </div>
  );
}

const TABS: { id: TabId; label: string; ownerOnly?: boolean }[] = [
  { id: "insights", label: "Insights" },
  { id: "approvals", label: "Approvals" },
  { id: "requests", label: "Brand requests" },
  { id: "listings", label: "Listings" },
  { id: "clubs", label: "Clubs" },
  { id: "revenue", label: "Revenue" },
  { id: "brands", label: "Brands" },
  { id: "admins", label: "Admins", ownerOnly: true },
];

/** Moderation row: any listing on the platform, with hide/restore. */
function AdminListingRow({
  listing,
  busy,
  onSetActive,
}: {
  listing: AdminListing;
  busy: boolean;
  onSetActive: (active: boolean) => void;
}) {
  const expired = new Date(listing.expires_at).getTime() <= Date.now();
  const held = listing.draft || listing.auto_post_on_brand;
  const status = held
    ? { variant: "neutral" as const, label: listing.draft ? "Draft" : "Posts on approval" }
    : expired
      ? { variant: "urgent" as const, label: "Ended" }
      : listing.active
        ? { variant: "success" as const, label: "Live" }
        : { variant: "neutral" as const, label: "Hidden" };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-border bg-surface-raised p-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="truncate text-base font-bold">{listing.title}</h3>
          <Badge variant={status.variant}>{status.label}</Badge>
        </div>
        <p className="mt-0.5 truncate text-xs text-ink-muted">
          {listing.brand} <span className="mx-1">/</span> {listing.club_name}
          <span className="mx-1">/</span> {listing.orders} {listing.orders === 1 ? "order" : "orders"}
          <span className="mx-1">/</span> ends {formatExpiry(listing.expires_at)}
        </p>
      </div>
      {!held && (
        <Button
          variant={listing.active ? "secondary" : "primary"}
          size="sm"
          loading={busy}
          onClick={() => onSetActive(!listing.active)}
        >
          {listing.active ? (
            <>
              <EyeOff className="size-3.5" aria-hidden="true" />
              Hide
            </>
          ) : (
            <>
              <Eye className="size-3.5" aria-hidden="true" />
              Restore
            </>
          )}
        </Button>
      )}
    </div>
  );
}

export default function Admin() {
  const { user, isAdmin, isOwner, loading: authLoading } = useAuth();
  const { open: openTour } = useTour();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [requests, setRequests] = useState<AdminBrandRequest[]>([]);
  const [clubs, setClubs] = useState<AdminClub[]>([]);
  const [brands, setBrands] = useState<AdminGlobalBrand[]>([]);
  const [clubBrands, setClubBrands] = useState<AdminClubBrandApproval[]>([]);
  const [allListings, setAllListings] = useState<AdminListing[]>([]);
  const [brandRevenue, setBrandRevenue] = useState<AdminBrandRevenue[]>([]);
  // Insights load separately: if migration 041 hasn't been applied yet, only
  // this tab degrades instead of the whole page erroring.
  const [insights, setInsights] = useState<AdminInsights | null>(null);
  const [insightsError, setInsightsError] = useState<string | null>(null);
  const [backendAdmin, setBackendAdmin] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<TabId>("approvals");
  const [search, setSearch] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);
  const [confirmRejectId, setConfirmRejectId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    const [ov, rq, cl, br, cb, li, rev, me, ins] = await Promise.all([
      supabase.rpc("admin_overview"),
      supabase.rpc("admin_brand_requests"),
      supabase.rpc("admin_clubs"),
      supabase.rpc("admin_global_brands"),
      supabase.rpc("admin_club_brand_approvals"),
      supabase.rpc("admin_listings"),
      supabase.rpc("admin_revenue_by_brand"),
      supabase.rpc("am_i_admin"),
      supabase.rpc("admin_insights"),
    ]);
    const firstError = ov.error || rq.error || cl.error || br.error || cb.error || li.error || rev.error || me.error;
    if (firstError) setError(firstError.message);
    setInsights((ins.data as AdminInsights | null) ?? null);
    setInsightsError(ins.error?.message ?? null);
    setOverview((ov.data as AdminOverview | null) ?? null);
    setRequests((rq.data as unknown as AdminBrandRequest[]) ?? []);
    setClubs((cl.data as unknown as AdminClub[]) ?? []);
    setBrands((br.data as unknown as AdminGlobalBrand[]) ?? []);
    setClubBrands((cb.data as unknown as AdminClubBrandApproval[]) ?? []);
    setAllListings((li.data as unknown as AdminListing[]) ?? []);
    setBrandRevenue((rev.data as unknown as AdminBrandRevenue[]) ?? []);
    setBackendAdmin(me.error ? null : (me.data as boolean | null) ?? false);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isAdmin) void load();
  }, [isAdmin, load]);

  const pendingClubs = useMemo(() => clubs.filter((club) => !club.approved), [clubs]);
  const clubsByRevenue = useMemo(
    () => [...clubs].sort((a, b) => Number(b.revenue) - Number(a.revenue)),
    [clubs],
  );
  const filteredClubs = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return clubs;
    return clubs.filter(
      (club) =>
        club.name.toLowerCase().includes(query) || club.email.toLowerCase().includes(query),
    );
  }, [clubs, search]);
  const filteredListings = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return allListings;
    return allListings.filter(
      (listing) =>
        listing.title.toLowerCase().includes(query) ||
        listing.brand.toLowerCase().includes(query) ||
        listing.club_name.toLowerCase().includes(query),
    );
  }, [allListings, search]);

  // Chart-ready shapes from admin_insights(). Days come back as YYYY-MM-DD in
  // America/New_York; fill the 30-day window so the trend has no gaps.
  const insightsView = useMemo(() => {
    if (!insights) return null;
    const revenueByDay = new Map(insights.daily.map((entry) => [entry.day, Number(entry.revenue)]));
    const dayKey = (date: Date) => date.toLocaleDateString("en-CA", { timeZone: "America/New_York" });
    const trend: RevenuePoint[] = Array.from({ length: 30 }, (_, index) => {
      const date = new Date(Date.now() - (29 - index) * 86_400_000);
      return {
        day: date.toLocaleDateString("en-US", {
          timeZone: "America/New_York",
          month: "short",
          day: "numeric",
        }),
        revenue: Math.round((revenueByDay.get(dayKey(date)) ?? 0) * 100) / 100,
      };
    });
    const heatmap: number[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    for (const cell of insights.heatmap) {
      if (heatmap[cell.dow]?.[cell.hour] !== undefined) heatmap[cell.dow][cell.hour] = cell.orders;
    }
    const orders30d = insights.daily.reduce((sum, entry) => sum + Number(entry.orders), 0);
    return { trend, heatmap, orders30d };
  }, [insights]);

  if (authLoading) {
    return (
      <div className="mx-auto w-full max-w-4xl px-4 py-10" aria-busy="true" aria-label="Loading admin panel">
        <div className="h-9 w-40 animate-pulse rounded-xl bg-border/70" />
        <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
          {Array.from({ length: 8 }, (_, index) => (
            <div key={index} className="h-20 animate-pulse rounded-2xl bg-border/40" />
          ))}
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" replace />;
  if (!isAdmin) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16">
        <EmptyState
          icon={<ShieldX className="size-6" aria-hidden="true" />}
          title="Admins only"
          body="This account does not have admin access. If that seems wrong, check VITE_ADMIN_EMAIL."
        />
      </div>
    );
  }

  const approveClub = async (id: string) => {
    setBusyId(id);
    const { error: rpcError } = await supabase.rpc("admin_set_club_approved", {
      p_club_id: id,
      p_approved: true,
    });
    setBusyId(null);
    if (rpcError) {
      toast.error(rpcError.message);
      return;
    }
    toast.success("Club approved. Welcome email is on its way.");
    await load();
  };

  const revokeClub = async (id: string) => {
    setBusyId(id);
    const { error: rpcError } = await supabase.rpc("admin_set_club_approved", {
      p_club_id: id,
      p_approved: false,
    });
    setBusyId(null);
    if (rpcError) {
      toast.error(rpcError.message);
      return;
    }
    toast.success("Club suspended and its live drops hidden.");
    await load();
  };

  const rejectClub = async (id: string) => {
    if (confirmRejectId !== id) {
      setConfirmRejectId(id);
      return;
    }
    setBusyId(id);
    const { error: deleteError } = await supabase.from("clubs").delete().eq("id", id);
    setBusyId(null);
    setConfirmRejectId(null);
    if (deleteError) {
      toast.error(deleteError.message);
      return;
    }
    toast.success("Club deleted.");
    await load();
  };

  const decideBrand = async (id: string, name: string, action: BrandDecision) => {
    setBusyId(id);
    const { error: rpcError } = await supabase.rpc("decide_brand_request", {
      p_id: id,
      p_name: name,
      p_action: action,
    });
    setBusyId(null);
    if (rpcError) {
      toast.error(rpcError.message);
      return;
    }
    toast.success(
      action === "global"
        ? `"${name}" added for every club and in cravings.`
        : action === "one_time"
          ? `"${name}" approved for that club. Their waiting drops post now, and they can reuse the brand any time.`
          : "Request rejected.",
    );
    await load();
  };

  const setListingActive = async (id: string, active: boolean) => {
    setBusyId(id);
    const { error: rpcError } = await supabase.rpc("admin_set_listing_active", {
      p_id: id,
      p_active: active,
    });
    setBusyId(null);
    if (rpcError) {
      toast.error(rpcError.message);
      return;
    }
    toast.success(active ? "Listing restored to the feed." : "Listing hidden from the feed.");
    await load();
  };

  const revokeClubBrand = async (id: string, brand: string, clubName: string) => {
    if (!window.confirm(`Revoke "${brand}" for ${clubName}? They won't be able to publish new drops with it.`)) {
      return;
    }
    setBusyId(id);
    const { error: rpcError } = await supabase.rpc("admin_revoke_club_brand", { p_id: id });
    setBusyId(null);
    if (rpcError) {
      toast.error(rpcError.message);
      return;
    }
    toast.success(`"${brand}" revoked for ${clubName}.`);
    await load();
  };

  const removeBrand = async (id: string, name: string) => {
    setBusyId(id);
    const { error: rpcError } = await supabase.rpc("admin_remove_brand", { p_brand_id: id });
    setBusyId(null);
    if (rpcError) {
      toast.error(rpcError.message);
      return;
    }
    toast.success(`"${name}" removed from the global list.`);
    await load();
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-10">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight">Admin operations</h1>
          <p className="mt-1 text-sm text-ink-muted">Cornell Craves at a glance.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Replayable admin walkthrough. Every decision in it is simulated, so
              no club is approved and no brand is granted by tapping through. */}
          <Button variant="ghost" size="sm" onClick={() => openTour("admin")}>
            <Compass className="size-3.5" aria-hidden="true" />
            How this works
          </Button>
          <Button variant="secondary" size="sm" loading={loading} onClick={() => void load()}>
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-accent/40 bg-accent/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
          <span>
            Some admin data failed to load: {error}. Confirm your account matches{" "}
            <span className="font-mono">VITE_ADMIN_EMAIL</span> and the migration's{" "}
            <span className="font-mono">is_admin()</span> email.
          </span>
        </div>
      )}

      {backendAdmin === false && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl border border-accent/40 bg-accent/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
          <span>
            The app shows you this page, but the database does not recognize you as admin, so all
            stats and brand requests come back empty. Update{" "}
            <span className="font-mono">is_admin()</span> to your exact Google account email
            (currently checks <span className="font-mono">{user.email}</span>) and re-run the
            migration.
          </span>
        </div>
      )}

      {/* Overview */}
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard
          label="Revenue"
          value={overview ? formatPrice(Number(overview.revenue)) : "n/a"}
          sub="verified payments"
        />
        <StatCard
          label="Orders"
          value={overview ? String(overview.orders_verified) : "n/a"}
          sub={overview ? `${overview.orders_pending} awaiting verify` : undefined}
        />
        <StatCard
          label="Clubs"
          value={overview ? String(overview.clubs_approved) : "n/a"}
          sub={overview ? `${overview.clubs_pending} pending` : undefined}
        />
        <StatCard
          label="Live drops"
          value={overview ? String(overview.listings_active) : "n/a"}
          sub={overview ? `${overview.listings_draft} drafts` : undefined}
        />
        <StatCard label="Students" value={overview ? String(overview.students) : "n/a"} />
        <StatCard label="Craving subs" value={overview ? String(overview.cravings) : "n/a"} />
        <StatCard label="Reservations" value={overview ? String(overview.reservations) : "n/a"} />
        <StatCard
          label="Brand requests"
          value={overview ? String(overview.brand_requests_pending) : "n/a"}
          sub="pending"
        />
      </div>

      {/* Tabs */}
      <div className="mt-8 flex flex-wrap gap-2" role="tablist" aria-label="Admin sections">
        {TABS.filter(({ ownerOnly }) => !ownerOnly || isOwner).map(({ id, label }) => {
          const count =
            id === "approvals"
              ? pendingClubs.length
              : id === "requests"
                ? requests.length
                : id === "listings"
                  ? allListings.filter((listing) => listing.active).length
                  : id === "clubs"
                    ? clubs.length
                    : id === "brands"
                      ? brands.length + clubBrands.length
                      : 0;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={cn(
                "rounded-full px-4 py-1.5 text-sm font-semibold transition-colors duration-150 [transition-timing-function:var(--ease-out)]",
                tab === id ? "bg-ink text-surface-raised" : "border border-border text-ink-muted hover-fine:border-primary",
              )}
            >
              {label}
              {count > 0 && <span className="ml-1.5 text-xs opacity-80">({count})</span>}
            </button>
          );
        })}
      </div>

      <section className="mt-6">
        {loading ? (
          <div className="space-y-3" aria-busy="true">
            {Array.from({ length: 3 }, (_, index) => (
              <div key={index} className="h-24 animate-pulse rounded-2xl bg-border/40" />
            ))}
          </div>
        ) : tab === "insights" ? (
          insightsError ? (
            <div className="flex items-start gap-2 rounded-2xl border border-accent/40 bg-accent/10 p-3 text-sm">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden="true" />
              <span>
                Insights need the <span className="font-mono">041_admin_insights.sql</span> migration.
                Apply it to Supabase and refresh. ({insightsError})
              </span>
            </div>
          ) : !insights || !insightsView ? (
            <EmptyState
              icon={<Inbox className="size-6" aria-hidden="true" />}
              title="No insight data"
              body="Once verified orders start coming in, platform-wide buying patterns show up here."
            />
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <StatCard
                  label="Avg order value"
                  value={formatPrice(Number(insights.avg_order_value_30d))}
                  sub={`${insightsView.orders30d} orders in 30 days`}
                />
                <StatCard
                  label="Repeat buyers"
                  value={
                    insights.buyers_total > 0
                      ? `${Math.round((insights.buyers_repeat / insights.buyers_total) * 100)}%`
                      : "n/a"
                  }
                  sub={`${insights.buyers_repeat} of ${insights.buyers_total} ordered again`}
                />
                <StatCard
                  label="New buyers"
                  value={String(insights.buyers_new_30d)}
                  sub="first order in last 30 days"
                />
                <StatCard
                  label="New students"
                  value={String(insights.students_new_30d)}
                  sub="accounts created, last 30 days"
                />
              </div>

              <section className="rounded-2xl border border-border bg-surface-raised p-4">
                <h3 className="text-sm font-bold">Platform revenue, last 30 days</h3>
                <p className="mt-0.5 text-xs text-ink-muted">
                  Verified payments plus paid group shares, across every club.
                </p>
                <div className="mt-3">
                  <RevenueLineChart data={insightsView.trend} />
                </div>
              </section>

              <div className="grid gap-4 lg:grid-cols-2">
                <section className="rounded-2xl border border-border bg-surface-raised p-4">
                  <h3 className="text-sm font-bold">Top items platform-wide</h3>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    What students actually buy, last 30 days.
                  </p>
                  {insights.top_items.length === 0 ? (
                    <p className="mt-3 text-sm text-ink-muted">No verified item sales yet.</p>
                  ) : (
                    <div className="mt-3 overflow-x-auto">
                      <table className="w-full min-w-[300px] text-sm">
                        <thead>
                          <tr className="text-left text-xs uppercase tracking-wide text-ink-muted">
                            <th className="pb-2 font-semibold">Item</th>
                            <th className="pb-2 text-right font-semibold">Units</th>
                            <th className="pb-2 text-right font-semibold">Revenue</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-border/60">
                          {insights.top_items.map((item) => (
                            <tr key={item.name}>
                              <td className="py-2 pr-2 font-semibold">{item.name}</td>
                              <td className="py-2 text-right font-mono">{item.units}</td>
                              <td className="py-2 text-right font-mono font-bold">
                                {formatPrice(Number(item.revenue))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>
                <section className="rounded-2xl border border-border bg-surface-raised p-4">
                  <h3 className="text-sm font-bold">When students order</h3>
                  <p className="mt-0.5 text-xs text-ink-muted">
                    Verified orders by day and hour, last 30 days, Ithaca time.
                  </p>
                  <div className="mt-3">
                    <PeakHeatmap matrix={insightsView.heatmap} />
                  </div>
                </section>
              </div>
            </div>
          )
        ) : tab === "approvals" ? (
          pendingClubs.length === 0 ? (
            <EmptyState
              icon={<Inbox className="size-6" aria-hidden="true" />}
              title="All caught up"
              body="No clubs are waiting on approval. New registrations show up here."
            />
          ) : (
            <div className="space-y-3">
              {pendingClubs.map((club) => (
                <ClubRow
                  key={club.id}
                  club={club}
                  busy={busyId === club.id}
                  confirmingReject={confirmRejectId === club.id}
                  onApprove={() => void approveClub(club.id)}
                  onRevoke={() => void revokeClub(club.id)}
                  onReject={() => void rejectClub(club.id)}
                />
              ))}
            </div>
          )
        ) : tab === "requests" ? (
          requests.length === 0 ? (
            <EmptyState
              icon={<Tag className="size-6" aria-hidden="true" />}
              title="No brand requests"
              body="When a club asks for a brand that isn't in the list, it shows up here."
            />
          ) : (
            <>
              <p className="mb-3 text-sm text-ink-muted">
                Rename to fix spelling, then deploy to all (adds it everywhere, incl. cravings) or
                approve once for that club. Either way their waiting drops publish and the club can
                keep using the brand; one-time grants are listed (and revocable) under Brands.
              </p>
              <div className="space-y-3">
                {requests.map((request) => (
                  <BrandRequestRow
                    key={request.id}
                    request={request}
                    busy={busyId === request.id}
                    onDecide={(name, action) => void decideBrand(request.id, name, action)}
                  />
                ))}
              </div>
            </>
          )
        ) : tab === "listings" ? (
          <>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by title, brand, or club"
              aria-label="Search listings"
              className="mb-3"
            />
            {filteredListings.length === 0 ? (
              <EmptyState
                icon={<PackageOpen className="size-6" aria-hidden="true" />}
                title="No listings match"
                body="Every drop on the platform shows here, newest first."
              />
            ) : (
              <div className="space-y-3">
                {filteredListings.map((listing) => (
                  <AdminListingRow
                    key={listing.id}
                    listing={listing}
                    busy={busyId === listing.id}
                    onSetActive={(active) => void setListingActive(listing.id, active)}
                  />
                ))}
              </div>
            )}
          </>
        ) : tab === "clubs" ? (
          <>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search clubs by name or email"
              aria-label="Search clubs"
              className="mb-3"
            />
            {filteredClubs.length === 0 ? (
              <EmptyState
                icon={<Inbox className="size-6" aria-hidden="true" />}
                title="No clubs match"
                body="Try a different search."
              />
            ) : (
              <div className="space-y-3">
                {filteredClubs.map((club) => (
                  <ClubRow
                    key={club.id}
                    club={club}
                    busy={busyId === club.id}
                    confirmingReject={confirmRejectId === club.id}
                    onApprove={() => void approveClub(club.id)}
                    onRevoke={() => void revokeClub(club.id)}
                    onReject={() => void rejectClub(club.id)}
                  />
                ))}
              </div>
            )}
          </>
        ) : tab === "admins" ? (
          // Belt and braces: the tab is already filtered out for non-owners,
          // and every RPC behind this component re-checks is_owner() anyway.
          isOwner ? (
            <AdminRoster />
          ) : null
        ) : tab === "revenue" ? (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-bold">Revenue by brand</h3>
              {brandRevenue.length === 0 ? (
                <p className="mt-2 text-sm text-ink-muted">No verified revenue yet.</p>
              ) : (
                <div className="mt-2 overflow-x-auto rounded-2xl border border-border bg-surface-raised p-3">
                  <table className="w-full min-w-[360px] text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-ink-muted">
                        <th className="pb-2 font-semibold">Brand</th>
                        <th className="pb-2 text-right font-semibold">Revenue</th>
                        <th className="pb-2 text-right font-semibold">Orders</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {brandRevenue.map((row) => (
                        <tr key={row.brand}>
                          <td className="py-2 pr-2 font-semibold">{row.brand}</td>
                          <td className="py-2 text-right font-mono font-bold">
                            {formatPrice(Number(row.revenue))}
                          </td>
                          <td className="py-2 text-right font-mono text-ink-muted">{row.orders}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div>
              <h3 className="text-sm font-bold">Revenue by club</h3>
              {clubsByRevenue.length === 0 ? (
                <p className="mt-2 text-sm text-ink-muted">No clubs yet.</p>
              ) : (
                <div className="mt-2 overflow-x-auto rounded-2xl border border-border bg-surface-raised p-3">
                  <table className="w-full min-w-[360px] text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase tracking-wide text-ink-muted">
                        <th className="pb-2 font-semibold">Club</th>
                        <th className="pb-2 text-right font-semibold">Revenue</th>
                        <th className="pb-2 text-right font-semibold">Orders</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {clubsByRevenue.map((club) => (
                        <tr key={club.id}>
                          <td className="py-2 pr-2 font-semibold">{club.name}</td>
                          <td className="py-2 text-right font-mono font-bold">
                            {formatPrice(Number(club.revenue))}
                          </td>
                          <td className="py-2 text-right font-mono text-ink-muted">{club.orders}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div>
              <h3 className="text-sm font-bold">Global brands (every club)</h3>
              {brands.length === 0 ? (
                <p className="mt-2 text-sm text-ink-muted">
                  Brands you deploy to all clubs appear here. The built-in list lives in the app.
                </p>
              ) : (
                <div className="mt-2 space-y-2">
                  {brands.map((brand) => (
                    <div
                      key={brand.id}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface-raised p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold">{brand.name}</p>
                        <p className="text-xs text-ink-muted">added {formatDay(brand.created_at)}</p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={busyId === brand.id}
                        className="text-accent"
                        onClick={() => void removeBrand(brand.id, brand.name)}
                      >
                        Remove
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h3 className="text-sm font-bold">One-time approvals (single club)</h3>
              {clubBrands.length === 0 ? (
                <p className="mt-2 text-sm text-ink-muted">
                  "Approve once" grants show here. They let one club keep posting a brand without it
                  joining the global list.
                </p>
              ) : (
                <div className="mt-2 space-y-2">
                  {clubBrands.map((grant) => (
                    <div
                      key={grant.id}
                      className="flex items-center justify-between gap-3 rounded-2xl border border-border bg-surface-raised p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-bold">{grant.brand}</p>
                        <p className="truncate text-xs text-ink-muted">
                          {grant.club_name} <span className="mx-1">/</span> approved{" "}
                          {formatDay(grant.created_at)}
                        </p>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        loading={busyId === grant.id}
                        className="text-accent"
                        onClick={() => void revokeClubBrand(grant.id, grant.brand, grant.club_name)}
                      >
                        Revoke
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
