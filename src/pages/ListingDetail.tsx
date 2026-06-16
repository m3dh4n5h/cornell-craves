import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import {
  AlertTriangle,
  ArrowLeft,
  CalendarCheck,
  Clock,
  Copy,
  Heart,
  Mail,
  MapPinned,
  SearchX,
} from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useListing } from "@/hooks/useListings";
import { useCountdown } from "@/hooks/useCountdown";
import { useAuth } from "@/hooks/useAuth";
import { useClub } from "@/hooks/useClub";
import { trackListingView } from "@/lib/analytics";
import { brandInitials, brandTint } from "@/lib/brands";
import { listingDietaryTags } from "@/lib/dietary";
import { ORDER_TYPE_BADGE, ORDER_TYPE_SHORT } from "@/lib/pickup";
import { formatPrice } from "@/lib/format";
import { VenmoButton } from "@/components/VenmoButton";
import { AllergenIcon } from "@/components/AllergenIcon";
import { DietaryTag } from "@/components/DietaryTag";
import { RatingStars } from "@/components/RatingStars";
import { ReviewsSection } from "@/components/ReviewsSection";
import { QAThread } from "@/components/QAThread";
import { PickupCalendar } from "@/components/PickupCalendar";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ListingPickupSpotWithLocation, ListingWithClub } from "@/types/database";

/** "Available May 3, 5 PM – May 3, 8 PM" style window for a pickup spot. */
function formatSpotWindow(spot: ListingPickupSpotWithLocation): string {
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    });
  if (spot.available_start && spot.available_end) {
    return `Available ${fmt(spot.available_start)} – ${fmt(spot.available_end)}`;
  }
  if (spot.available_end) return `Available until ${fmt(spot.available_end)}`;
  if (spot.available_start) return `Available from ${fmt(spot.available_start)}`;
  return "";
}

const TABS = [
  { id: "items", label: "Items" },
  { id: "reviews", label: "Reviews" },
  { id: "qa", label: "Q&A" },
  { id: "schedule", label: "Pickup" },
] as const;

type TabId = (typeof TABS)[number]["id"];

function useGoBack() {
  const navigate = useNavigate();
  return () => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) {
      navigate(-1);
    } else {
      navigate("/", { replace: true });
    }
  };
}

function PaymentCard({ listing }: { listing: ListingWithClub }) {
  const timeLeft = useCountdown(listing.expires_at);
  const note = `Cornell Craves: ${listing.title}`;
  const zelle = listing.clubs?.zelle_phone;

  const copyZelle = async () => {
    if (!zelle) return;
    try {
      await navigator.clipboard.writeText(zelle);
      toast.success("Zelle number copied");
    } catch {
      toast.error("Could not copy, long-press the number instead");
    }
  };

  return (
    <div className="rounded-2xl border border-border bg-surface-raised p-4">
      <p
        className={cn(
          "flex items-center gap-2 text-sm font-semibold",
          timeLeft.expired || timeLeft.urgent ? "text-accent" : "text-ink-muted",
        )}
      >
        <Clock className="size-4" aria-hidden="true" />
        {timeLeft.expired ? "This drop has ended" : timeLeft.label}
      </p>
      <Link to={`/listing/${listing.id}/order-form`} className="mt-4 block">
        <Button className="w-full" size="lg" disabled={timeLeft.expired || !listing.active}>
          Order items
        </Button>
      </Link>
      {listing.payment_updated_at && (
        <div className="mt-4 rounded-xl border border-accent/40 bg-accent/10 p-3 text-sm text-ink">
          <span className="font-semibold">Payment handle recently updated.</span> This club
          changed its Venmo/Zelle after this drop was posted. Confirm the current handle with the
          club before sending money. Cornell Craves only displays club-provided details and is not
          responsible for payments sent to an outdated or incorrect handle.
        </div>
      )}
      <div className="mt-2">
        <VenmoButton
          handle={listing.clubs?.venmo ?? null}
          note={note}
          disabled={timeLeft.expired || !listing.active}
        />
      </div>
      {zelle && (
        <div className="mt-4 flex items-center justify-between gap-2 rounded-xl bg-surface px-3 py-2.5">
          <p className="text-sm text-ink-muted">
            Zelle <span className="ml-1 font-mono text-ink">{zelle}</span>
          </p>
          <Button
            variant="ghost"
            size="sm"
            onClick={copyZelle}
            aria-label="Copy Zelle number"
            className="px-2.5 text-ink-muted"
          >
            <Copy className="size-4" aria-hidden="true" />
          </Button>
        </div>
      )}
      <p className="mt-4 text-xs text-ink-muted">
        Pay first, then show your receipt at pickup. Payments go straight to the club.
      </p>
    </div>
  );
}

