-- Account management: payment-change flag, craving opt-out, account deletion.

-- 1) Flag set on a club's live listings when it changes its Venmo/Zelle while a
--    drop is active, so the listing can warn buyers to reconfirm the handle.
alter table public.listings add column if not exists payment_updated_at timestamptz;

-- 2) Unsubscribe from craving alerts (students opt out of the mailing list).
--    Keyed to the caller's authenticated email, like the upsert RPC.
create or replace function public.delete_my_craving()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  delete from public.cravings where lower(email) = any (public.current_user_emails());
end;
$$;
revoke execute on function public.delete_my_craving() from public, anon;
grant execute on function public.delete_my_craving() to authenticated;

-- 3) Full account deletion for students and clubs. Removes the craving
--    subscription and the auth user; FK cascades then remove the club/student
--    row and everything hanging off it (listings, etc.). After this the person
--    receives no further notifications unless they sign up again.
create or replace function public.delete_my_account()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in';
  end if;
  delete from public.cravings where lower(email) = any (public.current_user_emails());
  delete from auth.users where id = v_uid;
end;
$$;
revoke execute on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;
