import { useCallback, useEffect, useRef, useState, type ComponentType, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type TourStep = {
  /** Stable id. Doubles as the React key, so demo state resets between steps. */
  id: string;
  title: string;
  /** One or two sentences under the title. Plain language, no jargon. */
  blurb: ReactNode;
  /** The simulated screen. Self-contained: owns its own state, touches nothing real. */
  Demo?: ComponentType;
};

interface TourShellProps {
  open: boolean;
  /** e.g. "Student walkthrough" - shown as the eyebrow above every step title. */
  label: string;
  steps: TourStep[];
  /** Bailed out early. Receives the step index they were on. */
  onSkip: (lastStep: number) => void;
  /** Reached the end. Receives the final step index. */
  onFinish: (lastStep: number) => void;
}

/**
 * The walkthrough chrome: progress, navigation, and the escape hatch.
 *
 * Two rules drive the design.
 *
 * 1. Skip is available at every single step - in the footer, as the header X,
 *    and on Escape. A tutorial you cannot leave is a trap, and someone who
 *    already knows the app should be able to get out in one tap.
 * 2. Next is never blocked on completing an interaction. The demos invite a tap
 *    but never demand one, so a learner on a slow connection, a screen reader,
 *    or a phone with a cracked digitizer is never stuck.
 */
export function TourShell({ open, label, steps, onSkip, onFinish }: TourShellProps) {
  const reduceMotion = useReducedMotion();
  const [index, setIndex] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const total = steps.length;
  const step = steps[Math.min(index, total - 1)];
  const isLast = index >= total - 1;
  const isFirst = index === 0;

  // Restart from the top each time the tour is opened.
  useEffect(() => {
    if (open) setIndex(0);
  }, [open]);

  const skip = useCallback(() => onSkip(index), [onSkip, index]);

  const next = useCallback(() => {
    if (isLast) {
      onFinish(index);
      return;
    }
    setIndex((current) => Math.min(total - 1, current + 1));
  }, [isLast, onFinish, index, total]);

  const back = useCallback(() => setIndex((current) => Math.max(0, current - 1)), []);

  // Escape leaves the tutorial. Body scroll is locked while it is up so the
  // page behind cannot scroll away under a bottom sheet on iOS.
  useEffect(() => {
    if (!open) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        skip();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = originalOverflow;
      document.removeEventListener("keydown", onKey);
    };
  }, [open, skip]);

  // Move focus into the dialog on open, and keep Tab inside it.
  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;
    panel.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const focusables = panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    panel.addEventListener("keydown", onKeyDown);
    return () => panel.removeEventListener("keydown", onKeyDown);
  }, [open]);

  // Long demos can push the footer off screen; scroll back to the top of the
  // body on every step change so each step starts at its own heading.
  useEffect(() => {
    bodyRef.current?.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
  }, [index, reduceMotion]);

  if (total === 0) return null;

  const Demo = step?.Demo;

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="z-overlay fixed inset-0 bg-ink/50 backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, transition: { duration: reduceMotion ? 0 : 0.2 } }}
            exit={{ opacity: 0, transition: { duration: reduceMotion ? 0 : 0.15 } }}
            onClick={skip}
            aria-hidden="true"
          />
          <div className="z-modal pointer-events-none fixed inset-0 flex items-end justify-center sm:items-center sm:p-4">
            <motion.div
              ref={panelRef}
              tabIndex={-1}
              role="dialog"
              aria-modal="true"
              aria-label={label}
              className="pointer-events-auto flex max-h-[92dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-3xl border border-border bg-surface shadow-[0_-8px_40px_oklch(18%_0.02_260/0.25)] outline-none sm:max-h-[88dvh] sm:rounded-3xl"
              initial={reduceMotion ? { opacity: 0 } : { opacity: 0, y: 28, scale: 0.98 }}
              animate={{
                opacity: 1,
                y: 0,
                scale: 1,
                transition: { duration: reduceMotion ? 0 : 0.28, ease: [0.32, 0.72, 0, 1] },
              }}
              exit={
                reduceMotion
                  ? { opacity: 0, transition: { duration: 0 } }
                  : { opacity: 0, y: 20, transition: { duration: 0.15 } }
              }
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-3 border-b border-border bg-surface-raised px-4 pb-3 pt-4 sm:px-5">
                <div className="min-w-0">
                  <p className="text-xs font-bold uppercase tracking-wide text-primary-dark">
                    {label}
                  </p>
                  <h2 className="mt-0.5 font-display text-lg font-extrabold tracking-tight text-ink">
                    {step?.title}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={skip}
                  aria-label="Close tutorial"
                  className="-mr-1 -mt-1 flex size-9 shrink-0 items-center justify-center rounded-xl text-ink-muted transition-colors duration-150 hover-fine:bg-primary/15 hover-fine:text-ink"
                >
                  <X className="size-5" aria-hidden="true" />
                </button>
              </div>

              {/* Progress */}
              <div className="flex items-center gap-2 border-b border-border bg-surface-raised px-4 pb-3 sm:px-5">
                <div className="flex flex-1 gap-1" aria-hidden="true">
                  {steps.map((s, i) => (
                    <span
                      key={s.id}
                      className={cn(
                        "h-1 flex-1 rounded-full transition-colors duration-200",
                        i < index ? "bg-primary-dark" : i === index ? "bg-primary" : "bg-border",
                      )}
                    />
                  ))}
                </div>
                <span className="shrink-0 text-xs font-bold tabular-nums text-ink-muted">
                  {index + 1}/{total}
                </span>
              </div>

              {/* Body */}
              <div
                ref={bodyRef}
                className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5"
              >
                <p className="text-sm leading-relaxed text-ink-muted">{step?.blurb}</p>
                {Demo && (
                  <div className="mt-4">
                    <Demo key={step.id} />
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between gap-2 border-t border-border bg-surface-raised px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
                <Button variant="ghost" size="sm" onClick={skip}>
                  Skip tutorial
                </Button>
                <div className="flex items-center gap-2">
                  {!isFirst && (
                    <Button variant="secondary" size="sm" onClick={back}>
                      <ArrowLeft className="size-3.5" aria-hidden="true" />
                      Back
                    </Button>
                  )}
                  <Button size="sm" onClick={next}>
                    {isLast ? (
                      <>
                        <Check className="size-3.5" aria-hidden="true" />
                        Finish
                      </>
                    ) : (
                      <>
                        Next
                        <ArrowRight className="size-3.5" aria-hidden="true" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
