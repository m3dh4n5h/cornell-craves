-- Cornell Craves: keep cravings in sync across the Cravings page and Account
-- tab (Batch 2 #18).
--
-- The Cravings page could not read existing picks (the cravings table has no
-- SELECT policy), so it started blank and diverged from the Account tab (which
-- reads users_extended.preferences_json). Fix: a get_my_craving() RPC both
-- screens read from, and upsert_my_craving now also mirrors the brands into
-- users_extended.preferences_json so the two never drift.

-- Returns the caller's current craving brands (by their verified email).
create or replace function public.get_my_craving()
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select c.brands
      from public.cravings c
      where lower(c.email) = any (public.current_user_emails())
      limit 1
    ),
    '{}'::text[]
  );
$$;

revoke execute on function public.get_my_craving() from public, anon;
grant execute on function public.get_my_craving() to authenticated;

-- upsert_my_craving now also mirrors brands into preferences_json.brands.
create or replace function public.upsert_my_craving(p_brands text[])
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  select coalesce(
    nullif(lower(btrim((select cornell_email from public.users_extended where id = auth.uid()))), ''),
    lower(btrim(auth.jwt() ->> 'email'))
  ) into v_email;

  if v_email is null or v_email = '' then
    raise exception 'No email on file for the current user';
  end if;

  insert into public.cravings (email, brands)
  values (v_email, coalesce(p_brands, '{}'))
  on conflict (email) do update set brands = excluded.brands;

  -- Keep the profile copy in sync so the Account tab and Cravings page agree.
  update public.users_extended
  set preferences_json = jsonb_set(
        coalesce(preferences_json, '{}'::jsonb),
        '{brands}',
        to_jsonb(coalesce(p_brands, '{}'::text[]))
      )
  where id = auth.uid();
end;
$$;

revoke execute on function public.upsert_my_craving(text[]) from public, anon;
grant execute on function public.upsert_my_craving(text[]) to authenticated;
