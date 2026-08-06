import { useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { Compass, Store, UserRound } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useClub } from "@/hooks/useClub";
import { GoogleButton } from "@/components/GoogleButton";
import { cn } from "@/lib/utils";

const PORTALS = [
  { id: "student", label: "Student", Icon: UserRound },
  { id: "club", label: "Club", Icon: Store },
] as const;

type Portal = (typeof PORTALS)[number]["id"];

// Only allow same-origin relative paths as the post-login destination, so a
// crafted ?next= cannot bounce the user to an external site after OAuth.
function safeNext(raw: string | null): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

/**
 * Escape hatch for anyone who is not sure what they are signing into. The About
 * page is public and carries the interactive walkthroughs, so a prospective club
 * can see the whole tool before creating an account.
 */
function AboutLink() {
  return (
    <Link
      to="/about"
      className="mt-4 flex items-center justify-center gap-2 rounded-xl border border-border bg-surface-raised px-4 py-3 text-sm font-bold text-ink transition-colors duration-150 hover-fine:border-primary"
    >
      <Compass className="size-4 text-primary-dark" aria-hidden="true" />
      New here? See how Cornell Craves works
    </Link>
  );
}

export default function Login() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { user, loading: authLoading } = useAuth();
  const { club, loading: clubLoading } = useClub();
  const [portal, setPortal] = useState<Portal>("student");

  // Student-only mode: reached from a student-only surface (/cravings, /orders,
  // /reservations). No club toggle, no mention of clubs.
  const studentOnly = params.get("intent") === "student";
  const next = safeNext(params.get("next"));
  const studentRedirect = next ?? "/";

  if (!authLoading && user && !clubLoading) {
    return <Navigate to={club ? "/dashboard" : (next ?? "/")} replace />;
  }

  if (studentOnly) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-10">
        <h1 className="text-2xl font-extrabold tracking-tight">Sign in to continue</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Order food, split costs with friends, reserve pickups, and get craving alerts. First
          time? You will add your NetID right after.
        </p>
        <div className="mt-6 rounded-2xl border border-border bg-surface-raised p-5">
          <GoogleButton label="Continue with Google as a student" redirectPath={studentRedirect} />
        </div>
        <p className="mt-6 text-center text-xs text-ink-muted">
          The{" "}
          <button
            type="button"
            className="font-semibold text-primary-dark underline-offset-2 hover-fine:underline"
            onClick={() => navigate("/")}
          >
            feed
          </button>{" "}
          and{" "}
          <button
            type="button"
            className="font-semibold text-primary-dark underline-offset-2 hover-fine:underline"
            onClick={() => navigate("/map")}
          >
            map
          </button>{" "}
          are open to everyone.
        </p>
        <AboutLink />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10">
      <h1 className="text-2xl font-extrabold tracking-tight">Sign in</h1>
      <p className="mt-2 text-sm text-ink-muted">
        Everyone signs in with Google. Pick your side of the table.
      </p>

      {/* Portal toggle */}
      <div
        className="mt-6 grid grid-cols-2 gap-1 rounded-2xl border border-border bg-surface-raised p-1"
        role="radiogroup"
        aria-label="Sign in as"
      >
        {PORTALS.map(({ id, label, Icon }) => {
          const selected = portal === id;
          return (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={selected}
              onClick={() => setPortal(id)}
              className={cn(
                "flex min-h-11 items-center justify-center gap-2 rounded-xl text-sm font-bold transition-colors duration-150 [transition-timing-function:var(--ease-out)]",
                selected ? "bg-ink text-surface-raised" : "text-ink-muted hover-fine:text-ink",
              )}
            >
              <Icon className="size-4" aria-hidden="true" />
              {label}
            </button>
          );
        })}
      </div>

      {portal === "student" ? (
        <div className="mt-6 rounded-2xl border border-border bg-surface-raised p-5">
          <h2 className="text-base font-bold">Students</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Order food, split costs with friends, reserve pickups, and get your QR passes.
            First time? You will add your NetID right after.
          </p>
          <div className="mt-4">
            <GoogleButton redirectPath={studentRedirect} />
          </div>
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-border bg-surface-raised p-5">
          <h2 className="text-base font-bold">Clubs</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Run fundraisers, verify payments, and scan pickups. New club? The same button
            walks you through setting it up; an admin approves you before you can post.
          </p>
          <div className="mt-4">
            <GoogleButton label="Continue with Google" redirectPath="/register" />
          </div>
          <p className="mt-3 text-xs text-ink-muted">
            Use the Google account your club checks; approval and order emails land there.
          </p>
        </div>
      )}

      <p className="mt-6 text-center text-xs text-ink-muted">
        Just browsing? The{" "}
        <button
          type="button"
          className="font-semibold text-primary-dark underline-offset-2 hover-fine:underline"
          onClick={() => navigate("/")}
        >
          feed
        </button>{" "}
        and{" "}
        <button
          type="button"
          className="font-semibold text-primary-dark underline-offset-2 hover-fine:underline"
          onClick={() => navigate("/map")}
        >
          map
        </button>{" "}
        are open to everyone.
      </p>
      <AboutLink />
    </div>
  );
}
