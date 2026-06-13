import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import type { Club } from "@/types/database";

export function useClub() {
  const { user } = useAuth();
  const [club, setClub] = useState<Club | null>(null);
  const [error, setError] = useState<string | null>(null);
  // See useProfile: `loading` holds until the fetch matches the current user,
  // so auth gates never act on a stale value mid sign-in.
  const [fetchedFor, setFetchedFor] = useState<string | null | undefined>(undefined);

  const userId = user?.id ?? null;

  const refetch = useCallback(async () => {
    if (!userId) {
      setClub(null);
      setFetchedFor(null);
      return;
    }
    setError(null);
    const { data, error: queryError } = await supabase
      .from("clubs")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    if (queryError) {
      setError(queryError.message);
      setClub(null);
    } else {
      setClub(data);
    }
    setFetchedFor(userId);
  }, [userId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { club, loading: fetchedFor === undefined || fetchedFor !== userId, error, refetch };
}
