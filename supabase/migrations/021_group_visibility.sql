-- Cornell Craves: private vs public split groups (Tranche 4 #6).
--
-- private (default): only the creator + people they (or any member) invite by
--   email may join. No open share link.
-- public: anyone can fill an open spot. Has an open share link, and solo
--   students auto-match into the earliest open public group for the same item
--   and split size, or start a fresh one.
-- The fill -> full -> payment-unlock flow and "passes only once everyone pays"
-- rule from Tranche 3 are reused unchanged.

alter table public.order_groups
  add column if not exists visibility text not null default 'private'
  check (visibility in ('private', 'public'));

-- create_order_group gains a visibility argument. Drop the old 4-arg signature
-- first so there is no overload ambiguity (per the create_order guidance).
drop function if exists public.create_order_group(uuid, text, int, text[]);

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
  v_item jsonb;
  v_price numeric;
  v_group_id uuid;
  v_open_token text;
  v_email text;
begin
  if auth.uid() is null then
    raise exception 'Sign in with Google to start a split order';
  end if;
  if p_split_type < 2 or p_split_type > 4 then
    raise exception 'Split between 2 and 4 people';
  end if;
  if p_visibility not in ('private', 'public') then
    raise exception 'Group must be private or public';
  end if;

  select * into v_listing from public.listings where id = p_listing_id;
  if not found or not v_listing.active or v_listing.expires_at <= now() then
    raise exception 'This listing is not taking orders';
  end if;

  select item into v_item
  from jsonb_array_elements(v_listing.items) as item
  where item ->> 'name' = p_item_name
  limit 1;
  if v_item is null then
    raise exception 'Unknown item: %', p_item_name;
  end if;
  v_price := coalesce(nullif(v_item ->> 'price', '')::numeric, 0);

  insert into public.order_groups (
    listing_id, item_name, item_price, split_type, total_people,
    filled_count, deadline, created_by, visibility
  )
  values (
    p_listing_id, p_item_name, v_price, p_split_type, p_split_type,
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

  -- Targeted email invites, each with its own token (emailed via webhook).
  foreach v_email in array coalesce(p_invited_emails, '{}') loop
    if trim(v_email) <> '' then
      insert into public.order_group_invitations (group_id, invited_email, invited_by_user_id, invite_link_token)
      values (v_group_id, lower(trim(v_email)), auth.uid(), public.generate_invite_token());
    end if;
  end loop;

  return jsonb_build_object('group_id', v_group_id, 'open_token', v_open_token);
end;
$$;

grant execute on function public.create_order_group(uuid, text, int, text[], text) to authenticated;

-- accept_group_invite: an open (null-email) link only works for public groups.
create or replace function public.accept_group_invite(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.order_group_invitations%rowtype;
  v_group public.order_groups%rowtype;
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
    return v_group.id; -- already in, idempotent
  end if;
  if v_group.filled_count >= v_group.total_people then
    raise exception 'This group is already full';
  end if;

  insert into public.order_group_members (group_id, user_id, status)
  values (v_group.id, auth.uid(), 'accepted');

  if v_invite.invited_email is not null then
    update public.order_group_invitations set status = 'accepted' where id = v_invite.id;
  end if;

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

  return v_group.id;
end;
$$;

-- Any current member of a filling group can add targeted email invites.
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

  foreach v_email in array coalesce(p_emails, '{}') loop
    if trim(v_email) <> '' then
      insert into public.order_group_invitations (group_id, invited_email, invited_by_user_id, invite_link_token)
      values (p_group_id, lower(trim(v_email)), auth.uid(), public.generate_invite_token());
    end if;
  end loop;
end;
$$;

-- Solo path: match into the earliest open public group for the same item AND
-- split size, or create a fresh public group. The candidate is locked so two
-- solos cannot race into the last open spot.
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
  v_item jsonb;
  v_price numeric;
  v_group public.order_groups%rowtype;
  v_group_id uuid;
  v_open_token text;
begin
  if auth.uid() is null then
    raise exception 'Sign in with Google to join a split order';
  end if;
  if p_total_people < 2 or p_total_people > 4 then
    raise exception 'Split between 2 and 4 people';
  end if;

  select * into v_listing from public.listings where id = p_listing_id;
  if not found or not v_listing.active or v_listing.expires_at <= now() then
    raise exception 'This listing is not taking orders';
  end if;
  select item into v_item
  from jsonb_array_elements(v_listing.items) as item
  where item ->> 'name' = p_item
  limit 1;
  if v_item is null then
    raise exception 'Unknown item: %', p_item;
  end if;
  v_price := coalesce(nullif(v_item ->> 'price', '')::numeric, 0);

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
    listing_id, item_name, item_price, split_type, total_people,
    filled_count, deadline, created_by, visibility
  )
  values (
    p_listing_id, p_item, v_price, p_total_people, p_total_people,
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

revoke execute on function public.invite_to_group(uuid, text[]) from public, anon;
revoke execute on function public.join_or_create_public_group(uuid, text, int) from public, anon;
grant execute on function public.invite_to_group(uuid, text[]) to authenticated;
grant execute on function public.join_or_create_public_group(uuid, text, int) to authenticated;
