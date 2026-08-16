import { useEffect, useId, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ComboboxProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  invalid?: boolean;
  /** One line shown when nothing matches, e.g. how to request a new entry. */
  emptyHint?: string;
  autoComplete?: string;
  "aria-label"?: string;
}

/** Bold the part of an option that matches the query so scanning is instant. */
function MatchedText({ option, query }: { option: string; query: string }) {
  const q = query.trim().toLowerCase();
  const at = q ? option.toLowerCase().indexOf(q) : -1;
  if (at < 0) return <>{option}</>;
  return (
    <>
      {option.slice(0, at)}
      <span className="font-bold">{option.slice(at, at + q.length)}</span>
      {option.slice(at + q.length)}
    </>
  );
}

/**
 * Free-text combobox: type anything, or pick from the filtered list. Replaces
 * native <datalist>, which renders inconsistently across browsers and buries
 * its options. Fully keyboard operable (arrows, Enter, Escape) and announced
 * via the ARIA combobox pattern. Free text is intentional: flows like brand
 * entry accept names that are not in the list yet.
 */
export function Combobox({
  id,
  value,
  onChange,
  options,
  placeholder,
  invalid = false,
  emptyHint,
  autoComplete = "off",
  "aria-label": ariaLabel,
}: ComboboxProps) {
  const reduceMotion = useReducedMotion();
  const listboxId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);

  const query = value.trim().toLowerCase();
  const filtered = useMemo(
    () => (query ? options.filter((option) => option.toLowerCase().includes(query)) : options),
    [options, query],
  );

  // Close when a tap/click lands outside the whole widget.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [open]);

  // Keep the active option in view while arrowing through a long list.
  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current
      ?.querySelector(`[data-index="${active}"]`)
      ?.scrollIntoView({ block: "nearest" });
  }, [open, active]);

  const select = (option: string) => {
    onChange(option);
    setOpen(false);
    setActive(-1);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
        return;
      }
      if (filtered.length === 0) return;
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActive((previous) => (previous + step + filtered.length) % filtered.length);
      return;
    }
    if (event.key === "Enter" && open && active >= 0 && filtered[active]) {
      // Claim Enter only while picking, so a closed combobox still submits forms.
      event.preventDefault();
      select(filtered[active]);
      return;
    }
    if (event.key === "Escape" && open) {
      event.stopPropagation();
      setOpen(false);
      setActive(-1);
      return;
    }
    if (event.key === "Tab") setOpen(false);
  };

  const selectedIndex = filtered.findIndex(
    (option) => option.toLowerCase() === value.trim().toLowerCase(),
  );

  return (
    <div ref={rootRef} className="relative w-full">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listboxId}
        aria-autocomplete="list"
        aria-activedescendant={open && active >= 0 ? `${listboxId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-label={ariaLabel}
        type="text"
        autoComplete={autoComplete}
        value={value}
        placeholder={placeholder}
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setActive(event.target.value.trim() ? 0 : -1);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        className={cn(
          "h-11 w-full truncate rounded-xl border border-border bg-surface-raised pl-3.5 pr-10 text-base text-ink transition-[border-color,box-shadow] duration-150 [transition-timing-function:var(--ease-out)] placeholder:text-ink-muted/70 focus-visible:border-primary-dark focus-visible:outline-2 focus-visible:outline-offset-0 focus-visible:outline-primary/40",
          invalid && "border-accent focus-visible:border-accent focus-visible:outline-accent/30",
        )}
      />
      <button
        type="button"
        tabIndex={-1}
        aria-label={open ? "Close suggestions" : "Show suggestions"}
        onPointerDown={(event) => {
          // Toggle without stealing focus from the input.
          event.preventDefault();
          setOpen((previous) => !previous);
        }}
        className="absolute right-0 top-0 flex h-11 w-10 items-center justify-center text-ink-muted"
      >
        <ChevronDown
          className={cn("size-4 transition-transform duration-150", open && "rotate-180")}
          aria-hidden="true"
        />
      </button>

      {/* Transform-only entrance (never opacity): if animation frames stall on a
          low-power device, the menu is still fully opaque and readable. Closing
          is instant, like native menus. */}
      <AnimatePresence>
        {open && (
          <motion.div
            initial={reduceMotion ? false : { scale: 0.98, y: -4 }}
            animate={{ scale: 1, y: 0 }}
            transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
            className="absolute left-0 right-0 top-full z-modal mt-1.5 origin-top overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-[0_12px_40px_oklch(18%_0.02_260/0.18)]"
          >
            <ul
              ref={listRef}
              id={listboxId}
              role="listbox"
              aria-label="Suggestions"
              className="max-h-64 overflow-y-auto overscroll-contain py-1.5 [touch-action:pan-y]"
            >
              {filtered.map((option, index) => (
                <li
                  key={option}
                  id={`${listboxId}-${index}`}
                  data-index={index}
                  role="option"
                  aria-selected={index === selectedIndex}
                  onPointerDown={(event) => {
                    // Mouse only: select before the input can blur, so focus
                    // never jumps. On touch, pointerdown is also the start of a
                    // scroll gesture - selecting here made the list impossible
                    // to scroll on phones (any touch picked an option and
                    // closed the menu). Touch selection happens in onClick,
                    // which the browser only fires for a real tap, never a
                    // scroll.
                    if (event.pointerType === "mouse") {
                      event.preventDefault();
                      select(option);
                    }
                  }}
                  onClick={() => select(option)}
                  onPointerMove={(event) => {
                    // Hover highlight is a mouse affordance; on touch it would
                    // repaint rows mid-scroll.
                    if (event.pointerType === "mouse") setActive(index);
                  }}
                  className={cn(
                    "flex min-h-11 cursor-pointer items-center justify-between gap-2 px-3.5 py-2 text-sm",
                    index === active && "bg-ink/[0.05]",
                  )}
                >
                  <span className="min-w-0 truncate">
                    <MatchedText option={option} query={value} />
                  </span>
                  {index === selectedIndex && (
                    <Check className="size-4 shrink-0 text-primary-dark" aria-hidden="true" />
                  )}
                </li>
              ))}
              {filtered.length === 0 && (
                <li className="px-3.5 py-3 text-sm text-ink-muted" role="presentation">
                  {emptyHint ?? "No matches."}
                </li>
              )}
            </ul>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
