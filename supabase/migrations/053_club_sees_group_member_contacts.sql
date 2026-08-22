-- Cornell Craves 053: the club can see its split-order members' email + NetID.
--
-- Why: a club fulfilling a split has to reach the four students sharing a box
-- the same way it reaches a solo buyer - to chase an unpaid share, to sort out
-- a refund on a canceled group, or to hand food to the right person. Solo
-- orders already give the club `orderer_email` and `orderer_netid` (003), but
-- split members were reachable only through their Venmo/Zelle handle, because
-- group_payload() (048) builds each member as first name + last initial and
-- nothing else. The club's own orders dashboard and CSV export had blanks where
-- the contact details belong.
--
-- Where the fields are added, and why not in group_payload():
--   group_payload() is the shared internal helper behind FOUR audiences -
--   get_club_groups (the club), get_my_groups + get_my_group_invites (a
--   student, who would then see their co-members' addresses), and
--   get_group_by_token (reachable by ANON, so an invite link forwarded to
--   anyone would carry them). 051 already had to strip payment handles back out
--   of the anon copy after 043 added them to the shared payload; repeating that
--   pattern means every future audience leaks by default until someone
--   remembers to strip.
--
--   So the contact details are added ONLY in get_club_groups, on top of the
--   shared payload. Every other caller is untouched and keeps exactly the
--   fields it has today - no strip step to forget, and a new RPC built on
--   group_payload() gets no contact data unless it asks for it.
--
-- Source of truth per member: the profile's cornell_email, falling back to the
-- auth address they signed in with, and cornell_netid when the student has
-- filled it in. Missing values come back as "" rather than null so the client
-- can render them without null checks (matching how the rest of the payload
-- treats optional text).
--
-- Run after 052_split_security_hardening. Idempotent: safe to re-run.

create or replace function public.get_club_groups()
returns setof jsonb
language sql
stable
security definer
set search_path = public
as $$
  select base.payload || jsonb_build_object('members', coalesce(contacts.members, '[]'::jsonb))
  from public.order_groups g
  join public.listings l on l.id = g.listing_id
  -- One group_payload() call per group; the lateral keeps it out of the
  -- projection so it is not evaluated twice per row.
  cross join lateral (select public.group_payload(g.id) as payload) base
  cross join lateral (
    select jsonb_agg(
             entry.member
               || jsonb_build_object(
                 'email', coalesce(nullif(btrim(u.cornell_email), ''), au.email, ''),
                 'netid', coalesce(nullif(btrim(u.cornell_netid), ''), '')
               )
             order by entry.ord
           ) as members
    from jsonb_array_elements(base.payload -> 'members') with ordinality as entry(member, ord)
    left join public.users_extended u on u.id = (entry.member ->> 'user_id')::uuid
    left join auth.users au on au.id = (entry.member ->> 'user_id')::uuid
  ) contacts
  where l.club_id = auth.uid()
  order by g.created_at desc;
$$;

-- Unchanged from 004, restated because create-or-replace does not carry grants
-- forward on a signature that never existed under a different owner. Only the
-- club's own session reaches this, and the body is scoped by auth.uid().
revoke execute on function public.get_club_groups() from public, anon;
grant execute on function public.get_club_groups() to authenticated;
