-- Cornell Craves 061: let a club record a sale made at its own table.
--
-- 060 added walk-up sales as real order rows. It missed that 023 puts a
-- BEFORE INSERT trigger on public.orders which rejects any order whose
-- user_id is null, with "Sign in with your Cornell (@cornell.edu) Google
-- account to order". A walk-up has no signed-in student by definition, so
-- record_walk_up_sale() failed on every single call - not just the ones with
-- a non-Cornell buyer email, but anonymous cash sales too. 023's own header
-- states the assumption that broke: "Clubs are unrestricted (they never
-- insert orders...)". They do now.
--
-- Three things change, all additive; 001-060 are untouched.
--
-- 1. assert_cornell_orderer() exempts a club-recorded walk-up.
--    The exemption is NOT "walk_up is true" on its own. It is "walk_up is
--    true AND the caller owns the drop", so the flag can never become a way
--    to slip a non-Cornell order past the gate. Today nothing can reach this
--    trigger except a SECURITY DEFINER RPC (public.orders has no INSERT
--    policy at all, so direct client inserts are already refused by RLS), but
--    this trigger is the last line before that gate and it should hold on its
--    own rather than on the current policy set staying as it is.
--
--    The student path is byte-for-byte what 023 does. Nothing about ordering
--    on the feed changes: a student still needs a Cornell Google account.
--
-- 2. A buyer at the table may use any email, or none.
--    That is the point of the exemption: people who walk past a table and buy
--    a box are not signing in, and in practice give a personal address
--    (@gmail.com and the like) if they want a receipt at all. No domain rule
--    applies to them, and the buyer's own address continues to live in
--    orders.walk_up_email.
--
-- 3. An anonymous walk-up stops borrowing the club's own email.
--    orders.orderer_email is NOT NULL, and 060 filled it with the club's
--    address when the buyer gave none. That address is a real account, and
--    two things key off it: get_my_orders() matches orders to a person by
--    orderer_email, so the club would have found its own cash sales sitting
--    in its personal "My orders" list; and admin_insights() counts distinct
--    orderer_email as buyers, so every anonymous sale on the platform would
--    have been credited to the club as a person who bought something.
--    Anonymous sales now carry walk-up@sale.invalid - .invalid is reserved by
--    RFC 2606 precisely so it can never resolve to a real mailbox or account.
--
-- Idempotent: safe to re-run. Run after 060.

-- ===========================================================================
-- 1. The Cornell gate, with a door for the club's own table
-- ===========================================================================

create or replace function public.assert_cornell_orderer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  -- A sale the club rang up in person. Allowed only for the club that owns
  -- the drop (or an admin), never on the strength of the flag alone.
  if coalesce(new.walk_up, false) then
    if public.is_admin()
       or exists (
         select 1 from public.listings l
         where l.id = new.listing_id and l.club_id = auth.uid()
       )
    then
      return new;
    end if;
    raise exception 'Only the club running this drop can record a sale at its table';
  end if;

  -- Unchanged from 023: students order with a Cornell Google account.
  if new.user_id is null then
    raise exception 'Sign in with your Cornell (@cornell.edu) Google account to order';
  end if;
  select lower(coalesce(email, '')) into v_email from auth.users where id = new.user_id;
  if v_email is null or v_email not like '%@cornell.edu' then
    raise exception 'Students must use a Cornell (@cornell.edu) Google account to order';
  end if;
  return new;
end;
$$;

-- The trigger itself is unchanged; recreated so this file stands alone if
-- 023 were ever applied after it.
drop trigger if exists orders_require_cornell on public.orders;
create trigger orders_require_cornell
  before insert on public.orders
  for each row execute function public.assert_cornell_orderer();

-- ===========================================================================
-- 2. Anonymous walk-ups get a reserved, unusable address
-- ===========================================================================

