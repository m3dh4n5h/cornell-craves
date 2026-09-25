-- Cornell Craves 057: expose the listing's own pickup spots on a solo order,
-- so the "Add to calendar" button can offer one option per spot with a fixed
-- start/end time, matching group_payload()'s pickup_spots (056).
--
-- Same data, same reasoning as 056: listing_pickup_spots (order_type,
-- available_start/available_end, campus_locations lat/lng) is already public
-- on the listing itself. get_my_orders (038) carried a single flattened
-- location_name from the listing's own pickup_location_id; this adds the full
-- list of spots the listing actually offers, each with its own fixed timing
-- and coordinates, so a listing with a same-day AND a pre-order spot (or
-- several scheduled days) lets the buyer pick which one they're using.
--
-- Idempotent: safe to re-run.

create or replace function public.get_my_orders(p_email text default null)
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(o)
    || jsonb_build_object(
      'listing_title', l.title,
      'brand', l.brand,
      'pickup_info', l.pickup_info,
      'location_name', cl.name,
      'expires_at', l.expires_at,
      'pickup_spots', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'order_type', s.order_type,
              'available_start', s.available_start,
              'available_end', s.available_end,
              'location_name', spot_loc.name,
              'latitude', spot_loc.latitude,
              'longitude', spot_loc.longitude
            )
            order by s.available_start nulls last
          )
          from public.listing_pickup_spots s
          join public.campus_locations spot_loc on spot_loc.id = s.location_id
          where s.listing_id = l.id
        ),
        '[]'::jsonb
      ),
      'club_name', c.name,
      'contact_email', l.contact_email,
      'qr_codes', coalesce(
        (select jsonb_agg(to_jsonb(q) order by q.user_type)
         from public.order_qr_codes q where q.order_id = o.id),
        '[]'::jsonb
      )
    )
  from public.orders o
  join public.listings l on l.id = o.listing_id
  join public.clubs c on c.id = l.club_id
  left join public.campus_locations cl on cl.id = l.pickup_location_id
  -- Preserve migration 005's hardening: the caller must be signed in and only
  -- ever sees their OWN orders (by user_id or a verified account email). Never
  -- trust a client-supplied email, and never grant anon.
  where auth.uid() is not null
    and (o.user_id = auth.uid() or lower(o.orderer_email) = any (public.current_user_emails()))
  order by o.created_at desc;
$$;

revoke execute on function public.get_my_orders(text) from public, anon;
grant execute on function public.get_my_orders(text) to authenticated;
