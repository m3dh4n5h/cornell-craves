-- Cornell Craves 040: make brand approval a real, integrated, enforced workflow.
--
-- What was broken (verified by simulation against a fresh database):
--   1. "Approve once" was not durable. It only touched listings that existed at
--      the moment of approval. The next listing the club created with the SAME
--      brand was stuck forever: request_brand() de-duplicated against the old
--      *approved* request, so no new request ever reached the admin queue, and
--      nothing would ever publish it.
--   2. Zero database enforcement. The brand gate lived only in Dashboard.tsx.
--      The template "Post" panel inserted listings with active defaulting to
--      TRUE, so any brand went straight to the live feed. Any club could also
--      publish any other club's one-time brand.
--   3. Approving a brand "published" autopost listings that had already
--      expired, so they went live into the void and the club never noticed.
--
-- The fix, in one sentence: one-time approvals become durable rows in
-- club_brand_approvals, a trigger on listings enforces the gate at the
-- database, and every approval/publish path handles expired listings.

-- ===================== 1. Durable per-club brand approvals =====================

create table if not exists public.club_brand_approvals (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  brand text not null,
  created_at timestamptz not null default now()
);

create unique index if not exists club_brand_approvals_unique_idx
  on public.club_brand_approvals (club_id, lower(btrim(brand)));

alter table public.club_brand_approvals enable row level security;

-- Clubs see their own approvals (the dashboard shows "approved for you");
-- writes happen only through SECURITY DEFINER admin functions below.
drop policy if exists "Clubs see their own brand approvals" on public.club_brand_approvals;
create policy "Clubs see their own brand approvals"
  on public.club_brand_approvals for select
  using (club_id = auth.uid() or public.is_admin());

-- Backfill (a): past one-time approvals recorded on brand_requests.
insert into public.club_brand_approvals (club_id, brand, created_at)
select r.club_id, r.requested_name, coalesce(r.decided_at, now())
from public.brand_requests r
where r.status = 'approved' and r.scope = 'one_time'
on conflict do nothing;

