import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { CheckCircle2, Store } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useClub } from "@/hooks/useClub";
import { useProfile } from "@/hooks/useProfile";
import { googleFullName } from "@/lib/identity";
import { GoogleButton } from "@/components/GoogleButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return (
    <p className="mt-1.5 text-xs font-medium text-accent" role="alert">
      {message}
    </p>
  );
}

/**
 * Club onboarding. Clubs sign in with Google like everyone else, then fill
 * this in once; an admin approves the club before it can post.
 */
export default function Register() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const { user, loading: authLoading, signOut } = useAuth();
  const { club, loading: clubLoading, refetch } = useClub();
  const { profile, loading: profileLoading } = useProfile();

  const [name, setName] = useState("");
  const [venmo, setVenmo] = useState("");
  const [zelle, setZelle] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // First sign-up confirms the account type (build spec 5 #4). Persist the
  // choice per user so a remount can't re-show it and trap the user in a loop.
  const confirmKey = user ? `craves:type-confirmed:${user.id}` : "";
  const [confirmedClub, setConfirmedClub] = useState(false);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    try {
      if (confirmKey && sessionStorage.getItem(confirmKey)) setConfirmedClub(true);
    } catch {
      /* storage unavailable */
    }
  }, [confirmKey]);

  const confirmClub = () => {
    setConfirmedClub(true);
    try {
      if (confirmKey) sessionStorage.setItem(confirmKey, "1");
    } catch {
      /* storage unavailable */
    }
  };

  // Prefill the club name from the Google profile (build spec 5 #3).
  useEffect(() => {
    const fromGoogle = googleFullName(user);
    if (fromGoogle) setName((previous) => previous || fromGoogle);
  }, [user]);

  // An established student (completed onboarding) cannot also become a club.
  const isEstablishedStudent = Boolean(profile?.cornell_netid);

  const switchToStudent = async () => {
    setSwitching(true);
    const { error } = await supabase.functions.invoke("notify-cravings", {
      body: { action: "delete_account" },
    });
    if (error) {
      setSwitching(false);
      toast.error(error.message);
      return;
    }
    await signOut();
    toast.success("Account removed. Sign in again and choose Student.");
    navigate("/login?intent=student");
  };

  if (!authLoading && user && !clubLoading && club && !submitted) {
    return <Navigate to="/dashboard" replace />;
  }

  // Step 1: Google sign-in.
  if (!authLoading && !user) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16">
        <div className="rounded-2xl border border-border bg-surface-raised p-8 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/20">
            <Store className="size-6 text-primary-dark" aria-hidden="true" />
          </div>
          <h1 className="mt-5 text-2xl font-extrabold">Register your club</h1>
          <p className="mt-3 text-sm text-ink-muted">
            Sign in with the Google account your club checks. You will set up the club
            details right after.
          </p>
          <div className="mt-6">
            <GoogleButton label="Continue with Google" redirectPath="/register" />
          </div>
        </div>
      </div>
    );
  }

  if (authLoading || clubLoading || profileLoading) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-10" aria-busy="true" aria-label="Loading">
        <div className="h-9 w-56 animate-pulse rounded-xl bg-border/70" />
        <div className="mt-6 space-y-4">
          {Array.from({ length: 3 }, (_, index) => (
            <div key={index} className="h-16 animate-pulse rounded-2xl bg-border/40" />
          ))}
        </div>
      </div>
    );
  }

  const errors = {
    name: name.trim().length >= 2 ? undefined : "Enter your club's name.",
    venmo: venmo.trim().length >= 2 ? undefined : "Enter the Venmo handle buyers will pay.",
  };
  const hasErrors = Object.values(errors).some(Boolean);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;
    setShowErrors(true);
    if (hasErrors) return;

    setSubmitting(true);
    const { error } = await supabase.from("clubs").insert({
      id: user.id,
      name: name.trim(),
      email: user.email ?? "",
      venmo: venmo.trim().replace(/^@/, ""),
      zelle_phone: zelle.trim() || null,
    });
    setSubmitting(false);

    if (error) {
      toast.error(error.message);
      return;
    }
    setSubmitted(true);
    await refetch();
  };

  // Step 3: done, waiting on approval.
  if (submitted) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16">
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-2xl border border-border bg-surface-raised p-8 text-center"
        >
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-tag-green">
            <CheckCircle2 className="size-7 text-ink" aria-hidden="true" />
          </div>
          <h1 className="mt-5 text-2xl font-extrabold">Club registered</h1>
          <p className="mt-3 text-sm text-ink-muted">
            An admin reviews every new club. You will get a welcome email at {user?.email}{" "}
            the moment you are approved, then you can post drops.
          </p>
          <Button className="mt-6 w-full" onClick={() => navigate("/dashboard")}>
            Go to my dashboard
          </Button>
        </motion.div>
      </div>
    );
  }

  // An existing student account cannot register as a club (build spec 5 #4).
  if (isEstablishedStudent) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16">
        <div className="rounded-2xl border border-border bg-surface-raised p-6 text-center">
          <h1 className="text-2xl font-extrabold tracking-tight">You have a student account</h1>
          <p className="mt-3 text-sm text-ink-muted">
            {user?.email} is registered as a student. One account is one type — delete your student
            account in settings first, then register as a club.
          </p>
          <Button className="mt-6 w-full" onClick={() => navigate("/account/settings")}>
            Open account settings
          </Button>
          <Button variant="ghost" className="mt-2 w-full" onClick={() => navigate("/")}>
            Back to the feed
          </Button>
        </div>
      </div>
    );
  }

  // First sign-up: confirm this is a club account before anything is saved.
  if (!confirmedClub) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16">
        <div className="rounded-2xl border border-border bg-surface-raised p-6 text-center">
          <h1 className="text-2xl font-extrabold tracking-tight">Set up a club account?</h1>
          <p className="mt-3 text-sm text-ink-muted">
            You're signed in as <span className="font-semibold">{user?.email}</span>. Club accounts
            run fundraisers, verify payments, and scan pickups.
          </p>
          <Button className="mt-6 w-full" size="lg" onClick={confirmClub}>
            Yes, I'm a club
          </Button>
          <Button
            variant="ghost"
            className="mt-2 w-full"
            loading={switching}
            onClick={() => void switchToStudent()}
          >
            No, I'm a student
          </Button>
        </div>
      </div>
    );
  }

  // Step 2: club details.
  return (
    <div className="mx-auto w-full max-w-md px-4 py-10">
      <h1 className="text-2xl font-extrabold tracking-tight">Set up your club</h1>
      <p className="mt-2 text-sm text-ink-muted">
        Signed in as {user?.email}. One short form and you are in the approval queue.
      </p>

      <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-5">
        <div>
          <Label htmlFor="club-name">Club name</Label>
          <Input
            id="club-name"
            value={name}
            invalid={showErrors && Boolean(errors.name)}
            onChange={(e) => setName(e.target.value)}
            placeholder="Cornell Robotics Club"
            autoComplete="organization"
          />
          <FieldError message={showErrors ? errors.name : undefined} />
        </div>

        <div>
          <Label htmlFor="venmo">Venmo handle</Label>
          <Input
            id="venmo"
            value={venmo}
            invalid={showErrors && Boolean(errors.venmo)}
            onChange={(e) => setVenmo(e.target.value)}
            placeholder="@cornell-robotics"
          />
          <p className="mt-1.5 text-xs text-ink-muted">
            Where buyers send money. Payments go straight to you, never through Cornell
            Craves.
          </p>
          <FieldError message={showErrors ? errors.venmo : undefined} />
        </div>

        <div>
          <Label htmlFor="zelle">Zelle phone (optional)</Label>
          <Input
            id="zelle"
            type="tel"
            value={zelle}
            onChange={(e) => setZelle(e.target.value)}
            placeholder="phone number"
            autoComplete="tel"
          />
        </div>

        <Button type="submit" className="w-full" size="lg" loading={submitting}>
          Register club
        </Button>
      </form>
    </div>
  );
}
