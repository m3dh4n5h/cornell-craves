import { Link } from "react-router-dom";
import { CalendarDays, MapPinned, SearchX } from "lucide-react";
import { usePickupAgenda } from "@/hooks/usePickupAgenda";
import { groupAgendaByDay, formatPickupDay, type PickupAgendaEntry } from "@/lib/pickup";
import { formatEasternTime } from "@/lib/format";
import { brandInitials, brandTint } from "@/lib/brands";
import { StockBadge } from "@/components/StockBadge";
import { GoalProgress } from "@/components/GoalProgress";
import { EmptyState } from "@/components/EmptyState";
import { Badge } from "@/components/ui/badge";
import { itemRemaining, listingSoldOut } from "@/lib/stock";

function AgendaRow({ entry }: { entry: PickupAgendaEntry }) {
  const { listing } = entry;
  const soldOut = listingSoldOut(listing);
  // The lowest-stock capped item, if any, for a compact "12 left" chip.
  const low = soldOut
    ? null
    : (listing.items ?? [])
        .map((item) => ({ item, remaining: itemRemaining(listing, item) }))
        .find(({ item, remaining }) => remaining != null && item.stock != null && remaining < item.stock * 0.2);

  return (
    <Link
      to={`/listing/${listing.id}`}
      className="flex items-start gap-3 rounded-2xl border border-border bg-surface-raised p-3.5 transition-[transform,box-shadow,border-color] duration-150 [transition-timing-function:var(--ease-out)] hover-fine:-translate-y-0.5 hover-fine:border-primary/60 active:scale-[0.98]"
    >
      {listing.clubs?.logo_url ? (
        <img
          src={listing.clubs.logo_url}
          alt=""
          className="size-11 shrink-0 rounded-xl border border-border object-cover"
          loading="lazy"
        />
      ) : (
        <span
          className={`flex size-11 shrink-0 items-center justify-center rounded-xl font-display text-sm font-extrabold text-ink/80 ${brandTint(listing.brand)}`}
          aria-hidden="true"
        >
          {brandInitials(listing.brand)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">{listing.title}</p>
        <p className="truncate text-xs text-ink-muted">
          {listing.brand}
          {listing.clubs?.name ? ` by ${listing.clubs.name}` : ""}
        </p>
        <p className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-ink-muted">
          <span className="font-semibold text-ink">{formatEasternTime(entry.start)}</span>
          {entry.locationName && (
            <span className="flex items-center gap-1">
              <MapPinned className="size-3 shrink-0" aria-hidden="true" />
              {entry.locationName}
            </span>
          )}
        </p>
        {soldOut ? (
          <StockBadge remaining={0} stock={0} className="mt-2" />
        ) : (
          low && <StockBadge remaining={low.remaining} stock={low.item.stock} className="mt-2" />
        )}
        {listing.goal_amount != null && (
          <GoalProgress
            compact
            goal={Number(listing.goal_amount)}
            raised={listing.goal_raised ?? 0}
            className="mt-2 max-w-56"
          />
        )}
      </div>
    </Link>
  );
}

export default function Week() {
  const { entries, loading } = usePickupAgenda({ days: 7 });
  const days = groupAgendaByDay(entries);

  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 md:py-8">
      <div className="flex items-center gap-2.5">
        <CalendarDays className="size-6 shrink-0 text-primary-dark" aria-hidden="true" />
        <h1 className="text-2xl font-extrabold tracking-tight">This week on campus</h1>
      </div>
      <p className="mt-1.5 text-sm text-ink-muted">
        Every live drop's pickup times for the next 7 days, in one place.
      </p>

      {loading ? (
        <div className="mt-6 space-y-3" aria-busy="true" aria-label="Loading this week's drops">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-20 animate-pulse rounded-2xl bg-border/40" />
          ))}
        </div>
      ) : days.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            icon={<SearchX className="size-6" aria-hidden="true" />}
            title="Nothing scheduled this week"
            body="Check back soon, or browse everything live on the feed."
          />
        </div>
      ) : (
        <div className="mt-6 space-y-6">
          {days.map((day) => (
            <section key={day.dayKey}>
              <div className="flex items-center gap-2">
                <h2 className="text-base font-bold">{formatPickupDay(day.date)}</h2>
                <Badge variant="neutral">
                  {day.entries.length} {day.entries.length === 1 ? "drop" : "drops"}
                </Badge>
              </div>
              <div className="mt-2.5 space-y-2.5">
                {day.entries.map((entry) => (
                  <AgendaRow key={`${entry.listing.id}-${entry.slotId ?? "expiry"}`} entry={entry} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
