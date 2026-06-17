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
import type { UserProfile } from "@/types/database";

type ProfileContextValue = {
  profile: UserProfile | null;
  loading: boolean;
  refetch: () => Promise<void>;
};

const ProfileContext = createContext<ProfileContextValue | null>(null);

/**
 * Holds the signed-in user's profile in ONE place so every screen - including
 * the onboarding redirect gate - reads the same value. Without this, filling
 * out onboarding only updated the local copy on that page, and other pages
 * kept redirecting back as if no details had been entered.
 */
export function ProfileProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [profile, setProfile] = useState<UserProfile | null>(null);
  // `loading` stays true until a fetch for the CURRENT user finishes, so gates
  // never act on a stale null right after sign-in.
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

  const value: ProfileContextValue = {
    profile,
    loading: fetchedFor === undefined || fetchedFor !== userId,
    refetch,
  };

  return createElement(ProfileContext.Provider, { value }, children);
}

export function useProfile(): ProfileContextValue {
  const ctx = useContext(ProfileContext);
  if (!ctx) throw new Error("useProfile must be used within a ProfileProvider");
  return ctx;
}
