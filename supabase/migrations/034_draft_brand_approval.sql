-- Cornell Craves: approving a brand respects how the club saved the listing.
--   * "Post on approval" (auto_post_on_brand) listings publish automatically.
--   * "Save as draft" listings STAY drafts, now flagged brand-approved, so the
--     club gets a manual "Post" button — they are never auto-posted.
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
