-- Cornell Craves: split feature health check (post-052).
-- Paste this whole file into the Supabase SQL Editor and run it. Every section
-- is read-only. Sections return one row per check with a status column, so you
-- can scan top to bottom for anything that isn't "OK".

-- ===================== 1. Migration 052 functions exist =====================
select
  'function exists: ' || expected.name as check,
  case when p.proname is not null then 'OK' else 'MISSING' end as status
from (values
  ('group_payload'), ('club_owns_group'), ('decline_group_invite'),
  ('accept_group_invite'), ('reactivate_group'), ('invite_to_group'),
  ('set_group_member_payment'), ('split_automation_health'),
  ('create_order_group'), ('join_or_create_public_group'),
  ('process_group_deadlines'), ('get_group_by_token'),
  ('get_my_groups'), ('get_club_groups')
) as expected(name)
left join pg_proc p on p.proname = expected.name
  and p.pronamespace = 'public'::regnamespace
order by status desc, expected.name;

-- ===================== 2. order_groups RLS: write policies must be GONE =====================
select
  'order_groups has no client INSERT policy' as check,
  case when count(*) = 0 then 'OK' else 'FAIL - found: ' || string_agg(policyname, ', ') end as status
from pg_policies
where schemaname = 'public' and tablename = 'order_groups' and cmd = 'INSERT';

select
  'order_groups has no client UPDATE policy' as check,
  case when count(*) = 0 then 'OK' else 'FAIL - found: ' || string_agg(policyname, ', ') end as status
from pg_policies
where schemaname = 'public' and tablename = 'order_groups' and cmd = 'UPDATE';

select
  'order_groups SELECT policy is scoped (not USING (true))' as check,
  case
    when count(*) filter (where qual = 'true') > 0 then 'FAIL - a wide-open SELECT policy still exists'
    when count(*) = 1 then 'OK'
    else 'CHECK MANUALLY - ' || count(*) || ' select polic(y/ies) found'
  end as status
from pg_policies
where schemaname = 'public' and tablename = 'order_groups' and cmd = 'SELECT';

-- RLS must be enabled on all three tables, or none of the above policies matter.
select
  'RLS enabled on ' || c.relname as check,
  case when c.relrowsecurity then 'OK' else 'FAIL - RLS is OFF' end as status
from pg_class c
join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public'
  and c.relname in ('order_groups', 'order_group_members', 'order_group_invitations')
order by c.relname;

-- ===================== 3. Functions that must NOT be publicly callable =====================
select
  'PUBLIC cannot execute ' || fn as check,
  case
    when acl is null then 'FAIL - no ACL row (default PUBLIC grant is active)'
    when acl !~ '=X' then 'OK'
    else 'FAIL - acl allows public: ' || acl
  end as status
from (
  select 'group_payload' as fn, pg_catalog.array_to_string(p.proacl, ' ') as acl
  from pg_proc p where p.proname = 'group_payload' and p.pronamespace = 'public'::regnamespace
  union all
  select 'club_owns_group', pg_catalog.array_to_string(p.proacl, ' ')
  from pg_proc p where p.proname = 'club_owns_group' and p.pronamespace = 'public'::regnamespace
) x;

select
  'anon cannot execute decline_group_invite' as check,
  case
    when acl is null then 'FAIL - no ACL row'
    when acl ~ 'anon=X' then 'FAIL - anon can still call it'
    else 'OK'
  end as status
from (
  select pg_catalog.array_to_string(p.proacl, ' ') as acl
  from pg_proc p where p.proname = 'decline_group_invite' and p.pronamespace = 'public'::regnamespace
) x;

select
  'anon/authenticated cannot execute split_automation_health' as check,
  case
    when acl is null then 'FAIL - no ACL row'
    when acl ~ '(anon|public)=X' then 'FAIL - too permissive: ' || acl
    else 'OK'
  end as status
from (
  select pg_catalog.array_to_string(p.proacl, ' ') as acl
  from pg_proc p where p.proname = 'split_automation_health' and p.pronamespace = 'public'::regnamespace
) x;

-- ===================== 4. pg_cron: is the deadline job actually scheduled? =====================
select
  'pg_cron extension installed' as check,
  case when count(*) > 0 then 'OK' else 'FAIL - extension not installed' end as status
