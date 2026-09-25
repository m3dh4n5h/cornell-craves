-- Cornell Craves 054: optional per-item stock caps with race-safe enforcement.
--
-- Where the cap lives: listings.items[].stock (JSONB), next to price. The cap is
-- an attribute of the item exactly like its price, the listing form already
-- edits that JSONB as one unit, and every order path already matches items by
-- name inside it. A side table would have to be kept in sync with renames and
-- removals for no gain. No key (or null) means unlimited.
--
-- What holds stock (remaining = stock - held):
--   * orders in pending_payment, qr_sent, picked_up. 'cancelled' releases.
--   * order_groups in any status except 'canceled' (filling, full,
--     payment_in_progress, paid, reactivated). A split group is ONE unit of
--     its item no matter how many people share it. A group that fails its
--     deadline is set to 'canceled' by 050's automation, which releases it.
--
-- Enforcement: BEFORE triggers on orders and order_groups, not edits to the
-- RPCs. Four RPCs create stock-holding rows (create_order, create_order_group,
-- join_or_create_public_group, reactivate_group) and clubs can update their
-- own orders directly under RLS; a trigger covers every one of those paths,
-- including any added later. The trigger locks the listing row with
-- SELECT ... FOR UPDATE, so two buyers racing for the last box are checked one
-- after the other and the second one sees the first one's order. Drops with no
-- capped items skip the lock entirely.
--
-- Public read: listing_stock(uuid[]) returns counts only (item name, cap,
-- remaining). No order rows, names or emails. Same visibility as the listings
-- SELECT policy (active, own club, or admin).
--
-- Idempotent: safe to re-run.

-- ---------------------------------------------------------------------------
-- Shape check: stock, when present, is a whole number from 0 to 100000.
-- 0 is allowed so a club can mark one item sold out without deleting it.
-- Stays executable by everyone: the CHECK runs as the club doing the update.
-- ---------------------------------------------------------------------------
create or replace function public.items_stock_valid(p_items jsonb)
returns boolean
language sql
immutable
set search_path = public
as $$
  select coalesce(bool_and(
    jsonb_typeof(i) <> 'object'
    or i -> 'stock' is null
    or jsonb_typeof(i -> 'stock') = 'null'
    or (
      jsonb_typeof(i -> 'stock') = 'number'
      and (i ->> 'stock')::numeric = trunc((i ->> 'stock')::numeric)
      and (i ->> 'stock')::numeric between 0 and 100000
    )
  ), true)
  from jsonb_array_elements(
    case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end
  ) as i;
$$;

alter table public.listings drop constraint if exists listings_items_stock_valid;
alter table public.listings
  add constraint listings_items_stock_valid check (public.items_stock_valid(items));

-- ---------------------------------------------------------------------------
-- Internal helpers (not callable by clients).
-- ---------------------------------------------------------------------------

-- The cap for one item by name, or null when that item is unlimited.
create or replace function public.item_stock_cap(p_items jsonb, p_name text)
returns int
language sql
immutable
set search_path = public
as $$
  select (i ->> 'stock')::numeric::int
  from jsonb_array_elements(
    case when jsonb_typeof(p_items) = 'array' then p_items else '[]'::jsonb end
  ) as i
  where i ->> 'name' = p_name
    and jsonb_typeof(i -> 'stock') = 'number'
  limit 1;
$$;

-- Units of one item currently held by live orders and groups on a listing.
-- p_exclude skips one order/group id (the row a BEFORE UPDATE is changing).
create or replace function public.listing_item_held(
  p_listing_id uuid,
  p_item_name text,
  p_exclude uuid default null
)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select (
    coalesce((
      select sum(coalesce(nullif(li ->> 'qty', '')::int, 0))
      from public.orders o
      cross join lateral jsonb_array_elements(o.items_json) as li
      where o.listing_id = p_listing_id
        and o.status in ('pending_payment', 'qr_sent', 'picked_up')
        and o.id is distinct from p_exclude
        and li ->> 'name' = p_item_name
    ), 0)
    + (
      select count(*)
      from public.order_groups g
      where g.listing_id = p_listing_id
        and g.item_name = p_item_name
        and g.status <> 'canceled'
        and g.id is distinct from p_exclude
    )
  )::int;
$$;

