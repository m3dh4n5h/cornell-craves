-- Cornell Craves 060: pickup dates & times, same-day inventory, walk-up sales,
-- club-scoped custom spot cleanup, a club-level listing contact email, and
-- full listing templates.
--
-- This is deliberately ONE migration rather than eight. Everything below is a
-- single coherent change to how a drop describes its pickup, and splitting it
-- would leave intermediate states where the listing form can save a window
-- that nothing can read. Nothing here rewrites an earlier migration: every
-- statement is additive (add column if not exists / create table if not
-- exists / create or replace function), so 001-059 stay exactly as they are
-- and this file is safe to re-run.
--
-- ---------------------------------------------------------------------------
-- What changes, and why
-- ---------------------------------------------------------------------------
-- 1. clubs.listing_contact_email
--    The listing form asked every club to retype a contact email on every
--    drop (011). Clubs set it once on their account; the form prefills it and
--    still lets them override it per listing.
--
-- 2. campus_locations.archived_at
--    049 already scoped a club's custom spots to that club by RLS, but there
--    was no way to get rid of one. A hard delete would orphan past orders
--    (pickup_location_id is ON DELETE SET NULL, listing_pickup_spots is ON
--    DELETE CASCADE - a delete would silently drop a past drop's spot row and
--    with it the record of where students actually collected). So a club
--    "deletes" a spot by archiving it: it leaves the picker, every past
--    listing, order, map pin and calendar entry keeps resolving it.
--    archive_campus_location() refuses while a LIVE listing still uses it, and
--    names the listings so the club knows what to edit and who to email.
--    Curated spots (created_by is null) can never be archived by a club.
--
-- 3. listing_pickup_windows  (the heart of this migration)
--    Before: a spot carried ONE available_start/available_end pair plus a
--    free-text hours_note for anything multi-day, and "pickup days"
--    (pickup_slots) were a separate, unconnected list. A club running the same
--    table Tue 11-2 and Thu 5-8 had to describe that in prose.
--    After: a spot has MANY windows. One window is one date with a from-time
--    and a to-time. Each window says how pickup is rationed:
--      'open'     anyone may come during the window, no signup      (no slots)
--      'capacity' N people total across the window                  (1 slot)
--      'split'    the window is cut into timed slots students book  (N slots)
--    'capacity' and 'split' both materialise into pickup_slots rows, so every
--    existing reservation path (reserve_slot, get_my_reservations, the club's
--    reservation screen, the QR gating) keeps working untouched. The window is
--    the club's intent; pickup_slots stays the booking ledger.
--    split_minutes records that a split was generated automatically at 15/20/
--    30/45/60 minutes, purely so the form can show what the club chose and
--    regenerate. A manual split leaves it null.
--
-- 4. pickup_slots.window_id
--    Ties a generated slot back to its window. ON DELETE CASCADE: removing a
--    window removes its slots, which is what a club means by deleting a date.
--    Legacy slots from before this migration keep window_id null and still
--    work - nothing reads window_id as required.
--
-- 5. listing_same_day_stock + listings.same_day_enabled
--    054 caps total units per item across the whole drop. That cap is a
--    pre-order cap: it is held by orders placed in advance. Same-day pickup is
--    a physically different pile - the boxes a club carries to a table on the
--    day - so it gets its own count, per item PER SPOT, because a club with
--    two tables splits its stock between them. Walk-up sales draw down this
--    pile and never touch the 054 cap (see 6).
--
-- 6. orders.walk_up / walk_up_email / pickup_spot_id + record_walk_up_sale()
--    A same-day sale at the table is a real order row, not a counter: it then
--    counts toward revenue, the fundraising goal bar (055/059) and analytics
--    for free, and shows in the CSV beside every other sale. It is created by
--    the club, has no student account, and carries an optional buyer email so
--    a receipt can be sent. Because walk-ups draw on the same-day pile,
--    listing_item_held() and the 054 triggers now skip walk_up rows - counting
--    them in both places would let a club sell its own stock to itself.
--
-- 7. recurring_templates gains the rest of a listing
--    "Save as template" has to capture what a club actually configured, not
--    just name/brand/items. Calendar DATES are deliberately not stored: a
--    template reused in three weeks would otherwise carry three-week-old
--    dates. Windows are kept as time-of-day plus a day offset from the first
--    pickup day, so posting from a template asks only for the start date.
--
-- 8. get_my_orders / group_payload carry the windows
--    So a buyer's order and a split group show the real dates and times, and
--    "add to calendar" can offer one entry per day rather than one guess.
-- ---------------------------------------------------------------------------

