-- Cornell Craves: per-listing contact email (Batch 2 #1).
-- Clubs enter a contact email on every listing (not prefilled). Shown on the
-- listing detail page only. Listings are publicly readable, so this is visible
-- to anyone viewing the drop, by design (it is a buyer-facing contact point).

alter table public.listings add column if not exists contact_email text;
