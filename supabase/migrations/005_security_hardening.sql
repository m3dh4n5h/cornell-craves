-- Cornell Craves v4.1: security hardening.
-- Run AFTER 004_order_splitting.sql.
--
-- Closes the SECURITY_AUDIT.md findings (Vuln 1, 2, 3): a class of
-- SECURITY DEFINER RPCs were granted to anon and trusted a client-supplied
-- `p_email` as proof of identity. Cornell emails are predictable
-- (netid@cornell.edu), so that was effectively no authorization: anyone could
-- read another person's orders (including live QR pickup tokens), reservations
-- (including dietary notes + pickup time/location), or cancel/re-enable them.
--
-- Fix: identity now comes ONLY from the authenticated session. The functions
-- keep their original signatures (so the frontend keeps compiling) but IGNORE
-- the `p_email` argument and derive the caller's verified emails server-side.
-- The anon grant is revoked; these are authenticated-only now.

-- ===================== Identity helper =====================

-- The set of email addresses proven to belong to the current caller: their
-- Google auth email plus any cornell_email they saved. Returns empty for
-- anonymous callers, so every check below fails closed.
create or replace function public.current_user_emails()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    array(
      select distinct lower(btrim(e))
      from (
        select au.email from auth.users au where au.id = auth.uid()
        union
        select u.cornell_email from public.users_extended u where u.id = auth.uid()
      ) t(e)
      where e is not null and btrim(e) <> ''
    ),
    '{}'::text[]
  );
$$;

revoke execute on function public.current_user_emails() from public;
revoke execute on function public.current_user_emails() from anon;
grant execute on function public.current_user_emails() to authenticated;

-- ===================== Orders: read =====================

-- p_email is accepted for signature compatibility but ignored. Rows are scoped
-- to the authenticated owner (by user_id or a verified email). qr_encrypted is
-- only ever returned to that owner now.
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
      'qr_codes', coalesce(
        (select jsonb_agg(to_jsonb(q) order by q.user_type)
         from public.order_qr_codes q where q.order_id = o.id),
        '[]'::jsonb
      )
    )
  from public.orders o
  join public.listings l on l.id = o.listing_id
  left join public.campus_locations cl on cl.id = l.pickup_location_id
  where auth.uid() is not null
    and (o.user_id = auth.uid() or lower(o.orderer_email) = any (public.current_user_emails()))
  order by o.created_at desc;
$$;

revoke execute on function public.get_my_orders(text) from public;
revoke execute on function public.get_my_orders(text) from anon;
grant execute on function public.get_my_orders(text) to authenticated;

-- ===================== Orders: mutate =====================