-- ===========================================================================
-- 1. Club-level contact email for listing questions
-- ===========================================================================

alter table public.clubs
  add column if not exists listing_contact_email text;

comment on column public.clubs.listing_contact_email is
  'Default "contact for questions about our listings" address. Prefilled into '
  'every new listing form; a listing may override it. Null falls back to clubs.email.';

-- ===========================================================================
-- 2. Archivable club-owned custom pickup spots
-- ===========================================================================

alter table public.campus_locations
  add column if not exists archived_at timestamptz;

create index if not exists campus_locations_active_idx
  on public.campus_locations (created_by)
  where archived_at is null;

-- One-off cleanup: the "HR5" / "High Rise 5" spots were added by a club and
-- are not part of the curated list. Archive them rather than delete so any
-- listing that used them still resolves. Curated rows are never touched.
update public.campus_locations
   set archived_at = now()
 where archived_at is null
   and created_by is not null
   and lower(btrim(name)) in ('hr5', 'hr 5', 'high rise 5', 'highrise 5');

-- Listings that are still live and still use a given spot. Used by the archive
-- RPC to explain a refusal, and by the dashboard to show what to fix first.
create or replace function public.campus_location_live_listings(p_location_id uuid)
returns table (listing_id uuid, title text, expires_at timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select distinct l.id, l.title, l.expires_at
  from public.listings l
  where l.active
    and l.expires_at > now()
    and (
      l.pickup_location_id = p_location_id
      or exists (
        select 1 from public.listing_pickup_spots s
        where s.listing_id = l.id and s.location_id = p_location_id
      )
      or exists (
        select 1 from public.pickup_slots ps
        where ps.listing_id = l.id and ps.location_id = p_location_id
      )
    )
  order by l.expires_at;
$$;

revoke execute on function public.campus_location_live_listings(uuid) from public, anon;
grant execute on function public.campus_location_live_listings(uuid) to authenticated;

-- A club removes one of its OWN custom spots from its picker.
--
-- Refused while a live listing still uses it: the club has to take the spot
-- off that drop first and tell the students who already ordered, because
-- yanking a pickup location out from under a paid order is exactly the kind
-- of silent data change that strands someone at an empty table. Once every
-- listing using it has ended, the archive goes through.
create or replace function public.archive_campus_location(p_location_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.campus_locations%rowtype;
  v_blocking jsonb;
begin
  if auth.uid() is null then
    raise exception 'Sign in to manage your pickup spots';
  end if;

  select * into v_row from public.campus_locations where id = p_location_id;
  if not found then
    raise exception 'That pickup spot no longer exists';
  end if;
  if v_row.created_by is null then
    raise exception 'Campus-wide spots are part of the shared list and cannot be removed';
  end if;
  if v_row.created_by <> auth.uid() and not public.is_admin() then
    raise exception 'Only the club that added a spot can remove it';
  end if;
  if v_row.archived_at is not null then
    return jsonb_build_object('ok', true, 'already_archived', true);
  end if;

  select coalesce(
           jsonb_agg(jsonb_build_object('id', listing_id, 'title', title, 'expires_at', expires_at)),
           '[]'::jsonb
         )
    into v_blocking
    from public.campus_location_live_listings(p_location_id);

  if jsonb_array_length(v_blocking) > 0 then
    return jsonb_build_object('ok', false, 'blocking_listings', v_blocking);
  end if;

  update public.campus_locations set archived_at = now() where id = p_location_id;
  return jsonb_build_object('ok', true, 'blocking_listings', '[]'::jsonb);
end;
$$;

revoke execute on function public.archive_campus_location(uuid) from public, anon;
grant execute on function public.archive_campus_location(uuid) to authenticated;

-- A club can undo an archive from its spot list (nothing references archived
-- state except the picker, so this is a plain flag flip).
create or replace function public.restore_campus_location(p_location_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.campus_locations%rowtype;
begin
  select * into v_row from public.campus_locations where id = p_location_id;
  if not found then
    raise exception 'That pickup spot no longer exists';
  end if;
  if v_row.created_by is distinct from auth.uid() and not public.is_admin() then
    raise exception 'Only the club that added a spot can restore it';
  end if;
  update public.campus_locations set archived_at = null where id = p_location_id;
end;
$$;

revoke execute on function public.restore_campus_location(uuid) from public, anon;
grant execute on function public.restore_campus_location(uuid) to authenticated;

-- ===========================================================================
-- 3. Pickup windows: one date + from/to time, per spot
-- ===========================================================================

create table if not exists public.listing_pickup_windows (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  spot_id uuid not null references public.listing_pickup_spots (id) on delete cascade,
  start_time timestamptz not null,
  end_time timestamptz not null,
  -- How this window is rationed. See the header note; 'open' means students
  -- just turn up, and is the default because most drops work that way.
  slot_mode text not null default 'open'
    check (slot_mode in ('open', 'capacity', 'split')),
  -- 'capacity' only: how many people total may book across the window.
  capacity int check (capacity is null or (capacity >= 1 and capacity <= 5000)),
  -- 'split' only, and only when the split was generated: the chosen interval.
  -- Null on a hand-built split, which is a real distinction the form shows.
  split_minutes int check (split_minutes is null or split_minutes in (15, 20, 30, 45, 60)),
  note text,
  created_at timestamptz not null default now(),
  constraint listing_pickup_windows_order check (end_time > start_time),
  -- A window can't span more than one day: the whole point of this table is
  -- that a club enters one date at a time, and a 3-day "window" is what the
  -- old free-text hours_note was papering over.
  constraint listing_pickup_windows_one_day check (end_time <= start_time + interval '24 hours')
);

create index if not exists listing_pickup_windows_listing_idx
  on public.listing_pickup_windows (listing_id, start_time);
create index if not exists listing_pickup_windows_spot_idx
  on public.listing_pickup_windows (spot_id, start_time);

alter table public.listing_pickup_windows enable row level security;

-- Same visibility model as listing_pickup_spots (014): a window is part of the
-- public description of a drop, and the owning club manages it.
drop policy if exists "Pickup windows are public" on public.listing_pickup_windows;
create policy "Pickup windows are public"
  on public.listing_pickup_windows for select
  using (true);

drop policy if exists "Clubs manage pickup windows for their listings" on public.listing_pickup_windows;
create policy "Clubs manage pickup windows for their listings"
  on public.listing_pickup_windows for all
  using (exists (select 1 from public.listings l where l.id = listing_id and l.club_id = auth.uid()))
  with check (exists (select 1 from public.listings l where l.id = listing_id and l.club_id = auth.uid()));

-- ---------------------------------------------------------------------------
-- 4. Slots belong to a window
-- ---------------------------------------------------------------------------

alter table public.pickup_slots
  add column if not exists window_id uuid
    references public.listing_pickup_windows (id) on delete cascade;

create index if not exists pickup_slots_window_idx on public.pickup_slots (window_id);

comment on column public.pickup_slots.window_id is
  'The pickup window this slot was generated from (060). Null on slots created '
  'before 060, which still behave exactly as they did.';

-- Backfill: a pre-060 listing that had both spots and slots gets a window per
-- existing slot so the new UI has something coherent to show. Only listings
-- with exactly one spot are inferred - with two or more there is no way to
-- know which table a slot belonged to, and guessing would move a student's
-- pickup to the wrong building. Those keep their slots, window_id null, and
-- the club is asked to re-enter dates the next time it edits the drop.
insert into public.listing_pickup_windows (listing_id, spot_id, start_time, end_time, slot_mode, capacity)
select ps.listing_id, s.id, ps.start_time, ps.end_time, 'capacity', ps.max_reservations
from public.pickup_slots ps
join public.listing_pickup_spots s on s.listing_id = ps.listing_id
where ps.window_id is null
  and (select count(*) from public.listing_pickup_spots s2 where s2.listing_id = ps.listing_id) = 1
  and (ps.location_id is null or ps.location_id = s.location_id)
  -- A window is one day by constraint. A legacy slot longer than that (there
  -- should be none, but the old schema allowed it) is left unconverted rather
  -- than failing the whole migration.
  and ps.end_time <= ps.start_time + interval '24 hours'
  and not exists (
    select 1 from public.listing_pickup_windows w
    where w.spot_id = s.id and w.start_time = ps.start_time and w.end_time = ps.end_time
  );

update public.pickup_slots ps
   set window_id = w.id
  from public.listing_pickup_windows w
 where ps.window_id is null
   and w.listing_id = ps.listing_id
   and w.start_time = ps.start_time
   and w.end_time = ps.end_time;

-- A spot's own window list, oldest first. Used by every read path below.
create or replace function public.spot_windows_json(p_spot_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', w.id,
        'start_time', w.start_time,
        'end_time', w.end_time,
        'slot_mode', w.slot_mode,
        'capacity', w.capacity,
        'split_minutes', w.split_minutes,
        'note', w.note,
        'slots_total', (select count(*) from public.pickup_slots s where s.window_id = w.id),
        'slots_taken', (
          select coalesce(sum(s.reserved_count), 0)
          from public.pickup_slots s where s.window_id = w.id
        )
      )
      order by w.start_time
    ),
    '[]'::jsonb
  )
  from public.listing_pickup_windows w
  where w.spot_id = p_spot_id;
$$;

grant execute on function public.spot_windows_json(uuid) to anon, authenticated;

-- ===========================================================================
-- 5. Same-day pickup inventory: per item, per spot
-- ===========================================================================

alter table public.listings
  add column if not exists same_day_enabled boolean not null default false;

comment on column public.listings.same_day_enabled is
  'The club opted this drop into selling at the table on the day (060). '
  'Independent of listing_pickup_spots.order_type, which says which spots '
  'accept walk-ups; this says the club is tracking a physical pile for them.';

create table if not exists public.listing_same_day_stock (
  id uuid primary key default gen_random_uuid(),
  listing_id uuid not null references public.listings (id) on delete cascade,
  spot_id uuid not null references public.listing_pickup_spots (id) on delete cascade,
  item_name text not null,
  -- Units the club is carrying to THIS table for THIS item. Not a cap on
  -- pre-orders: 054's items[].stock still governs those, and the two piles are
  -- deliberately separate because they are separate boxes in the real world.
  quantity int not null default 0 check (quantity >= 0 and quantity <= 100000),
  updated_at timestamptz not null default now(),
  unique (spot_id, item_name)
);

create index if not exists listing_same_day_stock_listing_idx
  on public.listing_same_day_stock (listing_id);

alter table public.listing_same_day_stock enable row level security;

-- Public read so the listing page can show "12 left at Duffield" the same way
-- 054's listing_stock() shows pre-order stock. Counts only; no buyer data.
drop policy if exists "Same-day stock is public" on public.listing_same_day_stock;
create policy "Same-day stock is public"
  on public.listing_same_day_stock for select
  using (true);

drop policy if exists "Clubs manage same-day stock" on public.listing_same_day_stock;
create policy "Clubs manage same-day stock"
  on public.listing_same_day_stock for all
  using (exists (select 1 from public.listings l where l.id = listing_id and l.club_id = auth.uid()))
  with check (exists (select 1 from public.listings l where l.id = listing_id and l.club_id = auth.uid()));

-- ===========================================================================
-- 6. Walk-up sales: a real order row, drawn from the same-day pile
-- ===========================================================================

alter table public.orders
  add column if not exists walk_up boolean not null default false;

alter table public.orders
  add column if not exists walk_up_email text;

alter table public.orders
  add column if not exists pickup_spot_id uuid
    references public.listing_pickup_spots (id) on delete set null;

create index if not exists orders_walk_up_idx
  on public.orders (listing_id, pickup_spot_id)
  where walk_up;

comment on column public.orders.walk_up is
  'Recorded by the club at the table on pickup day (060). Already collected and '
  'already handed over, so it is created verified and picked_up. Draws on '
  'listing_same_day_stock, never on items[].stock.';

-- Units of an item already sold at a spot from the same-day pile.
create or replace function public.same_day_sold(p_spot_id uuid, p_item_name text)
returns int
language sql
stable
security definer
set search_path = public
as $$
  select coalesce((
    select sum(coalesce(nullif(li ->> 'qty', '')::int, 0))
    from public.orders o
    cross join lateral jsonb_array_elements(o.items_json) as li
    where o.walk_up
      and o.pickup_spot_id = p_spot_id
      and o.status <> 'cancelled'
      and li ->> 'name' = p_item_name
  ), 0)::int;
$$;

grant execute on function public.same_day_sold(uuid, text) to authenticated;

-- What is left at each table, for the club's pickup-day screen and the public
-- listing page. Counts only, same visibility rationale as 054's listing_stock.
create or replace function public.same_day_stock(p_listing_ids uuid[])
returns table (
  listing_id uuid,
  spot_id uuid,
  location_name text,
  item_name text,
  quantity int,
  sold int,
  remaining int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    st.listing_id,
    st.spot_id,
    cl.name,
    st.item_name,
    st.quantity,
    public.same_day_sold(st.spot_id, st.item_name),
    greatest(st.quantity - public.same_day_sold(st.spot_id, st.item_name), 0)
  from public.listing_same_day_stock st
  join public.listing_pickup_spots s on s.id = st.spot_id
  join public.campus_locations cl on cl.id = s.location_id
  join public.listings l on l.id = st.listing_id
  where st.listing_id = any (p_listing_ids)
    and (l.active or l.club_id = auth.uid() or public.is_admin())
  order by cl.name, st.item_name;
$$;

grant execute on function public.same_day_stock(uuid[]) to anon, authenticated;

-- Record a sale made in person. Club-only. Prices come from the listing, never
-- from the client, exactly as create_order (003) does.
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

    -- No row at all means the club never set a same-day count for this item
    -- at this table. That is "not being sold here", not "unlimited": a club
    -- that wants to sell it adds a count first, which is one field on the
    -- pickup-day screen.
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
    -- orderer_email is NOT NULL and is the club's own reconciliation key for
    -- anonymous cash sales; the buyer's own address, when they gave one, is
    -- kept separately in walk_up_email so a receipt can go to the right place
    -- and so an anonymous sale never looks like it belongs to the club.
    coalesce(nullif(btrim(lower(p_buyer_email)), ''), (select email from public.clubs where id = auth.uid())),
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
    nullif(btrim(lower(p_buyer_email)), ''),
    p_spot_id
  )
  returning id into v_order_id;

  return v_order_id;
end;
$$;

revoke execute on function public.record_walk_up_sale(uuid, uuid, jsonb, text, text, text) from public, anon;
grant execute on function public.record_walk_up_sale(uuid, uuid, jsonb, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 054 correction: walk-ups draw the same-day pile, not the pre-order cap.
-- Redefined, not rewritten in place: 054's own file is untouched and this
-- replaces the function body at run time (the only change is the walk_up
-- filter). Without it a club's own table sales would eat the stock students
-- are pre-ordering against, and a drop could show "sold out" with boxes still
-- on the table.
-- ---------------------------------------------------------------------------
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
        and not o.walk_up
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

revoke execute on function public.listing_item_held(uuid, text, uuid) from public, anon, authenticated;

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
  -- A walk-up was already checked against listing_same_day_stock inside
  -- record_walk_up_sale, under the same row lock. Re-checking it here against
  -- the pre-order cap would double-count the same box.
  if new.walk_up then
    return new;
  end if;
  if new.status not in ('pending_payment', 'qr_sent', 'picked_up') then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and old.status in ('pending_payment', 'qr_sent', 'picked_up')
     and new.items_json is not distinct from old.items_json then
    return new;
  end if;

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

-- ===========================================================================
-- 7. Templates hold a whole listing
-- ===========================================================================
--
-- No new table and no new "kind": a template posted once is what
-- recurring_templates.mode = 'one_time' (026) already means, so saving a
-- listing as a template is the same object with more of it filled in. Only
-- the columns that were missing are added.

alter table public.recurring_templates add column if not exists contact_email text;
alter table public.recurring_templates add column if not exists cause_name text;
alter table public.recurring_templates add column if not exists cause_percent int;
alter table public.recurring_templates add column if not exists goal_amount numeric(10, 2);
alter table public.recurring_templates add column if not exists goal_public boolean not null default false;
alter table public.recurring_templates add column if not exists recommender_enabled boolean not null default false;
alter table public.recurring_templates add column if not exists same_day_enabled boolean not null default false;
-- How long the drop runs from the moment it is posted. Stored instead of an
-- expiry date for the same reason windows store offsets: an absolute date in a
-- template is stale the second time you use it.
alter table public.recurring_templates add column if not exists duration_hours int
  check (duration_hours is null or (duration_hours >= 1 and duration_hours <= 2160));
-- Pickup, as a shape rather than dates:
--   [{ location_id, order_type,
--      windows: [{ day_offset, start_minutes, end_minutes,
--                  slot_mode, capacity, split_minutes, note }],
--      same_day_stock: [{ item_name, quantity }] }]
-- day_offset counts days from the first pickup day the club picks when
-- posting; start_minutes/end_minutes are minutes past midnight local time.
alter table public.recurring_templates add column if not exists pickup_config jsonb
  not null default '[]'::jsonb;

comment on column public.recurring_templates.pickup_config is
  'Pickup spots, windows and same-day counts as relative shape, not dates (060). '
  'Posting from the template asks for the first pickup day and rebuilds real '
  'timestamps from day_offset + start_minutes/end_minutes.';

-- ===========================================================================
-- 8. Read paths carry the windows
-- ===========================================================================

-- A listing's spots with their windows, shared by the order and group payloads
-- below so both show a buyer the same thing.
create or replace function public.listing_spots_json(p_listing_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'id', s.id,
        'order_type', s.order_type,
        'available_start', s.available_start,
        'available_end', s.available_end,
        'hours_note', s.hours_note,
        'location_name', cl.name,
        'latitude', cl.latitude,
        'longitude', cl.longitude,
        'windows', public.spot_windows_json(s.id)
      )
      order by cl.name
    ),
    '[]'::jsonb
  )
  from public.listing_pickup_spots s
  join public.campus_locations cl on cl.id = s.location_id
  where s.listing_id = p_listing_id;
