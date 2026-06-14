import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ImagePlus, UserRound } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useClub } from "@/hooks/useClub";
import { useProfile } from "@/hooks/useProfile";
import { useBrandOptions } from "@/hooks/useBrands";
import { DIETARY_TAGS, DIETARY_TAG_IDS } from "@/lib/dietary";
import { isValidNetid } from "@/lib/orders";
import { GoogleButton } from "@/components/GoogleButton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { Club, DietaryTagId } from "@/types/database";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function AccountSettings() {
  const navigate = useNavigate();
  const { user, loading: authLoading, signOut } = useAuth();
  const { club, loading: clubLoading } = useClub();
  const { profile, loading: profileLoading, refetch } = useProfile();
  const brandOptions = useBrandOptions();

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
  const [unsubscribing, setUnsubscribing] = useState(false);
  const [deleting, setDeleting] = useState(false);

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

  // The cravings table is authoritative for brands; reconcile so this tab and
  // the Cravings page never drift, even for picks saved before they synced (#18).
  useEffect(() => {
    if (!hydrated) return;
    let cancelled = false;
    void supabase.rpc("get_my_craving").then(({ data }) => {
      if (!cancelled && Array.isArray(data) && data.length > 0) setBrands(data);
    });
    return () => {
      cancelled = true;
    };
  }, [hydrated]);

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

  if (!clubLoading && club) return <ClubAccount club={club} />;

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
      brands.length > 0
        ? await supabase.rpc("upsert_my_craving", { p_brands: brands })
        : { error: null };

    setSubmitting(false);
    if (error || cravingError) {
      toast.error((error ?? cravingError)!.message);
      return;
    }
    toast.success("Account updated");
    await refetch();
  };

  const unsubscribeCravings = async () => {
    setUnsubscribing(true);
    const { error } = await supabase.rpc("delete_my_craving");
    setUnsubscribing(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setBrands([]);
    toast.success("You're off the craving mailing list. No more drop emails.");
  };

  const deleteAccount = async () => {
    const ok = window.confirm(
      "Delete your account? This removes your profile, orders, pickups, and craving alerts, and stops every notification. This cannot be undone.",
    );
    if (!ok) return;
    setDeleting(true);
    const { data, error } = await supabase.functions.invoke("notify-cravings", {
      body: { action: "delete_account" },
    });
    if (error || (data && data.ok === false)) {
      setDeleting(false);
      toast.error(error?.message ?? data?.error ?? "Could not delete account");
      return;
    }
    await signOut();
    toast.success("Account deleted");
    navigate("/");
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
            {brandOptions.map((brand) => {
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

      <div className="mt-8 rounded-2xl border border-border bg-surface-raised p-4">
        <p className="text-sm font-bold text-ink">Craving alerts</p>
        <p className="mt-1 text-sm text-ink-muted">
          Stop all craving emails and remove yourself from the mailing list. You can re-add
          brands anytime above.
        </p>
        <Button
          variant="secondary"
          className="mt-3 w-full"
          loading={unsubscribing}
          onClick={unsubscribeCravings}
        >
          Unsubscribe from craving alerts
        </Button>
      </div>

      <div className="mt-4 rounded-2xl border border-accent/40 p-4">
        <p className="text-sm font-bold text-ink">Delete account</p>
        <p className="mt-1 text-sm text-ink-muted">
          Permanently removes your profile, orders, pickups, and craving alerts, and stops
          every notification. You can always sign up again later.
        </p>
        <Button variant="secondary" className="mt-3 w-full" loading={deleting} onClick={deleteAccount}>
          Delete my account
        </Button>
      </div>
    </div>
  );
}

/** Account page for club owners: payout handles, change disclaimer, deletion. */
function ClubAccount({ club }: { club: Club }) {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const { refetch: refetchClub } = useClub();
  const [venmo, setVenmo] = useState(club.venmo ?? "");
  const [zelle, setZelle] = useState(club.zelle_phone ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [needsConsent, setNeedsConsent] = useState(false);
  const [consent, setConsent] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [togglingGroups, setTogglingGroups] = useState(false);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const logoInputRef = useRef<HTMLInputElement>(null);

  // Upload a logo to the club-logos bucket and store its public URL (#14).
  const uploadLogo = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      toast.error("Pick an image file (PNG, JPG, or SVG).");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Logo must be under 2 MB.");
      return;
    }
    setUploadingLogo(true);
    const ext = file.name.split(".").pop()?.toLowerCase() || "png";
    // A fresh filename each time so the public URL changes and never serves a stale logo.
    const path = `${club.id}/logo-${Date.now()}.${ext}`;
    const { error: uploadError } = await supabase.storage
      .from("club-logos")
      .upload(path, file, { cacheControl: "3600", upsert: true });
    if (uploadError) {
      setUploadingLogo(false);
      toast.error(uploadError.message);
      return;
    }
    const { data: pub } = supabase.storage.from("club-logos").getPublicUrl(path);
    const { error } = await supabase.from("clubs").update({ logo_url: pub.publicUrl }).eq("id", club.id);
    setUploadingLogo(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await refetchClub();
    toast.success("Logo updated. It now shows on your drops.");
  };

  const removeLogo = async () => {
    setUploadingLogo(true);
    const { error } = await supabase.from("clubs").update({ logo_url: null }).eq("id", club.id);
    setUploadingLogo(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await refetchClub();
    toast.success("Logo removed.");
  };

  const setGroupsEnabled = async (enabled: boolean) => {
    setTogglingGroups(true);
    const { error } = await supabase.from("clubs").update({ groups_enabled: enabled }).eq("id", club.id);
    setTogglingGroups(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    await refetchClub();
    toast.success(enabled ? "Group ordering turned on" : "Group ordering turned off");
  };

  const normalizedVenmo = venmo.trim().replace(/^@/, "");
  const normalizedZelle = zelle.trim();
  const changed =
    normalizedVenmo !== (club.venmo ?? "") || normalizedZelle !== (club.zelle_phone ?? "");

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!changed) {
      toast.success("No changes to save");
      return;
    }

    // If a drop is live, buyers may already hold the old handle. Require the
    // club to accept responsibility for both before anything changes.
    const { count } = await supabase
      .from("listings")
      .select("id", { count: "exact", head: true })
      .eq("club_id", club.id)
      .eq("active", true)
      .gt("expires_at", new Date().toISOString());
    const hasActive = (count ?? 0) > 0;

    if (hasActive && !consent) {
      setNeedsConsent(true);
      return;
    }

    setSubmitting(true);
    const { error } = await supabase
      .from("clubs")
      .update({ venmo: normalizedVenmo || null, zelle_phone: normalizedZelle || null })
      .eq("id", club.id);

    // Stamp live listings so buyers see a reconfirm-your-handle notice.
    const { error: listingError } = hasActive
      ? await supabase
          .from("listings")
          .update({ payment_updated_at: new Date().toISOString() })
          .eq("club_id", club.id)
          .eq("active", true)
      : { error: null };

    setSubmitting(false);
    if (error || listingError) {
      toast.error((error ?? listingError)!.message);
      return;
    }
    setNeedsConsent(false);
    setConsent(false);
    toast.success(
      hasActive
        ? "Payment details updated. Your live drops now show a reconfirm notice."
        : "Club account updated",
    );
  };

  const deleteAccount = async () => {
    const ok = window.confirm(
      "Delete your club account? This permanently removes your club, all its drops, and stops every notification. This cannot be undone.",
    );
    if (!ok) return;
    setDeleting(true);
    const { data, error } = await supabase.functions.invoke("notify-cravings", {
      body: { action: "delete_account" },
    });
    if (error || (data && data.ok === false)) {
      setDeleting(false);
      toast.error(error?.message ?? data?.error ?? "Could not delete account");
      return;
    }
    await signOut();
    toast.success("Account deleted");
    navigate("/");
  };

  const handleSignOut = async () => {
    await signOut();
    toast.success("Signed out");
    navigate("/");
  };

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10">
      <h1 className="text-2xl font-extrabold tracking-tight">Club account</h1>
      <p className="mt-2 text-sm text-ink-muted">
        Manage how buyers pay you. Post drops and review orders from your{" "}
        <button
          type="button"
          className="font-semibold text-primary-dark underline-offset-2 hover-fine:underline"
          onClick={() => navigate("/dashboard")}
        >
          Dashboard
        </button>
        .
      </p>

      <div className="mt-6 rounded-2xl border border-border bg-surface-raised p-4">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-muted">Club</p>
        <p className="mt-1 text-lg font-bold">{club.name}</p>
        <p className="text-sm text-ink-muted">{club.email}</p>
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-surface-raised p-4">
        <p className="text-sm font-bold">Logo</p>
        <p className="mt-0.5 text-xs text-ink-muted">
          Shows on your feed cards and drop pages. Square images look best, under 2 MB.
        </p>
        <div className="mt-3 flex items-center gap-4">
          {club.logo_url ? (
            <img
              src={club.logo_url}
              alt={`${club.name} logo`}
              className="size-16 shrink-0 rounded-2xl border border-border object-cover"
            />
          ) : (
            <span className="flex size-16 shrink-0 items-center justify-center rounded-2xl border border-dashed border-border text-ink-muted">
              <ImagePlus className="size-6" aria-hidden="true" />
            </span>
          )}
          <div className="flex flex-wrap gap-2">
            <input
              ref={logoInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void uploadLogo(file);
                e.target.value = "";
              }}
            />
            <Button
              type="button"
              variant="secondary"
              size="sm"
              loading={uploadingLogo}
              onClick={() => logoInputRef.current?.click()}
            >
              {club.logo_url ? "Replace logo" : "Upload logo"}
            </Button>
            {club.logo_url && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={uploadingLogo}
                onClick={() => void removeLogo()}
              >
                Remove
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-2xl border border-border bg-surface-raised p-4">
        <label className="flex min-h-11 cursor-pointer items-center justify-between gap-3">
          <span>
            <span className="block text-sm font-bold">Group ordering &amp; splitting</span>
            <span className="block text-xs text-ink-muted">
              Let students split an item with friends. Turn off to only accept solo orders.
            </span>
          </span>
          <input
            type="checkbox"
            checked={club.groups_enabled}
            disabled={togglingGroups}
            onChange={(e) => void setGroupsEnabled(e.target.checked)}
            className="size-5 shrink-0 accent-(--color-primary-dark)"
            aria-label="Enable group ordering and splitting"
          />
        </label>
      </div>

      <form onSubmit={save} className="mt-6 space-y-4">
        <div>
          <Label htmlFor="club-venmo">Venmo handle</Label>
          <Input
            id="club-venmo"
            value={venmo}
            onChange={(e) => {
              setVenmo(e.target.value);
              setNeedsConsent(false);
              setConsent(false);
            }}
            placeholder="club-venmo"
          />
        </div>
        <div>
          <Label htmlFor="club-zelle">Zelle (phone or email)</Label>
          <Input
            id="club-zelle"
            value={zelle}
            onChange={(e) => {
              setZelle(e.target.value);
              setNeedsConsent(false);
              setConsent(false);
            }}
            placeholder="Optional"
          />
        </div>

        {needsConsent && (
          <div className="rounded-2xl border border-accent/40 bg-accent/10 p-4">
            <p className="text-sm font-semibold text-ink">You have a live drop right now.</p>
            <p className="mt-1 text-sm text-ink-muted">
              Buyers may already have your previous handle. You (not Cornell Craves) are
              solely responsible for any funds sent to either the old or the new Venmo/Zelle,
              and for reconciling payments across both. Cornell Craves only displays the
              details you provide and never holds, processes, or transfers money. Your live
              drops will show a notice telling buyers to reconfirm your handle.
            </p>
            <label className="mt-3 flex items-start gap-2 text-sm font-medium text-ink">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
                className="mt-0.5 size-4"
              />
              I understand and accept sole responsibility for funds in both my old and new
              payment accounts.
            </label>
          </div>
        )}

        <Button
          type="submit"
          size="lg"
          className="w-full"
          loading={submitting}
          disabled={needsConsent && !consent}
        >
          Save changes
        </Button>
      </form>

      <Button variant="ghost" className="mt-4 w-full" onClick={handleSignOut}>
        Sign out
      </Button>

      <div className="mt-8 rounded-2xl border border-accent/40 p-4">
        <p className="text-sm font-bold text-ink">Delete account</p>
        <p className="mt-1 text-sm text-ink-muted">
          Permanently removes your club, all its drops, and stops every notification. You can
          always sign up again later.
        </p>
        <Button variant="secondary" className="mt-3 w-full" loading={deleting} onClick={deleteAccount}>
          Delete club account
        </Button>
      </div>
    </div>
  );
}
