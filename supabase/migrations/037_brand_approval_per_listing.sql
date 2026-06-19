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
