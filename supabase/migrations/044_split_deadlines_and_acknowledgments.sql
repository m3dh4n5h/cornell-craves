-- Cornell Craves: split-order deadline model + acknowledgments (user batch 2).
-- Run AFTER 043_split_payment_and_qr_gating.sql.
--
-- New deadline model (replaces "24h from the moment a group fills"):
--
--   filling  A group takes members until its ORDER deadline (order_deadline,
--            defaulted to the drop's own end time, extendable by the club).
--            If it has not filled by then, it CANCELS unless the club extended.
--   full     Every spot is taken but the drop is still taking orders. Nobody
--            owes anything yet. The 24h payment clock has NOT started.
--   payment_in_progress
--            The drop's order deadline has passed (the club stopped accepting
--            orders) OR the club opened payment early. Members now have 24 hours
--            from that moment to pay. Passes release only when everyone is
--            verified (unchanged from 043).
--   reactivated
--            The club reopened a canceled group. If it had filled, payment
--            reopens for 24h; if it never filled, it goes back to filling.
--   paid / canceled  terminal.
--
-- All deadlines are timestamptz instants advanced by fixed intervals, so a 24h
-- window is 24 real hours regardless of the EST/EDT change; the UI renders them
-- in America/New_York.
--
-- Acknowledgments (liability): students accept the split rules every time they
-- start or join a split (saved per membership); clubs accept how splitting
-- works every time they turn the feature on (saved on the club with the rules
-- version, so a future rules change re-prompts). Versions are opaque strings
-- chosen by the app.
--
-- Idempotent: safe to re-run.

-- ===================== Columns =====================

alter table public.order_groups
  add column if not exists order_deadline timestamptz;

-- Backfill: existing groups treat their current deadline as the order deadline.
update public.order_groups
set order_deadline = coalesce(order_deadline, deadline);

alter table public.order_group_members
  add column if not exists acknowledged_at timestamptz;
alter table public.order_group_members
  add column if not exists acknowledged_rules_version text;

alter table public.clubs
  add column if not exists split_ack_at timestamptz;
alter table public.clubs
  add column if not exists split_ack_version text;

-- ===================== Drop superseded signatures =====================
-- create-or-replace cannot change an argument list; it makes a NEW overload and
-- leaves the old one callable. The pre-044 versions had no acknowledgment
-- argument, so a caller could invoke them and skip the rules gate. Drop them so
-- only the acknowledged versions below exist.
drop function if exists public.create_order_group(uuid, text, int, text[], text);
drop function if exists public.create_order_group(uuid, text, int, text[]);
drop function if exists public.accept_group_invite(text);
drop function if exists public.join_or_create_public_group(uuid, text, int);

-- ===================== Club: enable/disable splitting with acknowledgment =====================

