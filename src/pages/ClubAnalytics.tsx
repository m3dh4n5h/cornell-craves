import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowLeft, BarChart3 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import {
  PeakHeatmap,
  RankBarChart,
  RevenueLineChart,
  TagBarChart,
  type RevenuePoint,
} from "@/components/AnalyticsChart";
import { EmptyState } from "@/components/EmptyState";
import { RatingStars } from "@/components/RatingStars";
import { DIETARY_TAGS, isDietaryTagId } from "@/lib/dietary";
import { formatPrice } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { GroupDetails, Listing, OrderItem, QAEntry } from "@/types/database";

/** Only verified payments count toward money figures (Tranche 4 #1). */
interface VerifiedOrder {
  listing_id: string;
  total: number;
  items_json: OrderItem[];
  orderer_email: string;
  recommended_by: string | null;
  created_at: string;
}

interface ViewRow {
  listing_id: string;
  created_at: string;
}

type ListingLite = Pick<
  Listing,
  "id" | "title" | "brand" | "avg_rating" | "review_count" | "items" | "active"
>;

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className="mt-1 font-display text-2xl font-extrabold">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-muted">{sub}</p>}
    </div>
  );
}

function AnalyticsSkeleton() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10" aria-busy="true" aria-label="Loading analytics">
      <div className="h-9 w-48 animate-pulse rounded-xl bg-border/70" />
      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} className="h-24 animate-pulse rounded-2xl bg-border/40" />
        ))}
      </div>
      <div className="mt-6 h-64 animate-pulse rounded-2xl bg-border/40" />
    </div>
  );
}

