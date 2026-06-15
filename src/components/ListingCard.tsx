import { motion } from "framer-motion";
import { Link } from "react-router-dom";
import { MapPin, Star } from "lucide-react";
import type { ListingWithClub } from "@/types/database";
import { brandInitials, brandTint } from "@/lib/brands";
import { listingDietaryTags } from "@/lib/dietary";
import { listingOrderTypes, ORDER_TYPE_BADGE, ORDER_TYPE_LABEL } from "@/lib/pickup";
import { priceRange } from "@/lib/format";
import { useCountdown } from "@/hooks/useCountdown";
import { Badge } from "@/components/ui/badge";
import { DietaryTag } from "@/components/DietaryTag";
import { cn } from "@/lib/utils";

export const cardItemVariants = {
  hidden: { opacity: 0, y: 8 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.25, ease: [0.23, 1, 0.32, 1] as const },
  },
};

interface ListingCardProps {
  listing: ListingWithClub;
}

export function ListingCard({ listing }: ListingCardProps) {
  const timeLeft = useCountdown(listing.expires_at);
  const range = priceRange(listing.items ?? []);
  const itemCount = listing.items?.length ?? 0;
  const dietaryTags = listingDietaryTags(listing.items);
  const orderTypes = listingOrderTypes(listing);
  const spotCount = listing.listing_pickup_spots?.length ?? 0;

  return (
    <motion.article variants={cardItemVariants} className="h-full">
      <Link
        to={`/listing/${listing.id}`}
        className="block h-full rounded-2xl border border-border bg-surface-raised p-4 transition-[transform,box-shadow,border-color] duration-150 [transition-timing-function:var(--ease-out)] hover-fine:-translate-y-0.5 hover-fine:border-primary/60 hover-fine:shadow-[0_6px_20px_oklch(72%_0.19_75/0.18)] active:scale-[0.98]"
      >
        <div className="flex items-start gap-3">
          {listing.clubs?.logo_url ? (
            <img
              src={listing.clubs.logo_url}
              alt={`${listing.clubs.name ?? "Club"} logo`}
              className="size-12 shrink-0 rounded-xl border border-border object-cover"
              loading="lazy"
            />
          ) : (
            <span
              className={cn(
                "flex size-12 shrink-0 items-center justify-center rounded-xl font-display text-base font-extrabold text-ink/80",
                brandTint(listing.brand),
              )}
              aria-hidden="true"
            >
              {brandInitials(listing.brand)}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <h3 className="truncate font-display text-lg font-bold leading-snug">
              {listing.title}
            </h3>
            <p className="truncate text-sm text-ink-muted">
              {listing.brand}
              {listing.clubs?.name ? ` by ${listing.clubs.name}` : ""}
            </p>
          </div>
          {listing.review_count > 0 && (
            <span
              className="flex shrink-0 items-center gap-1 rounded-full bg-primary/20 px-2 py-0.5 text-xs font-bold"
              aria-label={`Rated ${listing.avg_rating.toFixed(1)} out of 5 from ${listing.review_count} reviews`}
            >
              <Star className="size-3 text-primary-dark" fill="currentColor" strokeWidth={0} aria-hidden="true" />
              {Number(listing.avg_rating).toFixed(1)}
            </span>
          )}
        </div>

        {listing.description && (
          <p className="mt-3 line-clamp-2 text-sm text-ink-muted">{listing.description}</p>
        )}

        {listing.pickup_info && (
          <p className="mt-3 flex items-center gap-1.5 text-sm text-ink-muted">
            <MapPin className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{listing.pickup_info}</span>
          </p>
        )}

        {orderTypes.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {orderTypes.map((type) => (
              <Badge key={type} variant={ORDER_TYPE_BADGE[type]}>
                {ORDER_TYPE_LABEL[type]}
              </Badge>
            ))}
            {spotCount > 1 && (
              <span className="text-xs font-semibold text-ink-muted">
                {spotCount} pickup spots
              </span>
            )}
          </div>
        )}

        {dietaryTags.length > 0 && (
          <div className="mt-3 flex items-center gap-1">
            {dietaryTags.slice(0, 4).map((tag) => (
              <DietaryTag key={tag} tag={tag} compact />
            ))}
            {dietaryTags.length > 4 && (
              <span className="text-xs font-semibold text-ink-muted">+{dietaryTags.length - 4}</span>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
          <Badge variant="default">
            {range ?? "Price at pickup"}
            {itemCount > 0 && (
              <span className="text-ink-muted">
                {" "}
                / {itemCount} {itemCount === 1 ? "item" : "items"}
              </span>
            )}
          </Badge>
          <Badge variant={timeLeft.expired || timeLeft.urgent ? "urgent" : "neutral"}>
            {timeLeft.label}
          </Badge>
        </div>
      </Link>
    </motion.article>
  );
}