$$;

grant execute on function public.listing_spots_json(uuid) to anon, authenticated;

-- Same body as 057, with pickup_spots delegated to listing_spots_json (which
-- adds each spot's id and windows) and the buyer's own reserved slot attached.
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
      'pickup_spots', public.listing_spots_json(l.id),
      'my_reservations', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'slot_id', ps.id,
              'start_time', ps.start_time,
              'end_time', ps.end_time,
              'quantity', r.quantity,
              'location_name', rl.name
            )
            order by ps.start_time
          )
          from public.reservations r
          join public.pickup_slots ps on ps.id = r.slot_id
          left join public.campus_locations rl on rl.id = ps.location_id
          where ps.listing_id = l.id
            and lower(r.user_email) = lower(o.orderer_email)
        ),
        '[]'::jsonb
      ),
      'club_name', c.name,
      'contact_email', coalesce(l.contact_email, c.listing_contact_email, c.email),
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
  where auth.uid() is not null
    and (o.user_id = auth.uid() or lower(o.orderer_email) = any (public.current_user_emails()))
  order by o.created_at desc;
$$;

revoke execute on function public.get_my_orders(text) from public, anon;
grant execute on function public.get_my_orders(text) to authenticated;

-- group_payload (048, extended by 056). Reproduced from 056 with two changes:
-- pickup_spots now comes from listing_spots_json (spot id + windows), and the
-- contact email falls back through the club's default. Every wrapper RPC
-- spreads this output, so all four callers pick the change up, get_group_by_token
-- (anon) included. Not executable directly - the wrappers are SECURITY DEFINER.
create or replace function public.group_payload(p_group_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select to_jsonb(g)
    || jsonb_build_object(
      'listing_title', l.title,
      'brand', l.brand,
      'listing_active', l.active,
      'pickup_info', l.pickup_info,
      'expires_at', l.expires_at,
      'location_name', cl.name,
      'pickup_spots', public.listing_spots_json(l.id),
      'contact_email', coalesce(l.contact_email, c.listing_contact_email, c.email),
      'club_name', c.name,
      'club_venmo', c.venmo,
      'club_zelle', c.zelle_phone,
      'share_amount', round(g.item_price / greatest(g.total_people, 1), 2),
      'units_per_person', floor(greatest(g.item_quantity, 1) / greatest(g.total_people, 1)),
      'recommender_enabled', coalesce(l.recommender_enabled, false),
      'member_options', coalesce(c.member_options, '{}'),
      'open_token', (
        select i.invite_link_token from public.order_group_invitations i
        where i.group_id = g.id and i.invited_email is null
        limit 1
      ),
      'members', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', m.id,
              'user_id', m.user_id,
              'name',
                case
                  when coalesce(u.first_name, '') = '' then 'Student'
                  else u.first_name || case when coalesce(u.last_name, '') = '' then '' else ' ' || left(u.last_name, 1) end
                end,
              'status', m.status,
              'scanned_at', m.scanned_at,
              'is_creator', m.user_id = g.created_by,
              'payment_method', m.payment_method,
              'payment_handle', m.payment_handle,
              'recommended_by', m.recommended_by
            )
            order by m.created_at
          )
          from public.order_group_members m
          left join public.users_extended u on u.id = m.user_id
          where m.group_id = g.id
        ),
        '[]'::jsonb
      )
    )
  from public.order_groups g
  join public.listings l on l.id = g.listing_id
  join public.clubs c on c.id = l.club_id
  left join public.campus_locations cl on cl.id = l.pickup_location_id
  where g.id = p_group_id;
