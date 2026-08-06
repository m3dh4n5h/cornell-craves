import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useClub } from "@/hooks/useClub";
import {
  TOUR_VERSION,
  clearLocalTourSeen,
  readLocalTourSeen,
  writeLocalTourSeen,
  type TourKey,
  type TourStatus,
} from "@/lib/tour";
import type { TourProgress } from "@/types/database";

interface TourContextValue {
  /** The walkthrough currently on screen, or null. */
  active: TourKey | null;
  /** Tours this account has already finished or skipped, at TOUR_VERSION. */
  seen: Set<TourKey>;
  /** True until the first fetch for the current user settles. */
  loading: boolean;
  /**
   * Whether the signed-in account type is allowed to run this walkthrough.
   * Student: everyone. Club: club accounts and the admin. Admin: admin only.
   */
  canOpen: (tour: TourKey) => boolean;
  open: (tour: TourKey) => void;
  close: () => void;
  /** Records the tour as done (server + local mirror) and closes it. */
  finish: (tour: TourKey, status: TourStatus, lastStep: number) => void;
  /** Forgets a tour so it can be auto-offered again. Used by "replay". */
  reset: (tour: TourKey) => void;
}

const TourContext = createContext<TourContextValue | null>(null);

/**
 * Owns walkthrough state for the whole app so any surface - the dashboard, the
 * admin console, /about, account settings - can launch the same tutorial.
 *
 * Persistence is best-effort by design. The server table (migration 045) is the
 * source of truth, but every write also lands in localStorage and every read
 * falls back to it. If 045 has not been applied yet, or the visitor is signed
 * out, the tutorial still behaves correctly - it just cannot follow them to a
 * new device. Nothing here ever blocks the UI on a network call.
 */
export function TourProvider({ children }: { children: ReactNode }) {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const { club } = useClub();
  const [active, setActive] = useState<TourKey | null>(null);
  const [seen, setSeen] = useState<Set<TourKey>>(new Set());
  const [fetchedFor, setFetchedFor] = useState<string | null | undefined>(undefined);
  // Set once we learn the table is missing, so we stop retrying on every write.
  const serverUnavailable = useRef(false);

  const userId = user?.id ?? null;

  useEffect(() => {
    let cancelled = false;

    const hydrate = async () => {
      if (authLoading) return;

      // Signed out: local-only. Someone browsing /about can still replay a
      // tutorial and we remember that they did.
      if (!userId) {
        if (cancelled) return;
        const local = new Set<TourKey>(
          (["student", "club", "admin"] as TourKey[]).filter((key) =>
            readLocalTourSeen(null, key),
          ),
        );
        setSeen(local);
        setFetchedFor(null);
        return;
      }

      const local = new Set<TourKey>(
        (["student", "club", "admin"] as TourKey[]).filter((key) =>
          readLocalTourSeen(userId, key),
        ),
      );

      if (serverUnavailable.current) {
        if (!cancelled) {
          setSeen(local);
          setFetchedFor(userId);
        }
        return;
      }

      const { data, error } = await supabase
        .from("tour_progress")
        .select("tour_key, version")
        .eq("user_id", userId);

      if (cancelled) return;

      if (error) {
        // Table missing (045 not applied) or unreadable. Degrade to local only,
        // exactly like the admin insights tab degrades without 041.
        serverUnavailable.current = true;
        setSeen(local);
        setFetchedFor(userId);
        return;
      }

      for (const row of (data ?? []) as Pick<TourProgress, "tour_key" | "version">[]) {
        // A version bump re-offers the tour, so old rows are ignored.
        if (row.version === TOUR_VERSION) local.add(row.tour_key);
      }
      setSeen(local);
      setFetchedFor(userId);
    };

    void hydrate();
    return () => {
      cancelled = true;
    };
  }, [userId, authLoading]);

  /**
   * Single source of truth for who may see which walkthrough. The admin tour
   * describes moderation and approval tooling, so it is admin-only; the club
   * tour is for club accounts (and the admin, who oversees them). Enforced here
   * rather than only in the UI so no future entry point can leak one by
   * forgetting a check.
   */
  const canOpen = useCallback(
    (tour: TourKey) => {
      if (tour === "admin") return isAdmin;
      if (tour === "club") return Boolean(club) || isAdmin;
      return true;
    },
    [isAdmin, club],
  );

  const open = useCallback(
    (tour: TourKey) => {
      if (!canOpen(tour)) return;
      setActive(tour);
    },
    [canOpen],
  );

  /** Closes without recording anything - the tour stays "unseen". */
  const close = useCallback(() => setActive(null), []);

  const finish = useCallback(
    (tour: TourKey, status: TourStatus, lastStep: number) => {
      setActive(null);
      // Optimistic: the tour must never re-open because a write was slow.
      setSeen((previous) => new Set(previous).add(tour));
      writeLocalTourSeen(userId, tour, status);
      if (!userId || serverUnavailable.current) return;
      void supabase
        .from("tour_progress")
        .upsert(
          {
            user_id: userId,
            tour_key: tour,
            status,
            last_step: lastStep,
            version: TOUR_VERSION,
            seen_at: new Date().toISOString(),
          },
          { onConflict: "user_id,tour_key" },
        )
        .then(({ error }) => {
          if (error) serverUnavailable.current = true;
        });
    },
    [userId],
  );

  const reset = useCallback(
    (tour: TourKey) => {
      setSeen((previous) => {
        const next = new Set(previous);
        next.delete(tour);
        return next;
      });
      clearLocalTourSeen(userId, tour);
      if (!userId || serverUnavailable.current) return;
      // A PostgrestBuilder only issues its request when it is awaited, so the
      // trailing .then() is load-bearing - without it this delete never runs.
      void supabase
        .from("tour_progress")
        .delete()
        .eq("user_id", userId)
        .eq("tour_key", tour)
        .then(({ error }) => {
          if (error) serverUnavailable.current = true;
        });
    },
    [userId],
  );

  const value = useMemo<TourContextValue>(
    () => ({
      active,
      seen,
      loading: fetchedFor === undefined || fetchedFor !== userId,
      canOpen,
      open,
      close,
      finish,
      reset,
    }),
    [active, seen, fetchedFor, userId, canOpen, open, close, finish, reset],
  );

  return <TourContext.Provider value={value}>{children}</TourContext.Provider>;
}

export function useTour(): TourContextValue {
  const context = useContext(TourContext);
  if (!context) throw new Error("useTour must be used inside a TourProvider");
  return context;
}
