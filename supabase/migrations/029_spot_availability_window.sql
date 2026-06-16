-- Cornell Craves: each pickup spot has a general availability window (start ->
-- end). The map only shows the club's pin for that spot during the window.

alter table public.listing_pickup_spots
  add column if not exists available_start timestamptz;

alter table public.listing_pickup_spots
  add column if not exists available_end timestamptz;
