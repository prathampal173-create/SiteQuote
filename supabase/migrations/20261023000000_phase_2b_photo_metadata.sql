-- Phase 2B: private photo metadata and forward repair of Phase 0B4 Storage path validation.
-- Never modify the already-applied 0B4 migration; object bytes belong to Storage API.
-- The bucket is private even when this migration is applied to an existing installation.
update storage.buckets
set public = false, file_size_limit = 10485760,
    allowed_mime_types = array['image/jpeg']::text[]
where id = 'project-site-photos';

-- F01: existing filename regex incorrectly omitted one 4-hex UUID group.
-- Replace helper, preserving the same Storage policy names/operation allowlists.
create or replace function sitequote_internal.owns_photo_path(p_bucket text, p_name text)
returns boolean language sql stable set search_path = '' as $$
  select case when p_bucket = 'project-site-photos'
    and p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
    and split_part(p_name, '/', 1) = (select auth.uid())::text
  then exists (
    select 1 from public.projects p
    where p.id = split_part(p_name, '/', 2)::uuid
      and p.user_id = (select auth.uid())
  ) else false end;
$$;
-- Internal invoker helper only; no public API endpoint.
revoke all on function sitequote_internal.owns_photo_path(text,text) from public, anon;
grant execute on function sitequote_internal.owns_photo_path(text,text) to authenticated;

-- Key columns stay immutable: Phase 2C may implement the two-step deleting workflow.
-- In 2B clients can only INSERT and SELECT (no UPDATE/DELETE grants).
alter table public.project_tasks add constraint project_tasks_owner_project_id_unique
  unique (user_id, project_id, id);

create table public.project_photos (
  id uuid primary key,
  user_id uuid not null references auth.users(id),
  project_id uuid not null,
  task_id uuid,
  storage_path text not null unique,
  source text not null check (source in ('site_visit', 'client_provided')),
  state text not null default 'active' check (state in ('active', 'deleting')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint project_photos_owner_project_fk foreign key (user_id, project_id)
    references public.projects (user_id, id) on delete restrict,
  constraint project_photos_matching_task_fk foreign key (user_id, project_id, task_id)
    references public.project_tasks (user_id, project_id, id) on delete restrict,
  constraint project_photos_exact_path check (
    storage_path = user_id::text || '/' || project_id::text || '/' || id::text || '.jpg'
  )
);
create index project_photos_owner_project_task_created_idx
  on public.project_photos (user_id, project_id, task_id, created_at, id);
create trigger project_photos_touch_updated_at before update on public.project_photos
  for each row execute function sitequote_internal.touch_updated_at();

-- Do not accept invented metadata for a missing or foreign object. This runs as
-- the authenticated invoker and checks a REAL Storage API-created object row.
-- INSERT goes after upload, not before. Never write storage.objects from SQL.
create function sitequote_internal.verify_uploaded_photo()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  -- Read Storage's physical object as the restricted migration owner; ordinary
  -- Storage policies are operation-aware and do not authorize PostgREST reads.
  if new.user_id is distinct from (select auth.uid()) or
     not sitequote_internal.is_verified_photo_user() then
    raise exception 'Photo access denied' using errcode = '42501';
  end if;
  if not exists (
    select 1 from storage.objects o
    where o.bucket_id = 'project-site-photos' and o.name = new.storage_path
  ) then
    raise exception 'Photo file unavailable for metadata' using errcode = '23503';
  end if;
  return new;
end;
$$;
revoke all on function sitequote_internal.verify_uploaded_photo() from public, anon, authenticated;
create trigger project_photos_uploaded_object before insert on public.project_photos
  for each row execute function sitequote_internal.verify_uploaded_photo();

alter table public.project_photos enable row level security;
revoke all on public.project_photos from public, anon, authenticated;
grant select on public.project_photos to authenticated;
grant insert (id, user_id, project_id, task_id, storage_path, source)
  on public.project_photos to authenticated;

create policy project_photos_owner_read on public.project_photos
  for select to authenticated using (
    user_id = (select auth.uid())
    and sitequote_internal.is_verified_photo_user()
  );
create policy project_photos_owner_create on public.project_photos
  for insert to authenticated with check (
    user_id = (select auth.uid())
    and sitequote_internal.is_verified_photo_user()
    and state = 'active'
  );
