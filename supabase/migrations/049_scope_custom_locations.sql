-- Cornell Craves 049: scope club-added campus locations to their own club.
--
-- campus_locations has been "public read" (using (true)) since 002_marketplace,
-- even after 020_custom_locations gave rows a created_by owner. The dashboard
-- and templates queries filtered to curated + own club client-side, but that
-- was UI-only: any authenticated (or anon) client could still read every
-- club's custom spots straight from the table, bypassing the app entirely.
--
-- This replaces the blanket policy with: curated rows (created_by is null),
-- the owning club's own rows, admin, or a row already attached to a listing
-- the requester can see (pickup_location_id, listing_pickup_spots, or
-- pickup_slots). The listing joins inherit the listings table's own "active
-- or own or admin" policy automatically, so a spot becomes visible the moment
-- it's used on a listing the requester could already see - matching 020's
-- original intent ("on the public feed/map it behaves like any other
-- location") without exposing a club's unused custom spots to every other
-- club.
--
-- Run after 048_per_member_recommender. Idempotent: safe to re-run.

drop policy if exists "Locations are public" on public.campus_locations;

create policy "Curated, own, or in-use locations are visible"
  on public.campus_locations for select
  using (
    created_by is null
    or created_by = auth.uid()
    or public.is_admin()
    or exists (
      select 1 from public.listings l
      where l.pickup_location_id = campus_locations.id
    )
    or exists (
      select 1
      from public.listing_pickup_spots lps
      join public.listings l on l.id = lps.listing_id
      where lps.location_id = campus_locations.id
    )
    or exists (
      select 1
      from public.pickup_slots ps
      join public.listings l on l.id = ps.listing_id
      where ps.location_id = campus_locations.id
    )
  );
