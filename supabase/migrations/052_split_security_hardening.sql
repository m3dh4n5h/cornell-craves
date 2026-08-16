-- Cornell Craves 052: close the gaps found stress-testing the split feature
-- against SPLIT_RULES / CLUB_SPLIT_RULES (src/lib/groups.ts).
--
-- Every fix below was reproduced against a real Postgres before being written,
-- and is guarded going forward by supabase/tests/split-attack.mjs.
--
--  1. CRITICAL - order_groups was directly writable by its creator. The RLS
--     policy "Creators and clubs update groups" (004_order_splitting.sql) let
--     anyone holding created_by = auth.uid() UPDATE their own group row with
--     arbitrary values. The worst chain: once the club verified THAT member,
--     their qr_encrypted/pickup_code exist but are correctly hidden by
--     get_my_groups until group.status = 'paid' - so the creator simply ran
--     `update order_groups set status = 'paid'` and get_my_groups handed them a
--     live pass while other members were still pending_payment. The same policy
--     also allowed repricing (item_price -> 0.01, which is what the club's
--     dashboard renders as each member's share), inflating total_people, and
--     pushing order_deadline past the automatic cancellation. Nothing in the app
--     writes these tables directly - every path is a security-definer RPC (which
--     bypasses RLS as the table owner) or the edge function (service role) - so
--     the write policies are dropped outright rather than narrowed.
--
--  2. CRITICAL - migration 051 stripped payment handles from get_group_by_token,
--     but group_payload() itself kept Postgres's default PUBLIC execute grant and
--     order_groups was readable by anon ("Groups are public" USING (true)). A
--     signed-out caller could therefore enumerate every group - private ones
--     included - and call group_payload(id) directly to read every member's name,
--     status and Venmo/Zelle handle, bypassing 051 entirely. Locks the function
--     and scopes the table's SELECT policy to people already entitled to the row.
--
--  3. decline_group_invite (004) had NO authorization and no revoke from public:
--     a signed-OUT caller holding an invite token could decline it, permanently
--     locking the real invitee out ("This invite link is not valid"). Now only
--     the invited person (or whoever sent it) may decline.
--
--  4. accept_group_invite never checked the listing was still taking orders, and
--     reactivate_group would reopen a never-filled group on a dead drop - so
--     students could join a listing the club had unpublished. Reactivating for
--     PAYMENT is still allowed on an expired listing: that group already filled
--     and those members genuinely owe the club.
--
--  5. invite_to_group had no fan-out cap; one member could push 500 invitation
--     rows into a 3-person group, each firing the invitation webhook (an email
--     cost/abuse vector). Capped per call and per group.
--
--  6. set_group_member_payment accepted a method the club does not actually
--     collect (declaring Zelle to a Venmo-only club). MyOrders.tsx already
--     filters the buttons; this enforces the same rule server-side.
--
--  7. split_automation_health() is a new read-only helper: the whole deadline
--     model (auto-cancel, opening payment) depends on the pg_cron job scheduled
--     in 050, and 050 deliberately swallows a scheduling failure with a NOTICE so
--     it can run on Postgres without pg_cron. That means the job can be silently
--     absent in production while students have agreed to "it cancels
--     automatically". Run `select public.split_automation_health();` after
--     applying this to confirm it is actually scheduled.
--
-- Run after 051_split_payment_hardening. Idempotent: safe to re-run.

-- ===================== 1 + 2. Table access =====================

-- Writes: no client path exists, so nobody gets a direct write. create_order_
-- group / accept_group_invite / the club RPCs are security definer and owned by
-- the table owner, so they are unaffected by the absence of these policies; the
-- edge function uses the service role, which bypasses RLS.
drop policy if exists "Signed-in users create groups" on public.order_groups;
drop policy if exists "Creators and clubs update groups" on public.order_groups;

-- Reads: was USING (true), which let anon enumerate every group (including
-- private ones) and feed those ids to group_payload. Scope it to the people the
-- row is actually about. Client code reads groups through the RPCs, so this
-- policy only backstops direct PostgREST access.
drop policy if exists "Groups are public" on public.order_groups;
drop policy if exists "Group rows are visible to their own people" on public.order_groups;
create policy "Group rows are visible to their own people"
  on public.order_groups for select
  using (
    created_by = auth.uid()
    or exists (
      select 1 from public.order_group_members m
      where m.group_id = id and m.user_id = auth.uid()
    )
    or exists (
      select 1 from public.listings l
      where l.id = listing_id and l.club_id = auth.uid()
    )
  );

-- group_payload() carries every member's payment handle. It is an internal
-- helper for the security-definer RPCs (get_my_groups, get_club_groups,
-- get_group_by_token), each of which already applies its own audience rules;
-- those keep working because a security-definer function calls it as the
-- definer, not as the caller. No client may call it directly.
revoke execute on function public.group_payload(uuid) from public, anon, authenticated;

-- Same treatment for the ownership helper: it is only ever used inside other
-- security-definer functions.
revoke execute on function public.club_owns_group(uuid) from public, anon, authenticated;

-- ===================== 3. decline_group_invite =====================

-- Only the person the invite was addressed to (matched the same way
-- get_my_group_invites matches: profile email or auth email, case-insensitive)
-- or the member who sent it may decline. Open share links (invited_email is
-- null) are not declinable, unchanged.
create or replace function public.decline_group_invite(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.order_group_invitations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Sign in to respond to an invitation';
  end if;

  select * into v_invite from public.order_group_invitations
  where invite_link_token = trim(p_token) and invited_email is not null;
  if not found then
    raise exception 'This invite link is not valid';
  end if;

  if v_invite.invited_by_user_id is distinct from auth.uid()
     and lower(v_invite.invited_email) not in (
       select lower(coalesce(u.cornell_email, '')) from public.users_extended u where u.id = auth.uid()
       union
       select lower(coalesce(au.email, '')) from auth.users au where au.id = auth.uid()
     )
  then
    raise exception 'This invitation was not addressed to you';
  end if;

  update public.order_group_invitations
  set status = 'declined'
  where id = v_invite.id and status = 'pending';
end;
$$;

revoke execute on function public.decline_group_invite(text) from public, anon;
grant execute on function public.decline_group_invite(text) to authenticated;

-- ===================== 4. Joining a drop that is no longer taking orders =====================

-- Supersedes the 050 version. Adds the listing check; every other guard
-- (declined invites, invite-only groups, the order-deadline gate from 050,
-- idempotent re-join, the acknowledgment) is carried over unchanged.
create or replace function public.accept_group_invite(p_token text, p_ack_version text default null)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.order_group_invitations%rowtype;
  v_group public.order_groups%rowtype;
  v_listing_active boolean;
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

  -- A "filling" group whose order deadline has already passed should have been
  -- canceled by process_group_deadlines; reject the join here too, so nobody can
  -- join in the gap before that job next runs. (This can only reject, not also
  -- flip the row to canceled: raising an exception rolls back any update made
  -- earlier in this same call.)
  if v_group.status = 'filling' and v_group.order_deadline <= now() then
    raise exception 'This group''s order deadline has passed and it is no longer accepting members';
  end if;

  if v_group.status not in ('filling') then
    raise exception 'This group is no longer accepting members';
  end if;

  -- The club may have unpublished the drop out from under a still-open group
  -- (or reactivate_group may have reopened one on a dead listing). The group's
  -- own order_deadline is authoritative for TIMING - a club can legitimately
  -- extend it past the listing's expiry - but an inactive listing means the drop
  -- is off entirely.
  select l.active into v_listing_active
  from public.listings l where l.id = v_group.listing_id;
  if not coalesce(v_listing_active, false) then
    raise exception 'This drop is no longer taking orders';
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
    -- Full, but payment does not open until the order deadline passes.
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

-- Reactivating INTO 'filling' asks students to join a drop again, so it needs a
-- live listing. Reactivating into 'payment' does not: that group already filled
-- and those members owe the club for food it already ordered.
create or replace function public.reactivate_group(p_group_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.order_groups%rowtype;
  v_listing public.listings%rowtype;
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
    select * into v_listing from public.listings where id = v_group.listing_id;
    if not coalesce(v_listing.active, false) or v_listing.expires_at <= now() then
      raise exception 'Repost this drop before reopening a group that still needs to fill';
    end if;
    v_mode := 'fill';
    update public.order_groups
    set status = 'filling',
        order_deadline = least(now() + interval '48 hours', v_listing.expires_at),
        deadline = least(now() + interval '48 hours', v_listing.expires_at)
    where id = p_group_id;
  end if;

  return jsonb_build_object('mode', v_mode);
end;
$$;

revoke execute on function public.reactivate_group(uuid) from public, anon;
grant execute on function public.reactivate_group(uuid) to authenticated;

-- ===================== 5. Invitation fan-out cap =====================

-- Supersedes 047. Same dedupe behavior, plus a ceiling: a split is a handful of
-- friends, not a mailing list. The per-group ceiling counts live (non-declined)
-- invitations so declining and re-inviting still works.
create or replace function public.invite_to_group(p_group_id uuid, p_emails text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group public.order_groups%rowtype;
  v_email text;
  v_live int;
  v_cap int;
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

  if coalesce(array_length(p_emails, 1), 0) > 20 then
    raise exception 'Invite up to 20 people at a time';
  end if;

  -- Room for plenty of no-shows, without becoming a broadcast channel.
  v_cap := greatest(v_group.total_people * 5, 20);
  select count(*) into v_live
  from public.order_group_invitations
  where group_id = p_group_id and invited_email is not null and status <> 'declined';

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
      if v_live >= v_cap then
        raise exception 'This group has reached its invitation limit (%)', v_cap;
      end if;
      insert into public.order_group_invitations (group_id, invited_email, invited_by_user_id, invite_link_token)
      values (p_group_id, v_email, auth.uid(), public.generate_invite_token());
      v_live := v_live + 1;
    end if;
  end loop;
end;
$$;

revoke execute on function public.invite_to_group(uuid, text[]) from public, anon;
grant execute on function public.invite_to_group(uuid, text[]) to authenticated;

-- ===================== 6. Declaring a method the club does not collect =====================

-- Supersedes 043. Adds the club-collects check; every other guard is unchanged.
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
  v_venmo text;
  v_zelle text;
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

  -- Mirrors the method buttons MyOrders.tsx renders: a member can only declare
  -- a method the club actually collects, so the club never sees "paying by
  -- Zelle" for an account it does not have.
  select nullif(btrim(coalesce(c.venmo, '')), ''), nullif(btrim(coalesce(c.zelle_phone, '')), '')
    into v_venmo, v_zelle
  from public.order_groups g
  join public.listings l on l.id = g.listing_id
  join public.clubs c on c.id = l.club_id
  where g.id = p_group_id;

  if p_method = 'venmo' and v_venmo is null then
    raise exception 'This club does not collect Venmo; pay by Zelle instead';
  end if;
  if p_method = 'zelle' and v_zelle is null then
    raise exception 'This club does not collect Zelle; pay by Venmo instead';
  end if;

  update public.order_group_members
  set payment_method = p_method,
      payment_handle = v_handle
  where id = v_member.id;
end;
$$;

revoke execute on function public.set_group_member_payment(uuid, text, text) from public, anon;
grant execute on function public.set_group_member_payment(uuid, text, text) to authenticated;

-- ===================== 7. Is the deadline automation actually running? =====================

-- Every "it cancels automatically" promise in SPLIT_RULES depends on the pg_cron
-- job scheduled by 050, which 050 will skip with only a NOTICE where pg_cron is
-- unavailable. This reports whether it really exists, plus the backlog that
-- would be swept if it ran right now - so a silently-missing job is visible
-- instead of looking like "no groups expired yet".
create or replace function public.split_automation_health()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_scheduled boolean := false;
  v_overdue_fill int;
  v_overdue_open int;
  v_overdue_pay int;
begin
  if not exists (select 1 from public.clubs where id = auth.uid())
     and not coalesce(public.is_admin(), false) then
    raise exception 'Only a club or an admin can check split automation';
  end if;

  begin
    execute $q$select exists (select 1 from cron.job where jobname = 'process-group-deadlines')$q$
      into v_scheduled;
  exception
    when others then
      v_scheduled := false; -- pg_cron not installed at all
  end;

  select count(*) into v_overdue_fill
  from public.order_groups where status = 'filling' and order_deadline <= now();
  select count(*) into v_overdue_open
  from public.order_groups where status = 'full' and order_deadline <= now();
  select count(*) into v_overdue_pay
  from public.order_groups g
  where g.status in ('payment_in_progress', 'reactivated') and g.deadline <= now()
    and exists (select 1 from public.order_group_members m
                where m.group_id = g.id and m.status <> 'paid');

  return jsonb_build_object(
    'cron_scheduled', v_scheduled,
    'overdue_unfilled', v_overdue_fill,
    'overdue_awaiting_payment_open', v_overdue_open,
    'overdue_unpaid', v_overdue_pay,
    'healthy', v_scheduled and (v_overdue_fill + v_overdue_open + v_overdue_pay) = 0
  );
end;
$$;

revoke execute on function public.split_automation_health() from public, anon;
grant execute on function public.split_automation_health() to authenticated;
