import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useListings } from "@/hooks/useListings";
import { buildPickupAgenda, type PickupAgendaEntry, type PickupSlotLite } from "@/lib/pickup";

interface UsePickupAgendaOptions {
  days?: number;
  /** Drop one listing (the one a club is currently editing) from the result. */
  excludeListingId?: string;
}

/**
 * Campus-wide pickup agenda for the next `days` days: every live, public
 * listing (useListings() with no args already scopes to active + not yet
 * expired), joined to its scheduled pickup_slots. pickup_slots is publicly
 * readable ("Slots are public", migration 002) so this is a plain client
 * query, no RPC needed. Shared by the /week page and the club form's
 * same-day conflict warning.
 */
export function usePickupAgenda({ days = 7, excludeListingId }: UsePickupAgendaOptions = {}) {
  const { listings, loading: listingsLoading, error } = useListings();
  const [slotsByListing, setSlotsByListing] = useState<Map<string, PickupSlotLite[]>>(new Map());
  const [slotsLoading, setSlotsLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const ids = listings.map((listing) => listing.id);
    if (ids.length === 0) {
      setSlotsByListing(new Map());
      setSlotsLoading(false);
      return;
    }
    setSlotsLoading(true);
    const from = new Date();
    const windowEnd = new Date(from.getTime() + days * 86_400_000);
    supabase
      .from("pickup_slots")
      .select("id, listing_id, start_time, end_time, location_id")
      .in("listing_id", ids)
      .lte("start_time", windowEnd.toISOString())
      .gte("end_time", from.toISOString())
      .order("start_time", { ascending: true })
      .then(({ data, error: slotsError }) => {
        if (cancelled) return;
        if (slotsError) {
          console.warn("pickup slots unavailable:", slotsError.message);
          setSlotsByListing(new Map());
          setSlotsLoading(false);
          return;
        }
        const map = new Map<string, PickupSlotLite[]>();
        for (const row of (data as PickupSlotLite[] | null) ?? []) {
          const list = map.get(row.listing_id);
          if (list) list.push(row);
          else map.set(row.listing_id, [row]);
        }
        setSlotsByListing(map);
        setSlotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listings, days]);

  const entries = useMemo<PickupAgendaEntry[]>(() => {
    const all = buildPickupAgenda(listings, slotsByListing, new Date(), days);
    return excludeListingId ? all.filter((entry) => entry.listing.id !== excludeListingId) : all;
  }, [listings, slotsByListing, days, excludeListingId]);

  return { entries, loading: listingsLoading || slotsLoading, error };
}
