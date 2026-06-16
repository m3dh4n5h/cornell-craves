-- Cornell Craves: Q&A helpful is now a signed-in, per-user toggle, and the
-- club's answer can be marked helpful separately from the question.

-- Separate helpful tally for the club's answer.
alter table public.qa
  add column if not exists answer_helpful_count int not null default 0;

-- One row per (qa, user, target). The unique constraint makes the toggle safe.
create table public.qa_helpful_votes (
  id uuid primary key default gen_random_uuid(),
  qa_id uuid not null references public.qa (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  target text not null check (target in ('question', 'answer')),
  created_at timestamptz not null default now(),
  unique (qa_id, user_id, target)
);

create index qa_helpful_votes_qa_idx on public.qa_helpful_votes (qa_id);

alter table public.qa_helpful_votes enable row level security;

-- A user can read their own votes (drives the toggled UI state); writes go
-- through the SECURITY DEFINER RPC only.
create policy "Users see their own qa votes"
  on public.qa_helpful_votes for select
  using (user_id = auth.uid());

-- Toggle: returns the new { voted, count }. Signed-in only.
create or replace function public.toggle_qa_helpful(p_qa_id uuid, p_target text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_exists boolean;
  v_count int;
begin
  if auth.uid() is null then
    raise exception 'Sign in to mark answers helpful';
  end if;
  if p_target not in ('question', 'answer') then
    raise exception 'Invalid helpful target';
  end if;

  select exists (
    select 1 from public.qa_helpful_votes
    where qa_id = p_qa_id and user_id = auth.uid() and target = p_target
  ) into v_exists;

  if v_exists then
    delete from public.qa_helpful_votes
    where qa_id = p_qa_id and user_id = auth.uid() and target = p_target;
    if p_target = 'question' then
      update public.qa set helpful_count = greatest(helpful_count - 1, 0)
      where id = p_qa_id returning helpful_count into v_count;
    else
      update public.qa set answer_helpful_count = greatest(answer_helpful_count - 1, 0)
      where id = p_qa_id returning answer_helpful_count into v_count;
    end if;
    return jsonb_build_object('voted', false, 'count', coalesce(v_count, 0));
  else
    insert into public.qa_helpful_votes (qa_id, user_id, target)
    values (p_qa_id, auth.uid(), p_target);
    if p_target = 'question' then
      update public.qa set helpful_count = helpful_count + 1
      where id = p_qa_id returning helpful_count into v_count;
    else
      update public.qa set answer_helpful_count = answer_helpful_count + 1
      where id = p_qa_id returning answer_helpful_count into v_count;
    end if;
    return jsonb_build_object('voted', true, 'count', coalesce(v_count, 0));
  end if;
end;
$$;

revoke execute on function public.toggle_qa_helpful(uuid, text) from public, anon;
grant execute on function public.toggle_qa_helpful(uuid, text) to authenticated;

-- Posting a question now requires a signed-in (non-club) account.
drop policy if exists "Non-club users can ask" on public.qa;
create policy "Signed-in non-club users can ask"
  on public.qa for insert
  with check (
    auth.uid() is not null
    and not exists (select 1 from public.clubs c where c.id = auth.uid())
  );
