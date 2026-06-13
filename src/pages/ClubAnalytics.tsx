import { useEffect, useMemo, useState } from "react";
import { Link, Navigate, useParams } from "react-router-dom";
import { ArrowLeft, BarChart3 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { PeakHeatmap, TagBarChart, TrendLineChart, type TrendPoint } from "@/components/AnalyticsChart";
import { EmptyState } from "@/components/EmptyState";
import { RatingStars } from "@/components/RatingStars";
import { DIETARY_TAGS, isDietaryTagId } from "@/lib/dietary";
import { cn } from "@/lib/utils";
import type { Listing, PickupSlot, QAEntry } from "@/types/database";

interface EventRow {
  listing_id: string;
  event_type: "view" | "venmo_click";
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
  const [events, setEvents] = useState<EventRow[]>([]);
  const [listings, setListings] = useState<ListingLite[]>([]);
  const [slots, setSlots] = useState<Pick<PickupSlot, "listing_id" | "max_reservations" | "reserved_count">[]>([]);
  const [qaEntries, setQaEntries] = useState<Pick<QAEntry, "listing_id" | "created_at" | "response_date">[]>([]);
  const [loading, setLoading] = useState(true);
  const [range, setRange] = useState<7 | 30>(7);

  const userId = user?.id ?? null;

  useEffect(() => {
    if (!userId || clubId !== userId) return;
    let cancelled = false;
    const load = async () => {
      setLoading(true);
      const cutoff = new Date(Date.now() - 30 * 24 * 3_600_000).toISOString();

      const [eventsResult, listingsResult] = await Promise.all([
        supabase
          .from("analytics_events")
          .select("listing_id, event_type, created_at")
          .eq("club_id", userId)
          .gte("created_at", cutoff),
        supabase
          .from("listings")
          .select("id, title, brand, avg_rating, review_count, items, active")
          .eq("club_id", userId),
      ]);
      if (cancelled) return;

      const ownListings = (listingsResult.data as ListingLite[] | null) ?? [];
      const ids = ownListings.map((listing) => listing.id);

      const [slotsResult, qaResult] =
        ids.length > 0
          ? await Promise.all([
              supabase
                .from("pickup_slots")
                .select("listing_id, max_reservations, reserved_count")
                .in("listing_id", ids),
              supabase.from("qa").select("listing_id, created_at, response_date").in("listing_id", ids),
            ])
          : [{ data: [] }, { data: [] }];
      if (cancelled) return;

      setEvents((eventsResult.data as EventRow[] | null) ?? []);
      setListings(ownListings);
      setSlots(slotsResult.data ?? []);
      setQaEntries(qaResult.data ?? []);
      setLoading(false);
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [userId, clubId]);

  const computed = useMemo(() => {
    const cutoff = Date.now() - range * 24 * 3_600_000;
    const inRange = events.filter((event) => new Date(event.created_at).getTime() >= cutoff);

    const views = inRange.filter((event) => event.event_type === "view").length;
    const clicks = inRange.filter((event) => event.event_type === "venmo_click").length;
    const ctr = views > 0 ? (clicks / views) * 100 : 0;

    const trend: TrendPoint[] = Array.from({ length: range }, (_, index) => {
      const date = new Date();
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - (range - 1 - index));
      const next = new Date(date);
      next.setDate(date.getDate() + 1);
      const dayEvents = inRange.filter((event) => {
        const time = new Date(event.created_at).getTime();
        return time >= date.getTime() && time < next.getTime();
      });
      return {
        day: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }),
        views: dayEvents.filter((event) => event.event_type === "view").length,
        clicks: dayEvents.filter((event) => event.event_type === "venmo_click").length,
      };
    });

    const heatmap: number[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => 0));
    for (const event of inRange) {
      const date = new Date(event.created_at);
      const day = (date.getDay() + 6) % 7; // Monday-first
      heatmap[day][date.getHours()] += 1;
    }

    const fillRates = slots.map((slot) => slot.reserved_count / slot.max_reservations);
    const reservationRate =
      fillRates.length > 0 ? (fillRates.reduce((sum, rate) => sum + rate, 0) / fillRates.length) * 100 : null;

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
          if (isDietaryTagId(tag)) {
            tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
          }
        }
      }
    }
    const dietary = [...tagCounts.entries()]
      .map(([tag, count]) => ({
        name: DIETARY_TAGS[tag as keyof typeof DIETARY_TAGS].label,
        count,
      }))
      .sort((a, b) => b.count - a.count);

    const perListing = listings
      .map((listing) => {
        const listingEvents = inRange.filter((event) => event.listing_id === listing.id);
        const listingViews = listingEvents.filter((event) => event.event_type === "view").length;
        const listingClicks = listingEvents.filter((event) => event.event_type === "venmo_click").length;
        return { listing, views: listingViews, clicks: listingClicks };
      })
      .sort((a, b) => b.views - a.views);

    return {
      views,
      clicks,
      ctr,
      trend,
      heatmap,
      reservationRate,
      avgRating,
      reviewCount,
      qaTotal: qaEntries.length,
      qaAnswered: answered.length,
      avgResponseHours,
      dietary,
      perListing,
    };
  }, [events, listings, slots, qaEntries, range]);

  if (authLoading) return <AnalyticsSkeleton />;
  if (!user) return <Navigate to="/login" replace />;
  if (clubId !== user.id) return <Navigate to={`/club/${user.id}/analytics`} replace />;
  if (loading) return <AnalyticsSkeleton />;

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

      {listings.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            icon={<BarChart3 className="size-6" aria-hidden="true" />}
            title="No data yet"
            body="Post your first drop and analytics start collecting: views, Venmo clicks, reservations, and ratings."
          />
        </div>
      ) : (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-3">
            <StatCard label="Views" value={String(computed.views)} sub={`last ${range} days`} />
            <StatCard
              label="Venmo CTR"
              value={`${computed.ctr.toFixed(1)}%`}
              sub={`${computed.clicks} clicks / ${computed.views} views`}
            />
            <StatCard
              label="Reservation rate"
              value={computed.reservationRate === null ? "n/a" : `${computed.reservationRate.toFixed(0)}%`}
              sub={computed.reservationRate === null ? "no pickup slots yet" : "of slot capacity reserved"}
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
            <StatCard
              label="Active drops"
              value={String(listings.filter((listing) => listing.active).length)}
              sub={`${listings.length} all time`}
            />
          </div>

          <section className="mt-6 rounded-2xl border border-border bg-surface-raised p-4">
            <h2 className="text-base font-bold">Views and Venmo clicks</h2>
            <div className="mt-3">
              <TrendLineChart data={computed.trend} />
            </div>
          </section>

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <section className="rounded-2xl border border-border bg-surface-raised p-4">
              <h2 className="text-base font-bold">Peak interest times</h2>
              <div className="mt-3">
                <PeakHeatmap matrix={computed.heatmap} />
              </div>
            </section>
            <section className="rounded-2xl border border-border bg-surface-raised p-4">
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
          </div>

          <section className="mt-4 rounded-2xl border border-border bg-surface-raised p-4">
            <h2 className="text-base font-bold">Per listing</h2>
            <div className="mt-3 space-y-2">
              {computed.perListing.map(({ listing, views, clicks }) => (
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
                      <span className="font-mono font-bold text-ink">{views}</span> views
                    </span>
                    <span>
                      <span className="font-mono font-bold text-ink">
                        {views > 0 ? `${((clicks / views) * 100).toFixed(0)}%` : "0%"}
                      </span>{" "}
                      CTR
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
