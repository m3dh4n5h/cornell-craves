import { useState } from "react";
import { RatingStars } from "cornell-craves";

export function Sizes() {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <RatingStars value={4.8} size="sm" />
      <RatingStars value={4.8} size="md" />
      <RatingStars value={4.8} size="lg" />
    </div>
  );
}

export function Values() {
  return (
    <div style={{ display: "grid", gap: 12 }}>
      <RatingStars value={5} size="md" />
      <RatingStars value={4.5} size="md" />
      <RatingStars value={3} size="md" />
      <RatingStars value={0} size="md" />
    </div>
  );
}

/** With a rating summary line, the way a listing header shows it. */
export function WithSummary() {
  return (
    <span className="flex items-center gap-2">
      <RatingStars value={4.8} size="md" />
      <span className="text-sm font-bold">4.8</span>
      <span className="text-sm text-ink-muted">(23)</span>
    </span>
  );
}

/** Passing onChange switches it to an interactive input for writing a review. */
export function Interactive() {
  const [value, setValue] = useState(4);
  return <RatingStars value={value} onChange={setValue} size="lg" />;
}
