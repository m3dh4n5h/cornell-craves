import { useEffect } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ShieldCheck } from "lucide-react";
import { SPLIT_RULES, CLUB_SPLIT_RULES, SPLIT_RULES_VERSION } from "@/lib/groups";
import { Button } from "@/components/ui/button";

interface SplitRulesDialogProps {
  open: boolean;
  /** "student" shows the ordering rules; "club" shows the club feature rules. */
  audience: "student" | "club";
  /** Verb shown on the confirm button, e.g. "Start split", "Join split", "Turn on splitting". */
  confirmLabel: string;
  busy?: boolean;
  onAccept: (version: string) => void;
  onClose: () => void;
}

/**
 * Acknowledgment pop-up shown every time a student starts/joins a split, and
 * every time a club turns the feature on. The accepted version (SPLIT_RULES_
 * VERSION) is saved server-side, so bumping the version re-prompts everyone.
 * Purely a disclosure gate: it explains the rules and limits liability, and
 * only calls onAccept once the person explicitly agrees.
 */
export function SplitRulesDialog({
  open,
  audience,
  confirmLabel,
  busy = false,
  onAccept,
  onClose,
}: SplitRulesDialogProps) {
  const reduceMotion = useReducedMotion();
  const rules = audience === "club" ? CLUB_SPLIT_RULES : SPLIT_RULES;
  const heading =
    audience === "club" ? "How split orders work" : "Before you split this order";

  // Lock body scroll and allow Escape to dismiss.
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !busy) onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = original;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, busy, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.button
            type="button"
            aria-label="Close"
            className="z-overlay fixed inset-0 bg-ink/45"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: 0.2 } }}
            exit={{ opacity: 0, transition: { duration: 0.15 } }}
            onClick={() => !busy && onClose()}
          />
          <div className="z-modal pointer-events-none fixed inset-0 flex items-end justify-center p-4 sm:items-center">
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label={heading}
              className="pointer-events-auto max-h-[85dvh] w-full max-w-md overflow-y-auto rounded-2xl border border-border bg-surface-raised p-5 shadow-[0_12px_40px_oklch(18%_0.02_260/0.25)]"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.1 } }}
              transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="flex items-center gap-2.5">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-primary/20">
                  <ShieldCheck className="size-5 text-primary-dark" aria-hidden="true" />
                </span>
                <h2 className="text-lg font-bold">{heading}</h2>
              </div>

              <p className="mt-3 text-sm text-ink-muted">
                {audience === "club"
                  ? "Please read and accept how splitting works before turning it on. You'll re-accept if these rules change."
                  : "Please read and accept these rules before continuing. You'll re-accept if the rules change."}
              </p>

              <ol className="mt-3 space-y-2.5">
                {rules.map((rule, index) => (
                  <li key={index} className="flex gap-2.5 text-sm text-ink">
                    <span
                      className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full bg-ink/[0.06] text-[11px] font-bold text-ink-muted"
                      aria-hidden="true"
                    >
                      {index + 1}
                    </span>
                    <span>{rule}</span>
                  </li>
                ))}
              </ol>

              <p className="mt-4 rounded-xl bg-surface px-3 py-2.5 text-xs text-ink-muted">
                By continuing you confirm you have read and agree to these rules and to the{" "}
                <a
                  href="/terms"
                  target="_blank"
                  rel="noreferrer"
                  className="font-semibold text-primary-dark underline-offset-2 hover-fine:underline"
                >
                  Cornell Craves terms
                </a>
                . Cornell Craves does not process payments and is not a party to your order.
              </p>

              <div className="mt-5 flex justify-end gap-2">
                <Button variant="ghost" disabled={busy} onClick={onClose}>
                  Cancel
                </Button>
                <Button loading={busy} onClick={() => onAccept(SPLIT_RULES_VERSION)}>
                  {confirmLabel}
                </Button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
