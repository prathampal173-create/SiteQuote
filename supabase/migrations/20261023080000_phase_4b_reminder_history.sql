-- Phase 4B: append-only completion/reopen history. No stage advancement or notifications.
-- An intentionally deleted reminder deletes its history (owner privacy / data minimization).
-- This migration only adds objects; 4A behavior and its guard remain unchanged.
alter table public.reminders
  add constraint reminders_owner_id_unique unique (user_id, id);

create table public.reminder_completion_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null,
  reminder_id uuid not null,
  event_type text not null check (event_type in ('completed', 'reopened')),
  occurred_at timestamptz not null,
  lead_id uuid not null,
  project_id uuid,
  reminder_title text not null,
  reminder_kind text not null,
  reminder_due_at timestamptz not null,
  constraint reminder_events_owner_reminder_fk foreign key (user_id, reminder_id)
    references public.reminders(user_id, id) on delete cascade
);
-- Preserve the one currently knowable completion for reminders saved during 4A.
-- Historic 4A completions already erased by reopening cannot be reconstructed.
insert into public.reminder_completion_events (
  user_id, reminder_id, event_type, occurred_at, lead_id, project_id,
  reminder_title, reminder_kind, reminder_due_at
)
select user_id, id, 'completed', completed_at, lead_id, project_id,
  title, kind, due_at
from public.reminders
where status = 'completed' and completed_at is not null;

create index reminder_events_owner_reminder_time_idx
  on public.reminder_completion_events (user_id, reminder_id, occurred_at desc, id desc);

-- Invoker cannot insert into the history table. Runs as migration owner, with an
-- empty search path; each genuine transition is recorded in the same transaction.
create function sitequote_internal.record_reminder_transition()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.status is distinct from new.status then
    insert into public.reminder_completion_events (
      user_id, reminder_id, event_type, occurred_at, lead_id, project_id,
      reminder_title, reminder_kind, reminder_due_at
    ) values (
      new.user_id, new.id,
      case when new.status = 'completed' then 'completed' else 'reopened' end,
      statement_timestamp(), new.lead_id, new.project_id,
      new.title, new.kind, new.due_at
    );
  end if;
  return null;
end;
$$;
revoke all on function sitequote_internal.record_reminder_transition()
  from public, anon, authenticated;
create trigger reminders_transition_history
  after update of status on public.reminders
  for each row execute function sitequote_internal.record_reminder_transition();

alter table public.reminder_completion_events enable row level security;
revoke all on public.reminder_completion_events from public, anon, authenticated;
grant select on public.reminder_completion_events to authenticated;
create policy reminder_events_owner_read on public.reminder_completion_events
  for select to authenticated
  using (
    user_id = (select auth.uid()) and
    coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  );
