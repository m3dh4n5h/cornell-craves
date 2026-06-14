import { useCallback, useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { MapContainer, Marker, TileLayer, useMap } from "react-leaflet";
import "leaflet/dist/leaflet.css";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { createBrandPin } from "@/components/MapPin";
import { BrandFilter } from "@/components/BrandFilter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { brandInitials, brandTint } from "@/lib/brands";
import { DIETARY_TAGS, DIETARY_TAG_IDS, listingDietaryTags } from "@/lib/dietary";
import { PICKUP_TYPE_LABELS } from "@/lib/orders";
import {
  formatPickupDay,
  hasUpcomingPickup,
  nextPickup,
  ORDER_TYPE_SHORT,
} from "@/lib/pickup";
import { priceRange } from "@/lib/format";
import { getTimeLeft } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DietaryTagId, ListingWithClub, OrderType, PickupType } from "@/types/database";

const CORNELL_CENTER: [number, number] = [42.4534, -76.4735];

interface LocationEntry {
  listing: ListingWithClub;
  /** The order type for this listing at this specific spot (null = legacy). */
  orderType: OrderType | null;
}

interface LocationGroup {
  key: string;
  name: string;
  pickupType: PickupType;
  position: [number, number];
  entries: LocationEntry[];
}

function FlyTo({ target }: { target: [number, number] | null }) {
  const map = useMap();
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (!target) return;
    if (reduceMotion) {
      map.setView(target, 16);
    } else {
      map.flyTo(target, 16, { duration: 0.8 });
    }
  }, [map, target, reduceMotion]);

  return null;
}

