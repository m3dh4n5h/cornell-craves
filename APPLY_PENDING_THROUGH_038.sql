-- Cornell Craves — apply ALL pending changes to reach migration 038.
-- Generated 2026-06-19. Paste this whole file into the Supabase SQL editor and Run.
-- It is wrapped in a transaction (all-or-nothing) and is safe given your current
-- partial state (034 missing, 037 half-applied). Order: 028, 031, 034, 037, 038(secure).
--
-- After it succeeds, run the verification block at the very bottom (outside the txn).

BEGIN;

-- ====================================================================
-- 028_campus_location_addresses.sql
-- ====================================================================
-- Cornell Craves: correct five campus pins to their geocoded street addresses
-- (user-provided). Coordinates from Nominatim; verify each pin on the live map.

update public.campus_locations
set latitude = 42.4567055, longitude = -76.4756475,
    description = '107 Jessup Rd, Ithaca, NY 14850'
where name = 'Robert Purcell Community Center';

update public.campus_locations
set latitude = 42.4465180, longitude = -76.4880334,
    description = '306 West Ave, Ithaca, NY 14853'
where name = 'Noyes Community Center';

update public.campus_locations
set latitude = 42.4455232, longitude = -76.4820602,
    description = '106 Statler Dr, Ithaca, NY 14853'
where name = 'Statler Hall';

update public.campus_locations
set latitude = 42.4490693, longitude = -76.4834788,
    description = '232 E Ave, Ithaca, NY 14850'
where name = 'Temple of Zeus (Klarman Hall)';

update public.campus_locations
set latitude = 42.4465706, longitude = -76.4664332,
    description = '260 Tower Rd, Ithaca, NY 14853'
where name = 'Mann Library Atrium';

-- ====================================================================
-- 031_fix_mann_rpcc.sql
-- ====================================================================
-- Cornell Craves: corrected Mann and RPCC pins to user-supplied coordinates.

update public.campus_locations
set latitude = 42.4487952, longitude = -76.476316,
    description = '237 Mann Dr, Ithaca, NY 14853'
where name = 'Mann Library Atrium';

update public.campus_locations
set latitude = 42.4559245, longitude = -76.4774412,
    description = '107 Jessup Rd, Ithaca, NY 14850'
where name = 'Robert Purcell Community Center';

-- ====================================================================
-- 034_draft_brand_approval.sql
-- ====================================================================
-- Cornell Craves: approving a brand respects how the club saved the listing.
--   * "Post on approval" (auto_post_on_brand) listings publish automatically.
--   * "Save as draft" listings STAY drafts, now flagged brand-approved, so the
--     club gets a manual "Post" button - they are never auto-posted.
-- Also: a draft files exactly one brand request; re-saving never duplicates it.

alter table public.listings
  add column if not exists brand_approved boolean not null default false;

-- request_brand de-duplicates: one open request per club + brand name.
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

  -- Already pending or approved for this club + brand? Reuse it, don't dupe.
  select id into v_id
  from public.brand_requests
  where club_id = auth.uid()
    and lower(requested_name) = lower(v_name)
    and status in ('pending', 'approved')
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

-- Approving a request publishes post-on-approval listings but leaves drafts as
-- drafts (just brand-approved), applying any admin rename to both.
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
    insert into public.brands (name) values (v_name)
    on conflict (name) do nothing;
  end if;

  -- Post-on-approval listings go live now.
  update public.listings
  set brand = v_name,
      active = true,
      draft = false,
      auto_post_on_brand = false,
      brand_approved = true
  where club_id = v_club
    and lower(brand) = lower(v_orig)
    and auto_post_on_brand = true;

  -- Drafts stay drafts but are now brand-approved (club posts them manually).
  update public.listings
  set brand = v_name,
      brand_approved = true
  where club_id = v_club
    and lower(brand) = lower(v_orig)
    and draft = true;
end;
$$;

