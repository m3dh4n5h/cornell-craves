-- Cornell Craves: multiple pickup spots per listing, each with an order type
-- (Batch 2 #2, #3, #5).
--
-- Replaces the single listings.pickup_location_id with a join table so a club
-- can offer several campus locations for one drop, and tag each spot as
-- "same_day" (walk up and buy in person) or "preorder" (must order ahead).
-- The legacy listings.pickup_location_id column is kept and mirrored to the
-- first spot for back-compat (older reads, the listing→detail select).

create table public.listing_pickup_spots (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  location_id uuid not null references public.campus_locations (id) on delete cascade,
  order_type text not null default 'preorder' check (order_type in ('same_day', 'preorder')),
  created_at timestamptz not null default now(),
  unique (listing_id, location_id)
);

create index listing_pickup_spots_listing_idx on public.listing_pickup_spots (listing_id);
create index listing_pickup_spots_location_idx on public.listing_pickup_spots (location_id);

-- Backfill: every listing that already has a single pickup location becomes one
-- spot. Existing drops were pre-order, so default them to 'preorder'.
insert into public.listing_pickup_spots (listing_id, location_id, order_type)
select l.id, l.pickup_location_id, 'preorder'
from public.listings l
where l.pickup_location_id is not null
on conflict (listing_id, location_id) do nothing;

-- ===================== Row level security =====================

alter table public.listing_pickup_spots enable row level security;

-- Public read (feed/detail/map), owning club writes (same model as pickup_slots).
create policy "Pickup spots are public"
  on public.listing_pickup_spots for select
  using (true);

create policy "Clubs manage pickup spots for their listings"
  on public.listing_pickup_spots for all
  using (exists (select 1 from public.listings l where l.id = listing_id and l.club_id = auth.uid()))
  with check (exists (select 1 from public.listings l where l.id = listing_id and l.club_id = auth.uid()));
