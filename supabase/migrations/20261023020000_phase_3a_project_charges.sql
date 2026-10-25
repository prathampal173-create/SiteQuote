-- Phase 3A: project working estimate. Tax (0..3000 basis points) already lives on
-- projects and task prices already live on project_tasks. No quote snapshots here.
create table public.project_additional_charges (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  project_id uuid not null,
  description text not null,
  amount_minor bigint not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_additional_charges_owner_project_fk
    foreign key (user_id, project_id) references public.projects(user_id, id) on delete restrict,
  constraint project_additional_charges_description_nonblank check (description ~ '[^[:space:]]'),
  constraint project_additional_charges_amount_safe check (amount_minor between 0 and 9007199254740991),
  constraint project_additional_charges_sort_nonnegative check (sort_order >= 0)
);
create index project_additional_charges_owner_order_idx
  on public.project_additional_charges (user_id, project_id, sort_order, created_at, id);
create trigger project_additional_charges_updated_at
  before update on public.project_additional_charges
  for each row execute function sitequote_internal.touch_updated_at();

-- Lock the parent row when adding, editing or deleting a charge so project
-- decisions cannot race past the open-project check. Ownership never changes.
create function sitequote_internal.enforce_editable_project_charge()
returns trigger language plpgsql set search_path = '' as $$
declare parent_status public.project_status;
begin
  if tg_op = 'UPDATE' and
    (new.user_id is distinct from old.user_id or
     new.project_id is distinct from old.project_id) then
    raise exception 'Charge ownership/project cannot change' using errcode = '23514';
  end if;
  select status into parent_status from public.projects
    where user_id = (case when tg_op = 'DELETE' then old.user_id else new.user_id end)
      and id = (case when tg_op = 'DELETE' then old.project_id else new.project_id end)
    for update;
  if parent_status is null then
    raise exception 'Owning project unavailable' using errcode = '23503';
  end if;
  if parent_status in ('won', 'lost') then
    raise exception 'Reopen project before editing charges' using errcode = '23514';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;
revoke all on function sitequote_internal.enforce_editable_project_charge() from public, anon, authenticated;
create trigger project_additional_charges_edit_guard
  before insert or update or delete on public.project_additional_charges
  for each row execute function sitequote_internal.enforce_editable_project_charge();

alter table public.project_additional_charges enable row level security;
revoke all on table public.project_additional_charges from public, anon, authenticated;
grant select on public.project_additional_charges to authenticated;
grant insert (user_id, project_id, description, amount_minor, sort_order)
  on public.project_additional_charges to authenticated;
grant update (description, amount_minor, sort_order)
  on public.project_additional_charges to authenticated;
grant delete on public.project_additional_charges to authenticated;
create policy project_additional_charges_owner_select on public.project_additional_charges
  for select to authenticated using (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  );
create policy project_additional_charges_owner_insert on public.project_additional_charges
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  );
create policy project_additional_charges_owner_update on public.project_additional_charges
  for update to authenticated using (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  ) with check (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  );
create policy project_additional_charges_owner_delete on public.project_additional_charges
  for delete to authenticated using (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  );