create or replace function public.cancel_order(p_order_id uuid, p_email text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  if auth.uid() is null then
    raise exception 'Sign in to manage your orders';
  end if;
  update public.orders
  set status = 'cancelled'
  where id = p_order_id
    and status = 'pending_payment'
    and (user_id = auth.uid() or lower(orderer_email) = any (public.current_user_emails()));
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'Only your own pending orders can be cancelled';
  end if;
end;
$$;

revoke execute on function public.cancel_order(uuid, text) from public;
revoke execute on function public.cancel_order(uuid, text) from anon;
grant execute on function public.cancel_order(uuid, text) to authenticated;

create or replace function public.set_proxy_qr_active(p_order_id uuid, p_email text default null, p_active boolean default true)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in to manage your orders';
  end if;
  select * into v_order from public.orders where id = p_order_id;
  if not found
    or not (v_order.user_id = auth.uid() or lower(v_order.orderer_email) = any (public.current_user_emails()))
  then
    raise exception 'Order not found';
  end if;
  if not v_order.payment_verified and p_active then
    raise exception 'QR passes activate once the club verifies payment';
  end if;
  update public.order_qr_codes
  set is_active = p_active
  where order_id = p_order_id and user_type = 'proxy';
end;
$$;

revoke execute on function public.set_proxy_qr_active(uuid, text, boolean) from public;
revoke execute on function public.set_proxy_qr_active(uuid, text, boolean) from anon;
grant execute on function public.set_proxy_qr_active(uuid, text, boolean) to authenticated;

-- create_order now requires a signed-in student, so every order ties to a real
-- Google identity (auditability + anti-spam + airtight RLS). Pricing was already
-- server-authoritative; this just removes anonymous order creation.
create or replace function public.create_order(
  p_listing_id uuid,
  p_name text,
  p_email text,
  p_netid text,
  p_items jsonb,
  p_payment_method text,
  p_venmo text default null,
  p_zelle text default null,
  p_proxy_name text default null,
  p_proxy_email text default null,
  p_proxy_netid text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing public.listings%rowtype;
  v_item jsonb;
  v_listing_item jsonb;
  v_qty int;
  v_price numeric;
  v_total numeric := 0;
  v_items jsonb := '[]'::jsonb;
  v_details jsonb := '{}'::jsonb;
  v_has_proxy boolean;
  v_order_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in with Google to place an order';
  end if;
  if trim(coalesce(p_name, '')) = '' or trim(coalesce(p_email, '')) = '' then
    raise exception 'Name and email are required';
  end if;
  if p_payment_method not in ('venmo', 'zelle', 'both') then
    raise exception 'Pick a payment method';
  end if;
  if p_payment_method in ('venmo', 'both') and trim(coalesce(p_venmo, '')) = '' then
    raise exception 'Add your Venmo username so the club can match your payment';
  end if;
  if p_payment_method in ('zelle', 'both') and trim(coalesce(p_zelle, '')) = '' then
    raise exception 'Add your Zelle email or phone so the club can match your payment';
  end if;

  select * into v_listing from public.listings where id = p_listing_id;
  if not found or not v_listing.active then
    raise exception 'This listing is not taking orders';
  end if;
  if v_listing.expires_at <= now() then
    raise exception 'This drop has ended';
  end if;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_qty := coalesce(nullif(v_item ->> 'qty', '')::int, 0);
    if v_qty <= 0 then
      continue;
    end if;
    if v_qty > 50 then
      raise exception 'Quantity too large for %', v_item ->> 'name';
    end if;
    select item into v_listing_item
    from jsonb_array_elements(v_listing.items) as item
    where item ->> 'name' = v_item ->> 'name'
    limit 1;
    if v_listing_item is null then
      raise exception 'Unknown item: %', v_item ->> 'name';
    end if;
    v_price := coalesce(nullif(v_listing_item ->> 'price', '')::numeric, 0);
    v_total := v_total + v_price * v_qty;
    v_items := v_items || jsonb_build_array(
      jsonb_build_object('name', v_listing_item ->> 'name', 'price', v_price, 'qty', v_qty)
    );
  end loop;

  if jsonb_array_length(v_items) = 0 then
    raise exception 'Pick at least one item';
  end if;

  if p_payment_method in ('venmo', 'both') then
    v_details := v_details || jsonb_build_object('venmo', trim(p_venmo));
  end if;
  if p_payment_method in ('zelle', 'both') then
    v_details := v_details || jsonb_build_object('zelle', trim(p_zelle));
  end if;

  v_has_proxy := trim(coalesce(p_proxy_name, '')) <> '' and trim(coalesce(p_proxy_email, '')) <> '';

  insert into public.orders (
    listing_id, user_id, orderer_name, orderer_email, orderer_netid,
    items_json, total, payment_method, payment_details_json,
    proxy_name, proxy_email, proxy_netid
  )
  values (
    p_listing_id,
    auth.uid(),
    trim(p_name),
    lower(trim(p_email)),
    nullif(trim(coalesce(p_netid, '')), ''),
    v_items,
    round(v_total, 2),
    p_payment_method,
    v_details,
    case when v_has_proxy then trim(p_proxy_name) end,
    case when v_has_proxy then lower(trim(p_proxy_email)) end,
    case when v_has_proxy then nullif(trim(coalesce(p_proxy_netid, '')), '') end
  )
  returning id into v_order_id;

  insert into public.order_qr_codes (order_id, user_type) values (v_order_id, 'orderer');
  if v_has_proxy then
    insert into public.order_qr_codes (order_id, user_type) values (v_order_id, 'proxy');
  end if;

  return v_order_id;
end;
$$;

revoke execute on function public.create_order(uuid, text, text, text, jsonb, text, text, text, text, text, text) from public;
revoke execute on function public.create_order(uuid, text, text, text, jsonb, text, text, text, text, text, text) from anon;
grant execute on function public.create_order(uuid, text, text, text, jsonb, text, text, text, text, text, text) to authenticated;

-- ===================== Reservations =====================

create or replace function public.get_my_reservations(p_email text default null)
returns table (
  id uuid,
  quantity int,
  dietary_notes text,
  confirmed boolean,
  attended boolean,
  created_at timestamptz,
  slot_id uuid,
  start_time timestamptz,
  end_time timestamptz,
  listing_id uuid,
  listing_title text,
  brand text,
  listing_active boolean,
  location_name text,
  club_name text,
  venmo text,
  zelle_phone text
)
language sql
security definer
set search_path = public
as $$
  select
    r.id, r.quantity, r.dietary_notes, r.confirmed, r.attended, r.created_at,
    s.id, s.start_time, s.end_time,
    l.id, l.title, l.brand, l.active,
    cl.name, c.name, c.venmo, c.zelle_phone
  from public.reservations r
  join public.pickup_slots s on s.id = r.slot_id
  join public.listings l on l.id = s.listing_id
  join public.clubs c on c.id = l.club_id
  left join public.campus_locations cl on cl.id = l.pickup_location_id
  where auth.uid() is not null
    and lower(r.user_email) = any (public.current_user_emails())
  order by s.start_time asc;
$$;

revoke execute on function public.get_my_reservations(text) from public;
revoke execute on function public.get_my_reservations(text) from anon;
grant execute on function public.get_my_reservations(text) to authenticated;

create or replace function public.cancel_reservation(p_reservation_id uuid, p_email text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in to manage your reservations';
  end if;
  delete from public.reservations
  where id = p_reservation_id and lower(user_email) = any (public.current_user_emails())
  returning slot_id into v_slot;
  if v_slot is null then
    raise exception 'Reservation not found';
  end if;
  update public.pickup_slots
  set reserved_count = greatest(reserved_count - 1, 0)
  where id = v_slot;
end;
$$;

revoke execute on function public.cancel_reservation(uuid, text) from public;
revoke execute on function public.cancel_reservation(uuid, text) from anon;
grant execute on function public.cancel_reservation(uuid, text) to authenticated;

create or replace function public.confirm_reservation(p_reservation_id uuid, p_email text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  if auth.uid() is null then
    raise exception 'Sign in to confirm attendance';
  end if;
  update public.reservations r
  set confirmed = true
  from public.pickup_slots s
  where r.id = p_reservation_id
    and lower(r.user_email) = any (public.current_user_emails())
    and s.id = r.slot_id
    and s.start_time > now()
    and s.start_time <= now() + interval '24 hours';
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'Attendance can only be confirmed in the 24 hours before pickup';
  end if;
end;
$$;

revoke execute on function public.confirm_reservation(uuid, text) from public;
revoke execute on function public.confirm_reservation(uuid, text) from anon;
grant execute on function public.confirm_reservation(uuid, text) to authenticated;

-- create_reservation: keep it callable, but require a signed-in student so the
-- reservation ties to a verifiable email (the only handle students have on it).
create or replace function public.create_reservation(
  p_slot_id uuid,
  p_email text,
  p_name text,
  p_quantity int,
  p_dietary_notes text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot public.pickup_slots%rowtype;
  v_active boolean;
  v_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Sign in with Google to reserve a pickup';
  end if;
  if p_quantity < 1 or p_quantity > 20 then
    raise exception 'Quantity must be between 1 and 20';
  end if;
  if trim(coalesce(p_email, '')) = '' or trim(coalesce(p_name, '')) = '' then
    raise exception 'Name and email are required';
  end if;

  select * into v_slot from public.pickup_slots where id = p_slot_id for update;
  if not found then
    raise exception 'Pickup slot not found';
  end if;
  if v_slot.start_time <= now() then
    raise exception 'This pickup window has already started';
  end if;
  if v_slot.reserved_count >= v_slot.max_reservations then
    raise exception 'This slot is full';
  end if;

  select active into v_active from public.listings where id = v_slot.listing_id;
  if not coalesce(v_active, false) then
    raise exception 'This listing is no longer active';
  end if;

  begin
    insert into public.reservations (slot_id, user_email, user_name, quantity, dietary_notes)
    values (
      p_slot_id,
      lower(trim(p_email)),
      trim(p_name),
      p_quantity,
      nullif(trim(coalesce(p_dietary_notes, '')), '')
    )
    returning id into v_id;
  exception
    when unique_violation then
      raise exception 'You already have a reservation for this slot';
  end;

  update public.pickup_slots set reserved_count = reserved_count + 1 where id = p_slot_id;
  return v_id;
end;
$$;

revoke execute on function public.create_reservation(uuid, text, text, int, text) from public;
revoke execute on function public.create_reservation(uuid, text, text, int, text) from anon;
grant execute on function public.create_reservation(uuid, text, text, int, text) to authenticated;

-- ===================== Scale: hot-path indexes =====================

-- The feed query (active = true and expires_at > now(), newest first) is the
-- single hottest read. This partial index keeps it fast under load.
create index if not exists listings_feed_idx
  on public.listings (created_at desc)
  where active = true;

-- Brand filter + map both scan active listings by brand.
create index if not exists listings_brand_active_idx
  on public.listings (brand)
  where active = true;

-- Order group lookups by member (the /orders group section) and by listing.
create index if not exists group_members_user_status_idx
  on public.order_group_members (user_id, status);
