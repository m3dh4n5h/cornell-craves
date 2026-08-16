-- Cornell Craves 051: close two gaps found auditing the split-order payment
-- flow against SPLIT_RULES / CLUB_SPLIT_RULES (src/lib/groups.ts).
--
-- 1. get_group_by_token(text) is granted to anon (004_order_splitting.sql:320)
--    so someone can preview an invite before signing in. It returns the full
--    group_payload(), which since 043_split_payment_and_qr_gating.sql includes
--    every member's payment_method/payment_handle (their Venmo/Zelle handle) -
--    meaning anyone holding (or merely forwarded) an invite link can read
--    every current member's payment handle without ever joining or signing
--    in. Nothing on the anon-facing invite preview (src/pages/InvitePage.tsx)
--    reads those fields; they only matter to the members themselves (get_
--    my_groups, authenticated + already a member) and the club (get_club_
--    groups, authenticated + owns the listing). This strips just those two
--    fields from the anon-reachable copy; group_payload() itself, and the two
--    authenticated RPCs that call it, are unchanged.
--
-- 2. supabase/functions/notify-cravings/index.ts verifyGroupPayment() was not
--    idempotent under a raced or duplicated call for the same member (a
--    double-click before the UI's disabled state lands, or two overlapping
--    requests): it unconditionally regenerated that member's QR token/pickup
--    code, and unconditionally re-sent every member's pass email once it saw
--    the group fully paid - so a race on the last unpaid member could email
--    everyone their pass twice. That fix lives in the function file itself
--    (edge functions are not deployed by migrations - redeploy notify-cravings
--    after this: `supabase functions deploy notify-cravings`, or paste the
--    updated file into the Dashboard's Edge Functions editor).
--
-- Run after 050_split_deadline_automation. Idempotent: safe to re-run.

create or replace function public.get_group_by_token(p_token text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with base as (
    select i.status as invite_status, public.group_payload(i.group_id) as payload
    from public.order_group_invitations i
    where i.invite_link_token = trim(p_token)
  )
  select
    (base.payload || jsonb_build_object('invite_status', base.invite_status))
    || jsonb_build_object(
      'members',
      (
        select coalesce(jsonb_agg(member - 'payment_method' - 'payment_handle'), '[]'::jsonb)
        from jsonb_array_elements(base.payload -> 'members') as member
      )
    )
  from base;
$$;

revoke execute on function public.get_group_by_token(text) from public;
grant execute on function public.get_group_by_token(text) to anon, authenticated;
