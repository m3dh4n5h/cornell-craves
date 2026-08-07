import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase, ADMIN_EMAIL } from "@/lib/supabase";

interface AuthContextValue {
  session: Session | null;
  user: User | null;
  /**
   * Anyone on the admin roster with status 'active', plus the address in
   * VITE_ADMIN_EMAIL. Only a hint for what to render - the database decides
   * what an admin can actually do, through `is_admin()` and RLS.
   */
  isAdmin: boolean;
  /** The single owner, who alone can manage the admin roster (migration 046). */
  isOwner: boolean;
  /**
   * True until the roster lookup has answered for the current session.
   *
   * Gates MUST wait on this. `isAdmin` is now resolved over the network, so
   * anyone whose access comes from the roster rather than VITE_ADMIN_EMAIL
   * looks like a plain student for the first moment after sign-in - long enough
   * for the onboarding redirect to fire and strand them on a NetID form.
   */
  roleLoading: boolean;
  /** True when the session came through Google sign-in (student accounts). */
  isGoogleUser: boolean;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  // What the database says about this session. `admin: null` means "unknown"
  // (not asked yet, or the call failed) and falls back to the env var below.
  // `resolvedFor` records which email we have an answer for, so gates can tell
  // "still asking" apart from "asked, and the answer is no".
  const [roster, setRoster] = useState<{
    admin: boolean | null;
    owner: boolean;
    resolvedFor: string | null;
  }>({ admin: null, owner: false, resolvedFor: null });

  useEffect(() => {
    let cancelled = false;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!cancelled) {
          setSession(data.session);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) setLoading(false);
      });

    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setLoading(false);
    });

    return () => {
      cancelled = true;
      listener.subscription.unsubscribe();
    };
  }, []);

  const sessionEmail = session?.user?.email ?? "";

  /**
   * Ask the database who this is. Before migration 046 the client decided
   * "admin" by comparing against a single VITE_ADMIN_EMAIL, which meant a
   * second admin added to the roster would never see the console at all. The
   * roster is the truth; the env var survives only as a fallback below.
   */
  useEffect(() => {
    if (!sessionEmail) {
      setRoster({ admin: null, owner: false, resolvedFor: null });
      return;
    }
    let cancelled = false;
    void (async () => {
      const [adminResult, ownerResult] = await Promise.all([
        supabase.rpc("am_i_admin"),
        supabase.rpc("am_i_owner"),
      ]);
      if (cancelled) return;
      setRoster({
        // On error (RPC missing, offline) stay null and let the env fallback
        // decide, rather than demoting someone because a request failed.
        admin: adminResult.error ? null : Boolean(adminResult.data),
        // `am_i_owner` does not exist until 046 is applied. No owner is the
        // correct answer then: the roster UI simply stays hidden.
        owner: ownerResult.error ? false : Boolean(ownerResult.data),
        // Resolved either way. An errored lookup is still an answer; leaving
        // this null would hang every gate forever when the RPC is missing.
        resolvedFor: sessionEmail,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionEmail]);

  const value = useMemo<AuthContextValue>(() => {
    const email = sessionEmail;
    const envAdmin =
      email.length > 0 &&
      ADMIN_EMAIL.length > 0 &&
      email.toLowerCase() === ADMIN_EMAIL.toLowerCase();
    return {
      session,
      user: session?.user ?? null,
      // OR rather than replace, deliberately. If the roster says no but the env
      // says yes, you still reach /admin - where the existing banner tells you
      // the database does not recognise you. Losing that diagnostic would make
      // a misconfigured deploy look like a missing page.
      isAdmin: envAdmin || roster.admin === true,
      isOwner: roster.owner,
      // Someone matching VITE_ADMIN_EMAIL is admin instantly, so there is
      // nothing to wait for in that case.
      roleLoading: Boolean(email) && !envAdmin && roster.resolvedFor !== email,
      isGoogleUser: session?.user?.app_metadata?.provider === "google",
      loading,
      signOut: async () => {
        await supabase.auth.signOut();
      },
    };
  }, [session, sessionEmail, loading, roster]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used inside an AuthProvider");
  }
  return context;
}
