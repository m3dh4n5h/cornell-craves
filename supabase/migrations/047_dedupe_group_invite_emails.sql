-- Cornell Craves 047: de-duplicate split-order invite emails.
--
-- Neither create_order_group nor invite_to_group deduped the email list they
-- were handed, so a copy-pasted duplicate (or the same friend invited twice
-- across separate "Invite" calls) inserted two separate
-- order_group_invitations rows with two different tokens for the same
-- person. Accepting either link was already safe (accept_group_invite is
-- idempotent on group_id + user_id), so this was never a double-seat or
-- security bug -- just redundant rows, and a friend who could get invited
-- twice.
--
-- Both functions now:
--   * normalize (trim + lowercase) and de-duplicate the incoming array
--     itself, so one submission can't create two rows for the same address.
--   * invite_to_group additionally skips anyone who already has a live
--     (pending or accepted) invitation to that group, since it can be called
--     repeatedly over the group's life. A previously *declined* invite is
--     treated as spent, so a fresh invite is still allowed.
--
-- Run after 044_split_deadlines_and_acknowledgments.sql. Idempotent: safe to
-- re-run.

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

  -- Distinct, normalized, non-blank emails only: a copy-pasted duplicate in
  -- the invite box should not create two separate invitation rows/tokens.
  for v_email in
    select distinct lower(trim(e))
    from unnest(coalesce(p_invited_emails, '{}')) as e
    where trim(e) <> ''
  loop
    insert into public.order_group_invitations (group_id, invited_email, invited_by_user_id, invite_link_token)
    values (v_group_id, v_email, auth.uid(), public.generate_invite_token());
  end loop;

  return jsonb_build_object('group_id', v_group_id, 'open_token', v_open_token);
end;
$$;

create or replace function public.invite_to_group(p_group_id uuid, p_emails text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.order_groups%rowtype;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'Sign in to invite people';
  end if;
  select * into v_group from public.order_groups where id = p_group_id;
  if not found then
    raise exception 'Group not found';
  end if;
  if v_group.status <> 'filling' then
    raise exception 'This group is no longer accepting members';
  end if;
  if not exists (
    select 1 from public.order_group_members m
    where m.group_id = p_group_id and m.user_id = auth.uid()
  ) then
    raise exception 'Only members of the group can invite others';
  end if;

  for v_email in
    select distinct lower(trim(e))
    from unnest(coalesce(p_emails, '{}')) as e
    where trim(e) <> ''
  loop
    -- Skip anyone with a still-live invitation to this group. A declined
    -- invite is spent, so a fresh one is still allowed.
    if not exists (
      select 1 from public.order_group_invitations
      where group_id = p_group_id
        and invited_email = v_email
        and status <> 'declined'
    ) then
      insert into public.order_group_invitations (group_id, invited_email, invited_by_user_id, invite_link_token)
      values (p_group_id, v_email, auth.uid(), public.generate_invite_token());
    end if;
  end loop;
end;
$$;
