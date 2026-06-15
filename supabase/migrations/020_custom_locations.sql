-- Cornell Craves: club-added pickup locations (Tranche 4 #4).
--
-- The curated campus_locations list stays (created_by null). A club can add its
-- own location by name + geocoded address; it is owned by that club so only the
-- curated list plus the club's own show in its pickup-spot picker. On the public
-- feed/map it behaves like any other location.

alter table public.campus_locations
  add column if not exists created_by uuid references public.clubs (id) on delete cascade;

create index if not exists campus_locations_created_by_idx
  on public.campus_locations (created_by);

-- Inserts a club-owned location. The geocoding (address -> lat/lng) happens in
-- the browser against Nominatim; this RPC just validates and stores the result,
-- so a club can write to the otherwise admin-only campus_locations table.
create or replace function public.add_campus_location(
  p_name text,
  p_lat double precision,
  p_lng double precision,
  p_description text default null
)
returns public.campus_locations
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.campus_locations;
begin
  if not exists (select 1 from public.clubs c where c.id = auth.uid()) then
    raise exception 'Only clubs can add locations';
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'Enter a name for the spot';
  end if;
  if p_lat is null or p_lng is null or p_lat < -90 or p_lat > 90 or p_lng < -180 or p_lng > 180 then
    raise exception 'Could not place that address on the map';
  end if;

  insert into public.campus_locations (name, latitude, longitude, description, created_by)
  values (btrim(p_name), p_lat, p_lng, nullif(btrim(coalesce(p_description, '')), ''), auth.uid())
  returning * into v_row;
  return v_row;
end;
$$;

revoke execute on function public.add_campus_location(text, double precision, double precision, text) from public, anon;
grant execute on function public.add_campus_location(text, double precision, double precision, text) to authenticated;
