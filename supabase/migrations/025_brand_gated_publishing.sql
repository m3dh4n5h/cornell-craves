-- Cornell Craves: unknown brands can't go live until approved (build spec 5 #7).
--
-- A listing with a brand that isn't in the approved set (the brands table) is
-- held back: the club either keeps it as a draft, or opts into auto-posting it
-- the moment an admin approves the brand. We seed the built-in brands into the
-- brands table so the database knows the full approved set.

alter table public.listings
  add column if not exists draft boolean not null default false;

alter table public.listings
  add column if not exists auto_post_on_brand boolean not null default false;

-- Seed the built-in approved brands (brands.ts) so the DB is the source of truth.
insert into public.brands (name) values
  ('Krispy Kreme'), ('Crumbl'), ('Chick-fil-A'), ('Auntie Anne''s'), ('Wingstop'),
  ('Shake Shack'), ('Cinnabon'), ('Insomnia Cookies'), ('In-N-Out'),
  ('Texas Roadhouse'), ('Club Bake Sale')
on conflict (name) do nothing;

-- True when a brand is approved (in the brands table), case-insensitive.
create or replace function public.is_brand_approved(p_brand text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.brands b where lower(b.name) = lower(btrim(p_brand)));
$$;

-- When a brand is approved (inserted into brands), publish any listings that
-- opted into auto-posting for that brand.
create or replace function public.publish_auto_post_for_brand()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.listings
  set active = true, auto_post_on_brand = false, draft = false
  where lower(brand) = lower(new.name) and auto_post_on_brand = true;
  return new;
end;
$$;

drop trigger if exists brands_auto_post on public.brands;
create trigger brands_auto_post
  after insert on public.brands
  for each row execute function public.publish_auto_post_for_brand();
