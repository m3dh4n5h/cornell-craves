import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import type { BrandRequest, ClubBrandApproval } from "@/types/database";

export interface ClubBrandStatus {
  /** Brands approved one-time for THIS club (beyond the global list). */
  approvedForClub: string[];
  /** This club's brand requests, newest first (pending, approved, rejected). */
  requests: BrandRequest[];
  loading: boolean;
  refetch: () => Promise<void>;
}

/**
 * The club's private brand situation: durable one-time approvals (migration
 * 040) plus the state of every request they filed. Powers the dashboard's
 * "Your brands" panel and the publish gate in the listing form.
 */
export function useClubBrandStatus(clubId: string | undefined): ClubBrandStatus {
  const [approvedForClub, setApprovedForClub] = useState<string[]>([]);
  const [requests, setRequests] = useState<BrandRequest[]>([]);
  const [loading, setLoading] = useState(true);

  const refetch = useCallback(async () => {
    if (!clubId) {
      setApprovedForClub([]);
      setRequests([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [approvals, reqs] = await Promise.all([
      supabase
        .from("club_brand_approvals")
        .select("*")
        .eq("club_id", clubId)
        .order("created_at", { ascending: false }),
      supabase
        .from("brand_requests")
        .select("*")
        .eq("club_id", clubId)
        .order("created_at", { ascending: false }),
    ]);
    setApprovedForClub(
      ((approvals.data as ClubBrandApproval[] | null) ?? []).map((row) => row.brand),
    );
    setRequests((reqs.data as BrandRequest[] | null) ?? []);
    setLoading(false);
  }, [clubId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { approvedForClub, requests, loading, refetch };
}

/** Case-insensitive membership test used by the publish gates. */
export function brandInList(brand: string, list: string[]): boolean {
  const needle = brand.trim().toLowerCase();
  return list.some((name) => name.trim().toLowerCase() === needle);
}
