-- Cornell Craves v3: student accounts, orders, QR pickup passes.
-- Run AFTER 002_marketplace.sql.

-- ===================== Student profiles =====================

create table public.users_extended (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text not null default '',
  last_name text not null default '',
  cornell_netid text,
  cornell_email text,
  venmo_id text,
  zelle_id text,
  phone text,
  preferences_json jsonb not null default '{}'::jsonb, -- { "brands": [], "dietary": [] }
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Signup routing: club registrations (email/password with club_name metadata)
-- get a clubs row; everyone else (Google students) gets a profile row with
-- names parsed from Google metadata. cornell_email auto-fills for @cornell.edu.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_full text;
begin
  if new.raw_user_meta_data ? 'club_name' then
    insert into public.clubs (id, name, email, venmo, zelle_phone)
    values (
      new.id,
      coalesce(nullif(trim(new.raw_user_meta_data ->> 'club_name'), ''), 'Unnamed club'),
      coalesce(new.email, ''),
      nullif(trim(coalesce(new.raw_user_meta_data ->> 'venmo', '')), ''),
      nullif(trim(coalesce(new.raw_user_meta_data ->> 'zelle_phone', '')), '')
    );
  else
    v_full := coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
      nullif(trim(new.raw_user_meta_data ->> 'name'), ''),
      ''
    );
    insert into public.users_extended (id, first_name, last_name, cornell_email)
    values (
      new.id,
      coalesce(nullif(split_part(v_full, ' ', 1), ''), ''),
      coalesce(nullif(trim(regexp_replace(v_full, '^\S+\s*', '')), ''), ''),
      case when coalesce(new.email, '') ilike '%@cornell.edu' then new.email end
    )
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

create or replace function public.touch_users_extended()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger users_extended_touch
  before update on public.users_extended
  for each row execute function public.touch_users_extended();

-- ===================== Locations: pickup type =====================

alter table public.campus_locations
  add column pickup_type text not null default 'both'
  check (pickup_type in ('same_day_only', 'preorder_only', 'both'));

-- ===================== Orders =====================

create table public.orders (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  orderer_name text not null,
  orderer_email text not null,
  orderer_netid text,
  items_json jsonb not null default '[]'::jsonb, -- [{ name, price, qty }]
  total numeric(8, 2) not null check (total >= 0),
  payment_method text not null check (payment_method in ('venmo', 'zelle', 'both')),
  payment_details_json jsonb not null default '{}'::jsonb, -- { venmo?, zelle? }
  payment_verified boolean not null default false,
  status text not null default 'pending_payment'
    check (status in ('pending_payment', 'qr_sent', 'picked_up', 'cancelled')),
  proxy_name text,
  proxy_email text,
  proxy_netid text,
  picked_up_by_name text,
  picked_up_by_email text,
  picked_up_at timestamptz,
  created_at timestamptz not null default now()
);

create index orders_listing_idx on public.orders (listing_id, created_at desc);
create index orders_user_idx on public.orders (user_id);
create index orders_email_idx on public.orders (lower(orderer_email));

create table public.order_qr_codes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders (id) on delete cascade,
  user_type text not null check (user_type in ('orderer', 'proxy')),
  qr_encrypted text not null default '', -- signed token, filled on payment verify
  is_active boolean not null default false,
  scanned_at timestamptz,
  scanned_by_user_type text,
  created_at timestamptz not null default now(),
  unique (order_id, user_type)
);

create index order_qr_order_idx on public.order_qr_codes (order_id);

-- ===================== RPC functions =====================

-- Prices and totals are recomputed server-side from the listing's items so a
-- tampered client cannot order a $15 dozen for $1.
create or replace function public.create_order(
  p_listing_id uuid,
  p_name text,
  p_email text,
  p_netid text,
  p_items jsonb, -- [{ "name": "...", "qty": 2 }]
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

-- Guest order lookup by email; signed-in students query directly via RLS.
create or replace function public.get_my_orders(p_email text)
returns setof jsonb
language sql
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
  where lower(o.orderer_email) = lower(trim(p_email))
  order by o.created_at desc;
$$;

create or replace function public.cancel_order(p_order_id uuid, p_email text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated int;
begin
  update public.orders
  set status = 'cancelled'
  where id = p_order_id
    and status = 'pending_payment'
    and (lower(orderer_email) = lower(trim(p_email)) or user_id = auth.uid());
  get diagnostics v_updated = row_count;
  if v_updated = 0 then
    raise exception 'Only pending orders can be cancelled';
  end if;
end;
$$;

-- The orderer can switch the proxy pass off (and back on) anytime.
create or replace function public.set_proxy_qr_active(p_order_id uuid, p_email text, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders where id = p_order_id;
  if not found
    or not (lower(v_order.orderer_email) = lower(trim(p_email)) or v_order.user_id = auth.uid())
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

grant execute on function public.create_order(uuid, text, text, text, jsonb, text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.get_my_orders(text) to anon, authenticated;
grant execute on function public.cancel_order(uuid, text) to anon, authenticated;
grant execute on function public.set_proxy_qr_active(uuid, text, boolean) to anon, authenticated;

-- ===================== Row level security =====================

alter table public.users_extended enable row level security;
alter table public.orders enable row level security;
alter table public.order_qr_codes enable row level security;

create policy "Users manage their own profile"
  on public.users_extended for all
  using (id = auth.uid())
  with check (id = auth.uid());

-- orders: created only through create_order(). Students read their own,
-- clubs read and update orders on their listings (verify/scan flows run
-- through the edge function with the service role, but the dashboard reads
-- directly).
create policy "Students read their own orders"
  on public.orders for select
  using (
    user_id = auth.uid()
    or exists (select 1 from public.listings l where l.id = listing_id and l.club_id = auth.uid())
  );

create policy "Clubs update orders on their listings"
  on public.orders for update
  using (exists (select 1 from public.listings l where l.id = listing_id and l.club_id = auth.uid()))
  with check (exists (select 1 from public.listings l where l.id = listing_id and l.club_id = auth.uid()));

create policy "Order QR codes follow order access"
  on public.order_qr_codes for select
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_id
        and (
          o.user_id = auth.uid()
          or exists (select 1 from public.listings l where l.id = o.listing_id and l.club_id = auth.uid())
        )
    )
  );
