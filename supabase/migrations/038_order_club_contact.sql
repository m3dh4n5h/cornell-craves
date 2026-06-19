-- Cornell Craves: expose the club name and the listing's contact email on a
-- buyer's orders, so the order PDF can show who to contact with questions.

-- The existing (005) function has a parameter default, and create-or-replace
-- cannot remove a parameter default (Postgres 42P13), so drop it first.
drop function if exists public.get_my_orders(text);

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
