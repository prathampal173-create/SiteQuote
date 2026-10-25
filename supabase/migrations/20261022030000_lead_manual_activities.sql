-- Phase 1A only. The shared activities contract is extensible to later phases.
-- Manual notes alone can be inserted by mobile clients at this phase.
create table public.activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  lead_id uuid not null,
  project_id uuid,
  type text not null,
  detail jsonb not null,
  created_at timestamptz not null default now(),
  constraint activities_owner_lead_fkey foreign key (user_id, lead_id)
    references public.leads(user_id, id) on delete restrict,
  constraint activities_type_nonblank check (type ~ '[^[:space:]]'),
  constraint activities_manual_note_valid check (
    type <> 'manual_note' or (
      jsonb_typeof(detail) = 'object'
      and jsonb_typeof(detail -> 'note') = 'string'
      and (detail ->> 'note') ~ '[^[:space:]]'
      and length(detail ->> 'note') <= 5000
    )
  ),
  -- Phase 1B+ will add the matching project FK before enabling project_id writes.
  constraint activities_no_unvalidated_project check (project_id is null)
);

create index activities_owner_lead_date_idx
  on public.activities (user_id, lead_id, created_at, id);

alter table public.activities enable row level security;
revoke all on table public.activities from public, anon, authenticated;
grant select on public.activities to authenticated;
grant insert (user_id, lead_id, type, detail) on public.activities to authenticated;

create policy activities_owner_select on public.activities
  for select to authenticated
  using (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  );
create policy activities_owner_manual_insert on public.activities
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
    and type = 'manual_note'
    and project_id is null
  );
-- No UPDATE or DELETE grants/policies: manual history is append-only.
