-- Cornell Craves 050: automate split-order deadline processing, and stop a
-- join from landing on a group past its order deadline.
--
-- 044_split_deadlines_and_acknowledgments.sql added process_group_deadlines()
-- to open payment windows and auto-cancel unfilled/unpaid groups, but nothing
-- in this repo ever calls it - the only scheduling instructions live in the
-- gitignored NEXT_STEPS.md, wired through an HTTP call to the edge function
-- with a hand-pasted service_role key (a secret, so it could not live in a
-- committed migration). If that manual, per-deployment step is skipped, or
-- lost when the project is recreated, two of the promises shown to students
-- and clubs before they use splitting are false: "the group cancels
-- automatically" and "you have 24 hours to pay" both require a human to run
-- the RPC by hand instead.
--
-- This schedules process_group_deadlines() directly via pg_cron, in-database,
-- with no HTTP hop and no secret to embed. It still fires the order_groups
-- "Update" database webhook from NEXT_STEPS.md step 6 (that trigger is on the
-- table, not on who changed the row), so members still get emailed on status
-- changes. If you already set up the auto-cancel-groups HTTP cron from
-- NEXT_STEPS.md, this runs alongside it harmlessly (the RPC only matches rows
-- already past their deadline, so a second run in the same hour just matches
-- zero rows) - you can retire the old one once this is confirmed working:
--   select cron.unschedule('auto-cancel-groups');
--
-- Separately: accept_group_invite() and join_or_create_public_group() only
-- checked a group's status ('filling'), never its order_deadline, when
-- deciding whether someone could still join. Since the deadline was only ever
-- enforced by the job above, a friend could join a "filling" group through an
-- invite link (or the public match-or-create path) after its order deadline
-- passed, as long as this job hadn't swept it yet - contradicting "a group
-- must fill by your drop's order deadline or it cancels automatically." Both
-- now also refuse a filling group whose order_deadline has passed, so nobody
-- can join in that gap regardless of whether the cron job above has run yet.
-- (accept_group_invite cannot ALSO flip the row to canceled in that same
-- call: it rejects by raising an exception, and Postgres rolls back every
-- change a statement made before the exception that aborted it - so an
-- update immediately followed by a raise never persists. The row is still
-- correctly marked canceled the next time the job above runs; this guard
-- only needs to stop the join, which raising alone already does.)
--
-- Run after 049_scope_custom_locations. Idempotent: safe to re-run
-- (cron.schedule upserts by job name; the two functions are plain
-- create-or-replace).

-- Guarded: pg_cron is a hosted-Postgres extension not every environment can
-- install (e.g. it does not exist in the PGlite instance supabase/tests runs
-- migrations against). On real Supabase this succeeds silently; anywhere else
-- it logs a notice and the rest of this migration (the two function fixes
-- below) still applies. If it does not take on your Supabase project, enable
-- "pg_cron" under Database > Extensions in the dashboard, then re-run this
-- migration.
do $$
begin
  create extension if not exists pg_cron;
exception
  when others then
    raise notice 'pg_cron unavailable (%), skipping automatic scheduling', sqlerrm;
end $$;

do $$
begin
  perform cron.schedule(
    'process-group-deadlines',
    '0 * * * *',
    $cron$select public.process_group_deadlines();$cron$
  );
exception
  when others then
    raise notice 'Could not schedule process-group-deadlines (%); pg_cron may not be enabled', sqlerrm;
end $$;

-- ===================== accept_group_invite: reject/cancel past the order deadline =====================

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

  -- A "filling" group whose order deadline has already passed should have
  -- been canceled by process_group_deadlines; reject the join here too, so
  -- nobody can join in the gap before that job next runs. (This can only
  -- reject, not also flip the row to canceled: raising an exception rolls
  -- back any update made earlier in this same call. The job above is what
  -- actually marks it canceled, on its next run.)
  if v_group.status = 'filling' and v_group.order_deadline <= now() then
    raise exception 'This group''s order deadline has passed and it is no longer accepting members';
  end if;

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

-- ===================== join_or_create_public_group: never match an expired group =====================

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
    and g.order_deadline > now()
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
