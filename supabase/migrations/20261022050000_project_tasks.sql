-- Phase 1C: project-scoped, independently editable tasks; no pricing/quote tables.
-- Amounts are exact nonnegative USD cents within JavaScript's safe integer range.
create table public.project_tasks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  project_id uuid not null,
  category text not null,
  title text not null,
  notes text,
  amount_minor bigint not null default 0,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_tasks_owner_project_fkey
    foreign key (user_id, project_id) references public.projects(user_id, id) on delete restrict,
  constraint project_tasks_category_valid check (category in (
    'House Remodeling', 'Kitchen Remodeling', 'Bathroom Remodeling',
    'Flooring', 'Painting', 'Electrical/Plumbing', 'Miscellaneous'
  )),
  constraint project_tasks_title_nonblank check (title ~ '[^[:space:]]'),
  constraint project_tasks_amount_safe check (amount_minor between 0 and 9007199254740991),
  constraint project_tasks_sort_order_nonnegative check (sort_order >= 0)
);

-- Do NOT add a unique constraint on (project_id, category): categories repeat.
create index project_tasks_user_project_sort_idx
  on public.project_tasks (user_id, project_id, sort_order, created_at, id);

create trigger project_tasks_touch_updated_at
  before update on public.project_tasks
  for each row execute function sitequote_internal.touch_updated_at();

-- Locks the parent project while changing tasks. A concurrent project decision
-- cannot interleave a task write with the Won/Lost transition. This check runs
-- even when the client omits the status query; RLS/ACL are separate safeguards.
create function sitequote_internal.enforce_editable_project_task()
returns trigger language plpgsql set search_path = '' as $$
declare
  parent_status public.project_status;
  owner_id uuid;
  parent_id uuid;
begin
  owner_id := case when tg_op = 'DELETE' then old.user_id else new.user_id end;
  parent_id := case when tg_op = 'DELETE' then old.project_id else new.project_id end;
  if tg_op = 'UPDATE' and
    (new.user_id is distinct from old.user_id or new.project_id is distinct from old.project_id) then
    raise exception 'Task ownership and project cannot be reassigned' using errcode = '23514';
  end if;
  select status into parent_status from public.projects
    where user_id = owner_id and id = parent_id for update;
  if parent_status is null then
    raise exception 'Owning project unavailable' using errcode = '23503';
  end if;
  if parent_status in ('won', 'lost') then
    raise exception 'Reopen project before changing tasks' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function sitequote_internal.enforce_editable_project_task() from public, anon, authenticated;
create trigger project_tasks_edit_guard
  before insert or update or delete on public.project_tasks
  for each row execute function sitequote_internal.enforce_editable_project_task();

alter table public.project_tasks enable row level security;
revoke all on table public.project_tasks from public, anon, authenticated;
grant select on public.project_tasks to authenticated;
grant insert (user_id, project_id, category, title, notes, amount_minor, sort_order)
  on public.project_tasks to authenticated;
grant update (category, title, notes, amount_minor, sort_order)
  on public.project_tasks to authenticated;
grant delete on public.project_tasks to authenticated;

create policy project_tasks_owner_select on public.project_tasks
  for select to authenticated using (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  );
create policy project_tasks_owner_insert on public.project_tasks
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  );
create policy project_tasks_owner_update on public.project_tasks
  for update to authenticated using (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  ) with check (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  );
create policy project_tasks_owner_delete on public.project_tasks
  for delete to authenticated using (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  );