-- Backfill (b): listings that carry an approved_brand tag (037's mechanism).
insert into public.club_brand_approvals (club_id, brand)
select distinct l.club_id, l.approved_brand
from public.listings l
where l.approved_brand is not null and btrim(l.approved_brand) <> ''
on conflict do nothing;

-- Backfill (c): grandfather brands that are ALREADY live. They reached the feed
-- before enforcement existed (e.g. via the template hole); blocking edits to
-- those listings now would strand the clubs running them.
insert into public.club_brand_approvals (club_id, brand)
select distinct l.club_id, l.brand
from public.listings l
where l.active = true and not public.is_brand_approved(l.brand)
on conflict do nothing;

-- ===================== 2. The approval check =====================

create or replace function public.is_brand_approved_for_club(p_club uuid, p_brand text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
      select 1 from public.brands b
      where lower(b.name) = lower(btrim(p_brand))
    )
    or exists (
      select 1 from public.club_brand_approvals a
      where a.club_id = p_club
        and lower(btrim(a.brand)) = lower(btrim(p_brand))
    );
$$;

revoke execute on function public.is_brand_approved_for_club(uuid, text) from public, anon;
grant execute on function public.is_brand_approved_for_club(uuid, text) to authenticated;

-- ===================== 3. Enforcement at the database =====================

-- A listing may only be (or become) active when its brand is approved globally
-- or for its club. The admin bypasses the check (moderation + approval flows
-- run in the admin's session). Only transitions are checked, so unrelated edits
-- to old rows never explode.
create or replace function public.enforce_brand_gate()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- "Post on approval" for a brand that is ALREADY approved for this club has
  -- nothing to wait for: publish it now (a draft, in contrast, stays a draft
  -- until the club posts it). Expired ones park as postable drafts.
  if new.auto_post_on_brand and not new.active
     and public.is_brand_approved_for_club(new.club_id, new.brand)
  then
    new.auto_post_on_brand := false;
    new.approved_brand := btrim(new.brand);
    if new.expires_at > now() then
      new.active := true;
      new.draft := false;
    else
      new.draft := true;
    end if;
  end if;

  if new.active
     and (tg_op = 'INSERT'
          or old.active is distinct from new.active
          or lower(btrim(old.brand)) is distinct from lower(btrim(new.brand)))
     and not public.is_admin()
     and not public.is_brand_approved_for_club(new.club_id, new.brand)
  then
    raise exception 'The brand "%" needs admin approval before it can go live. Save the drop as a draft or choose "post on approval" instead.', btrim(new.brand)
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists listings_brand_gate on public.listings;
create trigger listings_brand_gate
  before insert or update on public.listings
  for each row execute function public.enforce_brand_gate();

-- ===================== 4. request_brand: approval-aware de-duplication =====================

-- Reuse an open (pending) request; skip entirely when the brand is already
-- usable by this club; otherwise ALWAYS file a fresh request - including when
-- an old request was approved one-time but later revoked, which used to
-- swallow the request forever.
create or replace function public.request_brand(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if not exists (select 1 from public.clubs c where c.id = auth.uid()) then
    raise exception 'Only clubs can request brands';
  end if;
  if v_name = '' then
    raise exception 'Enter a brand name';
  end if;

  -- Already usable: nothing to request.
  if public.is_brand_approved_for_club(auth.uid(), v_name) then
    return null;
  end if;

  -- An open request already sits in the admin queue: reuse it.
  select id into v_id
  from public.brand_requests
  where club_id = auth.uid()
    and lower(requested_name) = lower(v_name)
    and status = 'pending'
  limit 1;
  if v_id is not null then
    return v_id;
  end if;

  insert into public.brand_requests (club_id, requested_name)
  values (auth.uid(), v_name)
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.request_brand(text) from public, anon;
grant execute on function public.request_brand(text) to authenticated;

-- ===================== 5. decide_brand_request: durable + expiry-aware =====================

create or replace function public.decide_brand_request(p_id uuid, p_name text, p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_club uuid;
  v_orig text;
begin
  if not public.is_admin() then
    raise exception 'Admins only';
  end if;
  if p_action not in ('one_time', 'global', 'reject') then
    raise exception 'Unknown action';
  end if;

  if p_action = 'reject' then
    update public.brand_requests
    set status = 'rejected', decided_at = now()
    where id = p_id;
    return;
  end if;

  if v_name = '' then
    raise exception 'Enter a brand name';
  end if;

  select club_id, requested_name into v_club, v_orig
  from public.brand_requests where id = p_id;
  if v_club is null then
    raise exception 'Brand request not found';
  end if;

  update public.brand_requests
  set requested_name = v_name,
      status = 'approved',
      scope = p_action,
      decided_at = now()
  where id = p_id;

  if p_action = 'global' then
    -- The brands_auto_post trigger publishes every club's waiting autopost
    -- listings (and parks the expired ones as postable drafts).
    insert into public.brands (name) values (v_name)
    on conflict (name) do nothing;

    -- Other clubs waiting on the same brand are now answered too.
    update public.brand_requests
    set status = 'approved', scope = 'global', decided_at = now()
    where status = 'pending' and lower(requested_name) = lower(v_name);
  else
    -- One-time: durable approval for THIS club. Every future listing this club
    -- creates with this brand publishes without another round-trip to admin.
    insert into public.club_brand_approvals (club_id, brand)
    values (v_club, v_name)
    on conflict do nothing;
  end if;

  -- Publish the requesting club's waiting "post on approval" listings that are
  -- still worth publishing (not expired), applying any admin rename.
  update public.listings
  set brand = v_name,
      active = true,
      draft = false,
      auto_post_on_brand = false,
      approved_brand = v_name
  where club_id = v_club
    and lower(brand) = lower(v_orig)
    and auto_post_on_brand = true
    and expires_at > now();

  -- Expired autoposts become postable drafts instead of publishing into the
  -- void: the club fixes the end time and posts with one click.
  update public.listings
  set brand = v_name,
      draft = true,
      auto_post_on_brand = false,
      approved_brand = v_name
  where club_id = v_club
    and lower(brand) = lower(v_orig)
    and auto_post_on_brand = true;

  -- Drafts stay drafts, now postable (manual "Post now" in the dashboard).
  update public.listings
  set brand = v_name,
      approved_brand = v_name
  where club_id = v_club
    and lower(brand) = lower(v_orig)
    and draft = true;
end;
$$;

revoke execute on function public.decide_brand_request(uuid, text, text) from public, anon;
grant execute on function public.decide_brand_request(uuid, text, text) to authenticated;

-- Global deploys: publish everyone's waiting autoposts, park expired ones.
create or replace function public.publish_auto_post_for_brand()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.listings
  set active = true, auto_post_on_brand = false, draft = false, approved_brand = new.name
  where lower(brand) = lower(new.name)
    and auto_post_on_brand = true
    and expires_at > now();

  update public.listings
  set draft = true, auto_post_on_brand = false, approved_brand = new.name
  where lower(brand) = lower(new.name)
    and auto_post_on_brand = true;
  return new;
end;
$$;

-- ===================== 6. Admin controls =====================

-- Pending requests now tell the admin what is riding on the decision: how many
-- of the club's listings are held waiting for this brand.
create or replace function public.admin_brand_requests()
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', r.id,
    'requested_name', r.requested_name,
    'status', r.status,
    'created_at', r.created_at,
    'club_id', r.club_id,
    'club_name', c.name,
    'club_email', c.email,
    'held_listings', (
      select count(*) from public.listings l
      where l.club_id = r.club_id
        and lower(l.brand) = lower(r.requested_name)
        and (l.draft or l.auto_post_on_brand)
    )
  )
  from public.brand_requests r
  join public.clubs c on c.id = r.club_id
  where public.is_admin() and r.status = 'pending'
  order by r.created_at;
$$;

-- Every one-time approval, with the club, for the admin Brands tab.
create or replace function public.admin_club_brand_approvals()
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', a.id,
    'club_id', a.club_id,
    'club_name', c.name,
    'brand', a.brand,
    'created_at', a.created_at
  )
  from public.club_brand_approvals a
  join public.clubs c on c.id = a.club_id
  where public.is_admin()
  order by a.created_at desc;
$$;

-- Revoke a one-time approval. Live listings stay live (moderate those
-- separately); the club just cannot publish NEW drops with the brand.
create or replace function public.admin_revoke_club_brand(p_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only';
  end if;
  delete from public.club_brand_approvals where id = p_id;
end;
$$;

-- Moderation: every listing with its club, newest first.
create or replace function public.admin_listings()
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', l.id,
    'title', l.title,
    'brand', l.brand,
    'club_id', l.club_id,
    'club_name', c.name,
    'active', l.active,
    'draft', l.draft,
    'auto_post_on_brand', l.auto_post_on_brand,
    'expires_at', l.expires_at,
    'created_at', l.created_at,
    'orders', (select count(*) from public.orders o where o.listing_id = l.id)
  )
  from public.listings l
  join public.clubs c on c.id = l.club_id
  where public.is_admin()
  order by l.created_at desc;
$$;

-- Moderation: hide (or restore) any listing.
create or replace function public.admin_set_listing_active(p_id uuid, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only';
  end if;
  update public.listings set active = p_active where id = p_id;
end;
$$;

revoke execute on function public.admin_club_brand_approvals() from public, anon;
revoke execute on function public.admin_revoke_club_brand(uuid) from public, anon;
revoke execute on function public.admin_listings() from public, anon;
revoke execute on function public.admin_set_listing_active(uuid, boolean) from public, anon;
grant execute on function public.admin_club_brand_approvals() to authenticated;
grant execute on function public.admin_revoke_club_brand(uuid) to authenticated;
grant execute on function public.admin_listings() to authenticated;
grant execute on function public.admin_set_listing_active(uuid, boolean) to authenticated;

-- ===================== 7. Club dashboard stats =====================

-- One cheap call that powers the dashboard header: live counts, money, and
-- what needs the club's attention right now.
create or replace function public.club_dashboard_stats()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when exists (select 1 from public.clubs c where c.id = auth.uid()) then
    jsonb_build_object(
      'live_drops', (
        select count(*) from public.listings l
        where l.club_id = auth.uid() and l.active and l.expires_at > now()
      ),
      'held_drops', (
        select count(*) from public.listings l
        where l.club_id = auth.uid() and (l.draft or l.auto_post_on_brand)
      ),
      'orders_pending', (
        select count(*) from public.orders o
        join public.listings l on l.id = o.listing_id
        where l.club_id = auth.uid() and o.status = 'pending_payment'
      ),
      'orders_total', (
        select count(*) from public.orders o
        join public.listings l on l.id = o.listing_id
        where l.club_id = auth.uid()
      ),
      'revenue', (
        (select coalesce(sum(o.total), 0) from public.orders o
         join public.listings l on l.id = o.listing_id
         where l.club_id = auth.uid() and o.payment_verified)
        + (select coalesce(sum(g.item_price / greatest(g.total_people, 1)), 0)
           from public.order_group_members m
           join public.order_groups g on g.id = m.group_id
           join public.listings l on l.id = g.listing_id
           where l.club_id = auth.uid() and m.status = 'paid')
      ),
      'upcoming_reservations', (
        select count(*) from public.reservations r
        join public.pickup_slots s on s.id = r.slot_id
        join public.listings l on l.id = s.listing_id
        where l.club_id = auth.uid() and s.end_time > now()
      ),
      'pending_brands', (
        select count(*) from public.brand_requests b
        where b.club_id = auth.uid() and b.status = 'pending'
      )
    )
  else null end;
$$;

revoke execute on function public.club_dashboard_stats() from public, anon;
grant execute on function public.club_dashboard_stats() to authenticated;
