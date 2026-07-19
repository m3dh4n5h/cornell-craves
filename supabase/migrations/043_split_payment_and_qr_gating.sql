-- Cornell Craves: split-order payment visibility + QR gating (user-reported batch).
-- Run AFTER 042_admin_email_registry.sql.
--
-- What this fixes:
--   1. Split members can now individually say HOW they are paying (Venmo or
--      Zelle) and with WHICH handle, so the club can match incoming payments
--      per person (new columns + set_group_member_payment RPC).
--   2. group_payload exposes each member's payment method + handle to whoever
--      can already see the group (the club dashboard renders it next to the
--      "Verify share" button).
--   3. get_my_groups no longer leaks a member's QR token or 10-char pickup
--      code before the WHOLE group is verified. Both are returned only once
--      group.status = 'paid', matching the email behavior ("passes go out only
--      once everyone has paid"). The pickup code was previously never returned
--      at all, which is why split members saw no 10-character code.
--   4. Split orders now support the "which member recommended you?" capture:
--      recommended_by lives on the group, set by the creator via
--      set_group_recommender (mirrors set_order_recommender for solo orders).
--   5. Restores the creation guards migration 021 accidentally dropped when it
--      rewrote create_order_group / join_or_create_public_group for visibility:
--      the 2..4 people cap came back (the UI offers ANY divisor of the box,
--      e.g. 6 or 12 for a dozen -> those creates failed), the even-division
--      check vanished (a quantity-1 item could be "split"), the club's
--      groups_enabled toggle was ignored, and item_quantity was no longer
--      snapshotted (so units_per_person rendered as 0 on every group created
--      since 021). Guarded by supabase/tests/split-edge.mjs.
--
-- Idempotent: safe to re-run.

-- ===================== Columns =====================

alter table public.order_group_members
  add column if not exists payment_method text
  check (payment_method in ('venmo', 'zelle'));

alter table public.order_group_members
  add column if not exists payment_handle text;

alter table public.order_groups
  add column if not exists recommended_by text;

-- ===================== Member payment RPC =====================

-- A member declares how they will pay their share. Locked once the club has
-- verified them (the club already matched a real payment to these details).
create or replace function public.set_group_member_payment(
  p_group_id uuid,
  p_method text,
  p_handle text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member public.order_group_members%rowtype;
  v_status text;
  v_handle text := nullif(btrim(coalesce(p_handle, '')), '');
begin
  if auth.uid() is null then
    raise exception 'Sign in to set your payment method';
  end if;
  if p_method not in ('venmo', 'zelle') then
    raise exception 'Pay with Venmo or Zelle';
  end if;
  if v_handle is null then
    raise exception 'Enter your % handle so the club can match your payment',
      case when p_method = 'venmo' then 'Venmo' else 'Zelle' end;
  end if;

  select m.* into v_member
  from public.order_group_members m
  where m.group_id = p_group_id and m.user_id = auth.uid();
  if not found then
    raise exception 'You are not a member of this group';
  end if;
  if v_member.status = 'paid' then
    raise exception 'Your share is already verified; payment details are locked';
  end if;

  select g.status into v_status from public.order_groups g where g.id = p_group_id;
  if v_status in ('canceled', 'paid') then
    raise exception 'This group is not accepting payment updates';
  end if;

  update public.order_group_members
  set payment_method = p_method,
      payment_handle = v_handle
  where id = v_member.id;
end;
$$;

revoke execute on function public.set_group_member_payment(uuid, text, text) from public, anon;
grant execute on function public.set_group_member_payment(uuid, text, text) to authenticated;

-- ===================== Group recommender RPC =====================

-- Mirrors set_order_recommender: only the group creator, only when the listing
-- asks for it, value must be on the club's member list. Blank clears.
create or replace function public.set_group_recommender(p_group_id uuid, p_value text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.order_groups%rowtype;
  v_enabled boolean;
  v_options text[];
  v_value text := nullif(btrim(coalesce(p_value, '')), '');
begin
  select * into v_group from public.order_groups where id = p_group_id;
  if not found then
    raise exception 'Group not found';
  end if;
  if v_group.created_by is distinct from auth.uid() then
    raise exception 'Only the group creator can set the recommender';
  end if;

  select l.recommender_enabled, c.member_options
    into v_enabled, v_options
  from public.listings l
  join public.clubs c on c.id = l.club_id
  where l.id = v_group.listing_id;

  if not coalesce(v_enabled, false) then
    raise exception 'This listing is not asking for a recommender';
  end if;
  if v_value is not null and not (v_value = any (coalesce(v_options, '{}'))) then
    raise exception 'That recommender is not on the club''s list';
  end if;

  update public.order_groups set recommended_by = v_value where id = p_group_id;
end;
$$;

revoke execute on function public.set_group_recommender(uuid, text) from public, anon;
grant execute on function public.set_group_recommender(uuid, text) to authenticated;

-- ===================== group_payload: member payment info =====================

-- Latest authoritative version (supersedes 009). Adds payment_method and
-- payment_handle per member; recommended_by rides along via to_jsonb(g).
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
      'club_name', c.name,
      'club_venmo', c.venmo,
      'club_zelle', c.zelle_phone,
      'share_amount', round(g.item_price / greatest(g.total_people, 1), 2),
      'units_per_person', floor(greatest(g.item_quantity, 1) / greatest(g.total_people, 1)),
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
              'payment_handle', m.payment_handle
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
  where g.id = p_group_id;
$$;

-- ===================== get_my_groups: gate the pass, expose the code =====================

-- The QR token and pickup code exist per member as soon as the club verifies
-- THAT member, but they must not be usable/visible until the whole group is
-- verified (status = 'paid'). Gate both here so no client can jump the queue.
create or replace function public.get_my_groups()
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.group_payload(m.group_id)
    || jsonb_build_object(
      'my_status', m.status,
      'my_member_id', m.id,
      'my_qr', case when g.status = 'paid' then m.qr_encrypted else '' end,
      'my_pickup_code', case when g.status = 'paid' then m.pickup_code else null end
    )
  from public.order_group_members m
  join public.order_groups g on g.id = m.group_id
  where m.user_id = auth.uid()
  order by g.created_at desc;
$$;

grant execute on function public.get_my_groups() to authenticated;

-- ===================== Restore creation guards lost in 021 =====================

-- Final authoritative create_order_group: 021's visibility behavior PLUS 009's
-- guarantees (groups toggle, even division, quantity snapshot, divisor sizes).
create or replace function public.create_order_group(
  p_listing_id uuid,
  p_item_name text,
  p_split_type int,
  p_invited_emails text[] default '{}',
  p_visibility text default 'private'
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
begin
  if auth.uid() is null then
    raise exception 'Sign in with Google to start a split order';
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
    filled_count, deadline, created_by, visibility
  )
  values (
    p_listing_id, p_item_name, v_price, v_qty, p_split_type, p_split_type,
    1, now() + interval '48 hours', auth.uid(), p_visibility
  )
  returning id into v_group_id;

  insert into public.order_group_members (group_id, user_id, status)
  values (v_group_id, auth.uid(), 'accepted');

  -- The open share link exists only for public groups.
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

revoke execute on function public.create_order_group(uuid, text, int, text[], text) from public, anon;
grant execute on function public.create_order_group(uuid, text, int, text[], text) to authenticated;

-- Same restoration for the solo "join an open group" path.
create or replace function public.join_or_create_public_group(
  p_listing_id uuid,
  p_item text,
  p_total_people int
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
begin
  if auth.uid() is null then
    raise exception 'Sign in with Google to join a split order';
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
    insert into public.order_group_members (group_id, user_id, status)
    values (v_group.id, auth.uid(), 'accepted');
    if v_group.filled_count + 1 >= v_group.total_people then
      update public.order_groups
      set filled_count = filled_count + 1,
          status = 'full',
          deadline = now() + interval '24 hours'
      where id = v_group.id;
      update public.order_group_members
      set status = 'pending_payment'
      where group_id = v_group.id and status in ('accepted', 'invited');
    else
      update public.order_groups set filled_count = filled_count + 1 where id = v_group.id;
    end if;
    return jsonb_build_object('group_id', v_group.id, 'joined', true);
  end if;

  -- No open group: start a fresh public one with the caller as first member.
  v_open_token := public.generate_invite_token();
  insert into public.order_groups (
    listing_id, item_name, item_price, item_quantity, split_type, total_people,
    filled_count, deadline, created_by, visibility
  )
  values (
    p_listing_id, p_item, v_price, v_qty, p_total_people, p_total_people,
    1, now() + interval '48 hours', auth.uid(), 'public'
  )
  returning id into v_group_id;

  insert into public.order_group_members (group_id, user_id, status)
  values (v_group_id, auth.uid(), 'accepted');
  insert into public.order_group_invitations (group_id, invited_email, invited_by_user_id, invite_link_token)
  values (v_group_id, null, auth.uid(), v_open_token);

  return jsonb_build_object('group_id', v_group_id, 'open_token', v_open_token, 'joined', false);
end;
$$;

revoke execute on function public.join_or_create_public_group(uuid, text, int) from public, anon;
grant execute on function public.join_or_create_public_group(uuid, text, int) to authenticated;

-- Backfill: groups created since 021 carry the default item_quantity = 1, so
-- units_per_person rendered as 0. Re-snapshot from the listing where possible.
update public.order_groups g
set item_quantity = greatest(coalesce(nullif(item.value ->> 'quantity', '')::int, 1), 1)
from public.listings l,
     lateral jsonb_array_elements(l.items) as item(value)
where l.id = g.listing_id
  and item.value ->> 'name' = g.item_name
  and g.item_quantity = 1;
