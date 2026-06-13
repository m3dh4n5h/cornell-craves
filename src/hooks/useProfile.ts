import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import type { UserProfile } from "@/types/database";

export function useProfile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  // Tracks which user the current `profile` value belongs to. `loading` stays
  // true until a fetch for the CURRENT user finishes, which prevents redirect
  // gates from acting on a stale null right after sign-in.
  const [fetchedFor, setFetchedFor] = useState<string | null | undefined>(undefined);

  const userId = user?.id ?? null;

  const refetch = useCallback(async () => {
    if (!userId) {
      setProfile(null);
      setFetchedFor(null);
      return;
    }
    const { data } = await supabase
      .from("users_extended")
      .select("*")
      .eq("id", userId)
      .maybeSingle();
    setProfile(data);
    setFetchedFor(userId);
  }, [userId]);

  useEffect(() => {
    void refetch();
  }, [refetch]);

  return { profile, loading: fetchedFor === undefined || fetchedFor !== userId, refetch };
}
