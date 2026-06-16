import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useClub } from "@/hooks/useClub";
import { useProfile } from "@/hooks/useProfile";
import { isValidNetid } from "@/lib/orders";
import { isCornellEmail } from "@/lib/identity";
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

export default function Onboarding() {
  const navigate = useNavigate();
  const { user, loading: authLoading, signOut } = useAuth();
  const { club, loading: clubLoading } = useClub();
  const { profile, loading: profileLoading, refetch } = useProfile();

  const [netid, setNetid] = useState("");
  const [venmo, setVenmo] = useState("");
  const [phone, setPhone] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  // First sign-up confirms the account type (build spec 5 #4). Persist the
  // choice per user so a remount or a brief profile lag can't re-show it (which
  // caused an endless confirm -> form -> confirm loop).
  const confirmKey = user ? `craves:type-confirmed:${user.id}` : "";
  const [confirmedStudent, setConfirmedStudent] = useState(false);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    try {
      if (confirmKey && sessionStorage.getItem(confirmKey)) setConfirmedStudent(true);
    } catch {
      /* storage unavailable */
    }
  }, [confirmKey]);

  const confirmStudent = () => {
    setConfirmedStudent(true);
    try {
      if (confirmKey) sessionStorage.setItem(confirmKey, "1");
    } catch {
      /* storage unavailable */
    }
  };

  // The student's email is their Cornell Google account, never editable (#2).
  const accountEmail = (user?.email ?? "").toLowerCase();
  const firstTime = !profile?.cornell_netid;

  useEffect(() => {
    if (!profile && !user) return;
    setNetid((previous) => previous || (profile?.cornell_netid ?? ""));
    setVenmo((previous) => previous || (profile?.venmo_id ?? ""));
    setPhone((previous) => previous || (profile?.phone ?? ""));
  }, [profile, user]);

  if (!authLoading && !user) return <Navigate to="/login" replace />;
  if (!clubLoading && club) return <Navigate to="/dashboard" replace />;

  // "No, I'm a club": delete the just-created account so nothing stale is left,
  // sign out, and send them back to choose again (build spec 5 #4).
  const switchToClub = async () => {
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
    toast.success("Account removed. Sign in again and choose Club.");
    navigate("/login");
  };

  const errors = {
    netid: isValidNetid(netid) ? undefined : "Enter your NetID, like abc123.",
  };
  const hasErrors = Object.values(errors).some(Boolean);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;
    setShowErrors(true);
    if (hasErrors) return;
    setSubmitting(true);
    const { error } = await supabase.from("users_extended").upsert({
      id: user.id,
      first_name: profile?.first_name ?? "",
      last_name: profile?.last_name ?? "",
      cornell_netid: netid.trim().toLowerCase(),
      cornell_email: accountEmail,
      venmo_id: venmo.trim().replace(/^@/, "") || null,
      phone: phone.trim() || null,
    });
    if (error) {
      setSubmitting(false);
      toast.error(error.message);
      return;
    }
    // Refresh the profile context BEFORE leaving so the onboarding gate sees the
    // new NetID and doesn't bounce the user back into this flow (endless loop).
    await refetch();
    setSubmitting(false);
    navigate("/preferences");
  };

  if (authLoading || profileLoading) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-10" aria-busy="true" aria-label="Loading">
        <div className="h-9 w-48 animate-pulse rounded-xl bg-border/70" />
        <div className="mt-6 space-y-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-16 animate-pulse rounded-2xl bg-border/40" />
          ))}
        </div>
      </div>
    );
  }

  const firstName = profile?.first_name || "there";

  // First sign-up: confirm this is a student account before anything is saved.
  if (firstTime && !confirmedStudent) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16">
        <div className="rounded-2xl border border-border bg-surface-raised p-6 text-center">
          <h1 className="text-2xl font-extrabold tracking-tight">Set up a student account?</h1>
          <p className="mt-3 text-sm text-ink-muted">
            You're signed in as <span className="font-semibold">{accountEmail}</span>. Student
            accounts order food, split costs, and reserve pickups.
          </p>
          <Button className="mt-6 w-full" size="lg" onClick={confirmStudent}>
            Yes, I'm a student
          </Button>
          <Button
            variant="ghost"
            className="mt-2 w-full"
            loading={switching}
            onClick={() => void switchToClub()}
          >
            No, I'm a club
          </Button>
        </div>
      </div>
    );
  }

  // Students must use a Cornell Google account (build spec 5 #1).
  if (!isCornellEmail(accountEmail)) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16">
        <div className="rounded-2xl border border-border bg-surface-raised p-6 text-center">
          <h1 className="text-2xl font-extrabold tracking-tight">Cornell account needed</h1>
          <p className="mt-3 text-sm text-ink-muted">
            Students must sign in with a Cornell <span className="font-semibold">@cornell.edu</span>{" "}
            Google account. You're signed in as {accountEmail}.
          </p>
          <Button variant="secondary" className="mt-6 w-full" onClick={() => void signOut()}>
            Sign out and use my Cornell account
          </Button>
          <Button variant="ghost" className="mt-2 w-full" loading={switching} onClick={() => void switchToClub()}>
            Actually, I'm a club
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10">
      <h1 className="text-2xl font-extrabold tracking-tight">Almost in, {firstName}</h1>
      <p className="mt-2 text-sm text-ink-muted">
        A couple of Cornell details so clubs can match your orders and email your pickup
        passes. Editable anytime in account settings.
      </p>

      <form onSubmit={submit} noValidate className="mt-8 space-y-5">
        <div>
          <Label htmlFor="onboarding-netid">NetID</Label>
          <Input
            id="onboarding-netid"
            value={netid}
            invalid={showErrors && Boolean(errors.netid)}
            onChange={(e) => setNetid(e.target.value)}
            placeholder="abc123"
            autoComplete="username"
          />
          <FieldError message={showErrors ? errors.netid : undefined} />
        </div>
        <div>
          <Label>Cornell email</Label>
          <p className="mt-1 rounded-xl bg-surface px-3 py-2.5 font-medium text-ink">{accountEmail}</p>
          <p className="mt-1.5 text-xs text-ink-muted">
            This is your Google account email and can't be changed.
          </p>
        </div>
        <div>
          <Label htmlFor="onboarding-venmo">Venmo username (optional)</Label>
          <Input
            id="onboarding-venmo"
            value={venmo}
            onChange={(e) => setVenmo(e.target.value)}
            placeholder="@your-venmo"
          />
          <p className="mt-1.5 text-xs text-ink-muted">
            Pre-fills order forms so clubs can match your payment fast.
          </p>
        </div>
        <div>
          <Label htmlFor="onboarding-phone">Phone (optional)</Label>
          <Input
            id="onboarding-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="(607) 555-0100"
            autoComplete="tel"
          />
        </div>
        <Button type="submit" size="lg" className="w-full" loading={submitting}>
          Continue
        </Button>
      </form>
    </div>
  );
}
