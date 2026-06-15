import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { useWindowVirtualizer } from "@tanstack/react-virtual";
import { AlertTriangle, BellRing } from "lucide-react";
import { useListings } from "@/hooks/useListings";
import { useDebouncedValue } from "@/hooks/useDebouncedValue";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { ListingCard } from "@/components/ListingCard";
import { SkeletonCard } from "@/components/SkeletonCard";
import { BrandFilter } from "@/components/BrandFilter";
import { EmptyState } from "@/components/EmptyState";
import { Button } from "@/components/ui/button";
import { brandInitials, brandTint } from "@/lib/brands";
import { cn } from "@/lib/utils";
import type { ListingWithClub } from "@/types/database";

const VIRTUALIZE_THRESHOLD = 50;

const containerVariants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.05 } },
};

const HERO_TILES = [
  { brand: "Krispy Kreme", rotate: "-rotate-6" },
  { brand: "Insomnia Cookies", rotate: "rotate-3" },
  { brand: "Kung Fu Tea", rotate: "-rotate-2" },
];

function Hero() {
  const navigate = useNavigate();
  return (
    <section className="bg-primary">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-8 px-4 py-10 md:py-14">
        <div className="text-on-primary">
          <h1 className="max-w-[16ch] font-display text-3xl font-extrabold tracking-tight">
            Hot drops from Cornell clubs.
          </h1>
          <p className="mt-3 max-w-[44ch] text-on-primary/80">
            Student orgs sell donuts, cookies, and bubble tea to fund what they do. Grab
            yours before time runs out.
          </p>
          <Button
            size="lg"
            className="mt-6 bg-ink text-surface shadow-none hover-fine:bg-ink/85"
            onClick={() => navigate("/cravings")}
          >
            <BellRing className="size-4" aria-hidden="true" />
            Notify me
          </Button>
        </div>
        <div className="hidden shrink-0 items-center md:flex" aria-hidden="true">
          {HERO_TILES.map(({ brand, rotate }, index) => (
            <span
              key={brand}
              className={cn(
                "flex size-20 items-center justify-center rounded-2xl border border-ink/10 font-display text-xl font-extrabold text-ink/80 shadow-[0_4px_14px_oklch(18%_0.02_260/0.12)]",
                index > 0 && "-ml-4",
                brandTint(brand),
                rotate,
              )}
            >
              {brandInitials(brand)}
            </span>
          ))}
        </div>
      </div>
    </section>
  );
}

function VirtualFeed({ listings, columns }: { listings: ListingWithClub[]; columns: number }) {
  const listRef = useRef<HTMLDivElement>(null);
  const rowCount = Math.ceil(listings.length / columns);

  const virtualizer = useWindowVirtualizer({
    count: rowCount,
    estimateSize: () => 248,
    overscan: 5,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });

  return (
    <div ref={listRef}>
      <div className="relative" style={{ height: virtualizer.getTotalSize() }}>
        {virtualizer.getVirtualItems().map((row) => {
          const rowListings = listings.slice(row.index * columns, row.index * columns + columns);
          return (
            <div
              key={row.key}
              data-index={row.index}
              ref={virtualizer.measureElement}
              className="absolute left-0 top-0 grid w-full grid-cols-1 gap-4 pb-4 sm:grid-cols-2 lg:grid-cols-3"
              style={{
                transform: `translateY(${row.start - virtualizer.options.scrollMargin}px)`,
              }}
            >
              {rowListings.map((listing) => (
                <ListingCard key={listing.id} listing={listing} />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default function Home() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const { listings, loading, error, refetch } = useListings();
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const debouncedBrand = useDebouncedValue(selectedBrand, 300);

  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const isTablet = useMediaQuery("(min-width: 640px)");
  const columns = isDesktop ? 3 : isTablet ? 2 : 1;

  const brands = useMemo(
    () => [...new Set(listings.map((listing) => listing.brand))].sort((a, b) => a.localeCompare(b)),
    [listings],
  );

  const filtered = useMemo(() => {
    const base = debouncedBrand
      ? listings.filter((listing) => listing.brand === debouncedBrand)
      : listings;
    // Drops supporting a cause float to the top; otherwise keep newest-first
    // (the query already orders by created_at desc). Stable sort preserves it.
    return [...base].sort(
      (a, b) => Number(Boolean(b.cause_name)) - Number(Boolean(a.cause_name)),
    );
  }, [listings, debouncedBrand]);

  return (
    <>
      <Hero />
      <section className="mx-auto w-full max-w-6xl px-4 py-8">
        <div className="flex items-baseline justify-between gap-3">
          <h2 className="text-xl font-bold">Live drops</h2>
          {!loading && !error && (
            <span className="text-sm text-ink-muted">
              {filtered.length} live {filtered.length === 1 ? "drop" : "drops"}
            </span>
          )}
        </div>

        {loading ? (
          <>
            <div className="mt-4 flex gap-2" aria-hidden="true">
              {[64, 96, 80, 104, 88].map((width, index) => (
                <span
                  key={index}
                  className="h-9 shrink-0 animate-pulse rounded-full bg-border/60"
                  style={{ width }}
                />
              ))}
            </div>
            <div
              className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
              aria-busy="true"
              aria-label="Loading drops"
            >
              {Array.from({ length: 6 }, (_, index) => (
                <SkeletonCard key={index} />
              ))}
            </div>
          </>
        ) : error ? (
          <div className="mt-6">
            <EmptyState
              icon={<AlertTriangle className="size-6" aria-hidden="true" />}
              title="Could not load the feed"
              body="Something went wrong fetching drops. Check your connection and try again."
              actionLabel="Retry"
              onAction={() => void refetch()}
            />
          </div>
        ) : (
          <>
            {brands.length > 1 && (
              <div className="mt-4">
                <BrandFilter brands={brands} selected={selectedBrand} onSelect={setSelectedBrand} />
              </div>
            )}

            {filtered.length === 0 ? (
              <div className="mt-6">
                {debouncedBrand ? (
                  <EmptyState
                    icon={<BellRing className="size-6" aria-hidden="true" />}
                    title={`No ${debouncedBrand} drops right now`}
                    body="Try another brand, or get an email the moment one goes live."
                    actionLabel="Show all brands"
                    onAction={() => setSelectedBrand(null)}
                  />
                ) : (
                  <EmptyState
                    icon={<BellRing className="size-6" aria-hidden="true" />}
                    title="Nothing is sizzling right now"
                    body="No active drops at the moment. Leave your email and we will ping you the second one goes live."
                    actionLabel="Get notified"
                    onAction={() => navigate("/cravings")}
                  />
                )}
              </div>
            ) : filtered.length > VIRTUALIZE_THRESHOLD ? (
              <div className="mt-6">
                <VirtualFeed listings={filtered} columns={columns} />
              </div>
            ) : (
              <motion.div
                key={debouncedBrand ?? "all"}
                variants={containerVariants}
                initial={reduceMotion ? false : "hidden"}
                animate="show"
                className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
              >
                {filtered.map((listing) => (
                  <ListingCard key={listing.id} listing={listing} />
                ))}
              </motion.div>
            )}
          </>
        )}
      </section>
    </>
  );
}