create or replace function public.record_walk_up_sale(
  p_listing_id uuid,
  p_spot_id uuid,
  p_items jsonb,               -- [{ "name": "...", "qty": 2 }]
  p_buyer_name text default null,
  p_buyer_email text default null,
  p_payment_method text default 'venmo'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing public.listings%rowtype;
  v_spot public.listing_pickup_spots%rowtype;
  v_item jsonb;
  v_listing_item jsonb;
  v_qty int;
  v_price numeric;
  v_total numeric := 0;
  v_items jsonb := '[]'::jsonb;
  v_stock public.listing_same_day_stock%rowtype;
  v_left int;
  v_email text := nullif(btrim(lower(p_buyer_email)), '');
  v_order_id uuid;
begin
  select * into v_listing from public.listings where id = p_listing_id;
  if not found then
    raise exception 'That drop no longer exists';
  end if;
  if v_listing.club_id <> auth.uid() then
    raise exception 'Only the club running this drop can record a sale';
  end if;

  select * into v_spot from public.listing_pickup_spots where id = p_spot_id;
  if not found or v_spot.listing_id <> p_listing_id then
    raise exception 'Pick one of this drop''s pickup spots';
  end if;
  if v_spot.order_type not in ('same_day', 'both') then
    raise exception 'That spot is pre-order only. Switch it to same-day first.';
  end if;
  if p_payment_method not in ('venmo', 'zelle', 'both', 'cash') then
    raise exception 'Unknown payment method';
  end if;
  -- Any domain is fine here (a buyer at the table is not a Cornell login),
  -- but a typo that is not an address at all should not be stored as one.
  if v_email is not null and v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'That does not look like an email address. Leave it blank for an anonymous sale.';
  end if;

  -- Serialize against another officer selling the last box at the same table.
  perform 1 from public.listings where id = p_listing_id for update;

  for v_item in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    v_qty := coalesce(nullif(v_item ->> 'qty', '')::int, 0);
    continue when v_qty <= 0;
    if v_qty > 200 then
      raise exception 'Quantity too large for %', v_item ->> 'name';
    end if;

    select item into v_listing_item
    from jsonb_array_elements(v_listing.items) as item
    where item ->> 'name' = v_item ->> 'name'
    limit 1;
    if v_listing_item is null then
      raise exception 'Unknown item: %', v_item ->> 'name';
    end if;

    select * into v_stock
    from public.listing_same_day_stock
    where spot_id = p_spot_id and item_name = v_item ->> 'name';

    if not found then
      raise exception 'Set a same-day count for % at this spot first', v_item ->> 'name';
    end if;
    v_left := greatest(v_stock.quantity - public.same_day_sold(p_spot_id, v_stock.item_name), 0);
    if v_qty > v_left then
      if v_left = 0 then
        raise exception '% is sold out at this spot', v_stock.item_name;
      end if;
      raise exception 'Only % left of % at this spot', v_left, v_stock.item_name;
    end if;

    v_price := coalesce(nullif(v_listing_item ->> 'price', '')::numeric, 0);
    v_total := v_total + v_price * v_qty;
    v_items := v_items || jsonb_build_array(
      jsonb_build_object('name', v_listing_item ->> 'name', 'price', v_price, 'qty', v_qty)
    );
  end loop;

  if jsonb_array_length(v_items) = 0 then
    raise exception 'Add at least one item';
  end if;

  insert into public.orders (
    listing_id, user_id, orderer_name, orderer_email, orderer_netid,
    items_json, total, payment_method, payment_details_json,
    payment_verified, status, picked_up_by_name, picked_up_at,
    walk_up, walk_up_email, pickup_spot_id
  ) values (
    p_listing_id,
    null,
    coalesce(nullif(btrim(p_buyer_name), ''), 'Walk-up sale'),
    -- The buyer's address when they gave one, otherwise a reserved address
    -- that can never be a real mailbox or a real account (RFC 2606). Never
    -- the club's own email: that is a live account, and both get_my_orders()
    -- and admin_insights() treat orderer_email as a person's identity.
    coalesce(v_email, 'walk-up@sale.invalid'),
    null,
    v_items,
    v_total,
    case when p_payment_method = 'cash' then 'venmo' else p_payment_method end,
    case when p_payment_method = 'cash' then '{"note":"cash at table"}'::jsonb else '{}'::jsonb end,
    true,
    'picked_up',
    coalesce(nullif(btrim(p_buyer_name), ''), 'Walk-up'),
    now(),
    true,
    v_email,
    p_spot_id
  )
  returning id into v_order_id;

  return v_order_id;
end;
$$;

revoke execute on function public.record_walk_up_sale(uuid, uuid, jsonb, text, text, text) from public, anon;
grant execute on function public.record_walk_up_sale(uuid, uuid, jsonb, text, text, text) to authenticated;

-- Repair anything 060 already wrote under a club's own address. In practice
-- there is nothing to repair, because the 023 trigger rejected every walk-up
-- before it reached the table, but this makes the file safe against a
-- database where some slipped through.
update public.orders o
   set orderer_email = 'walk-up@sale.invalid'
  from public.listings l
  join public.clubs c on c.id = l.club_id
 where o.walk_up
   and o.listing_id = l.id
   and o.walk_up_email is null
   and lower(o.orderer_email) = lower(c.email);

-- ===========================================================================
-- 3. Platform buyer counts ignore walk-ups
-- ===========================================================================
--
-- admin_insights() (041) counts a buyer as a distinct orderer_email. A
-- walk-up has no identified buyer: anonymous ones all share one reserved
-- address, so counting them would invent a single customer with thousands of
-- purchases and mark them "repeat". Their MONEY is untouched - revenue, the
-- daily series and the item breakdown all still include table sales - only
-- the three people-counting figures skip them.
-- admin_insights() (041) counts a buyer as a distinct orderer_email. A
-- walk-up has no identified buyer: anonymous ones all share one reserved
-- address, so counting them would invent a single customer with thousands of
-- purchases and mark them "repeat". Their MONEY is untouched - revenue, the
-- daily series, the item breakdown and the average order value all still
-- include table sales - only the three people-counting figures skip them.
--
-- Reproduced from 041 with exactly three clauses changed
-- (`where payment_verified` -> `where payment_verified and not walk_up`, in
-- buyers_total, buyers_repeat and buyers_new_30d). The heatmap's and the
-- average-order-value clauses are deliberately left alone: those are about
-- money and activity, not about who a person is.

create or replace function public.admin_insights()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when public.is_admin() then jsonb_build_object(
    -- Verified solo revenue + paid group shares, per Ithaca-local day.
    'daily', (
      select coalesce(
        jsonb_agg(jsonb_build_object('day', d.day, 'revenue', d.revenue, 'orders', d.orders) order by d.day),
        '[]'::jsonb
      )
      from (
        select day, sum(revenue) as revenue, sum(orders) as orders
        from (
          select to_char(o.created_at at time zone 'America/New_York', 'YYYY-MM-DD') as day,
                 sum(o.total) as revenue,
                 count(*) as orders
          from public.orders o
          where o.payment_verified and o.created_at >= now() - interval '30 days'
          group by 1
          union all
          select to_char(g.created_at at time zone 'America/New_York', 'YYYY-MM-DD'),
                 sum(g.item_price / greatest(g.total_people, 1)),
                 count(*)
          from public.order_group_members m
          join public.order_groups g on g.id = m.group_id
          where m.status = 'paid' and g.created_at >= now() - interval '30 days'
          group by 1
        ) u
        group by day
      ) d
    ),
    -- What students actually buy, across every club (last 30 days).
    'top_items', (
      select coalesce(
        jsonb_agg(jsonb_build_object('name', t.name, 'units', t.units, 'revenue', t.revenue) order by t.units desc),
        '[]'::jsonb
      )
      from (
        select line->>'name' as name,
               sum(coalesce((line->>'qty')::numeric, 0)) as units,
               sum(coalesce((line->>'qty')::numeric, 0) * coalesce((line->>'price')::numeric, 0)) as revenue
        from public.orders o
        cross join lateral jsonb_array_elements(o.items_json) as line
        where o.payment_verified and o.created_at >= now() - interval '30 days'
        group by 1
        order by 2 desc
        limit 10
      ) t
    ),
    -- When students order: Monday-first day-of-week x hour, Ithaca time.
    'heatmap', (
      select coalesce(
        jsonb_agg(jsonb_build_object('dow', h.dow, 'hour', h.hour, 'orders', h.orders)),
        '[]'::jsonb
      )
      from (
        select extract(isodow from o.created_at at time zone 'America/New_York')::int - 1 as dow,
               extract(hour from o.created_at at time zone 'America/New_York')::int as hour,
               count(*) as orders
        from public.orders o
        where o.payment_verified and o.created_at >= now() - interval '30 days'
        group by 1, 2
      ) h
    ),
    'buyers_total', (
      select count(distinct lower(orderer_email)) from public.orders
      where payment_verified and not walk_up
    ),
    'buyers_repeat', (
      select count(*) from (
        select 1 from public.orders
        where payment_verified and not walk_up
        group by lower(orderer_email)
        having count(*) >= 2
      ) r
    ),
    'buyers_new_30d', (
      select count(*) from (
        select lower(orderer_email) as email, min(created_at) as first_order
        from public.orders
        where payment_verified and not walk_up
        group by 1
      ) f
      where f.first_order >= now() - interval '30 days'
    ),
    'students_new_30d', (
      select count(*) from public.users_extended
      where created_at >= now() - interval '30 days'
    ),
    'avg_order_value_30d', (
      select coalesce(avg(total), 0) from public.orders
      where payment_verified and created_at >= now() - interval '30 days'
    )
  ) else null end;
$$;

revoke execute on function public.admin_insights() from public, anon;
grant execute on function public.admin_insights() to authenticated;
