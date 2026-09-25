-- Cornell Craves 058: a fundraiser goal is the club's own target, not tied to a cause.
--
-- 055 required cause_name before a goal could be set, and labelled the progress
-- bar with the cause ("Raising for: <cause>"). A cause is an outside
-- organization receiving a share of earnings; a goal is what the club itself is
-- trying to raise from the drop. The two are now independent: a drop can have a
-- goal, a cause, both, or neither. Raised is still the full confirmed amount
-- (listing_fundraising from 055 is unchanged).
--
-- Only the check constraint changes. Existing rows already satisfy it.
-- Run AFTER 055. Idempotent: safe to re-run.

alter table public.listings drop constraint if exists listings_goal_amount_valid;
alter table public.listings
  add constraint listings_goal_amount_valid check (
    goal_amount is null
    or (goal_amount > 0 and goal_amount <= 1000000)
  );
