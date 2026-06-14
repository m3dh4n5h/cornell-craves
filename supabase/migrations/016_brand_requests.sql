-- Cornell Craves: request-a-brand flow (Batch 2 #17).
--
-- A club can request a brand that isn't in the built-in list. An admin reviews
-- the request, optionally fixes the name, then either approves it just for that
-- club (one_time) or deploys it to everyone (global). Global brands land in the
-- `brands` table, which the app merges with the static list so they appear in
-- the listing form and the cravings options automatically.

-- Approved-global brands. The static brands.ts list stays; this holds additions.
create table public.brands (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  created_at timestamptz not null default now()
);

create table public.brand_requests (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  requested_name text not null check (char_length(btrim(requested_name)) between 1 and 80),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  scope text check (scope in ('one_time', 'global')),
  decided_at timestamptz,
  created_at timestamptz not null default now()
);

create index brand_requests_status_idx on public.brand_requests (status, created_at);
create index brand_requests_club_idx on public.brand_requests (club_id);

-- ===================== Row level security =====================

alter table public.brands enable row level security;
alter table public.brand_requests enable row level security;

-- brands: public read (everyone needs the merged list); writes only via the RPC.
create policy "Brands are public" on public.brands for select using (true);
create policy "Admin manages brands" on public.brands for all
  using (public.is_admin())
  with check (public.is_admin());

-- brand_requests: a club sees and creates only its own; admin sees all.
create policy "Clubs see their brand requests" on public.brand_requests for select
  using (club_id = auth.uid() or public.is_admin());
create policy "Clubs create their brand requests" on public.brand_requests for insert
  with check (club_id = auth.uid());
create policy "Admin manages brand requests" on public.brand_requests for update
  using (public.is_admin())
  with check (public.is_admin());

-- ===================== RPCs =====================

-- A club asks for a brand to be added. Returns the new request id.
create or replace function public.request_brand(p_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if not exists (select 1 from public.clubs c where c.id = auth.uid()) then
    raise exception 'Only clubs can request brands';
  end if;
  if btrim(coalesce(p_name, '')) = '' then
    raise exception 'Enter a brand name';
  end if;
  insert into public.brand_requests (club_id, requested_name)
  values (auth.uid(), btrim(p_name))
  returning id into v_id;
  return v_id;
end;
$$;

-- Admin decides a request. p_action is 'one_time', 'global', or 'reject'. The
-- admin may also rename the brand (fix spelling/capitalization) via p_name.
create or replace function public.decide_brand_request(p_id uuid, p_name text, p_action text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
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
end;
$$;

revoke execute on function public.request_brand(text) from public, anon;
revoke execute on function public.decide_brand_request(uuid, text, text) from public, anon;
grant execute on function public.request_brand(text) to authenticated;
grant execute on function public.decide_brand_request(uuid, text, text) to authenticated;