revoke execute on function public.item_stock_cap(jsonb, text) from public, anon, authenticated;
revoke execute on function public.listing_item_held(uuid, text, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Enforcement: solo orders.
-- Checks inserts, a cancelled order being revived, and an edit to items_json.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_order_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items jsonb;
  v_line record;
  v_cap int;
  v_left int;
begin
  if new.status not in ('pending_payment', 'qr_sent', 'picked_up') then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.status in ('pending_payment', 'qr_sent', 'picked_up')
     and new.items_json is not distinct from old.items_json then
    return new;
  end if;

  -- Fast path: a drop with no capped items never takes the lock.
  select l.items into v_items from public.listings l where l.id = new.listing_id;
  if not exists (
    select 1
    from jsonb_array_elements(
      case when jsonb_typeof(v_items) = 'array' then v_items else '[]'::jsonb end
    ) as i
    where jsonb_typeof(i -> 'stock') = 'number'
  ) then
    return new;
  end if;

  -- Serialize every stock check for this drop. A concurrent order waits here
  -- until this transaction commits, then counts this order as held.
  select l.items into v_items from public.listings l where l.id = new.listing_id for update;

  for v_line in
    select li ->> 'name' as name, sum(coalesce(nullif(li ->> 'qty', '')::int, 0))::int as qty
    from jsonb_array_elements(coalesce(new.items_json, '[]'::jsonb)) as li
    group by li ->> 'name'
  loop
    v_cap := public.item_stock_cap(v_items, v_line.name);
    continue when v_cap is null or v_line.qty <= 0;
    v_left := greatest(v_cap - public.listing_item_held(new.listing_id, v_line.name, new.id), 0);
    if v_line.qty > v_left then
      if v_left = 0 then
        raise exception '% is sold out', v_line.name;
      end if;
      raise exception 'Only % left of %. Lower the quantity and try again.', v_left, v_line.name;
    end if;
  end loop;

  return new;
end;
$$;

revoke execute on function public.enforce_order_stock() from public, anon, authenticated;

drop trigger if exists orders_enforce_stock on public.orders;
create trigger orders_enforce_stock
  before insert or update of status, items_json on public.orders
  for each row execute function public.enforce_order_stock();

-- ---------------------------------------------------------------------------
-- Enforcement: split groups (one unit each).
-- Checks new groups and a canceled group being reactivated.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_group_stock()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_items jsonb;
  v_cap int;
begin
  if new.status = 'canceled' then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.status <> 'canceled'
     and new.item_name is not distinct from old.item_name then
    return new;
  end if;

  select l.items into v_items from public.listings l where l.id = new.listing_id;
  if public.item_stock_cap(v_items, new.item_name) is null then
    return new;
  end if;

  select l.items into v_items from public.listings l where l.id = new.listing_id for update;
  v_cap := public.item_stock_cap(v_items, new.item_name);
  if v_cap is null then
    return new;
  end if;

  if v_cap - public.listing_item_held(new.listing_id, new.item_name, new.id) < 1 then
    raise exception '% is sold out', new.item_name;
  end if;

  return new;
end;
$$;

revoke execute on function public.enforce_group_stock() from public, anon, authenticated;

drop trigger if exists order_groups_enforce_stock on public.order_groups;
create trigger order_groups_enforce_stock
  before insert or update of status, item_name on public.order_groups
  for each row execute function public.enforce_group_stock();

-- ---------------------------------------------------------------------------
-- Public read: remaining counts for capped items only. Aggregates, no rows.
-- ---------------------------------------------------------------------------
create or replace function public.listing_stock(p_listing_ids uuid[])
returns table (listing_id uuid, item_name text, stock int, remaining int)
language sql
stable
security definer
set search_path = public
as $$
  select
    l.id,
    i ->> 'name',
    (i ->> 'stock')::numeric::int,
    greatest((i ->> 'stock')::numeric::int - public.listing_item_held(l.id, i ->> 'name'), 0)
  from public.listings l
  cross join lateral jsonb_array_elements(
    case when jsonb_typeof(l.items) = 'array' then l.items else '[]'::jsonb end
  ) as i
  where l.id = any ((coalesce(p_listing_ids, '{}'::uuid[]))[1:200])
    and (l.active or l.club_id = auth.uid() or public.is_admin())
    and jsonb_typeof(i -> 'stock') = 'number';
$$;

revoke execute on function public.listing_stock(uuid[]) from public;
grant execute on function public.listing_stock(uuid[]) to anon, authenticated;