function ItemsTab({ listing }: { listing: ListingWithClub }) {
  const navigate = useNavigate();
  const items = listing.items ?? [];

  if (items.length === 0) {
    return (
      <EmptyState
        icon={<SearchX className="size-6" aria-hidden="true" />}
        title="No items listed"
        body="The club has not listed individual items. Check the description or ask in the Q&A."
      />
    );
  }

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        {items.map((item, index) => (
          <div key={index} className="rounded-2xl border border-border bg-surface-raised p-4">
            <div className="flex items-baseline justify-between gap-3">
              <h3 className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5 text-base font-bold">
                {(item.dietary_tags ?? []).map((tag) => (
                  <AllergenIcon key={tag} tag={tag} className="self-center text-ink-muted" />
                ))}
                {/* Full item name, no clamp/truncate (Batch 2 #6) */}
                <span className="break-words">{item.name}</span>
                {(item.quantity ?? 1) > 1 && (
                  <span className="text-xs font-normal text-ink-muted">
                    {"·"} {item.quantity} in a box
                  </span>
                )}
              </h3>
              <span className="shrink-0 font-mono text-lg font-bold">{formatPrice(item.price)}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => navigate(`/listing/${listing.id}/order-form`)}>
          Order these items
        </Button>
        <Button
          variant="secondary"
          onClick={() => navigate(`/listing/${listing.id}/schedule`)}
        >
          <CalendarCheck className="size-4" aria-hidden="true" />
          Reserve a pickup time
        </Button>
      </div>
    </div>
  );
}

function DetailSkeleton() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8" aria-busy="true" aria-label="Loading listing">
      <div className="h-9 w-28 animate-pulse rounded-xl bg-border/60" />
      <div className="mt-6 grid gap-8 md:grid-cols-[1fr_280px]">
        <div className="animate-pulse">
          <div className="flex items-start gap-3">
            <div className="size-16 shrink-0 rounded-xl bg-border/60" />
            <div className="flex-1 space-y-2 pt-1">
              <div className="h-6 w-2/3 rounded-md bg-border/60" />
              <div className="h-4 w-1/3 rounded-md bg-border/50" />
            </div>
          </div>
          <div className="mt-6 h-10 w-full rounded-xl bg-border/40" />
          <div className="mt-4 h-44 rounded-2xl bg-border/40" />
        </div>
        <div className="h-48 animate-pulse rounded-2xl bg-border/40" />
      </div>
    </div>
  );
}

