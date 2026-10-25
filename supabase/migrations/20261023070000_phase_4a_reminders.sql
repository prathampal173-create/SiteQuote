-- Phase 4A: owner-scoped reminders. No notifications / automatic stage advancement.
-- A three-column foreign key prevents linking an owned project from a different lead.
alter table public.projects
  add constraint projects_owner_lead_id_unique unique (user_id, lead_id, id);

create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  lead_id uuid not null,
  project_id uuid,
  kind text not null,
  title text not null,
  note text,
  due_at timestamptz not null,
  status text not null default 'open',
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint reminders_owner_lead_fkey foreign key (user_id, lead_id)
    references public.leads(user_id, id) on delete restrict,
  constraint reminders_owner_lead_project_fkey foreign key (user_id, lead_id, project_id)
    references public.projects(user_id, lead_id, id) on delete restrict,
  constraint reminders_kind_check check (kind in ('site_visit','follow_up','other')),
  constraint reminders_title_check check (length(btrim(title)) between 1 and 200),
  constraint reminders_note_check check (note is null or length(note) <= 5000),
  constraint reminders_status_check check (status in ('open','completed')),
  constraint reminders_completion_consistency check (
    (status = 'open' and completed_at is null) or
    (status = 'completed' and completed_at is not null)
  )
);

create index reminders_owner_status_due_idx on public.reminders (user_id, status, due_at, id);
create index reminders_owner_lead_idx on public.reminders (user_id, lead_id);
create index reminders_owner_project_idx on public.reminders (user_id, project_id)
  where project_id is not null;

-- Enforce future dates on INSERT or actual rescheduling, but allow changes to
-- titles/notes of already-overdue items. Completion time cannot be forged.
create function sitequote_internal.reminder_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.status <> 'open' or new.completed_at is not null then
      raise exception 'New reminders must be open' using errcode = '23514';
    end if;
    if new.due_at <= statement_timestamp() then
      raise exception 'Reminder due time must be in the future' using errcode = '23514';
    end if;
  else
    if new.due_at is distinct from old.due_at and new.due_at <= statement_timestamp() then
      raise exception 'Rescheduled due time must be in the future' using errcode = '23514';
    end if;
    if old.status = 'open' and new.status = 'completed' then
      new.completed_at := statement_timestamp();
    elsif old.status = 'completed' and new.status = 'open' then
      new.completed_at := null;
    else
      new.completed_at := old.completed_at;
    end if;
  end if;
  return new;
end;
$$;
revoke all on function sitequote_internal.reminder_guard() from public, anon, authenticated;
create trigger reminders_before_write before insert or update on public.reminders
  for each row execute function sitequote_internal.reminder_guard();
create trigger reminders_touch_updated_at before update on public.reminders
  for each row execute function sitequote_internal.touch_updated_at();

alter table public.reminders enable row level security;
revoke all on public.reminders from public, anon, authenticated;
grant select on public.reminders to authenticated;
grant insert (user_id, lead_id, project_id, kind, title, note, due_at)
  on public.reminders to authenticated;
grant update (lead_id, project_id, kind, title, note, due_at, status)
  on public.reminders to authenticated;
grant delete on public.reminders to authenticated;

create policy reminders_owner_select on public.reminders for select to authenticated
  using (user_id = (select auth.uid()) and
    coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false');
create policy reminders_owner_insert on public.reminders for insert to authenticated
  with check (user_id = (select auth.uid()) and
    coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false');
create policy reminders_owner_update on public.reminders for update to authenticated
  using (user_id = (select auth.uid()) and
    coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false')
  with check (user_id = (select auth.uid()) and
    coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false');
create policy reminders_owner_delete on public.reminders for delete to authenticated
  using (user_id = (select auth.uid()) and
    coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false');
