import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Map as MapGL, Marker, NavigationControl, type MapRef } from "react-map-gl/maplibre";
import "maplibre-gl/dist/maplibre-gl.css";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { BrandPin } from "@/components/MapPin";
import { BrandFilter } from "@/components/BrandFilter";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { brandInitials, brandTint } from "@/lib/brands";
import { DIETARY_TAGS, DIETARY_TAG_IDS } from "@/lib/dietary";
import { PICKUP_TYPE_LABELS } from "@/lib/orders";
import {
  formatPickupDay,
  hasUpcomingPickup,
  nextPickup,
  ORDER_TYPE_BADGE,
  ORDER_TYPE_SHORT,
  ORDER_TYPE_TO_PICKUP_TYPE,
  spotHoursText,
} from "@/lib/pickup";
import { priceRange } from "@/lib/format";
import { getTimeLeft } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DietaryTagId, ListingWithClub, OrderType, PickupType } from "@/types/database";

const CORNELL_CENTER = { longitude: -76.4735, latitude: 42.4534 };
// OpenFreeMap "liberty": free, no API key, labeled vector style with building
// and street names. Tiles/sprites/glyphs all come from *.openfreemap.org.
const MAP_STYLE = "https://tiles.openfreemap.org/styles/liberty";

interface LocationEntry {
  listing: ListingWithClub;
  /** The order type for this listing at this specific spot (null = legacy). */
  orderType: OrderType | null;
  /** Availability hours/timing text for this spot, shown in the popup. */
  hoursText: string;
}

interface LocationGroup {
  key: string;
  name: string;
  pickupType: PickupType;
  position: [number, number];
  entries: LocationEntry[];
}

