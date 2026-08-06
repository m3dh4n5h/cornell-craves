import { Suspense, lazy, useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Compass, Sparkles } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useClub } from "@/hooks/useClub";
import { useProfile } from "@/hooks/useProfile";
import { useTour } from "@/hooks/useTour";
import { TOUR_META, tourForRole, type TourKey } from "@/lib/tour";
import { Button } from "@/components/ui/button";

/**
 * One lazy chunk per walkthrough. Two reasons for the split rather than a
 * single tutorial bundle:
 *   * nobody pays for a tutorial they never open;
 *   * the admin tour's copy describes approval and moderation tooling, and
 *     `canOpen` never lets a student or club open it - so its chunk is never
 *     fetched for them either.
 */
const TOURS = {
  student: lazy(() => import("@/components/tour/tours/student")),
  club: lazy(() => import("@/components/tour/tours/club")),
  admin: lazy(() => import("@/components/tour/tours/admin")),
} as const;

/**
 * Routes where a first-run invite would be an interruption rather than a help:
 * the person is mid-signup, mid-registration, or following a friend's invite
 * link and has one thing they are trying to do.
 */
const INVITE_EXEMPT_PREFIXES = [
  "/login",
  "/onboarding",
  "/preferences",
  "/register",
  "/invite",
  "/terms",
  // The About page has its own explicit walkthrough cards; an invite on top of
  // them would be redundant.
  "/about",
  // An order detail page is what someone has open at the pickup table with a QR
  // pass on screen. Never cover that.
  "/orders/",
];

/** True on any screen where a modal would interrupt something in progress. */
function isMidTask(pathname: string): boolean {
  if (INVITE_EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix))) return true;
  // Checkout: /listing/:id/order-form
  return pathname.endsWith("/order-form");
}

/** The small "want the tour?" card shown once, on first run. */
function TourInvite({
  tour,
  onStart,
  onDismiss,
}: {
  tour: TourKey;
  onStart: () => void;
  onDismiss: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const meta = TOUR_META[tour];

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onDismiss]);

  return (
    <>
      <motion.div
        className="z-overlay fixed inset-0 bg-ink/45"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1, transition: { duration: reduceMotion ? 0 : 0.2 } }}
        exit={{ opacity: 0, transition: { duration: reduceMotion ? 0 : 0.15 } }}
        onClick={onDismiss}
        aria-hidden="true"
      />
      <div className="z-modal pointer-events-none fixed inset-0 flex items-end justify-center p-4 sm:items-center">
        <motion.div
          role="dialog"
          aria-modal="true"
          aria-label="Take the walkthrough"
          className="pointer-events-auto w-full max-w-sm rounded-3xl border border-border bg-surface-raised p-6 text-center shadow-[0_12px_48px_oklch(18%_0.02_260/0.28)]"
          initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 24, scale: 0.97 }}
          animate={{
            opacity: 1,
            y: 0,
            scale: 1,
            transition: { duration: reduceMotion ? 0 : 0.26, ease: [0.32, 0.72, 0, 1] },
          }}
          exit={{ opacity: 0, transition: { duration: reduceMotion ? 0 : 0.15 } }}
        >
          <span className="mx-auto flex size-12 items-center justify-center rounded-2xl bg-primary/20">
            <Sparkles className="size-6 text-primary-dark" aria-hidden="true" />
          </span>
          <h2 className="mt-4 font-display text-xl font-extrabold tracking-tight text-ink">
            First time here?
          </h2>
          <p className="mt-2 text-sm text-ink-muted">
            {meta.blurb} It runs on sample data, so nothing you tap is real.
          </p>
          <Button className="mt-5 w-full" size="lg" onClick={onStart}>
            <Compass className="size-4" aria-hidden="true" />
            Start the {meta.minutes} walkthrough
          </Button>
          <Button variant="ghost" className="mt-2 w-full" onClick={onDismiss}>
            Not now
          </Button>
          <p className="mt-3 text-xs text-ink-muted">
            You can replay it any time from About Cornell Craves.
          </p>
        </motion.div>
      </div>
    </>
  );
}

/**
 * Mounted once, at the app root. Owns two things:
 *
 *  1. the first-run invite - offered once per account per role, never forced,
 *     and never on a route where the person is mid-task;
 *  2. rendering whichever walkthrough `useTour().open(...)` asked for, from
 *     anywhere in the app.
 *
 * Dismissing the invite records the tour as seen, so it asks once and then
 * leaves you alone. Replaying is always available from /about, the dashboards,
 * and account settings.
 */
export function TourHost() {
  const location = useLocation();
  const { user, isAdmin, loading: authLoading } = useAuth();
  const { club, loading: clubLoading } = useClub();
  const { profile, loading: profileLoading } = useProfile();
  const { active, seen, loading: tourLoading, open, finish } = useTour();
  const [inviteFor, setInviteFor] = useState<TourKey | null>(null);

  const rolesReady = !authLoading && !clubLoading && !profileLoading && !tourLoading;
  const suggested = tourForRole({ isAdmin, hasClub: Boolean(club) });

  useEffect(() => {
    if (!rolesReady || !user) return;
    if (active || inviteFor) return;
    if (seen.has(suggested)) return;
    if (isMidTask(location.pathname)) return;
    // A student who has not finished onboarding is still being asked for a
    // NetID; the onboarding gate owns the screen until that is done.
    if (suggested === "student" && !profile?.cornell_netid) return;
    setInviteFor(suggested);
  }, [
    rolesReady,
    user,
    active,
    inviteFor,
    seen,
    suggested,
    location.pathname,
    profile?.cornell_netid,
  ]);

  const ActiveTour = active ? TOURS[active] : null;

  return (
    <>
      <AnimatePresence>
        {inviteFor && !active && (
          <TourInvite
            tour={inviteFor}
            onStart={() => {
              const tour = inviteFor;
              setInviteFor(null);
              open(tour);
            }}
            onDismiss={() => {
              const tour = inviteFor;
              setInviteFor(null);
              // Asked and declined counts as seen: nagging on every page load
              // would be worse than never offering it at all.
              finish(tour, "skipped", 0);
            }}
          />
        )}
      </AnimatePresence>

      {ActiveTour && active && (
        // No fallback: the chunk is small and a flash of skeleton behind a
        // modal reads as a glitch. The invite/button click just settles a beat
        // later on a slow connection.
        <Suspense fallback={null}>
          <ActiveTour onDone={(status, lastStep) => finish(active, status, lastStep)} />
        </Suspense>
      )}
    </>
  );
}