export default function ClubAnalytics() {
  const { clubId } = useParams<{ clubId: string }>();
  const { user, loading: authLoading } = useAuth();
  const [orders, setOrders] = useState<VerifiedOrder[]>([]);
  const [views, setViews] = useState<ViewRow[]>([]);
  const [groups, setGroups] = useState<GroupDetails[]>([]);
  const [listings, setListings] = useState<ListingLite[]>([]);
  const [qaEntries, setQaEntries] = useState<Pick<QAEntry, "listing_id" | "created_at" | "response_date">[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<7 | 30>(30);

  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId || clubId !== userId) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const cutoff = new Date(Date.now() - 30 * 24 * 3_600_000).toISOString();

      const listingsResult = await supabase
        .from("listings")
        .select("id, title, brand, avg_rating, review_count, items, active")
        .eq("club_id", userId);
      if (cancelled) return;

      const ownListings = (listingsResult.data as ListingLite[] | null) ?? [];
      const ids = ownListings.map((listing) => listing.id);

      const [ordersResult, viewsResult, qaResult, groupsResult] =
        ids.length > 0
          ? await Promise.all([
              supabase
                .from("orders")
                .select("listing_id, total, items_json, orderer_email, recommended_by, created_at")
                .in("listing_id", ids)
                .eq("payment_verified", true)
                .gte("created_at", cutoff),
              supabase
                .from("analytics_events")
                .select("listing_id, created_at")
                .eq("club_id", userId)
                .eq("event_type", "view")
                .gte("created_at", cutoff),
              supabase.from("qa").select("listing_id, created_at, response_date").in("listing_id", ids),
              supabase.rpc("get_club_groups"),
            ])
          : [{ data: [] }, { data: [] }, { data: [] }, { data: [] }];
      if (cancelled) return;

      setListings(ownListings);
      setOrders((ordersResult.data as VerifiedOrder[] | null) ?? []);
      setViews((viewsResult.data as ViewRow[] | null) ?? []);
      setQaEntries(qaResult.data ?? []);
      setGroups(((groupsResult.data as unknown as GroupDetails[]) ?? []).filter(Boolean));
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [userId, clubId]);

  const computed = useMemo(() => {
    const cutoff = Date.now() - range * 24 * 3_600_000;
    const inRange = orders.filter((order) => new Date(order.created_at).getTime() >= cutoff);
    const viewsInRange = views.filter((view) => new Date(view.created_at).getTime() >= cutoff);
    // Only paid members of a group count as money in the bank.
    const groupsInRange = groups.filter((group) => new Date(group.created_at).getTime() >= cutoff);

    const soloRevenue = inRange.reduce((sum, order) => sum + Number(order.total), 0);

    // Unique buyers + group revenue + per-item + per-listing all in one pass.
    const buyers = new Set<string>();
    const itemAgg = new Map<string, { units: number; revenue: number }>();
    const byListing = new Map<string, { revenue: number; orders: number }>();
    const recommenders = new Map<string, number>();

    const bumpItem = (name: string, units: number, revenue: number) => {
      const entry = itemAgg.get(name) ?? { units: 0, revenue: 0 };
      entry.units += units;
      entry.revenue += revenue;
      itemAgg.set(name, entry);
    };
    const bumpListing = (id: string, revenue: number, orders: number) => {
      const entry = byListing.get(id) ?? { revenue: 0, orders: 0 };
      entry.revenue += revenue;
      entry.orders += orders;
      byListing.set(id, entry);
    };

    for (const order of inRange) {
      buyers.add(`email:${order.orderer_email.toLowerCase()}`);
      bumpListing(order.listing_id, Number(order.total), 1);
      for (const line of order.items_json ?? []) {
        bumpItem(line.name, Number(line.qty), Number(line.price) * Number(line.qty));
      }
      const ref = order.recommended_by?.trim();
      if (ref) recommenders.set(ref, (recommenders.get(ref) ?? 0) + Number(order.total));
    }

    let groupRevenue = 0;
    for (const group of groupsInRange) {
      const perPerson = group.units_per_person ?? Math.floor(group.item_quantity / Math.max(group.total_people, 1));
      for (const member of group.members) {
        if (member.status !== "paid") continue;
        groupRevenue += Number(group.share_amount);
        buyers.add(`uid:${member.user_id}`);
        bumpListing(group.listing_id, Number(group.share_amount), 1);
        bumpItem(group.item_name, perPerson, Number(group.share_amount));
      }
    }

    const totalRevenue = soloRevenue + groupRevenue;
    const orderCount = inRange.length;
    const avgOrderValue = orderCount > 0 ? soloRevenue / orderCount : 0;

    // Box size per item name, to express sell-through in boxes where set.
    const boxSize = new Map<string, number>();
    for (const listing of listings) {
      for (const item of listing.items ?? []) {
        const qty = Math.max(1, item.quantity ?? 1);
        boxSize.set(item.name, Math.max(boxSize.get(item.name) ?? 1, qty));
      }
    }

    const items = [...itemAgg.entries()]
      .map(([name, agg]) => ({
        name,
        units: agg.units,
        revenue: agg.revenue,
        box: boxSize.get(name) ?? 1,
      }))
      .sort((a, b) => b.units - a.units);

    const itemRevenueChart = items
      .map((item) => ({ name: item.name, value: Math.round(item.revenue * 100) / 100 }))
      .slice(0, 8);

    const leaderboard = [...recommenders.entries()]
      .map(([name, value]) => ({ name, value: Math.round(value * 100) / 100 }))
      .sort((a, b) => b.value - a.value);

    // Daily revenue trend (solo orders + paid group shares by created_at).
    const revenueByDay = new Map<number, number>();
    const dayKey = (iso: string) => {
      const date = new Date(iso);
      date.setHours(0, 0, 0, 0);
      return date.getTime();
    };
    for (const order of inRange) {
      revenueByDay.set(dayKey(order.created_at), (revenueByDay.get(dayKey(order.created_at)) ?? 0) + Number(order.total));
    }
    for (const group of groupsInRange) {
      const paid = group.members.filter((member) => member.status === "paid").length;
      if (paid === 0) continue;
      const add = paid * Number(group.share_amount);
      revenueByDay.set(dayKey(group.created_at), (revenueByDay.get(dayKey(group.created_at)) ?? 0) + add);
    }
    const trend: RevenuePoint[] = Array.from({ length: range }, (_, index) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (range - 1 - index));
      return {
        day: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        revenue: Math.round((revenueByDay.get(date.getTime()) ?? 0) * 100) / 100,
      };
    });

    // Peak ORDER times (Tranche 4 #1: heatmap driven off orders).
    const heatmap: number[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    for (const order of inRange) {
      const date = new Date(order.created_at);
      const day = (date.getDay() + 6) % 7; // Monday-first
      heatmap[day][date.getHours()] += 1;
    }

    const rated = listings.filter((listing) => listing.review_count > 0);
    const reviewCount = rated.reduce((sum, listing) => sum + listing.review_count, 0);
    const avgRating =
      reviewCount > 0
        ? rated.reduce((sum, listing) => sum + Number(listing.avg_rating) * listing.review_count, 0) / reviewCount
        : null;

    const answered = qaEntries.filter((entry) => entry.response_date);
    const avgResponseHours =
      answered.length > 0
        ? answered.reduce(
            (sum, entry) =>
              sum + (new Date(entry.response_date!).getTime() - new Date(entry.created_at).getTime()) / 3_600_000,
            0,
          ) / answered.length
        : null;

    const tagCounts = new Map<string, number>();
    for (const listing of listings) {
      for (const item of listing.items ?? []) {
        for (const tag of item.dietary_tags ?? []) {
          if (isDietaryTagId(tag)) tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
        }
      }
    }
    const dietary = [...tagCounts.entries()]
      .map(([tag, count]) => ({ name: DIETARY_TAGS[tag as keyof typeof DIETARY_TAGS].label, count }))
      .sort((a, b) => b.count - a.count);

    const viewsByListing = new Map<string, number>();
    for (const view of viewsInRange) {
      viewsByListing.set(view.listing_id, (viewsByListing.get(view.listing_id) ?? 0) + 1);
    }

    const perListing = listings
      .map((listing) => ({
        listing,
        revenue: byListing.get(listing.id)?.revenue ?? 0,
        orders: byListing.get(listing.id)?.orders ?? 0,
        views: viewsByListing.get(listing.id) ?? 0,
      }))
      .sort((a, b) => b.revenue - a.revenue);

    return {
      totalRevenue,
      groupRevenue,
      orderCount,
      avgOrderValue,
      uniqueBuyers: buyers.size,
      totalViews: viewsInRange.length,
      items,
      itemRevenueChart,
      leaderboard,
      trend,
      heatmap,
      avgRating,
      reviewCount,
      qaTotal: qaEntries.length,
      qaAnswered: answered.length,
      avgResponseHours,
      dietary,
      perListing,
    };
  }, [orders, views, groups, listings, qaEntries, range]);

  if (authLoading) return <AnalyticsSkeleton />;
  if (!user) return <Navigate to="/login" replace />;
  if (clubId !== user.id) return <Navigate to={`/club/${user.id}/analytics`} replace />;
  if (loading) return <AnalyticsSkeleton />;

  const bestSeller = computed.items[0] ?? null;
  const slowest = computed.items.length > 1 ? computed.items[computed.items.length - 1] : null;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover-fine:text-ink">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Dashboard
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">Analytics</h1>
        <div className="flex gap-1 rounded-full border border-border p-1" role="radiogroup" aria-label="Time range">
          {([7, 30] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={range === option}
              onClick={() => setRange(option)}
              className={cn(
                "rounded-full px-3.5 py-1 text-xs font-semibold transition-colors duration-150 [transition-timing-function:var(--ease-out)]",
                range === option ? "bg-ink text-surface-raised" : "text-ink-muted hover-fine:text-ink",
              )}
            >
              {option} days
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-sm text-ink-muted">
        Money figures count verified payments only, over the last {range} days.
      </p>

      {listings.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={<BarChart3 className="size-6" aria-hidden="true" />}
            title="No data yet"
            body="Post your first drop and analytics start collecting: revenue, orders, ratings, and more."
          />
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
            <StatCard
              label="Revenue"
              value={formatPrice(computed.totalRevenue)}
              sub={
                computed.groupRevenue > 0
                  ? `incl. ${formatPrice(computed.groupRevenue)} from splits`
                  : "from verified payments"
              }
            />
            <StatCard label="Orders" value={String(computed.orderCount)} sub={`last ${range} days`} />
            <StatCard
              label="Avg order value"
              value={computed.orderCount > 0 ? formatPrice(computed.avgOrderValue) : "n/a"}
              sub="per verified order"
            />
            <StatCard
              label="Unique buyers"
              value={String(computed.uniqueBuyers)}
              sub={`${computed.totalViews} views`}
            />
            <StatCard
              label="Avg rating"
              value={computed.avgRating === null ? "n/a" : computed.avgRating.toFixed(1)}
              sub={computed.reviewCount > 0 ? `${computed.reviewCount} reviews` : "no reviews yet"}
            />
            <StatCard
              label="Q&A answered"
              value={computed.qaTotal === 0 ? "n/a" : `${computed.qaAnswered} of ${computed.qaTotal}`}
              sub={
                computed.avgResponseHours === null
                  ? "no questions yet"
                  : `avg response ${computed.avgResponseHours < 1 ? "under an hour" : `${computed.avgResponseHours.toFixed(0)}h`}`
              }
            />
          </div>

          <section className="mt-6 rounded-2xl border border-border bg-surface-raised p-4">
            <h2 className="text-base font-bold">Revenue over time</h2>
            <div className="mt-3">
              <RevenueLineChart data={computed.trend} />
            </div>
          </section>

          <section className="mt-4 rounded-2xl border border-border bg-surface-raised p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-base font-bold">Items sold</h2>
              {bestSeller && (
                <p className="text-xs text-ink-muted">
                  Best seller: <span className="font-semibold text-ink">{bestSeller.name}</span>
                  {slowest && slowest.name !== bestSeller.name && (
                    <>
                      {" · "}slowest: <span className="font-semibold text-ink">{slowest.name}</span>
                    </>
                  )}
                </p>
              )}
            </div>
            {computed.items.length === 0 ? (
              <p className="mt-3 text-sm text-ink-muted">No verified item sales yet in this window.</p>
            ) : (
              <div className="mt-3 overflow-x-auto">
                <table className="w-full min-w-[420px] text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-ink-muted">
                      <th className="pb-2 font-semibold">Item</th>
                      <th className="pb-2 text-right font-semibold">Units</th>
                      <th className="pb-2 text-right font-semibold">Revenue</th>
                      <th className="pb-2 text-right font-semibold">Boxes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {computed.items.map((item) => (
                      <tr key={item.name}>
                        <td className="py-2 pr-2 font-semibold">{item.name}</td>
                        <td className="py-2 text-right font-mono">{item.units}</td>
                        <td className="py-2 text-right font-mono font-bold">{formatPrice(item.revenue)}</td>
                        <td className="py-2 text-right font-mono text-ink-muted">
                          {item.box > 1 ? (item.units / item.box).toFixed(1) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-2 text-xs text-ink-muted">
                  Boxes = units sold ÷ box size, shown where an item has a box quantity.
                </p>
              </div>
            )}
          </section>

          {computed.leaderboard.length > 0 && (
            <section className="mt-4 rounded-2xl border border-border bg-surface-raised p-4">
              <h2 className="text-base font-bold">Recommender leaderboard</h2>
              <p className="mt-0.5 text-xs text-ink-muted">
                Revenue from orders that credited each member. Who raised the most money.
              </p>
              <div className="mt-3">
                <RankBarChart data={computed.leaderboard} money />
              </div>
            </section>
          )}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-border bg-surface-raised p-4">
              <h2 className="text-base font-bold">Peak order times</h2>
              <div className="mt-3">
                <PeakHeatmap matrix={computed.heatmap} />
              </div>
            </section>
            <section className="rounded-2xl border border-border bg-surface-raised p-4">
              <h2 className="text-base font-bold">Revenue by item</h2>
              {computed.itemRevenueChart.length === 0 ? (
                <p className="mt-3 text-sm text-ink-muted">No sales yet to chart.</p>
              ) : (
                <div className="mt-3">
                  <RankBarChart data={computed.itemRevenueChart} money />
                </div>
              )}
            </section>
          </div>

          <section className="mt-4 rounded-2xl border border-border bg-surface-raised p-4">
            <h2 className="text-base font-bold">Dietary tags across your items</h2>
            {computed.dietary.length === 0 ? (
              <p className="mt-3 text-sm text-ink-muted">
                No dietary tags on your items yet. Tag items when creating a listing; students filter by them.
              </p>
            ) : (
              <div className="mt-3">
                <TagBarChart data={computed.dietary} />
              </div>
            )}
          </section>

          <section className="mt-4 rounded-2xl border border-border bg-surface-raised p-4">
            <h2 className="text-base font-bold">Per listing</h2>
            <div className="mt-3 space-y-2">
              {computed.perListing.map(({ listing, revenue, orders, views }) => (
                <div
                  key={listing.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{listing.title}</p>
                    <p className="text-xs text-ink-muted">{listing.brand}</p>
                  </div>
                  <div className="flex items-center gap-4 text-xs text-ink-muted">
                    <span>
                      <span className="font-mono font-bold text-ink">{formatPrice(revenue)}</span> revenue
                    </span>
                    <span>
                      <span className="font-mono font-bold text-ink">{orders}</span> orders
                    </span>
                    <span>
                      <span className="font-mono font-bold text-ink">{views}</span> views
                    </span>
                    {listing.review_count > 0 ? (
                      <span className="flex items-center gap-1">
                        <RatingStars value={Number(listing.avg_rating)} size="sm" />
                        {Number(listing.avg_rating).toFixed(1)}
                      </span>
                    ) : (
                      <span>no reviews</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