export default function MapPage() {
  const reduceMotion = useReducedMotion();
  const [listings, setListings] = useState<ListingWithClub[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedBrand, setSelectedBrand] = useState<string | null>(null);
  const [dietaryFilter, setDietaryFilter] = useState<DietaryTagId[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const nowIso = new Date().toISOString();
    const { data, error } = await supabase
      .from("listings")
      .select(
        "*, clubs(name, venmo, zelle_phone, groups_enabled, logo_url), campus_locations(name, latitude, longitude, pickup_type), listing_pickup_spots(*, campus_locations(id, name, latitude, longitude, description)), pickup_slots(start_time, end_time)",
      )
      .eq("active", true)
      .gt("expires_at", nowIso)
      .returns<ListingWithClub[]>();
    if (error) {
      setLoadError(error.message);
    } else {
      setListings(data ?? []);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const brands = useMemo(
    () => [...new Set(listings.map((listing) => listing.brand))].sort((a, b) => a.localeCompare(b)),
    [listings],
  );

  const filtered = useMemo(
    () =>
      listings.filter((listing) => {
        if (selectedBrand && listing.brand !== selectedBrand) return false;
        if (dietaryFilter.length > 0) {
          // OR logic: any selected tag present anywhere in the listing.
          const tags = listingDietaryTags(listing.items);
          if (!dietaryFilter.some((tag) => tags.includes(tag))) return false;
        }
        return true;
      }),
    [listings, selectedBrand, dietaryFilter],
  );

  // Expand each listing across all its pickup spots, then group by location. A
  // listing only pins where it has a pickup happening today or upcoming (#10).
  const groups = useMemo(() => {
    const byLocation = new Map<string, LocationGroup>();
    for (const listing of filtered) {
      if (!hasUpcomingPickup(listing)) continue;
      const spots = listing.listing_pickup_spots ?? [];
      const places =
        spots.length > 0
          ? spots.flatMap((spot) =>
              spot.campus_locations
                ? [
                    {
                      name: spot.campus_locations.name,
                      lat: Number(spot.campus_locations.latitude),
                      lng: Number(spot.campus_locations.longitude),
                      orderType: spot.order_type as OrderType | null,
                      pickupType: (spot.order_type === "same_day"
                        ? "same_day_only"
                        : "preorder_only") as PickupType,
                    },
                  ]
                : [],
            )
          : listing.campus_locations
            ? [
                {
                  name: listing.campus_locations.name,
                  lat: Number(listing.campus_locations.latitude),
                  lng: Number(listing.campus_locations.longitude),
                  orderType: null as OrderType | null,
                  pickupType: (listing.campus_locations.pickup_type ?? "both") as PickupType,
                },
              ]
            : [];
      for (const place of places) {
        const key = `${place.lat},${place.lng}`;
        const existing = byLocation.get(key);
        if (existing) {
          existing.entries.push({ listing, orderType: place.orderType });
          if (existing.pickupType !== place.pickupType) existing.pickupType = "both";
        } else {
          byLocation.set(key, {
            key,
            name: place.name,
            pickupType: place.pickupType,
            position: [place.lat, place.lng],
            entries: [{ listing, orderType: place.orderType }],
          });
        }
      }
    }
    return [...byLocation.values()];
  }, [filtered]);

  const selectedGroup = groups.find((group) => group.key === selectedKey) ?? null;

  const pinnedIds = useMemo(() => {
    const ids = new Set<string>();
    for (const group of groups) for (const entry of group.entries) ids.add(entry.listing.id);
    return ids;
  }, [groups]);
  const unlocatedCount = filtered.length - pinnedIds.size;

  const toggleDietary = (tag: DietaryTagId) => {
    setDietaryFilter((previous) =>
      previous.includes(tag) ? previous.filter((entry) => entry !== tag) : [...previous, tag],
    );
  };

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-2xl font-extrabold tracking-tight">Drops on campus</h1>
        {!loading && !loadError && (
          <span className="text-sm text-ink-muted">
            {pinnedIds.size} pinned {pinnedIds.size === 1 ? "drop" : "drops"}
            {unlocatedCount > 0 && `, ${unlocatedCount} more on the feed without a pin`}
          </span>
        )}
      </div>

      {brands.length > 1 && (
        <div className="mt-3">
          <BrandFilter
            brands={brands}
            selected={selectedBrand}
            onSelect={(brand) => {
              setSelectedBrand(brand);
              setSelectedKey(null);
            }}
          />
        </div>
      )}

      <div className="mt-2 flex flex-wrap gap-1.5" role="group" aria-label="Filter by dietary tag">
        {DIETARY_TAG_IDS.map((tag) => {
          const meta = DIETARY_TAGS[tag];
          const selected = dietaryFilter.includes(tag);
          return (
            <button
              key={tag}
              type="button"
              aria-pressed={selected}
              onClick={() => toggleDietary(tag)}
              className={cn(
                "inline-flex items-center gap-1 rounded-full border px-2.5 py-1.5 text-xs font-semibold transition-colors duration-150 [transition-timing-function:var(--ease-out)] active:scale-[0.97]",
                selected
                  ? cn("border-transparent", meta.className)
                  : "border-border text-ink-muted hover-fine:border-primary",
              )}
            >
              <meta.Icon className="size-3.5" aria-hidden="true" />
              {meta.label}
            </button>
          );
        })}
      </div>

      <div className="craves-map relative mt-4 h-[60dvh] min-h-[420px] overflow-hidden rounded-2xl border border-border">
        {loading ? (
          <div className="h-full w-full animate-pulse bg-border/40" aria-busy="true" aria-label="Loading map" />
        ) : loadError ? (
          <div className="flex h-full items-center justify-center p-6">
            <div className="text-center">
              <AlertTriangle className="mx-auto size-6 text-accent" aria-hidden="true" />
              <p className="mt-2 text-sm text-ink-muted">
                Could not load drops for the map. The feed still works.
              </p>
              <div className="mt-4 flex justify-center gap-2">
                <Button size="sm" onClick={() => void load()}>
                  Retry
                </Button>
                <Link to="/">
                  <Button variant="secondary" size="sm">
                    Open the feed
                  </Button>
                </Link>
              </div>
            </div>
          </div>
        ) : (
          <>
            <MapContainer
              center={CORNELL_CENTER}
              zoom={15}
              scrollWheelZoom
              className="h-full w-full"
            >
              {/* CARTO Voyager: warm, low-saturation tiles that sit well under saffron pins. */}
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
                url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
              />
              <FlyTo target={selectedGroup?.position ?? null} />
              {groups.map((group) => (
                <Marker
                  key={group.key}
                  position={group.position}
                  icon={createBrandPin(
                    group.entries[0].listing.brand,
                    group.entries.length,
                    group.key === selectedKey,
                    group.pickupType,
                  )}
                  eventHandlers={{
                    click: () => setSelectedKey(group.key === selectedKey ? null : group.key),
                  }}
                />
              ))}
            </MapContainer>

            {groups.length === 0 && (
              <div className="z-raised absolute inset-x-4 top-4 rounded-2xl border border-border bg-surface-raised/95 p-4 text-center backdrop-blur-md">
                <p className="text-sm font-semibold">No pinned drops match those filters.</p>
                <p className="mt-1 text-xs text-ink-muted">
                  Try fewer filters, or browse everything on the <Link to="/" className="font-semibold text-primary-dark">feed</Link>.
                </p>
              </div>
            )}

            <AnimatePresence>
              {selectedGroup && (
                <motion.div
                  key={selectedGroup.key}
                  initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={
                    reduceMotion
                      ? { opacity: 0, transition: { duration: 0.1 } }
                      : { opacity: 0, y: 24, transition: { duration: 0.15 } }
                  }
                  transition={{ duration: 0.2, ease: [0.23, 1, 0.32, 1] }}
                  className="z-raised absolute inset-x-3 bottom-3 max-h-[45%] overflow-y-auto rounded-2xl border border-border bg-surface-raised/95 p-3 shadow-[0_8px_24px_oklch(18%_0.02_260/0.16)] backdrop-blur-md"
                >
                  <div className="flex items-center justify-between gap-2 px-1">
                    <span className="flex min-w-0 items-center gap-2">
                      <h2 className="truncate text-sm font-bold">{selectedGroup.name}</h2>
                      <Badge variant="neutral" className="shrink-0">
                        {PICKUP_TYPE_LABELS[selectedGroup.pickupType]}
                      </Badge>
                    </span>
                    <button
                      type="button"
                      onClick={() => setSelectedKey(null)}
                      aria-label="Close location preview"
                      className="rounded-full p-1 text-ink-muted hover-fine:bg-ink/10"
                    >
                      <X className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                  <div className="mt-2 space-y-2">
                    {selectedGroup.entries.map(({ listing, orderType }) => {
                      const timeLeft = getTimeLeft(listing.expires_at);
                      const range = priceRange(listing.items ?? []);
                      const day = nextPickup(listing);
                      return (
                        <Link
                          key={listing.id}
                          to={`/listing/${listing.id}`}
                          className="flex items-center gap-3 rounded-xl border border-border bg-surface-raised p-2.5 transition-colors duration-150 [transition-timing-function:var(--ease-out)] hover-fine:border-primary active:scale-[0.99]"
                        >
                          <span
                            className={cn(
                              "flex size-10 shrink-0 items-center justify-center rounded-lg font-display text-sm font-extrabold text-ink/80",
                              brandTint(listing.brand),
                            )}
                            aria-hidden="true"
                          >
                            {brandInitials(listing.brand)}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-bold">{listing.title}</span>
                            <span className="block truncate text-xs text-ink-muted">
                              {listing.brand}
                              {range ? `, ${range}` : ""}
                            </span>
                            <span className="mt-1 flex flex-wrap items-center gap-1">
                              {orderType && (
                                <Badge variant={orderType === "same_day" ? "success" : "default"}>
                                  {ORDER_TYPE_SHORT[orderType]}
                                </Badge>
                              )}
                              {day && (
                                <span className="text-xs font-semibold text-ink-muted">
                                  Pickup {formatPickupDay(day)}
                                </span>
                              )}
                            </span>
                          </span>
                          <Badge variant={timeLeft.urgent ? "urgent" : "neutral"}>{timeLeft.label}</Badge>
                        </Link>
                      );
                    })}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </>
        )}
      </div>
    </div>
  );
}
