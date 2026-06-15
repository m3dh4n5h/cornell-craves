-- Cornell Craves: enforce that the student flow uses a Cornell Google account
-- (build spec 5 #1). Clubs are unrestricted (they never insert orders or join
-- splits, so these triggers never fire for them). Ordering and joining a split
-- both require a signed-in user whose auth email ends in @cornell.edu.

create or replace function public.assert_cornell_orderer()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  if new.user_id is null then
    raise exception 'Sign in with your Cornell (@cornell.edu) Google account to order';
  end if;
  select lower(coalesce(email, '')) into v_email from auth.users where id = new.user_id;
  if v_email is null or v_email not like '%@cornell.edu' then
    raise exception 'Students must use a Cornell (@cornell.edu) Google account to order';
  end if;
  return new;
end;
$$;

drop trigger if exists orders_require_cornell on public.orders;
create trigger orders_require_cornell
  before insert on public.orders
  for each row execute function public.assert_cornell_orderer();

create or replace function public.assert_cornell_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text;
begin
  select lower(coalesce(email, '')) into v_email from auth.users where id = new.user_id;
  if v_email is null or v_email not like '%@cornell.edu' then
    raise exception 'Students must use a Cornell (@cornell.edu) Google account to join a split';
  end if;
  return new;
end;
$$;

drop trigger if exists group_members_require_cornell on public.order_group_members;
create trigger group_members_require_cornell
  before insert on public.order_group_members
  for each row execute function public.assert_cornell_member();
