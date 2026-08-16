import { DeadlineTimer } from "cornell-craves";

// Offsets from render time so the countdown always reads realistically.
const inHours = (h: number) => new Date(Date.now() + h * 3_600_000).toISOString();

export function Default() {
  return <DeadlineTimer deadline={inHours(26)} />;
}

/** A prefix labels what the countdown belongs to. */
export function WithPrefix() {
  return <DeadlineTimer deadline={inHours(18)} prefix="Deadline" />;
}

/** Under the urgency threshold the timer switches to the accent treatment. */
export function Urgent() {
  return <DeadlineTimer deadline={inHours(1)} prefix="Deadline" />;
}

export function Expired() {
  return <DeadlineTimer deadline={inHours(-2)} prefix="Deadline" />;
}
