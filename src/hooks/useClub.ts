import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import type { Club } from "@/types/database";

type ClubContextValue = {
  club: Club | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
};

const ClubContext = createContext<ClubContextValue | null>(null);

/**
 * Holds the signed-in user's club row in ONE place so every consumer (the nav,
 * the role/onboarding gates, and every page) reads the same value. Without this,
 * registering a club mid-session only updated the local copy on the Register
 * page, and the nav + guards kept treating the user as a student until a hard
 * reload. Same fix as ProfileProvider.
 */
export function ClubProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [club, setClub] = useState<Club | null>(null);
  const [error, setError] = useState<string | null>(null);
  // `loading` holds until the fetch matches the current user, so gates never
  // act on a stale value mid sign-in.
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

  const value: ClubContextValue = {
    club,
    loading: fetchedFor === undefined || fetchedFor !== userId,
    error,
    refetch,
  };

  return createElement(ClubContext.Provider, { value }, children);
}

export function useClub(): ClubContextValue {
  const ctx = useContext(ClubContext);
  if (!ctx) throw new Error("useClub must be used within a ClubProvider");
  return ctx;
}