$$;

revoke execute on function public.group_payload(uuid) from public, anon, authenticated;

-- ===========================================================================
-- 9. Club-side export feed
-- ===========================================================================
--
-- The CSV needs pickup context per order (which table, which date, which
-- booked slot) and that is three joins the client would otherwise do by hand
-- against tables it can only partly see. One RPC, club-scoped.
create or replace function public.get_club_order_pickup(p_listing_ids uuid[])
returns table (
  order_id uuid,
  spot_name text,
  spot_order_type text,
  reserved_start timestamptz,
  reserved_end timestamptz,
  reserved_location text,
  reserved_quantity int
)
language sql
stable
security definer
set search_path = public
as $$
  select
    o.id,
    spot_loc.name,
    s.order_type,
    ps.start_time,
    ps.end_time,
    slot_loc.name,
    r.quantity
  from public.orders o
  join public.listings l on l.id = o.listing_id
  left join public.listing_pickup_spots s on s.id = o.pickup_spot_id
  left join public.campus_locations spot_loc on spot_loc.id = s.location_id
  left join public.reservations r
    on lower(r.user_email) = lower(o.orderer_email)
   and exists (
     select 1 from public.pickup_slots x
     where x.id = r.slot_id and x.listing_id = o.listing_id
   )
  left join public.pickup_slots ps on ps.id = r.slot_id
  left join public.campus_locations slot_loc on slot_loc.id = ps.location_id
  where o.listing_id = any (p_listing_ids)
    and (l.club_id = auth.uid() or public.is_admin());
$$;

revoke execute on function public.get_club_order_pickup(uuid[]) from public, anon;
grant execute on function public.get_club_order_pickup(uuid[]) to authenticated;
