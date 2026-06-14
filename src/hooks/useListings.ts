import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { ListingWithClub } from "@/types/database";

interface UseListingsOptions {
  /** When set, fetch every listing for this club (dashboard view), including inactive ones. */
  clubId?: string;
  /** Set false to hold off fetching, e.g. while auth is still resolving. */
  enabled?: boolean;
}

export function useListings({ clubId, enabled = true }: UseListingsOptions = {}) {
  const [listings, setListings] = useState<ListingWithClub[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!enabled) {
      setListings([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    let query = supabase
      .from("listings")
      .select(
        "*, clubs(name, venmo, zelle_phone, groups_enabled, logo_url), listing_pickup_spots(*, campus_locations(id, name, latitude, longitude, description))",
      )
      .order("created_at", { ascending: false });
    if (clubId) {
      query = query.eq("club_id", clubId);
    } else {
      query = query.eq("active", true).gt("expires_at", new Date().toISOString());
    }
    const { data, error: queryError } = await query.returns<ListingWithClub[]>();
    if (queryError) {
      setError(queryError.message);
      setListings([]);
    } else {
      setListings(data ?? []);
    }
    setLoading(false);
  }, [clubId, enabled]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { listings, loading, error, refetch };
}

export function useListing(id: string | undefined) {
  const [listing, setListing] = useState<ListingWithClub | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    if (!id) {
      setListing(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    const { data, error: queryError } = await supabase
      .from("listings")
      .select(
        "*, clubs(name, venmo, zelle_phone, groups_enabled, logo_url), campus_locations(name, latitude, longitude), listing_pickup_spots(*, campus_locations(id, name, latitude, longitude, description))",
      )
      .eq("id", id)
      .maybeSingle<ListingWithClub>();
    if (queryError) {
      setError(queryError.message);
      setListing(null);
    } else {
      setListing(data);
    }
    setLoading(false);
  }, [id]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { listing, loading, error, refetch };
}
