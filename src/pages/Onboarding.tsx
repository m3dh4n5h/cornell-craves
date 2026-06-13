import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useClub } from "@/hooks/useClub";
import { useProfile } from "@/hooks/useProfile";
import { isValidNetid } from "@/lib/orders";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
  const { user, loading: authLoading } = useAuth();
  const { club, loading: clubLoading } = useClub();
  const { profile, loading: profileLoading } = useProfile();

  const [netid, setNetid] = useState("");
  const [cornellEmail, setCornellEmail] = useState("");
  const [venmo, setVenmo] = useState("");
  const [phone, setPhone] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!profile && !user) return;
    setNetid((previous) => previous || (profile?.cornell_netid ?? ""));
    setVenmo((previous) => previous || (profile?.venmo_id ?? ""));
    setPhone((previous) => previous || (profile?.phone ?? ""));
    setCornellEmail((previous) => {
      if (previous) return previous;
      if (profile?.cornell_email) return profile.cornell_email;
      const authEmail = user?.email ?? "";
      return authEmail.toLowerCase().endsWith("@cornell.edu") ? authEmail : "";
    });
  }, [profile, user]);

  if (!authLoading && !user) return <Navigate to="/login" replace />;
  if (!clubLoading && club) return <Navigate to="/dashboard" replace />;

  const errors = {
    netid: isValidNetid(netid) ? undefined : "Enter your NetID, like abc123.",
    email:
      EMAIL_PATTERN.test(cornellEmail.trim()) &&
      cornellEmail.trim().toLowerCase().endsWith("@cornell.edu")
        ? undefined
        : "Enter your @cornell.edu email.",
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
      cornell_email: cornellEmail.trim().toLowerCase(),
      venmo_id: venmo.trim().replace(/^@/, "") || null,
      phone: phone.trim() || null,
    });
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
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
          <Label htmlFor="onboarding-email">Cornell email</Label>
          <Input
            id="onboarding-email"
            type="email"
            value={cornellEmail}
            invalid={showErrors && Boolean(errors.email)}
            onChange={(e) => setCornellEmail(e.target.value)}
            placeholder="netid@cornell.edu"
            autoComplete="email"
          />
          <FieldError message={showErrors ? errors.email : undefined} />
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
