-- Cornell Craves: club logo upload (Batch 2 #14).
--
-- Adds clubs.logo_url and a public-read / owner-write Storage bucket. Logos are
-- stored under a folder named for the club's id (which equals auth.uid()), so
-- the owner-write policy is a simple folder-name check.

alter table public.clubs add column if not exists logo_url text;

-- Public bucket so <img src> works without signed URLs.
insert into storage.buckets (id, name, public)
values ('club-logos', 'club-logos', true)
on conflict (id) do nothing;

-- Anyone can read logos (public feed/detail).
create policy "Club logos are public"
  on storage.objects for select
  using (bucket_id = 'club-logos');

-- A club may upload/replace/remove only files inside its own id folder.
create policy "Clubs upload their own logo"
  on storage.objects for insert
  with check (
    bucket_id = 'club-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Clubs update their own logo"
  on storage.objects for update
  using (
    bucket_id = 'club-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'club-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "Clubs delete their own logo"
  on storage.objects for delete
  using (
    bucket_id = 'club-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
