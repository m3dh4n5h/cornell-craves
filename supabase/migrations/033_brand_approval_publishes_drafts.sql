-- Cornell Craves: approving a brand request (one-time OR deploy-to-all) now also
-- publishes the requesting club's listings that were held for that brand — the
-- drafts and post-on-approval listings. Previously "Approve once" did nothing to
-- those listings, so they could never go live.

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

  -- The requester + the brand they originally typed (matches their listings).
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

  -- Deploy-to-all adds the brand to the global list (and to cravings options);
  -- the brands trigger also publishes everyone's post-on-approval listings.
  if p_action = 'global' then
    insert into public.brands (name) values (v_name)
    on conflict (name) do nothing;
  end if;

  -- Either way, publish the requesting club's held listings for this brand and
  -- apply any rename so the listing carries the approved name.
  update public.listings
  set brand = v_name,
      active = true,
      draft = false,
      auto_post_on_brand = false
  where club_id = v_club
    and lower(brand) = lower(v_orig)
    and (draft = true or auto_post_on_brand = true);
end;
$$;

revoke execute on function public.decide_brand_request(uuid, text, text) from public, anon;
grant execute on function public.decide_brand_request(uuid, text, text) to authenticated;
