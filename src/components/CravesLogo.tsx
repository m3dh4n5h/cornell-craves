/**
 * Logo direction 22 ("Craves C, flame A") from the identity exploration.
 * Both symbols live inside the word: the block C carries the burger, and a
 * flame stands in for the A. `CravesMark` is the icon alone (favicons,
 * compact tiles); `CravesLogo` is the full wordmark lockup.
 */

interface CravesMarkProps {
  /** Width in px; height follows the mark's own proportions. */
  size?: number;
  /** Use the light-shell variant for placement on a dark/ink background. */
  onDark?: boolean;
  className?: string;
}

export function CravesMark({ size = 40, onDark = false, className }: CravesMarkProps) {
  const shell = onDark ? "var(--color-surface)" : "var(--color-ink)";
  const mid = onDark ? "var(--color-ink)" : "var(--color-primary-dark)";
  return (
    <svg
      width={size}
      height={size * 1.03}
      viewBox="4 3 56 58"
      aria-hidden="true"
      className={className}
    >
      <path
        d="M16 5 48 5 58 15 58 23 45 23 45 18 23 18 19 22 19 42 23 46 45 46 45 41 58 41 58 49 48 59 16 59 6 49 6 15Z"
        fill={shell}
      />
      <path d="M21 30.5A11.5 10 0 0 1 44 30.5Z" fill="var(--color-primary)" />
      <rect x="21" y="30.5" width="23" height="3" rx="1.5" fill="var(--color-primary-dark)" />
      <rect x="21.8" y="34.1" width="21.4" height="5" rx="2.5" fill={mid} opacity={onDark ? 1 : 0.55} />
      <rect x="22.4" y="39.7" width="20.2" height="4.8" rx="2.4" fill="var(--color-primary)" />
    </svg>
  );
}

function FlameGlyph({ height }: { height: number }) {
  return (
    <svg
      width={height * 0.76}
      height={height}
      viewBox="4.4 2.4 15.2 20.2"
      aria-hidden="true"
      style={{ margin: "0 1px" }}
    >
      <path
        d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"
        fill="var(--color-primary)"
        stroke="var(--color-primary)"
        strokeWidth={1.6}
        strokeLinejoin="round"
      />
    </svg>
  );
}

interface CravesLogoProps {
  /** Cap height of "CRAVES" in px; the mark, flame, and rule scale off it. */
  size?: number;
  /** Use the light-text variant for placement on a dark/ink background. */
  onDark?: boolean;
  /** Show the tracked "CORNELL" line above the wordmark. */
  showCornell?: boolean;
  /** Show the saffron accent rule beneath the wordmark. */
  showRule?: boolean;
  className?: string;
}

/** Full lockup: optional CORNELL caption, then the CRAVES wordmark, then the rule. */
export function CravesLogo({
  size = 46,
  onDark = false,
  showCornell = true,
  showRule = true,
  className,
}: CravesLogoProps) {
  const word = onDark ? "var(--color-surface)" : "var(--color-ink)";
  const letterStyle = {
    fontFamily: "var(--font-display)",
    fontWeight: 800,
    fontSize: size,
    lineHeight: 0.9,
    letterSpacing: "-.01em",
    color: word,
  };

  return (
    <div role="img" aria-label="Cornell Craves" className={className}>
      {showCornell && (
        <p
          aria-hidden="true"
          style={{
            fontFamily: "var(--font-display)",
            fontWeight: 800,
            fontSize: size * 0.37,
            lineHeight: 1,
            letterSpacing: ".28em",
            textTransform: "uppercase",
            color: onDark ? "oklch(72% .02 85)" : "var(--color-ink-muted)",
            margin: `0 0 ${size * 0.09}px`,
          }}
        >
          Cornell
        </p>
      )}
      <div aria-hidden="true" style={{ display: "flex", alignItems: "center", gap: size * 0.09 }}>
        <CravesMark size={size * 0.74} onDark={onDark} />
        <span style={letterStyle}>R</span>
        <FlameGlyph height={size * 0.74} />
        <span style={letterStyle}>VES</span>
      </div>
      {showRule && (
        <div
          aria-hidden="true"
          style={{
            height: size * 0.13,
            background: "var(--color-primary)",
            borderRadius: size * 0.065,
            marginTop: size * 0.08,
          }}
        />
      )}
    </div>
  );
}
