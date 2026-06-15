-- Cornell Craves: optional cause / donation on a listing (build spec 5 #9).
-- A club can name a cause and the percentage of earnings going to it. Listings
-- with a cause are prioritized to the top of the feed (handled client-side).

alter table public.listings
  add column if not exists cause_name text;

alter table public.listings
  add column if not exists cause_percent int
  check (cause_percent is null or (cause_percent between 1 and 100));
