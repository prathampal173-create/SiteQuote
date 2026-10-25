-- Phase 2B LOCAL SQL policy/constraint checks, run via psql as local DB owner
-- AFTER applying every migration. No fabricated storage.objects rows.
\set ON_ERROR_STOP on
begin;
do $checks$
declare p record;
begin
  if (select public from storage.buckets where id = 'project-site-photos') is distinct from false then
    raise exception 'Photo bucket is not private';
  end if;
  if (select relrowsecurity from pg_class where oid = 'public.project_photos'::regclass) is distinct from true then
    raise exception 'project_photos RLS disabled';
  end if;
  if has_table_privilege('anon', 'public.project_photos', 'SELECT') or
     has_table_privilege('anon', 'public.project_photos', 'INSERT') or
     has_table_privilege('authenticated', 'public.project_photos', 'UPDATE') then
    raise exception 'Wrong photo metadata table privileges';
  end if;
  if has_column_privilege('authenticated', 'public.project_photos', 'state', 'INSERT') or
     has_column_privilege('authenticated', 'public.project_photos', 'storage_path', 'UPDATE') then
    raise exception 'Protected photo columns writable';
  end if;
  if not has_table_privilege('authenticated','public.project_photos','SELECT') or
     not has_column_privilege('authenticated','public.project_photos','source','INSERT') then
    raise exception 'Missing photo RLS/client grants';
  end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename='project_photos' and cmd in ('SELECT','INSERT')) <> 2 then
    raise exception 'Unexpected photo metadata policies';
  end if;
  for p in select * from pg_policies where schemaname='public' and tablename='project_photos' and cmd in ('SELECT','INSERT') loop
    if p.roles <> array['authenticated'::name] or p.cmd not in ('SELECT','INSERT') or
       position('is_verified_photo_user' in coalesce(p.qual,'') || coalesce(p.with_check,'')) = 0 or
       position('auth.uid' in coalesce(p.qual,'') || coalesce(p.with_check,'')) = 0 then
      raise exception 'Unscoped policy: %', p.policyname;
    end if;
  end loop;
  if not exists (select 1 from pg_constraint where conname='project_photos_owner_project_fk' and contype='f') or
     not exists (select 1 from pg_constraint where conname='project_photos_matching_task_fk' and contype='f') or
     not exists (select 1 from pg_constraint where conname='project_photos_exact_path' and contype='c') then
    raise exception 'Missing owner/project/task or exact path constraints';
  end if;
  if not exists (select 1 from pg_trigger where tgname='project_photos_uploaded_object' and not tgisinternal) then
    raise exception 'Missing uploaded-object verification';
  end if;
  if not exists (select 1 from pg_proc where oid='sitequote_internal.verify_uploaded_photo()'::regprocedure and prosecdef) then
    raise exception 'Uploaded-file check cannot see operation-scoped Storage objects';
  end if;
  raise notice 'PASS: Phase 2B metadata policies, grants, FK/path constraints and Storage gating';
end;
$checks$;

-- Verify F01 fix under a *real* authenticated owner context. These fixtures
-- are rolled back. No direct storage.objects writes are made.
insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,created_at,updated_at)
values ('33333333-3333-4333-8333-333333333333','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','phase2b-owner@example.test',now(),now(),now());
insert into public.leads(id,user_id,customer_name,phone,source)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','Owner','123','Other');
insert into public.projects(id,user_id,lead_id,title)
values ('aaaaaaaa-0000-4000-8000-000000000001','33333333-3333-4333-8333-333333333333',
 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','Photo project');
set local role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
select set_config('request.jwt.claims',
 '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","is_anonymous":false}',true);
do $path$
declare
  valid text := '33333333-3333-4333-8333-333333333333/aaaaaaaa-0000-4000-8000-000000000001/cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg';
begin
  if not sitequote_internal.owns_photo_path('project-site-photos',valid) then
    raise exception 'F01 still blocks standard 8-4-4-4-12 UUID filename';
  end if;
  if sitequote_internal.owns_photo_path('project-site-photos',
    replace(valid,'cccccccc-cccc-4ccc-8ccc-cccccccccccc','cccccccc-cccc-4ccc-cccccccccccc')) then
    raise exception 'F01 malformed 8-4-4-12 UUID erroneously accepted';
  end if;
  raise notice 'PASS: strict UUID/UUID/UUID.jpg ownership gate';
end;
$path$;
rollback;
