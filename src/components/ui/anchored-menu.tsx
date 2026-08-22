import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";

/** Breathing room kept between the panel and the edge of the viewport. */
const VIEWPORT_MARGIN = 8;
/** Gap between the anchor control and the panel. */
const ANCHOR_GAP = 6;
/** Below this much room, flipping to the other side beats squeezing. */
const COMFORTABLE_HEIGHT = 200;
const MIN_HEIGHT = 112;
const MAX_HEIGHT = 320;

export interface AnchoredPosition {
  placement: "top" | "bottom";
  style: CSSProperties;
}

interface AnchorOptions {
  /** Panel is at least as wide as the anchor (fields). Menus pass a width instead. */
  matchWidth?: boolean;
  /** Preferred width when `matchWidth` is false, or a floor when it is true. */
  width?: number;
  /** Which edge lines up with the anchor's matching edge. */
  align?: "start" | "end";
}

const clamp = (value: number, min: number, max: number) =>
  Math.min(Math.max(value, min), Math.max(min, max));

/**
 * Viewport-relative coordinates for a panel anchored to `anchorRef`.
 *
 * The panel is meant to render in a portal with `position: fixed`, which is the
 * only way a dropdown reliably escapes its surroundings: an ancestor with a
 * transform, a filter, or `overflow: hidden` creates a stacking/clipping
 * context, and inside one a `z-index` — however high — cannot paint over the
 * sticky navbar, and the menu gets cut off by the scroll container. Both are
 * exactly what the club forms do (cards inside animated, clipped sections).
 *
 * Coordinates come from `getBoundingClientRect()` and `window.innerHeight`,
 * which live in the same layout-viewport space that `position: fixed` uses, so
 * the panel stays glued to its control through pinch-zoom on phones. It is
 * recomputed on scroll, resize, visual-viewport changes and anchor resizes.
 */
export function useAnchoredPosition(
  anchorRef: RefObject<HTMLElement | null>,
  open: boolean,
  options: AnchorOptions = {},
): AnchoredPosition | null {
  const { matchWidth = false, width: preferredWidth, align = "start" } = options;
  const [position, setPosition] = useState<AnchoredPosition | null>(null);
  // Last geometry we committed, so the per-frame check below only re-renders
  // when the anchor genuinely moved.
  const lastKey = useRef("");

  const measure = useCallback(() => {
    const anchor = anchorRef.current;
    if (!anchor) return;
    const rect = anchor.getBoundingClientRect();
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = window.innerHeight;

    const spaceBelow = viewportHeight - rect.bottom - ANCHOR_GAP - VIEWPORT_MARGIN;
    const spaceAbove = rect.top - ANCHOR_GAP - VIEWPORT_MARGIN;
    // Prefer opening downward, like every native picker, and only flip when
    // down is both cramped and genuinely worse than up.
    const placement: "top" | "bottom" =
      spaceBelow >= COMFORTABLE_HEIGHT || spaceBelow >= spaceAbove ? "bottom" : "top";
    const available = placement === "bottom" ? spaceBelow : spaceAbove;
    const maxHeight = clamp(available, MIN_HEIGHT, MAX_HEIGHT);

    const desired = matchWidth
      ? Math.max(rect.width, preferredWidth ?? 0)
      : (preferredWidth ?? rect.width);
    const width = Math.min(desired, viewportWidth - VIEWPORT_MARGIN * 2);
    const rawLeft = align === "end" ? rect.right - width : rect.left;
    const left = clamp(rawLeft, VIEWPORT_MARGIN, viewportWidth - width - VIEWPORT_MARGIN);

    const key = `${placement}|${left}|${width}|${maxHeight}|${rect.top}|${rect.bottom}`;
    if (key === lastKey.current) return;
    lastKey.current = key;

    setPosition({
      placement,
      style: {
        position: "fixed",
        left,
        width,
        maxHeight,
        ...(placement === "bottom"
          ? { top: rect.bottom + ANCHOR_GAP }
          : // Pin the bottom edge so the panel grows upward from the control
            // instead of jumping once its real height is known.
            { bottom: viewportHeight - rect.top + ANCHOR_GAP }),
      },
    });
  }, [anchorRef, align, matchWidth, preferredWidth]);

  // Measure before paint so the panel never flashes at the wrong spot.
  useLayoutEffect(() => {
    if (!open) {
      lastKey.current = "";
      setPosition(null);
      return;
    }
    measure();
  }, [open, measure]);

  useEffect(() => {
    if (!open) return;
    // Scroll/resize events alone are not enough: the anchor can also move
    // because an ancestor animated, a sibling above it grew, or the page
    // reflowed after a font loaded, and a scroll inside a container that
    // predates this effect never reaches us at all. A frame loop, running only
    // while a menu is open and re-rendering only when the geometry key
    // changes, tracks all of it for a few frames' worth of getBoundingClientRect.
    let frame = requestAnimationFrame(function tick() {
      measure();
      frame = requestAnimationFrame(tick);
    });
    // Kept alongside the loop so the panel also settles immediately on the
    // events that matter most, including in a background tab where the frame
    // loop is throttled to a stop.
    const onChange = () => measure();
    window.addEventListener("scroll", onChange, true);
    window.addEventListener("resize", onChange);
    // Pinch-zoom and the mobile keyboard move the visual viewport without
    // firing a window resize.
    const visual = window.visualViewport;
    visual?.addEventListener("resize", onChange);
    visual?.addEventListener("scroll", onChange);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onChange, true);
      window.removeEventListener("resize", onChange);
      visual?.removeEventListener("resize", onChange);
      visual?.removeEventListener("scroll", onChange);
    };
  }, [open, measure]);

  return position;
}

