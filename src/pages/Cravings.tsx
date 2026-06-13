import { useEffect, useState, type FormEvent } from "react";
import { Navigate } from "react-router-dom";
import { motion, useReducedMotion } from "framer-motion";
import { BellRing, Check } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BRANDS } from "@/lib/brands";
import { cn } from "@/lib/utils";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function Cravings() {
  const { user, isGoogleUser, loading: authLoading } = useAuth();
  const reduceMotion = useReducedMotion();
  const [email, setEmail] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [showErrors, setShowErrors] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState<string[] | null>(null);

  // Alerts go to your account email; prefill and lock the field.
  useEffect(() => {
    if (user?.email) setEmail((previous) => previous || user.email!);
  }, [user]);

  // Craving subscriptions require a Google student account.
  if (!authLoading && (!user || !isGoogleUser)) {
    return <Navigate to="/login" replace />;
  }

  const emailError = EMAIL_PATTERN.test(email.trim()) ? undefined : "Enter a valid email address.";
  const brandsError = selected.length > 0 ? undefined : "Pick at least one brand.";

  const toggleBrand = (brand: string) => {
    setSelected((previous) =>
      previous.includes(brand)
        ? previous.filter((entry) => entry !== brand)
        : [...previous, brand],
    );
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setShowErrors(true);
    if (emailError || brandsError) return;

    setSubmitting(true);
    const { error } = await supabase.rpc("upsert_my_craving", { p_brands: selected });
    setSubmitting(false);

    if (error) {
      toast.error(error.message);
      return;
    }
    setSaved(selected);
  };

  if (saved) {
    return (
      <div className="mx-auto w-full max-w-md px-4 py-16">
        <motion.div
          initial={reduceMotion ? false : { opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="rounded-2xl border border-border bg-surface-raised p-8 text-center"
        >
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-primary/20">
            <BellRing className="size-6 text-primary-dark" aria-hidden="true" />
          </div>
          <h1 className="mt-5 text-2xl font-extrabold">You are on the list</h1>
          <p className="mt-3 text-sm text-ink-muted">
            We will email {email.trim().toLowerCase()} the moment a drop matches your picks.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-1.5">
            {saved.map((brand) => (
              <Badge key={brand}>{brand}</Badge>
            ))}
          </div>
          <Button variant="secondary" className="mt-6 w-full" onClick={() => setSaved(null)}>
            Edit my picks
          </Button>
        </motion.div>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-md px-4 py-10">
      <h1 className="text-2xl font-extrabold tracking-tight">Never miss a drop</h1>
      <p className="mt-2 text-sm text-ink-muted">
        Pick the brands you crave. We email you the second a club starts selling them, and
        only then.
      </p>

      <form onSubmit={handleSubmit} noValidate className="mt-8 space-y-6">
        <div>
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            value={email}
            readOnly
            invalid={showErrors && Boolean(emailError)}
            placeholder="netid@cornell.edu"
            autoComplete="email"
          />
          {showErrors && emailError && (
            <p className="mt-1.5 text-xs font-medium text-accent" role="alert">
              {emailError}
            </p>
          )}
        </div>

        <div>
          <Label>Brands</Label>
          <div className="flex flex-wrap gap-2" role="group" aria-label="Brands to watch">
            {BRANDS.map((brand) => {
              const isSelected = selected.includes(brand);
              return (
                <button
                  key={brand}
                  type="button"
                  aria-pressed={isSelected}
                  onClick={() => toggleBrand(brand)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors duration-150 [transition-timing-function:var(--ease-out)] active:scale-[0.97]",
                    isSelected
                      ? "border-ink bg-ink text-surface-raised"
                      : "border-border bg-surface-raised text-ink hover-fine:border-primary hover-fine:bg-primary/10",
                  )}
                >
                  {isSelected && <Check className="size-3.5" aria-hidden="true" />}
                  {brand}
                </button>
              );
            })}
          </div>
          {showErrors && brandsError && (
            <p className="mt-1.5 text-xs font-medium text-accent" role="alert">
              {brandsError}
            </p>
          )}
        </div>

        <Button type="submit" className="w-full" size="lg" loading={submitting}>
          Save my cravings
        </Button>
        <p className="text-center text-xs text-ink-muted">
          One email per matching drop. Resubmit anytime to change your picks.
        </p>
      </form>
    </div>
  );
}