-- The club turns group ordering on or off. Turning it ON requires acknowledging
-- how splitting works (a fresh acknowledgment every enable, and whenever the
-- rules version changes). Turning it OFF needs no acknowledgment.
create or replace function public.set_club_groups_enabled(
  p_enabled boolean,
  p_ack_version text default null
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ack text := nullif(btrim(coalesce(p_ack_version, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Sign in as your club to change this';
  end if;
  if not exists (select 1 from public.clubs where id = auth.uid()) then
    raise exception 'Only a club can change group ordering';
  end if;

  if p_enabled then
    if v_ack is null then
      raise exception 'Acknowledge how splitting works to turn it on';
    end if;
    update public.clubs
    set groups_enabled = true,
        split_ack_at = now(),
        split_ack_version = v_ack
    where id = auth.uid();
  else
    update public.clubs set groups_enabled = false where id = auth.uid();
  end if;
end;
$$;

revoke execute on function public.set_club_groups_enabled(boolean, text) from public, anon;
grant execute on function public.set_club_groups_enabled(boolean, text) to authenticated;

-- ===================== Create / join: require the student acknowledgment =====================

-- create_order_group: filling, order_deadline defaults to the drop's end time,
-- and the creating member records their rules acknowledgment.
create or replace function public.create_order_group(
  p_listing_id uuid,
  p_item_name text,
  p_split_type int,
  p_invited_emails text[] default '{}',
  p_visibility text default 'private',
  p_ack_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing public.listings%rowtype;
  v_groups_enabled boolean;
  v_item jsonb;
  v_price numeric;
  v_qty int;
  v_group_id uuid;
  v_open_token text;
  v_email text;
  v_ack text := nullif(btrim(coalesce(p_ack_version, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Sign in with Google to start a split order';
  end if;
  if v_ack is null then
    raise exception 'Accept the split rules to start a split order';
  end if;
  if p_split_type < 2 or p_split_type > 50 then
    raise exception 'Split with 2 to 50 people';
  end if;
  if p_visibility not in ('private', 'public') then
    raise exception 'Group must be private or public';
  end if;

  select * into v_listing from public.listings where id = p_listing_id;
  if not found or not v_listing.active or v_listing.expires_at <= now() then
    raise exception 'This listing is not taking orders';
  end if;

  select groups_enabled into v_groups_enabled from public.clubs where id = v_listing.club_id;
  if not coalesce(v_groups_enabled, true) then
    raise exception 'This club has turned off group ordering';
  end if;

  select item into v_item
  from jsonb_array_elements(v_listing.items) as item
  where item ->> 'name' = p_item_name
  limit 1;
  if v_item is null then
    raise exception 'Unknown item: %', p_item_name;
  end if;
  v_price := coalesce(nullif(v_item ->> 'price', '')::numeric, 0);
  v_qty := greatest(coalesce(nullif(v_item ->> 'quantity', '')::int, 1), 1);

  if v_qty % p_split_type <> 0 then
    raise exception '% (% in a box) cannot be split evenly % ways', p_item_name, v_qty, p_split_type;
  end if;

  insert into public.order_groups (
    listing_id, item_name, item_price, item_quantity, split_type, total_people,
    filled_count, deadline, order_deadline, created_by, visibility
  )
  values (
    p_listing_id, p_item_name, v_price, v_qty, p_split_type, p_split_type,
    1, v_listing.expires_at, v_listing.expires_at, auth.uid(), p_visibility
  )
  returning id into v_group_id;

  insert into public.order_group_members (group_id, user_id, status, acknowledged_at, acknowledged_rules_version)
  values (v_group_id, auth.uid(), 'accepted', now(), v_ack);

  if p_visibility = 'public' then
    v_open_token := public.generate_invite_token();
    insert into public.order_group_invitations (group_id, invited_email, invited_by_user_id, invite_link_token)
    values (v_group_id, null, auth.uid(), v_open_token);
  end if;

  foreach v_email in array coalesce(p_invited_emails, '{}') loop
    if trim(v_email) <> '' then
      insert into public.order_group_invitations (group_id, invited_email, invited_by_user_id, invite_link_token)
      values (v_group_id, lower(trim(v_email)), auth.uid(), public.generate_invite_token());
    end if;
  end loop;

  return jsonb_build_object('group_id', v_group_id, 'open_token', v_open_token);
end;
$$;

revoke execute on function public.create_order_group(uuid, text, int, text[], text, text) from public, anon;
grant execute on function public.create_order_group(uuid, text, int, text[], text, text) to authenticated;

-- accept_group_invite: requires acknowledgment; on the fill that completes the
-- group it becomes 'full' but does NOT start the payment clock (that waits for
-- the order deadline). Members stay 'accepted' until payment opens.
create or replace function public.accept_group_invite(p_token text, p_ack_version text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.order_group_invitations%rowtype;
  v_group public.order_groups%rowtype;
  v_ack text := nullif(btrim(coalesce(p_ack_version, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Sign in with Google to join a split order';
  end if;

  select * into v_invite from public.order_group_invitations
  where invite_link_token = trim(p_token);
  if not found or v_invite.status = 'declined' then
    raise exception 'This invite link is not valid';
  end if;

  select * into v_group from public.order_groups where id = v_invite.group_id for update;
  if v_group.status not in ('filling') then
    raise exception 'This group is no longer accepting members';
  end if;
  if v_invite.invited_email is null and v_group.visibility <> 'public' then
    raise exception 'This group is invite-only';
  end if;
  if exists (select 1 from public.order_group_members where group_id = v_group.id and user_id = auth.uid()) then
    return v_group.id; -- already in, idempotent (no re-acknowledgment needed)
  end if;
  if v_ack is null then
    raise exception 'Accept the split rules to join a split order';
  end if;
  if v_group.filled_count >= v_group.total_people then
    raise exception 'This group is already full';
  end if;

  insert into public.order_group_members (group_id, user_id, status, acknowledged_at, acknowledged_rules_version)
  values (v_group.id, auth.uid(), 'accepted', now(), v_ack);

  if v_invite.invited_email is not null then
    update public.order_group_invitations set status = 'accepted' where id = v_invite.id;
  end if;

  if v_group.filled_count + 1 >= v_group.total_people then
    -- Full, but payment does not open until the order deadline passes. Keep the
    -- deadline on the order_deadline; members remain 'accepted' (owe nothing yet).
    update public.order_groups
    set filled_count = filled_count + 1,
        status = 'full'
    where id = v_group.id;
  else
    update public.order_groups set filled_count = filled_count + 1 where id = v_group.id;
  end if;

  return v_group.id;
end;
$$;

revoke execute on function public.accept_group_invite(text, text) from public, anon;
grant execute on function public.accept_group_invite(text, text) to authenticated;

-- join_or_create_public_group: same acknowledgment + fill semantics.
create or replace function public.join_or_create_public_group(
  p_listing_id uuid,
  p_item text,
  p_total_people int,
  p_ack_version text default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_listing public.listings%rowtype;
  v_groups_enabled boolean;
  v_item jsonb;
  v_price numeric;
  v_qty int;
  v_group public.order_groups%rowtype;
  v_group_id uuid;
  v_open_token text;
  v_ack text := nullif(btrim(coalesce(p_ack_version, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Sign in with Google to join a split order';
  end if;
  if v_ack is null then
    raise exception 'Accept the split rules to join a split order';
  end if;
  if p_total_people < 2 or p_total_people > 50 then
    raise exception 'Split with 2 to 50 people';
  end if;

  select * into v_listing from public.listings where id = p_listing_id;
  if not found or not v_listing.active or v_listing.expires_at <= now() then
    raise exception 'This listing is not taking orders';
  end if;

  select groups_enabled into v_groups_enabled from public.clubs where id = v_listing.club_id;
  if not coalesce(v_groups_enabled, true) then
    raise exception 'This club has turned off group ordering';
  end if;

  select item into v_item
  from jsonb_array_elements(v_listing.items) as item
  where item ->> 'name' = p_item
  limit 1;
  if v_item is null then
    raise exception 'Unknown item: %', p_item;
  end if;
  v_price := coalesce(nullif(v_item ->> 'price', '')::numeric, 0);
  v_qty := greatest(coalesce(nullif(v_item ->> 'quantity', '')::int, 1), 1);

  if v_qty % p_total_people <> 0 then
    raise exception '% (% in a box) cannot be split evenly % ways', p_item, v_qty, p_total_people;
  end if;

  select g.* into v_group
  from public.order_groups g
  where g.listing_id = p_listing_id
    and g.item_name = p_item
    and g.visibility = 'public'
    and g.status = 'filling'
    and g.total_people = p_total_people
    and g.filled_count < g.total_people
    and not exists (
      select 1 from public.order_group_members m
      where m.group_id = g.id and m.user_id = auth.uid()
    )
  order by g.created_at
  for update skip locked
  limit 1;

  if found then
    insert into public.order_group_members (group_id, user_id, status, acknowledged_at, acknowledged_rules_version)
    values (v_group.id, auth.uid(), 'accepted', now(), v_ack);
    if v_group.filled_count + 1 >= v_group.total_people then
      update public.order_groups
      set filled_count = filled_count + 1,
          status = 'full'
      where id = v_group.id;
    else
      update public.order_groups set filled_count = filled_count + 1 where id = v_group.id;
    end if;
    return jsonb_build_object('group_id', v_group.id, 'joined', true);
  end if;

  v_open_token := public.generate_invite_token();
  insert into public.order_groups (
    listing_id, item_name, item_price, item_quantity, split_type, total_people,
    filled_count, deadline, order_deadline, created_by, visibility
  )
  values (
    p_listing_id, p_item, v_price, v_qty, p_total_people, p_total_people,
    1, v_listing.expires_at, v_listing.expires_at, auth.uid(), 'public'
  )
  returning id into v_group_id;

  insert into public.order_group_members (group_id, user_id, status, acknowledged_at, acknowledged_rules_version)
  values (v_group_id, auth.uid(), 'accepted', now(), v_ack);
  insert into public.order_group_invitations (group_id, invited_email, invited_by_user_id, invite_link_token)
  values (v_group_id, null, auth.uid(), v_open_token);

  return jsonb_build_object('group_id', v_group_id, 'open_token', v_open_token, 'joined', false);
end;
$$;

revoke execute on function public.join_or_create_public_group(uuid, text, int, text) from public, anon;
grant execute on function public.join_or_create_public_group(uuid, text, int, text) to authenticated;

-- ===================== System job: deadline processing =====================

-- Called hourly by pg_cron via the edge function (service role). Drives every
-- time-based transition in one place so the rules are consistent and testable:
--   1. full + order deadline passed  -> payment opens (24h from the order
--      deadline); members move to pending_payment.
--   2. filling + order deadline passed and not full -> canceled.
--   3. payable + pay-by passed and not everyone paid -> canceled.
-- Row changes fire the order_groups webhook, which emails the members.
create or replace function public.process_group_deadlines()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opened int := 0;
  v_canceled_fill int := 0;
  v_canceled_pay int := 0;
begin
  -- 1. Open payment for full groups whose order deadline has passed. The 24h
  --    window runs from the order deadline (the moment ordering closed), but
  --    never less than "now + a moment" if the job ran late.
  update public.order_groups
  set status = 'payment_in_progress',
      deadline = greatest(order_deadline, now()) + interval '24 hours'
  where status = 'full'
    and order_deadline <= now();
  get diagnostics v_opened = row_count;

  update public.order_group_members m
  set status = 'pending_payment'
  from public.order_groups g
  where m.group_id = g.id
    and g.status = 'payment_in_progress'
    and m.status in ('accepted', 'invited');

  -- 2. Cancel groups that never filled by their order deadline.
  update public.order_groups
  set status = 'canceled'
  where status = 'filling'
    and order_deadline <= now();
  get diagnostics v_canceled_fill = row_count;

  -- 3. Cancel payable groups whose payment window elapsed with anyone unpaid.
  update public.order_groups g
  set status = 'canceled'
  where g.status in ('payment_in_progress', 'reactivated')
    and g.deadline <= now()
    and exists (
      select 1 from public.order_group_members m
      where m.group_id = g.id and m.status <> 'paid'
    );
  get diagnostics v_canceled_pay = row_count;

  return jsonb_build_object(
    'opened', v_opened,
    'canceled_fill', v_canceled_fill,
    'canceled_pay', v_canceled_pay
  );
end;
$$;

revoke execute on function public.process_group_deadlines() from public, anon, authenticated;
grant execute on function public.process_group_deadlines() to service_role;

-- ===================== Club controls: extend / open payment / reactivate =====================

-- Helper: does the caller own the listing behind this group?
create or replace function public.club_owns_group(p_group_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.order_groups g
    join public.listings l on l.id = g.listing_id
    where g.id = p_group_id and l.club_id = auth.uid()
  );
$$;

-- Extend deadlines for one group or every group on a listing. p_target:
--   'order'   -> push the fill/order deadline (filling + full groups), which
--                delays cancellation and, for full groups, when payment opens.
--   'payment' -> push the pay-by for groups already collecting payment.
create or replace function public.club_extend_deadlines(
  p_target text,
  p_hours int,
  p_group_id uuid default null,
  p_listing_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_changed int := 0;
begin
  if auth.uid() is null then
    raise exception 'Sign in as your club';
  end if;
  if p_target not in ('order', 'payment') then
    raise exception 'Extend the order or the payment deadline';
  end if;
  if p_hours is null or p_hours < 1 or p_hours > 720 then
    raise exception 'Choose between 1 and 720 hours';
  end if;
  if p_group_id is null and p_listing_id is null then
    raise exception 'Pick a group or a listing to extend';
  end if;
  if p_group_id is not null and not public.club_owns_group(p_group_id) then
    raise exception 'You can only manage your own listings'' groups';
  end if;
  if p_listing_id is not null and not exists (
    select 1 from public.listings where id = p_listing_id and club_id = auth.uid()
  ) then
    raise exception 'You can only manage your own listings'' groups';
  end if;

  if p_target = 'order' then
    update public.order_groups g
    set order_deadline = greatest(g.order_deadline, now()) + make_interval(hours => p_hours),
        deadline = greatest(g.order_deadline, now()) + make_interval(hours => p_hours)
    where g.status in ('filling', 'full')
      and (
        (p_group_id is not null and g.id = p_group_id)
        or (p_listing_id is not null and g.listing_id = p_listing_id)
      );
  else
    update public.order_groups g
    set deadline = greatest(g.deadline, now()) + make_interval(hours => p_hours)
    where g.status in ('payment_in_progress', 'reactivated')
      and (
        (p_group_id is not null and g.id = p_group_id)
        or (p_listing_id is not null and g.listing_id = p_listing_id)
      );
  end if;
  get diagnostics v_changed = row_count;
  return jsonb_build_object('changed', v_changed);
end;
$$;

revoke execute on function public.club_extend_deadlines(text, int, uuid, uuid) from public, anon;
grant execute on function public.club_extend_deadlines(text, int, uuid, uuid) to authenticated;

-- Open the 24h payment window now for full groups (the club "stops accepting
-- orders" early), for one group or all full groups on a listing.
create or replace function public.open_group_payment(
  p_group_id uuid default null,
  p_listing_id uuid default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_opened int := 0;
begin
  if auth.uid() is null then
    raise exception 'Sign in as your club';
  end if;
  if p_group_id is null and p_listing_id is null then
    raise exception 'Pick a group or a listing';
  end if;
  if p_group_id is not null and not public.club_owns_group(p_group_id) then
    raise exception 'You can only manage your own listings'' groups';
  end if;
  if p_listing_id is not null and not exists (
    select 1 from public.listings where id = p_listing_id and club_id = auth.uid()
  ) then
    raise exception 'You can only manage your own listings'' groups';
  end if;

  update public.order_groups g
  set status = 'payment_in_progress',
      order_deadline = now(),
      deadline = now() + interval '24 hours'
  where g.status = 'full'
    and (
      (p_group_id is not null and g.id = p_group_id)
      or (p_listing_id is not null and g.listing_id = p_listing_id)
    );
  get diagnostics v_opened = row_count;

  update public.order_group_members m
  set status = 'pending_payment'
  from public.order_groups g
  where m.group_id = g.id
    and g.status = 'payment_in_progress'
    and m.status in ('accepted', 'invited')
    and (
      (p_group_id is not null and g.id = p_group_id)
      or (p_listing_id is not null and g.listing_id = p_listing_id)
    );

  return jsonb_build_object('opened', v_opened);
end;
$$;

revoke execute on function public.open_group_payment(uuid, uuid) from public, anon;
grant execute on function public.open_group_payment(uuid, uuid) to authenticated;

-- Reactivate a canceled group. If it had filled, payment reopens for 24h; if it
-- never filled, it returns to filling with a fresh 48h order window.
create or replace function public.reactivate_group(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.order_groups%rowtype;
  v_mode text;
begin
  if auth.uid() is null then
    raise exception 'Sign in as your club';
  end if;
  if not public.club_owns_group(p_group_id) then
    raise exception 'You can only manage your own listings'' groups';
  end if;
  select * into v_group from public.order_groups where id = p_group_id for update;
  if v_group.status <> 'canceled' then
    raise exception 'Only canceled groups can be reactivated';
  end if;

  if v_group.filled_count >= v_group.total_people then
    v_mode := 'payment';
    update public.order_groups
    set status = 'reactivated',
        order_deadline = now(),
        deadline = now() + interval '24 hours'
    where id = p_group_id;
    update public.order_group_members
    set status = 'pending_payment'
    where group_id = p_group_id and status in ('accepted', 'invited', 'pending_payment');
  else
    v_mode := 'fill';
    update public.order_groups
    set status = 'filling',
        order_deadline = now() + interval '48 hours',
        deadline = now() + interval '48 hours'
    where id = p_group_id;
  end if;

  return jsonb_build_object('mode', v_mode);
end;
$$;

revoke execute on function public.reactivate_group(uuid) from public, anon;
grant execute on function public.reactivate_group(uuid) to authenticated;