export interface AnchoredPanelProps extends AnchorOptions {
  anchorRef: RefObject<HTMLElement | null>;
  open: boolean;
  /** Called for a pointer press outside both the anchor and the panel, or Escape. */
  onDismiss: () => void;
  /** Forwarded to the panel element so callers can hit-test their own clicks. */
  panelRef?: RefObject<HTMLDivElement>;
  className?: string;
  children: ReactNode;
  role?: "listbox" | "menu" | "dialog";
  "aria-label"?: string;
  id?: string;
}

/**
 * The floating half of a dropdown: a portal-rendered, viewport-positioned card
 * that scrolls internally when the list is long. Owning dismissal here (outside
 * press + Escape) keeps every menu in the app behaving the same way.
 */
export function AnchoredPanel({
  anchorRef,
  open,
  onDismiss,
  panelRef,
  className,
  children,
  role,
  id,
  "aria-label": ariaLabel,
  ...anchorOptions
}: AnchoredPanelProps) {
  const reduceMotion = useReducedMotion();
  const internalRef = useRef<HTMLDivElement>(null);
  const ref = panelRef ?? internalRef;
  const position = useAnchoredPosition(anchorRef, open, anchorOptions);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (ref.current?.contains(target)) return;
      if (anchorRef.current?.contains(target)) return;
      onDismiss();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onDismiss();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onDismiss, anchorRef, ref]);

  return createPortal(
    <AnimatePresence>
      {open && position && (
        <motion.div
          ref={ref}
          id={id}
          role={role}
          aria-label={ariaLabel}
          // Transform-only entrance, never opacity: if frames stall on a
          // low-power phone the menu is still fully opaque and readable.
          initial={reduceMotion ? false : { scale: 0.98, y: position.placement === "bottom" ? -4 : 4 }}
          animate={{ scale: 1, y: 0 }}
          transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
          style={{ ...position.style, transformOrigin: position.placement === "bottom" ? "top" : "bottom" }}
          className={cn(
            "z-modal flex flex-col overflow-hidden rounded-2xl border border-border bg-surface-raised shadow-[0_12px_40px_oklch(18%_0.02_260/0.18)]",
            className,
          )}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