from pg_extension where extname = 'pg_cron';

select
  'process-group-deadlines job scheduled' as check,
  case when count(*) > 0 then 'OK' else 'FAIL - job missing, nothing auto-cancels' end as status,
  max(schedule) as schedule,
  max(active::text) as active
from cron.job where jobname = 'process-group-deadlines';

-- Last 5 runs, so you can see it's actually firing (not just scheduled).
select
  runid, status, return_message,
  start_time, end_time
from cron.job_run_details
where jobid = (select jobid from cron.job where jobname = 'process-group-deadlines')
order by start_time desc
limit 5;

-- ===================== 5. Data health: nothing stuck past its deadline =====================
select
  'groups stuck: filling past order_deadline (should have canceled)' as check,
  case when count(*) = 0 then 'OK' else 'CHECK - ' || count(*) || ' stuck row(s), job may not be running' end as status
from public.order_groups
where status = 'filling' and order_deadline <= now();

select
  'groups stuck: full past order_deadline (should have opened payment)' as check,
  case when count(*) = 0 then 'OK' else 'CHECK - ' || count(*) || ' stuck row(s)' end as status
from public.order_groups
where status = 'full' and order_deadline <= now();

select
  'groups stuck: payment window elapsed with someone unpaid (should have canceled)' as check,
  case when count(*) = 0 then 'OK' else 'CHECK - ' || count(*) || ' stuck row(s)' end as status
from public.order_groups g
where g.status in ('payment_in_progress', 'reactivated')
  and g.deadline <= now()
  and exists (select 1 from public.order_group_members m where m.group_id = g.id and m.status <> 'paid');

-- ===================== 6. Data health: nothing structurally impossible =====================
select
  'no group is "paid" with an unpaid member' as check,
  case when count(*) = 0 then 'OK' else 'FAIL - ' || count(*) || ' paid group(s) have an unpaid member' end as status
from public.order_groups g
where g.status = 'paid'
  and exists (select 1 from public.order_group_members m where m.group_id = g.id and m.status <> 'paid');

select
  'no paid member is missing a QR token' as check,
  case when count(*) = 0 then 'OK' else 'CHECK - ' || count(*) || ' paid member(s) with no qr_encrypted' end as status
from public.order_group_members
where status = 'paid' and (qr_encrypted is null or qr_encrypted = '');

select
  'no canceled group still exposes a QR/pickup code' as check,
  -- get_my_groups gates in application code (status='paid' check), so this is a
  -- defense-in-depth read: the raw column can still hold a value after cancel,
  -- that is expected and fine as long as the RPC never returns it. Informational.
  'INFO - ' || count(*) || ' member row(s) on canceled groups still have a stored qr_encrypted (harmless: get_my_groups/get_club_groups never return it once status <> paid)' as status
from public.order_group_members m
join public.order_groups g on g.id = m.group_id
where g.status = 'canceled' and m.qr_encrypted is not null and m.qr_encrypted <> '';

select
  'pickup_code uniqueness holds' as check,
  case when count(*) = 0 then 'OK' else 'FAIL - duplicate pickup codes exist' end as status
from (
  select pickup_code from public.order_group_members
  where pickup_code is not null
  group by pickup_code having count(*) > 1
) dupes;

select
  'no group has filled_count > total_people' as check,
  case when count(*) = 0 then 'OK' else 'FAIL - ' || count(*) || ' overfilled group(s)' end as status
from public.order_groups where filled_count > total_people;

-- ===================== 7. Invitation fan-out cap is actually holding in prod data =====================
select
  'no group exceeds its invitation ceiling (total_people * 5, min 20)' as check,
  case when count(*) = 0 then 'OK' else 'CHECK - ' || count(*) || ' group(s) over the intended cap' end as status
from (
  select g.id, g.total_people, count(i.id) as live_invites
  from public.order_groups g
  join public.order_group_invitations i
    on i.group_id = g.id and i.invited_email is not null and i.status <> 'declined'
  group by g.id, g.total_people
  having count(i.id) > greatest(g.total_people * 5, 20)
) over_cap;

-- ===================== 8. Summary counts, for context =====================
select status, count(*) from public.order_groups group by status order by status;
