import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowLeft, BarChart3 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import {
  ChartEmpty,
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
import type { DietaryTagId, GroupDetails, Listing, OrderItem } from "@/types/database";

/** Only verified payments count toward money figures (Tranche 4 #1). All-time
 * fetch: new-vs-returning buyers needs each buyer's first-ever order. */
interface VerifiedOrder {
  listing_id: string;
  total: number;
  items_json: OrderItem[];
  orderer_name: string;
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

const RANGE_LABELS: Record<7 | 30 | 90 | 180, string> = {
  7: "7 days",
  30: "30 days",
  90: "3 months",
  180: "6 months",
};

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-border bg-surface-raised p-3 sm:p-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted sm:text-xs">
        {label}
      </p>
      <p className="mt-1 break-words font-display text-xl font-extrabold tabular-nums sm:text-2xl">
        {value}
      </p>
      {sub && <p className="mt-0.5 text-xs leading-snug text-ink-muted">{sub}</p>}
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
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<7 | 30 | 90 | 180>(30);

  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId || clubId !== userId) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const viewCutoff = new Date(Date.now() - 30 * 24 * 3_600_000).toISOString();

      const listingsResult = await supabase
        .from("listings")
        .select("id, title, brand, avg_rating, review_count, items, active")
        .eq("club_id", userId);
      if (cancelled) return;

      const ownListings = (listingsResult.data as ListingLite[] | null) ?? [];
      const ids = ownListings.map((listing) => listing.id);

      const [ordersResult, viewsResult, groupsResult] =
        ids.length > 0
          ? await Promise.all([
              // All-time, so repeat/new-vs-returning buyers compute correctly.
              supabase
                .from("orders")
                .select(
                  "listing_id, total, items_json, orderer_name, orderer_email, recommended_by, created_at",
                )
                .in("listing_id", ids)
                .eq("payment_verified", true),
              supabase
                .from("analytics_events")
                .select("listing_id, created_at")
                .eq("club_id", userId)
                .eq("event_type", "view")
                .gte("created_at", viewCutoff),
              supabase.rpc("get_club_groups"),
            ])
          : [{ data: [] }, { data: [] }, { data: [] }];
      if (cancelled) return;

      setListings(ownListings);
      setOrders((ordersResult.data as VerifiedOrder[] | null) ?? []);
      setViews((viewsResult.data as ViewRow[] | null) ?? []);
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

    // Item name -> dietary tags, per listing, so "what buyers pick" reflects
    // what actually sold rather than how the club tagged its menu.
    const tagsByListingItem = new Map<string, DietaryTagId[]>();
    for (const listing of listings) {
      for (const item of listing.items ?? []) {
        tagsByListingItem.set(
          `${listing.id}::${item.name}`,
          (item.dietary_tags ?? []).filter(isDietaryTagId),
        );
      }
    }

    // Unique buyers + group revenue + per-item + per-listing + buyer spend,
    // all in one pass over in-range activity.
    const buyers = new Set<string>();
    const itemAgg = new Map<string, { units: number; revenue: number }>();
    const byListing = new Map<string, { revenue: number; orders: number }>();
    const recommenders = new Map<string, { people: number; money: number }>();
    const bumpRecommender = (name: string, money: number) => {
      const entry = recommenders.get(name) ?? { people: 0, money: 0 };
      entry.people += 1;
      entry.money += money;
      recommenders.set(name, entry);
    };
    const buyerAgg = new Map<string, { name: string; orders: number; spend: number }>();
    const tagUnits = new Map<DietaryTagId, number>();
    let unitsInRange = 0;

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
    const bumpBuyer = (key: string, name: string, spend: number) => {
      const entry = buyerAgg.get(key) ?? { name, orders: 0, spend: 0 };
      entry.orders += 1;
      entry.spend += spend;
      buyerAgg.set(key, entry);
    };
    const bumpTags = (listingId: string, itemName: string, units: number) => {
      for (const tag of tagsByListingItem.get(`${listingId}::${itemName}`) ?? []) {
        tagUnits.set(tag, (tagUnits.get(tag) ?? 0) + units);
      }
    };

    for (const order of inRange) {
      const key = `email:${order.orderer_email.toLowerCase()}`;
      buyers.add(key);
      bumpBuyer(key, order.orderer_name, Number(order.total));
      bumpListing(order.listing_id, Number(order.total), 1);
      for (const line of order.items_json ?? []) {
        bumpItem(line.name, Number(line.qty), Number(line.price) * Number(line.qty));
        bumpTags(order.listing_id, line.name, Number(line.qty));
        unitsInRange += Number(line.qty);
      }
      const ref = order.recommended_by?.trim();
      if (ref) bumpRecommender(ref, Number(order.total));
    }

    let groupRevenue = 0;
    let groupShareCount = 0;
    for (const group of groupsInRange) {
      const perPerson = group.units_per_person ?? Math.floor(group.item_quantity / Math.max(group.total_people, 1));
      for (const member of group.members) {
        if (member.status !== "paid") continue;
        const key = `uid:${member.user_id}`;
        groupRevenue += Number(group.share_amount);
        groupShareCount += 1;
        buyers.add(key);
        bumpBuyer(key, member.name, Number(group.share_amount));
        bumpListing(group.listing_id, Number(group.share_amount), 1);
        bumpItem(group.item_name, perPerson, Number(group.share_amount));
        bumpTags(group.listing_id, group.item_name, perPerson);
        unitsInRange += perPerson;
        // Each member credits their own recommender with their own share, so
        // a 4-way split with 4 different referrals counts as 4 people and 4
        // shares of money, not 1 (Tranche: split recommender attribution).
        const memberRef = member.recommended_by?.trim();
        if (memberRef) bumpRecommender(memberRef, Number(group.share_amount));
      }
    }

    const totalRevenue = soloRevenue + groupRevenue;
    const orderCount = inRange.length;
    const avgOrderValue = orderCount > 0 ? soloRevenue / orderCount : 0;
    const avgUnitsPerOrder =
      orderCount + groupShareCount > 0 ? unitsInRange / (orderCount + groupShareCount) : 0;

    // First-ever order per buyer (all-time): active buyers whose history starts
    // before the window are returning; the rest are new this window.
    const firstSeen = new Map<string, number>();
    const noteFirst = (key: string, at: number) => {
      const previous = firstSeen.get(key);
      if (previous === undefined || at < previous) firstSeen.set(key, at);
    };
    for (const order of orders) {
      noteFirst(`email:${order.orderer_email.toLowerCase()}`, new Date(order.created_at).getTime());
    }
    for (const group of groups) {
      for (const member of group.members) {
        if (member.status !== "paid") continue;
        noteFirst(`uid:${member.user_id}`, new Date(group.created_at).getTime());
      }
    }
    let returningBuyers = 0;
    for (const key of buyers) {
      if ((firstSeen.get(key) ?? Number.POSITIVE_INFINITY) < cutoff) returningBuyers += 1;
    }
    const newBuyers = buyers.size - returningBuyers;

    // Views -> orders: how much of the browsing actually converts to money.
    const orderEvents = orderCount + groupShareCount;
    const conversion = viewsInRange.length > 0 ? orderEvents / viewsInRange.length : null;

    // Each unit ordered is one box, so units sold == boxes sold (no fraction).
    const items = [...itemAgg.entries()]
      .map(([name, agg]) => ({ name, units: agg.units, revenue: agg.revenue }))
      .sort((a, b) => b.units - a.units);

    const itemRevenueChart = items
      .map((item) => ({ name: item.name, value: Math.round(item.revenue * 100) / 100 }))
      .slice(0, 8);

    const leaderboard = [...recommenders.entries()]
      .map(([name, agg]) => ({ name, people: agg.people, money: Math.round(agg.money * 100) / 100 }))
      .sort((a, b) => b.money - a.money);
    const mostReferrals = [...leaderboard].sort((a, b) => b.people - a.people)[0] ?? null;

    const topBuyers = [...buyerAgg.values()]
      .sort((a, b) => b.spend - a.spend)
      .slice(0, 5);

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

    const dietaryDemand = [...tagUnits.entries()]
      .map(([tag, units]) => ({ name: DIETARY_TAGS[tag].label, count: units }))
      .sort((a, b) => b.count - a.count);

    const viewsByListing = new Map<string, number>();
    for (const view of viewsInRange) {
      viewsByListing.set(view.listing_id, (viewsByListing.get(view.listing_id) ?? 0) + 1);
    }

    const perListing = listings
      .map((listing) => {
        const listingViews = viewsByListing.get(listing.id) ?? 0;
        const listingOrders = byListing.get(listing.id)?.orders ?? 0;
        return {
          listing,
          revenue: byListing.get(listing.id)?.revenue ?? 0,
          orders: listingOrders,
          views: listingViews,
          conversion: listingViews > 0 ? listingOrders / listingViews : null,
        };
      })
      .sort((a, b) => b.revenue - a.revenue);

    return {
      totalRevenue,
      groupRevenue,
      orderCount,
      avgOrderValue,
      avgUnitsPerOrder,
      uniqueBuyers: buyers.size,
      newBuyers,
      returningBuyers,
      conversion,
      totalViews: viewsInRange.length,
      items,
      itemRevenueChart,
      leaderboard,
      mostReferrals,
      topBuyers,
      trend,
      heatmap,
      avgRating,
      reviewCount,
      dietaryDemand,
      perListing,
    };
  }, [orders, views, groups, listings, range]);

  if (authLoading) return <AnalyticsSkeleton />;
  if (!user) return <Navigate to="/login" replace />;
  if (clubId !== user.id) return <Navigate to={`/club/${user.id}/analytics`} replace />;
  if (loading) return <AnalyticsSkeleton />;

  const bestSeller = computed.items[0] ?? null;
  const slowest = computed.items.length > 1 ? computed.items[computed.items.length - 1] : null;
  const itemRevenueTotal = computed.items.reduce((sum, item) => sum + item.revenue, 0);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-10">
      <Link to="/dashboard" className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-muted hover-fine:text-ink">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Dashboard
      </Link>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">Analytics</h1>
        <div
          className="flex max-w-full gap-1 overflow-x-auto rounded-full border border-border p-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          role="radiogroup"
          aria-label="Time range"
        >
          {([7, 30, 90, 180] as const).map((option) => (
            <button
              key={option}
              type="button"
              role="radio"
              aria-checked={range === option}
              onClick={() => setRange(option)}
              className={cn(
                "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors duration-150 [transition-timing-function:var(--ease-out)]",
                range === option ? "bg-ink text-surface-raised" : "text-ink-muted hover-fine:text-ink",
              )}
            >
              {RANGE_LABELS[option]}
            </button>
          ))}
        </div>
      </div>
      <p className="mt-1 text-sm text-ink-muted">
        Money figures count verified payments only, over the last {RANGE_LABELS[range]}.
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
            <StatCard
              label="Orders"
              value={String(computed.orderCount)}
              sub={
                computed.orderCount > 0
                  ? `${computed.avgUnitsPerOrder.toFixed(1)} items per order on average`
                  : `last ${range} days`
              }
            />
            <StatCard
              label="Avg order value"
              value={computed.orderCount > 0 ? formatPrice(computed.avgOrderValue) : "n/a"}
              sub="per verified order"
            />
            <StatCard
              label="Unique buyers"
              value={String(computed.uniqueBuyers)}
              sub={
                computed.uniqueBuyers > 0
                  ? `${computed.newBuyers} new, ${computed.returningBuyers} returning`
                  : "no buyers in this window"
              }
            />
            <StatCard
              label="View → order rate"
              value={computed.conversion === null ? "n/a" : `${(computed.conversion * 100).toFixed(1)}%`}
              sub={
                computed.conversion === null
                  ? "no listing views yet"
                  : `of ${computed.totalViews} listing views became orders`
              }
            />
            <StatCard
              label="Avg rating"
              value={computed.avgRating === null ? "n/a" : computed.avgRating.toFixed(1)}
              sub={computed.reviewCount > 0 ? `${computed.reviewCount} reviews` : "no reviews yet"}
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
              <div className="mt-3 min-w-0 overflow-x-auto">
                <table className="w-full min-w-[360px] text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-ink-muted">
                      <th className="pb-2 font-semibold">Item</th>
                      <th className="pb-2 text-right font-semibold">Units sold</th>
                      <th className="pb-2 text-right font-semibold">Revenue</th>
                      <th className="pb-2 text-right font-semibold">Share</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {computed.items.map((item) => (
                      <tr key={item.name}>
                        <td className="py-2 pr-2 font-semibold">{item.name}</td>
                        <td className="py-2 text-right font-mono">{item.units}</td>
                        <td className="py-2 text-right font-mono font-bold">{formatPrice(item.revenue)}</td>
                        <td className="py-2 text-right font-mono text-ink-muted">
                          {itemRevenueTotal > 0 ? `${((item.revenue / itemRevenueTotal) * 100).toFixed(0)}%` : "–"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <section className="min-w-0 rounded-2xl border border-border bg-surface-raised p-4">
              <h2 className="text-base font-bold">Peak order times</h2>
              <p className="mt-0.5 text-xs text-ink-muted">
                When students actually place orders. Time your next drop to land just before a hot
                hour.
              </p>
              <div className="mt-3">
                <PeakHeatmap matrix={computed.heatmap} />
              </div>
            </section>
            <section className="min-w-0 rounded-2xl border border-border bg-surface-raised p-4">
              <h2 className="text-base font-bold">Revenue by item</h2>
              <p className="mt-0.5 text-xs text-ink-muted">
                Your top {Math.min(8, Math.max(computed.itemRevenueChart.length, 1))} earners, by
                money raised rather than units.
              </p>
              {computed.itemRevenueChart.length === 0 ? (
                <div className="mt-3">
                  <ChartEmpty>
                    No verified sales yet. Verify a payment on the Orders page and it charts here.
                  </ChartEmpty>
                </div>
              ) : (
                <div className="mt-3">
                  <RankBarChart data={computed.itemRevenueChart} money />
                </div>
              )}
            </section>
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <section className="min-w-0 rounded-2xl border border-border bg-surface-raised p-4">
              <h2 className="text-base font-bold">Top buyers</h2>
              <p className="mt-0.5 text-xs text-ink-muted">
                Your biggest spenders this window. Returning names are your regulars.
              </p>
              {computed.topBuyers.length === 0 ? (
                <p className="mt-3 text-sm text-ink-muted">No verified buyers yet in this window.</p>
              ) : (
                <ul className="mt-3 divide-y divide-border/60">
                  {computed.topBuyers.map((buyer, index) => (
                    <li key={`${buyer.name}-${index}`} className="flex items-center justify-between gap-3 py-2">
                      <span className="flex min-w-0 items-center gap-2 text-sm">
                        <span className="w-5 shrink-0 font-mono text-xs text-ink-muted">{index + 1}.</span>
                        <span className="truncate font-semibold">{buyer.name}</span>
                      </span>
                      <span className="shrink-0 text-xs text-ink-muted">
                        <span className="font-mono font-bold text-ink">{formatPrice(buyer.spend)}</span>
                        {" · "}
                        {buyer.orders} {buyer.orders === 1 ? "order" : "orders"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>
            <section className="min-w-0 rounded-2xl border border-border bg-surface-raised p-4">
              <h2 className="text-base font-bold">What buyers pick (dietary)</h2>
              <p className="mt-0.5 text-xs text-ink-muted">
                Units actually sold, grouped by the dietary tags on those items.
              </p>
              {computed.dietaryDemand.length === 0 ? (
                <p className="mt-3 text-sm text-ink-muted">
                  No tagged items sold yet. Tag items when creating a listing and this fills in as
                  students buy them.
                </p>
              ) : (
                <div className="mt-3">
                  <TagBarChart data={computed.dietaryDemand} />
                </div>
              )}
            </section>
          </div>

          {computed.leaderboard.length > 0 && (
            <section className="mt-4 rounded-2xl border border-border bg-surface-raised p-4">
              <h2 className="text-base font-bold">Recommender leaderboard</h2>
              <p className="mt-0.5 text-xs text-ink-muted">
                Every solo order and split share that credited a member, split shares counted at
                the person's own share cost. Sorted by money raised
                {computed.mostReferrals && computed.mostReferrals.name !== computed.leaderboard[0].name
                  ? ` — ${computed.mostReferrals.name} sent the most people (${computed.mostReferrals.people}).`
                  : "."}
              </p>
              <div className="mt-3 min-w-0 overflow-x-auto">
                <table className="w-full min-w-[340px] text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase tracking-wide text-ink-muted">
                      <th className="pb-2 font-semibold">Member</th>
                      <th className="pb-2 text-right font-semibold">People referred</th>
                      <th className="pb-2 text-right font-semibold">Money raised</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/60">
                    {computed.leaderboard.map((entry) => (
                      <tr key={entry.name}>
                        <td className="py-2 pr-2 font-semibold">{entry.name}</td>
                        <td className="py-2 text-right font-mono">{entry.people}</td>
                        <td className="py-2 text-right font-mono font-bold">{formatPrice(entry.money)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          <section className="mt-4 rounded-2xl border border-border bg-surface-raised p-4">
            <h2 className="text-base font-bold">Per listing</h2>
            <div className="mt-3 space-y-2">
              {computed.perListing.map(({ listing, revenue, orders: listingOrders, views: listingViews, conversion }) => (
                <div
                  key={listing.id}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-bold">{listing.title}</p>
                    <p className="text-xs text-ink-muted">{listing.brand}</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-muted">
                    <span>
                      <span className="font-mono font-bold text-ink">{formatPrice(revenue)}</span> revenue
                    </span>
                    <span>
                      <span className="font-mono font-bold text-ink">{listingOrders}</span> orders
                    </span>
                    <span>
                      <span className="font-mono font-bold text-ink">{listingViews}</span> views
                    </span>
                    <span>
                      <span className="font-mono font-bold text-ink">
                        {conversion === null ? "–" : `${(conversion * 100).toFixed(1)}%`}
                      </span>{" "}
                      converted
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