export default function MapPage() {
  const reduceMotion = useReducedMotion();
  const mapRef = useRef<MapRef>(null);
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
        "*, clubs(name, venmo, zelle_phone, groups_enabled, logo_url, member_options), campus_locations(name, latitude, longitude, pickup_type), listing_pickup_spots(*, campus_locations(id, name, latitude, longitude, description)), pickup_slots(start_time, end_time, location_id, campus_locations(id, name, latitude, longitude))",
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
          // AND logic: keep the listing only if at least one item satisfies
          // EVERY selected restriction (someone vegetarian AND dairy-free needs
          // an item that is both, not two separate items).
          const matches = listing.items.some((item) =>
            dietaryFilter.every((tag) => (item.dietary_tags ?? []).includes(tag)),
          );
          if (!matches) return false;
        }
        return true;
      }),
    [listings, selectedBrand, dietaryFilter],
  );

  // Expand each listing across all its pickup spots, then group by location. A
  // listing only pins where it has a pickup happening today or upcoming (#10).
  const groups = useMemo(() => {
    const now = Date.now();
    const byLocation = new Map<string, LocationGroup>();
    for (const listing of filtered) {
      if (!hasUpcomingPickup(listing)) continue;
      const spots = listing.listing_pickup_spots ?? [];
      const orderTypeAt = (locationId: string): OrderType | null =>
        spots.find((spot) => spot.location_id === locationId)?.order_type ?? null;

      // #6: when a listing assigns locations to its pickup days, a location pins
      // ONLY on a day it actually happens — i.e. it has an upcoming slot there.
      const upcomingSlotLocs = (listing.pickup_slots ?? []).filter(
        (slot) => slot.location_id && slot.campus_locations && new Date(slot.end_time).getTime() >= now,
      );

      // Hours/timing text for a spot at a given location (multi-day -> note).
      const hoursAt = (locationId: string): string => {
        const spot = spots.find((s) => s.location_id === locationId);
        return spot ? spotHoursText(spot) : "";
      };

      let places: {
        name: string;
        lat: number;
        lng: number;
        orderType: OrderType | null;
        pickupType: PickupType;
        hoursText: string;
      }[];

      if (upcomingSlotLocs.length > 0) {
        const byLoc = new Map<string, (typeof places)[number]>();
        for (const slot of upcomingSlotLocs) {
          const loc = slot.campus_locations!;
          if (byLoc.has(loc.id)) continue;
          const orderType = orderTypeAt(loc.id);
          byLoc.set(loc.id, {
            name: loc.name,
            lat: Number(loc.latitude),
            lng: Number(loc.longitude),
            orderType,
            pickupType: orderType ? ORDER_TYPE_TO_PICKUP_TYPE[orderType] : "both",
            hoursText: hoursAt(loc.id),
          });
        }
        places = [...byLoc.values()];
      } else if (spots.length > 0) {
        // A spot's pin shows only within its availability window, if one is set.
        const spotLive = (spot: (typeof spots)[number]) => {
          if (spot.available_start && new Date(spot.available_start).getTime() > now) return false;
          if (spot.available_end && new Date(spot.available_end).getTime() < now) return false;
          return true;
        };
        places = spots.flatMap((spot) =>
          spot.campus_locations && spotLive(spot)
            ? [
                {
                  name: spot.campus_locations.name,
                  lat: Number(spot.campus_locations.latitude),
                  lng: Number(spot.campus_locations.longitude),
                  orderType: spot.order_type as OrderType | null,
                  pickupType: ORDER_TYPE_TO_PICKUP_TYPE[spot.order_type],
                  hoursText: spotHoursText(spot),
                },
              ]
            : [],
        );
      } else if (listing.campus_locations) {
        places = [
          {
            name: listing.campus_locations.name,
            lat: Number(listing.campus_locations.latitude),
            lng: Number(listing.campus_locations.longitude),
            orderType: null,
            pickupType: (listing.campus_locations.pickup_type ?? "both") as PickupType,
            hoursText: "",
          },
        ];
      } else {
        places = [];
      }

      for (const place of places) {
        const key = `${place.lat},${place.lng}`;
        const entry = { listing, orderType: place.orderType, hoursText: place.hoursText };
        const existing = byLocation.get(key);
        if (existing) {
          existing.entries.push(entry);
          if (existing.pickupType !== place.pickupType) existing.pickupType = "both";
        } else {
          byLocation.set(key, {
            key,
            name: place.name,
            pickupType: place.pickupType,
            position: [place.lat, place.lng],
            entries: [entry],
          });
        }
      }
    }
    return [...byLocation.values()];
  }, [filtered]);

  const selectedGroup = groups.find((group) => group.key === selectedKey) ?? null;

  // Pan to the chosen drop's pin when one is selected.
  useEffect(() => {
    if (!selectedGroup) return;
    mapRef.current?.flyTo({
      center: { lng: selectedGroup.position[1], lat: selectedGroup.position[0] },
      zoom: 16,
      duration: reduceMotion ? 0 : 800,
    });
  }, [selectedGroup, reduceMotion]);

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
            <MapGL
              ref={mapRef}
              initialViewState={{ ...CORNELL_CENTER, zoom: 14.5 }}
              mapStyle={MAP_STYLE}
              style={{ width: "100%", height: "100%" }}
            >
              <NavigationControl position="top-right" showCompass={false} />
              {groups.map((group) => (
                <Marker
                  key={group.key}
                  longitude={group.position[1]}
                  latitude={group.position[0]}
                  anchor="bottom"
                  onClick={(event) => {
                    event.originalEvent.stopPropagation();
                    setSelectedKey(group.key === selectedKey ? null : group.key);
                  }}
                >
                  <BrandPin
                    brand={group.entries[0].listing.brand}
                    count={group.entries.length}
                    active={group.key === selectedKey}
                    pickupType={group.pickupType}
                  />
                </Marker>
              ))}
            </MapGL>

            {groups.length === 0 && (
              <div className="z-raised absolute inset-x-4 top-4 rounded-2xl border border-border bg-surface-raised/95 p-4 text-center backdrop-blur-md">
                <p className="text-sm font-semibold">No pinned drops match those filters.</p>
                <p className="mt-1 text-xs text-ink-muted">
                  Try fewer filters, or browse everything on the <Link to="/" className="font-semibold text-primary-dark">feed</Link>.
                </p>
              </div>
            )}

          </>
        )}
      </div>

      {/* Drop details render BELOW the map — the old on-map overlay clipped
          awkwardly inside the rounded, overflow-hidden map container. */}
      <AnimatePresence>
        {selectedGroup && (
          <motion.div
            key={selectedGroup.key}
            initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={
              reduceMotion
                ? { opacity: 0, transition: { duration: 0.1 } }
                : { opacity: 0, y: 12, transition: { duration: 0.15 } }
            }
            transition={{ duration: 0.18, ease: [0.23, 1, 0.32, 1] }}
            className="mt-3 rounded-2xl border border-border bg-surface-raised p-3"
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
              {selectedGroup.entries.map(({ listing, orderType, hoursText }) => {
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
                          <Badge variant={ORDER_TYPE_BADGE[orderType]}>
                            {ORDER_TYPE_SHORT[orderType]}
                          </Badge>
                        )}
                        {day && (
                          <span className="text-xs font-semibold text-ink-muted">
                            Pickup {formatPickupDay(day)}
                          </span>
                        )}
                      </span>
                      {hoursText && (
                        <span className="mt-1 block whitespace-pre-wrap text-xs text-ink-muted">
                          {hoursText}
                        </span>
                      )}
                    </span>
                    <Badge variant={timeLeft.urgent ? "urgent" : "neutral"}>{timeLeft.label}</Badge>
                  </Link>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
