-- Cornell Craves: when a pickup spot's window spans more than one calendar day,
-- the club can write the available hours per day; this text shows in the map
-- pin popup. Single-day spots just show their timing instead.

alter table public.listing_pickup_spots
  add column if not exists hours_note text;
