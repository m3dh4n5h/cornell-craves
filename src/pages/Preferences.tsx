import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Check } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { useClub } from "@/hooks/useClub";
import { useProfile } from "@/hooks/useProfile";
import { BRANDS } from "@/lib/brands";
import { DIETARY_TAGS, DIETARY_TAG_IDS } from "@/lib/dietary";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import type { DietaryTagId } from "@/types/database";

export default function Preferences() {
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const { club, loading: clubLoading } = useClub();
  const { profile, loading: profileLoading } = useProfile();

  const [brands, setBrands] = useState<string[]>([]);
  const [dietary, setDietary] = useState<DietaryTagId[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (profileLoading || hydrated) return;
    setBrands(profile?.preferences_json?.brands ?? []);
    setDietary(profile?.preferences_json?.dietary ?? []);
    setHydrated(true);
  }, [profile, profileLoading, hydrated]);

  if (!authLoading && !user) return <Navigate to="/login" replace />;
  if (!clubLoading && club) return <Navigate to="/dashboard" replace />;

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

  const save = async () => {
    if (!user) return;
    setSubmitting(true);
    const email = (profile?.cornell_email || user.email || "").toLowerCase();

    const { error: profileError } = await supabase
      .from("users_extended")
      .update({ preferences_json: { brands, dietary } })
      .eq("id", user.id);

    // Brand picks double as craving alerts, so drops you care about hit your inbox.
    const { error: cravingError } =
      email && brands.length > 0
        ? await supabase.from("cravings").upsert({ email, brands }, { onConflict: "email" })
        : { error: null };

    setSubmitting(false);
    if (profileError || cravingError) {
      toast.error((profileError ?? cravingError)!.message);
      return;
    }
    toast.success("Preferences saved. We will email you when your brands drop.");
    navigate("/");
  };

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10">
      <h1 className="text-2xl font-extrabold tracking-tight">What do you crave?</h1>
      <p className="mt-2 text-sm text-ink-muted">
        Pick brands to get an email the moment a club starts selling them. Dietary picks
        highlight matching items across the app.
      </p>

      <div className="mt-8">
        <Label>Brands</Label>
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

      <div className="mt-6">
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

      <div className="mt-8 flex items-center gap-3">
        <Button size="lg" className="flex-1" loading={submitting} onClick={() => void save()}>
          Save preferences
        </Button>
        <Button variant="ghost" onClick={() => navigate("/")}>
          Skip
        </Button>
      </div>
    </div>
  );
}