export default function ListingDetail() {
  const { id, tab } = useParams<{ id: string; tab?: string }>();
  const activeTab: TabId = TABS.some((entry) => entry.id === tab) ? (tab as TabId) : "items";
  const { listing, loading, error, refetch } = useListing(id);
  const { user } = useAuth();
  const { club } = useClub();
  const navigate = useNavigate();
  const goBack = useGoBack();
  const reduceMotion = useReducedMotion();
  const [hasSlots, setHasSlots] = useState(false);

  const clubOwner = Boolean(user && listing && user.id === listing.club_id);
  // Any club account (not just this listing's owner) may not post reviews/Q&A.
  const isClub = Boolean(club);
  const pickupSpots = listing?.listing_pickup_spots ?? [];

  useEffect(() => {
    if (listing?.id) trackListingView(listing.id);
  }, [listing?.id]);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    void supabase
      .from("pickup_slots")
      .select("id", { count: "exact", head: true })
      .eq("listing_id", id)
      .gt("end_time", new Date().toISOString())
      .then(({ count }) => {
        if (!cancelled) setHasSlots((count ?? 0) > 0);
      });
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) return <DetailSkeleton />;

  if (error) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-12">
        <EmptyState
          icon={<AlertTriangle className="size-6" aria-hidden="true" />}
          title="Could not load this listing"
          body="Something went wrong on the way to the kitchen. Give it another try."
          actionLabel="Retry"
          onAction={() => void refetch()}
        />
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-12">
        <EmptyState
          icon={<SearchX className="size-6" aria-hidden="true" />}
          title="Listing not found"
          body="This drop may have been taken down by the club. The feed has the latest."
          actionLabel="Back to feed"
          onAction={goBack}
        />
      </div>
    );
  }

  const dietaryTags = listingDietaryTags(listing.items);
  const staggerTags = dietaryTags.length > 3 && !reduceMotion;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 pb-24 md:pb-8">
      <Button variant="ghost" size="sm" onClick={goBack} className="-ml-2 text-ink-muted">
        <ArrowLeft className="size-4" aria-hidden="true" />
        Back to feed
      </Button>

      <div className="mt-4 grid gap-8 md:grid-cols-[1fr_280px]">
        <div>
          {/* Header */}
          <div className="flex items-start gap-4">
            {listing.clubs?.logo_url ? (
              <img
                src={listing.clubs.logo_url}
                alt={`${listing.clubs.name ?? "Club"} logo`}
                className="size-16 shrink-0 rounded-2xl border border-border object-cover"
              />
            ) : (
              <span
                className={cn(
                  "flex size-16 shrink-0 items-center justify-center rounded-2xl font-display text-xl font-extrabold text-ink/80",
                  brandTint(listing.brand),
                )}
                aria-hidden="true"
              >
                {brandInitials(listing.brand)}
              </span>
            )}
            <div className="min-w-0">
              <h1 className="text-2xl font-extrabold tracking-tight">{listing.title}</h1>
              <p className="mt-1 text-sm text-ink-muted">
                {listing.brand}
                {listing.clubs?.name ? `, run by ${listing.clubs.name}` : ""}
              </p>
              {listing.review_count > 0 && (
                <Link
                  to={`/listing/${listing.id}/reviews`}
                  className="mt-1.5 inline-flex items-center gap-1.5 text-sm font-semibold text-ink"
                >
                  <RatingStars value={Number(listing.avg_rating)} size="sm" />
                  {Number(listing.avg_rating).toFixed(1)}
                  <span className="font-normal text-ink-muted">({listing.review_count})</span>
                </Link>
              )}
            </div>
          </div>

          {!listing.active && (
            <Badge variant="urgent" className="mt-4">
              This listing is no longer active
            </Badge>
          )}

          {pickupSpots.length > 0 ? (
            <div className="mt-4 flex flex-col gap-2">
              {pickupSpots.map((spot) => (
                <div key={spot.id} className="flex flex-wrap items-center gap-2">
                  <Link
                    to="/map"
                    className="inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3 py-1.5 text-xs font-semibold text-ink-muted transition-colors duration-150 [transition-timing-function:var(--ease-out)] hover-fine:border-primary hover-fine:text-ink"
                  >
                    <MapPinned className="size-3.5 text-primary-dark" aria-hidden="true" />
                    {spot.campus_locations?.name ?? "Pickup spot"}
                    <Badge variant={ORDER_TYPE_BADGE[spot.order_type]}>
                      {ORDER_TYPE_SHORT[spot.order_type]}
                    </Badge>
                  </Link>
                  {(spot.available_start || spot.available_end) && (
                    <span className="text-xs text-ink-muted">{formatSpotWindow(spot)}</span>
                  )}
                </div>
              ))}
            </div>
          ) : (
            listing.campus_locations && (
              <Link
                to="/map"
                className="mt-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-surface-raised px-3 py-1.5 text-xs font-semibold text-ink-muted transition-colors duration-150 [transition-timing-function:var(--ease-out)] hover-fine:border-primary hover-fine:text-ink"
              >
                <MapPinned className="size-3.5 text-primary-dark" aria-hidden="true" />
                {listing.campus_locations.name}
              </Link>
            )
          )}

          {dietaryTags.length > 0 && (
            <motion.div
              className="mt-3 flex flex-wrap gap-1.5"
              initial={staggerTags ? "hidden" : false}
              animate="show"
              variants={{ hidden: {}, show: { transition: { staggerChildren: 0.04 } } }}
            >
              {dietaryTags.map((tag) => (
                <motion.span
                  key={tag}
                  variants={{
                    hidden: { opacity: 0, y: 4 },
                    show: { opacity: 1, y: 0, transition: { duration: 0.2, ease: [0.23, 1, 0.32, 1] } },
                  }}
                >
                  <DietaryTag tag={tag} />
                </motion.span>
              ))}
            </motion.div>
          )}

          {listing.description && <p className="mt-4 text-ink-muted">{listing.description}</p>}

          {listing.cause_name && (
            <p className="mt-4 flex items-start gap-2 rounded-xl bg-primary/15 p-3 text-sm font-semibold text-ink">
              <Heart className="mt-0.5 size-4 shrink-0 text-primary-dark" fill="currentColor" strokeWidth={0} aria-hidden="true" />
              <span>
                {listing.cause_percent}% of earnings go to {listing.cause_name}.
              </span>
            </p>
          )}

          {listing.pickup_info && (
            <p className="mt-3 flex items-start gap-2 text-sm text-ink-muted">
              <MapPinned className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              {listing.pickup_info}
            </p>
          )}

          {listing.contact_email && (
            <p className="mt-2 flex items-start gap-2 text-sm text-ink-muted">
              <Mail className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
              <a
                href={`mailto:${listing.contact_email}`}
                className="font-medium text-ink underline-offset-2 hover-fine:underline"
              >
                {listing.contact_email}
              </a>
            </p>
          )}

          {/* Tabs */}
          <nav className="mt-6 flex gap-1 border-b border-border" aria-label="Listing sections">
            {TABS.map(({ id: tabId, label }) => {
              const isActive = tabId === activeTab;
              const to = tabId === "items" ? `/listing/${listing.id}` : `/listing/${listing.id}/${tabId}`;
              const text =
                tabId === "reviews" && listing.review_count > 0
                  ? `${label} (${listing.review_count})`
                  : label;
              return (
                <Link
                  key={tabId}
                  to={to}
                  replace
                  aria-current={isActive ? "page" : undefined}
                  className={cn(
                    "relative px-3.5 py-2.5 text-sm font-semibold transition-colors duration-150 [transition-timing-function:var(--ease-out)]",
                    isActive ? "text-ink" : "text-ink-muted hover-fine:text-ink",
                  )}
                >
                  {text}
                  {isActive &&
                    (reduceMotion ? (
                      <span className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary-dark" aria-hidden="true" />
                    ) : (
                      <motion.span
                        layoutId="listing-tab-underline"
                        className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary-dark"
                        transition={{ type: "tween", duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                        aria-hidden="true"
                      />
                    ))}
                </Link>
              );
            })}
          </nav>

          <div className="mt-5">
            {activeTab === "items" && <ItemsTab listing={listing} />}
            {activeTab === "reviews" && (
              <ReviewsSection
                listingId={listing.id}
                canRespond={clubOwner}
                isClub={isClub}
                onChanged={() => void refetch()}
              />
            )}
            {activeTab === "qa" && (
              <QAThread listingId={listing.id} canRespond={clubOwner} isClub={isClub} />
            )}
            {activeTab === "schedule" && <PickupCalendar listing={listing} />}
          </div>
        </div>

        <aside className="hidden h-fit md:sticky md:top-24 md:block">
          <PaymentCard listing={listing} />
        </aside>
      </div>

      {/* Mobile sticky action bar, sitting above the bottom tab bar */}
      <div className="z-raised fixed inset-x-0 bottom-14 border-t border-border bg-surface-raised/95 p-3 backdrop-blur-md md:hidden">
        <div className="mx-auto flex max-w-5xl gap-2">
          <Button
            className="flex-1"
            disabled={!listing.active}
            onClick={() => navigate(`/listing/${listing.id}/order-form`)}
          >
            Order items
          </Button>
          {hasSlots && activeTab !== "schedule" && (
            <Button
              variant="secondary"
              className="flex-1"
              onClick={() => navigate(`/listing/${listing.id}/schedule`, { replace: true })}
            >
              <CalendarCheck className="size-4" aria-hidden="true" />
              Reserve
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
