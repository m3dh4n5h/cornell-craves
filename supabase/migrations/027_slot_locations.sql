-- Cornell Craves: a pickup time slot gets its own location (build spec 5 #5/#6).
--
-- Students reserving pick a location together with a time slot, and a location
-- only shows on the map/listing on the date its slot actually happens. The
-- listing-level listing_pickup_spots still drives the feed's order-type badges;
-- pickup_slots.location_id adds the per-slot, date-bound location.

alter table public.pickup_slots
  add column if not exists location_id uuid references public.campus_locations (id) on delete set null;

create index if not exists pickup_slots_location_idx on public.pickup_slots (location_id);
