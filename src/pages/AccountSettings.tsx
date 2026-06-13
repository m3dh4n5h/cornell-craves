import { useEffect, useState, type FormEvent } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Check, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useClub } from "@/hooks/useClub";
import { useProfile } from "@/hooks/useProfile";
import { BRANDS } from "@/lib/brands";
import { DIETARY_TAGS, DIETARY_TAG_IDS } from "@/lib/dietary";
import { isValidNetid } from "@/lib/orders";
import { GoogleButton } from "@/components/GoogleButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { DietaryTagId } from "@/types/database";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AccountSettings() {
  const navigate = useNavigate();
  const { user, loading: authLoading, signOut } = useAuth();
  const { club, loading: clubLoading } = useClub();
  const { profile, loading: profileLoading, refetch } = useProfile();

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [netid, setNetid] = useState("");
  const [cornellEmail, setCornellEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [venmo, setVenmo] = useState("");
  const [zelle, setZelle] = useState("");
  const [brands, setBrands] = useState<string[]>([]);
  const [dietary, setDietary] = useState<DietaryTagId[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!profile || hydrated) return;
    setFirstName(profile.first_name);
    setLastName(profile.last_name);
    setNetid(profile.cornell_netid ?? "");
    setCornellEmail(profile.cornell_email ?? "");
    setPhone(profile.phone ?? "");
    setVenmo(profile.venmo_id ?? "");
    setZelle(profile.zelle_id ?? "");
    setBrands(profile.preferences_json?.brands ?? []);
    setDietary(profile.preferences_json?.dietary ?? []);
    setHydrated(true);
  }, [profile, hydrated]);

  if (!authLoading && !user) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16">
        <div className="rounded-2xl border border-border bg-surface-raised p-8 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/20">
            <UserRound className="size-6 text-primary-dark" aria-hidden="true" />
          </div>
          <h1 className="mt-5 text-2xl font-extrabold">Your account</h1>
          <p className="mt-3 text-sm text-ink-muted">
            Sign in with Google to save your details, track orders, and get your QR pickup
            passes in one place.
          </p>
          <div className="mt-6">
            <GoogleButton />
          </div>
          <p className="mt-4 text-sm text-ink-muted">
            Run a club?{" "}
            <button
              type="button"
              className="font-semibold text-primary-dark underline-offset-2 hover-fine:underline"
              onClick={() => navigate("/login")}
            >
              Club login
            </button>
          </p>
        </div>
      </div>
    );
  }

  if (!clubLoading && club) return <Navigate to="/dashboard" replace />;

  if (authLoading || profileLoading || !hydrated) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-10" aria-busy="true" aria-label="Loading account">
        <div className="h-9 w-44 animate-pulse rounded-xl bg-border/70" />
        <div className="mt-6 space-y-4">
          {Array.from({ length: 5 }, (_, index) => (
            <div key={index} className="h-16 animate-pulse rounded-2xl bg-border/40" />
          ))}
        </div>
      </div>
    );
  }

  const errors = {
    firstName: firstName.trim() ? undefined : "Enter your first name.",
    netid: !netid.trim() || isValidNetid(netid) ? undefined : "That does not look like a NetID.",
    email:
      !cornellEmail.trim() || EMAIL_PATTERN.test(cornellEmail.trim())
        ? undefined
        : "Enter a valid email address.",
  };
  const hasErrors = Object.values(errors).some(Boolean);

  const toggleBrand = (brand: string) => {
    setBrands((previous) =>
      previous.includes(brand) ? previous.filter((entry) => entry !== brand) : [...previous, brand],
    );
  };

  const toggleDietary = (tag: DietaryTagId) => {
    setDietary((previous) =>
      previous.includes(tag) ? previous.filter((entry) => entry !== tag) : [...previous, tag],
    );
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!user) return;
    setShowErrors(true);
    if (hasErrors) return;
    setSubmitting(true);

    const email = (cornellEmail.trim() || user.email || "").toLowerCase();
    const { error } = await supabase.from("users_extended").upsert({
      id: user.id,
      first_name: firstName.trim(),
      last_name: lastName.trim(),
      cornell_netid: netid.trim().toLowerCase() || null,
      cornell_email: email || null,
      phone: phone.trim() || null,
      venmo_id: venmo.trim().replace(/^@/, "") || null,
      zelle_id: zelle.trim() || null,
      preferences_json: { brands, dietary },
    });

    const { error: cravingError } =
      email && brands.length > 0
        ? await supabase.from("cravings").upsert({ email, brands }, { onConflict: "email" })
        : { error: null };

    setSubmitting(false);
    if (error || cravingError) {
      toast.error((error ?? cravingError)!.message);
      return;
    }
    toast.success("Account updated");
    await refetch();
  };

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-extrabold tracking-tight">Account</h1>
        <Button
          variant="ghost"
          size="sm"
          onClick={async () => {
            await signOut();
            toast.success("Signed out");
            navigate("/");
          }}
        >
          Sign out
        </Button>
      </div>
      <p className="mt-1 text-sm text-ink-muted">{user?.email}</p>

      <form onSubmit={save} noValidate className="mt-8 space-y-5">
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <Label htmlFor="settings-first">First name</Label>
            <Input
              id="settings-first"
              value={firstName}
              invalid={showErrors && Boolean(errors.firstName)}
              onChange={(e) => setFirstName(e.target.value)}
              autoComplete="given-name"
            />
            {showErrors && errors.firstName && (
              <p className="mt-1.5 text-xs font-medium text-accent" role="alert">
                {errors.firstName}
              </p>
            )}
          </div>
          <div>
            <Label htmlFor="settings-last">Last name</Label>
            <Input
              id="settings-last"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
              autoComplete="family-name"
            />
          </div>
        </div>

        <div>
          <Label htmlFor="settings-netid">NetID</Label>
          <Input
            id="settings-netid"
            value={netid}
            invalid={showErrors && Boolean(errors.netid)}
            onChange={(e) => setNetid(e.target.value)}
            placeholder="abc123"
          />
          {showErrors && errors.netid && (
            <p className="mt-1.5 text-xs font-medium text-accent" role="alert">
              {errors.netid}
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="settings-email">Cornell email</Label>
          <Input
            id="settings-email"
            type="email"
            value={cornellEmail}
            invalid={showErrors && Boolean(errors.email)}
            onChange={(e) => setCornellEmail(e.target.value)}
            placeholder="netid@cornell.edu"
            autoComplete="email"
          />
          <p className="mt-1.5 text-xs text-ink-muted">
            Used for craving alerts, order updates, and QR pickup passes.
          </p>
          {showErrors && errors.email && (
            <p className="mt-1.5 text-xs font-medium text-accent" role="alert">
              {errors.email}
            </p>
          )}
        </div>

        <div>
          <Label htmlFor="settings-phone">Phone (optional)</Label>
          <Input
            id="settings-phone"
            type="tel"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            autoComplete="tel"
          />
        </div>

        <fieldset className="rounded-2xl border border-border p-4">
          <legend className="px-1 text-sm font-bold">Saved payment details</legend>
          <p className="text-xs text-ink-muted">
            Pre-fill order forms. Clubs use these to match your payment, money never moves
            through Cornell Craves.
          </p>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="settings-venmo">Venmo username</Label>
              <Input
                id="settings-venmo"
                value={venmo}
                onChange={(e) => setVenmo(e.target.value)}
                placeholder="@your-venmo"
              />
            </div>
            <div>
              <Label htmlFor="settings-zelle">Zelle email or phone</Label>
              <Input
                id="settings-zelle"
                value={zelle}
                onChange={(e) => setZelle(e.target.value)}
                placeholder="netid@cornell.edu"
              />
            </div>
          </div>
        </fieldset>

        <div>
          <Label>Craved brands</Label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Brands to watch">
            {BRANDS.map((brand) => {
              const selected = brands.includes(brand);
              return (
                <button
                  key={brand}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleBrand(brand)}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors duration-150 [transition-timing-function:var(--ease-out)] active:scale-[0.97]",
                    selected
                      ? "border-ink bg-ink text-surface-raised"
                      : "border-border bg-surface-raised text-ink hover-fine:border-primary",
                  )}
                >
                  {selected && <Check className="size-3.5" aria-hidden="true" />}
                  {brand}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <Label>Dietary needs</Label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Dietary preferences">
            {DIETARY_TAG_IDS.map((tag) => {
              const meta = DIETARY_TAGS[tag];
              const selected = dietary.includes(tag);
              return (
                <button
                  key={tag}
                  type="button"
                  aria-pressed={selected}
                  onClick={() => toggleDietary(tag)}
                  className={cn(
                    "inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors duration-150 [transition-timing-function:var(--ease-out)] active:scale-[0.97]",
                    selected
                      ? cn("border-transparent", meta.className)
                      : "border-border bg-surface-raised text-ink-muted hover-fine:border-primary",
                  )}
                >
                  <meta.Icon className="size-4" aria-hidden="true" />
                  {meta.label}
                </button>
              );
            })}
          </div>
        </div>

        <Button type="submit" size="lg" className="w-full" loading={submitting}>
          Save changes
        </Button>
      </form>
    </div>
  );
}
