-- Cornell Craves: initial schema, triggers, and row level security.
--
-- IMPORTANT before running: replace the email inside is_admin() below so it
-- matches the VITE_ADMIN_EMAIL you set in the frontend env.

-- ===================== Tables =====================

-- clubs.id doubles as the Supabase Auth user id, which is what makes the
-- auth.uid() = club_id RLS checks work.
create table public.clubs (
  id uuid primary key references auth.users (id) on delete cascade,
  name text not null,
  email text not null,
  venmo text,
  zelle_phone text,
  approved boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.listings (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs (id) on delete cascade,
  brand text not null,
  title text not null,
  description text,
  items jsonb not null default '[]'::jsonb,
  pickup_info text,
  expires_at timestamptz not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.cravings (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  brands text[] not null default '{}',
  created_at timestamptz not null default now()
);

create table public.notifications_log (
  id uuid primary key default gen_random_uuid(),
  craving_id uuid not null references public.cravings (id) on delete cascade,
  listing_id uuid not null references public.listings (id) on delete cascade,
  sent_at timestamptz not null default now(),
  unique (craving_id, listing_id)
);

create index listings_feed_idx on public.listings (active, expires_at desc);
create index listings_club_idx on public.listings (club_id);
create index listings_brand_idx on public.listings (brand);
create index cravings_brands_idx on public.cravings using gin (brands);
create index notifications_log_listing_idx on public.notifications_log (listing_id);

-- ===================== Admin check =====================

create or replace function public.is_admin()
returns boolean
language sql
stable
as $$
  -- CHANGE THIS before running: set it to your admin Google account email,
  -- and keep it in sync with VITE_ADMIN_EMAIL in the frontend env.
  select coalesce(auth.jwt() ->> 'email', '') = 'your-admin-netid@cornell.edu'
$$;

-- ===================== Auth trigger =====================

-- Registration sends club details as user metadata; this trigger creates the
-- clubs row server-side so it works even when email confirmation is required
-- (the user has no session yet, so a client-side insert would fail RLS).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.raw_user_meta_data ? 'club_name' then
    insert into public.clubs (id, name, email, venmo, zelle_phone)
    values (
      new.id,
      coalesce(nullif(trim(new.raw_user_meta_data ->> 'club_name'), ''), 'Unnamed club'),
      coalesce(new.email, ''),
      nullif(trim(coalesce(new.raw_user_meta_data ->> 'venmo', '')), ''),
      nullif(trim(coalesce(new.raw_user_meta_data ->> 'zelle_phone', '')), '')
    );
  end if;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Clubs may edit their own profile but only the admin can flip approval.
create or replace function public.protect_approved_flag()
returns trigger
language plpgsql
as $$
begin
  if new.approved is distinct from old.approved and not public.is_admin() then
    raise exception 'Only the admin can change approval status';
  end if;
  return new;
end;
$$;

create trigger clubs_protect_approved
  before update on public.clubs
  for each row execute function public.protect_approved_flag();

-- ===================== Row level security =====================

alter table public.clubs enable row level security;
alter table public.listings enable row level security;
alter table public.cravings enable row level security;
alter table public.notifications_log enable row level security;

-- clubs
create policy "Approved clubs are public, owners and admin see their own"
  on public.clubs for select
  using (approved = true or auth.uid() = id or public.is_admin());

create policy "Users can insert their own club row"
  on public.clubs for insert
  with check (auth.uid() = id);

create policy "Owners and admin can update clubs"
  on public.clubs for update
  using (auth.uid() = id or public.is_admin())
  with check (auth.uid() = id or public.is_admin());

create policy "Admin can delete clubs"
  on public.clubs for delete
  using (public.is_admin());

-- listings
create policy "Active listings are public, owners and admin see all theirs"
  on public.listings for select
  using (active = true or auth.uid() = club_id or public.is_admin());

create policy "Approved clubs can create their own listings"
  on public.listings for insert
  with check (
    auth.uid() = club_id
    and exists (
      select 1 from public.clubs
      where id = auth.uid() and approved = true
    )
  );

create policy "Clubs can update their own listings"
  on public.listings for update
  using (auth.uid() = club_id)
  with check (auth.uid() = club_id);

create policy "Clubs can delete their own listings"
  on public.listings for delete
  using (auth.uid() = club_id);

-- cravings: anyone can subscribe or update their picks (upsert on email).
-- There is intentionally NO select policy, so subscriber emails are never
-- readable from the client. The edge function reads them with the service role.
create policy "Anyone can add a craving"
  on public.cravings for insert
  with check (true);

create policy "Anyone can update a craving via email upsert"
  on public.cravings for update
  using (true)
  with check (true);

-- notifications_log: no policies on purpose. Only the service role (edge
-- function) reads and writes it.
