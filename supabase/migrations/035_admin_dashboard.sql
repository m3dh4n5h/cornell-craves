-- Cornell Craves: admin operations dashboard. All reads go through SECURITY
-- DEFINER RPCs guarded by is_admin(), so the admin reliably sees data without
-- depending on per-table RLS / PostgREST embedding (which was hiding brand
-- requests). Each function raises if the caller is not the admin.

-- ----- Platform overview (counts + revenue) -----
create or replace function public.admin_overview()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when public.is_admin() then jsonb_build_object(
    'clubs_total', (select count(*) from public.clubs),
    'clubs_pending', (select count(*) from public.clubs where not approved),
    'clubs_approved', (select count(*) from public.clubs where approved),
    'listings_total', (select count(*) from public.listings),
    'listings_active', (select count(*) from public.listings where active and expires_at > now()),
    'listings_draft', (select count(*) from public.listings where draft),
    'orders_total', (select count(*) from public.orders),
    'orders_verified', (select count(*) from public.orders where payment_verified),
    'orders_pending', (select count(*) from public.orders where status = 'pending_payment'),
    'revenue', (
      (select coalesce(sum(total), 0) from public.orders where payment_verified)
      + (select coalesce(sum(g.item_price / greatest(g.total_people, 1)), 0)
         from public.order_group_members m
         join public.order_groups g on g.id = m.group_id
         where m.status = 'paid')
    ),
    'students', (select count(*) from public.users_extended),
    'cravings', (select count(*) from public.cravings),
    'reservations', (select count(*) from public.reservations),
    'brand_requests_pending', (select count(*) from public.brand_requests where status = 'pending'),
    'global_brands', (select count(*) from public.brands)
  ) else null end;
$$;

-- ----- Pending brand requests with the requesting club -----
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
    'club_email', c.email
  )
  from public.brand_requests r
  join public.clubs c on c.id = r.club_id
  where public.is_admin() and r.status = 'pending'
  order by r.created_at;
$$;

-- ----- Every club with operational metrics -----
create or replace function public.admin_clubs()
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'id', c.id,
    'name', c.name,
    'email', c.email,
    'approved', c.approved,
    'created_at', c.created_at,
    'logo_url', c.logo_url,
    'venmo', c.venmo,
    'listings', (select count(*) from public.listings l where l.club_id = c.id),
    'active_listings', (
      select count(*) from public.listings l
      where l.club_id = c.id and l.active and l.expires_at > now()
    ),
    'orders', (
      select count(*) from public.orders o
      join public.listings l on l.id = o.listing_id
      where l.club_id = c.id and o.payment_verified
    ),
    'revenue', (
      (select coalesce(sum(o.total), 0) from public.orders o
       join public.listings l on l.id = o.listing_id
       where l.club_id = c.id and o.payment_verified)
      + (select coalesce(sum(g.item_price / greatest(g.total_people, 1)), 0)
         from public.order_group_members m
         join public.order_groups g on g.id = m.group_id
         join public.listings l2 on l2.id = g.listing_id
         where l2.club_id = c.id and m.status = 'paid')
    )
  )
  from public.clubs c
  where public.is_admin()
  order by c.approved, c.created_at desc;
$$;

-- ----- The global (deploy-to-all) brand list, newest first -----
create or replace function public.admin_global_brands()
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object('id', b.id, 'name', b.name, 'created_at', b.created_at)
  from public.brands b
  where public.is_admin()
  order by b.created_at desc;
$$;

-- ----- Remove a global brand (un-deploy) -----
create or replace function public.admin_remove_brand(p_brand_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only';
  end if;
  delete from public.brands where id = p_brand_id;
end;
$$;

-- ----- Approve / revoke a club (revoke also hides its live drops) -----
create or replace function public.admin_set_club_approved(p_club_id uuid, p_approved boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only';
  end if;
  update public.clubs set approved = p_approved where id = p_club_id;
  if not p_approved then
    update public.listings set active = false where club_id = p_club_id and active;
  end if;
end;
$$;

revoke execute on function public.admin_overview() from public, anon;
revoke execute on function public.admin_brand_requests() from public, anon;
revoke execute on function public.admin_clubs() from public, anon;
revoke execute on function public.admin_global_brands() from public, anon;
revoke execute on function public.admin_remove_brand(uuid) from public, anon;
revoke execute on function public.admin_set_club_approved(uuid, boolean) from public, anon;
grant execute on function public.admin_overview() to authenticated;
grant execute on function public.admin_brand_requests() to authenticated;
grant execute on function public.admin_clubs() to authenticated;
grant execute on function public.admin_global_brands() to authenticated;
grant execute on function public.admin_remove_brand(uuid) to authenticated;
grant execute on function public.admin_set_club_approved(uuid, boolean) to authenticated;
