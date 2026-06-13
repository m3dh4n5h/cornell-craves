-- Craving alerts: fix + harden.
--
-- The client saved cravings with .upsert(..., { onConflict: 'email' }). The
-- cravings table intentionally has NO select policy (subscriber emails must
-- never be readable from the browser), but an upsert has to read the
-- conflicting row to resolve it. With no select policy that read is denied and
-- Postgres reports "new row violates row-level security policy".
--
-- Fix: route craving saves through a SECURITY DEFINER RPC keyed to the caller's
-- authenticated email (their saved cornell_email, else their Google email),
-- matching the 005 pattern. This also closes the prior hole where the
-- permissive INSERT policy let anyone subscribe any arbitrary email.

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
end;
$$;

-- Authenticated callers only; the function decides the email, not the client.
revoke execute on function public.upsert_my_craving(text[]) from public, anon;
grant execute on function public.upsert_my_craving(text[]) to authenticated;
