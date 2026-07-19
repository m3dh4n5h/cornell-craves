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