revoke execute on function public.decide_brand_request(uuid, text, text) from public, anon;
grant execute on function public.decide_brand_request(uuid, text, text) to authenticated;

-- When a brand is deployed globally, the existing trigger publishes everyone's
-- post-on-approval listings; flag them brand-approved too.
create or replace function public.publish_auto_post_for_brand()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.listings
  set active = true, auto_post_on_brand = false, draft = false, brand_approved = true
  where lower(brand) = lower(new.name) and auto_post_on_brand = true;
  return new;
end;
$$;

-- ====================================================================
-- 037_brand_approval_per_listing.sql
-- ====================================================================
-- Cornell Craves: fix brand-approval gaps. The boolean brand_approved was sticky
-- (it survived a brand change), so a club could change a draft to a rejected
-- brand and still post it. Replace it with approved_brand: the exact brand name
-- the admin approved for that listing. A draft is postable only when its current
-- brand is globally approved (in brands) OR equals approved_brand. Changing the
-- brand to anything else automatically requires going through approval again,
-- because the comparison is live.

alter table public.listings add column if not exists approved_brand text;

-- Preserve existing approvals: the approved name is the current brand.
update public.listings set approved_brand = brand where brand_approved = true;

-- Approving a request: post-on-approval listings go live; drafts stay drafts but
-- record the approved brand so the club gets a manual Post button. Applies any
-- admin rename to both.
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
    insert into public.brands (name) values (v_name)
    on conflict (name) do nothing;
  end if;

  -- Post-on-approval listings go live now, tagged with the approved brand.
  update public.listings
  set brand = v_name,
      active = true,
      draft = false,
      auto_post_on_brand = false,
      approved_brand = v_name
  where club_id = v_club
    and lower(brand) = lower(v_orig)
    and auto_post_on_brand = true;

  -- Drafts stay drafts but record the approved brand (club posts them manually).
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

-- When a brand is deployed globally, publish everyone's post-on-approval
-- listings for it and record the approved brand.
create or replace function public.publish_auto_post_for_brand()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.listings
  set active = true, auto_post_on_brand = false, draft = false, approved_brand = new.name
  where lower(brand) = lower(new.name) and auto_post_on_brand = true;
  return new;
end;
$$;

alter table public.listings drop column if exists brand_approved;

-- ====================================================================
-- 038_order_club_contact.sql
-- ====================================================================
-- Cornell Craves: expose the club name and the listing's contact email on a
-- buyer's orders, so the order PDF can show who to contact with questions.

-- The existing (005) function has a parameter default, and create-or-replace
-- cannot remove a parameter default (Postgres 42P13), so drop it first.
drop function if exists public.get_my_orders(text);

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
      'club_name', c.name,
      'contact_email', l.contact_email,
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
  -- Preserve migration 005's hardening: the caller must be signed in and only
  -- ever sees their OWN orders (by user_id or a verified account email). Never
  -- trust a client-supplied email, and never grant anon.
  where auth.uid() is not null
    and (o.user_id = auth.uid() or lower(o.orderer_email) = any (public.current_user_emails()))
  order by o.created_at desc;
$$;

revoke execute on function public.get_my_orders(text) from public, anon;
grant execute on function public.get_my_orders(text) to authenticated;

COMMIT;

-- ====================================================================
-- VERIFICATION (runs after COMMIT — read the Results grid).
-- Want:  true , false , true , true
-- ====================================================================
select
  (select count(*) from information_schema.columns
     where table_name='listings' and column_name='approved_brand') > 0      as approved_brand_present,
  (select count(*) from information_schema.columns
     where table_name='listings' and column_name='brand_approved') > 0       as brand_approved_still_there,
  pg_get_functiondef('public.decide_brand_request(uuid,text,text)'::regprocedure)
     like '%approved_brand%'                                                 as decide_fn_final,
  pg_get_functiondef('public.get_my_orders(text)'::regprocedure)
     like '%auth.uid()%'                                                     as orders_fn_secure;
