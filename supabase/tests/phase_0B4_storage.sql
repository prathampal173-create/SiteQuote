-- Phase 0B4 LOCAL SQL checks. psql with a local database-owner connection.
-- SQL role simulation tests helper predicates and policy definitions only.
-- REAL Storage API assertions are in scripts/check-storage-two-accounts.mjs.
-- Do not insert, update or delete storage.objects rows: metadata != file bytes.
\set ON_ERROR_STOP on
begin;

do $audit$
declare
  record_policy record;
  definition text;
begin
  if not exists (
    select 1 from storage.buckets
    where id = 'project-site-photos' and name = 'project-site-photos'
      and public = false and file_size_limit = 10485760
      and allowed_mime_types = array['image/jpeg']::text[]
  ) then raise exception 'FAIL: bucket private/type/size config'; end if;

  if not (select relrowsecurity from pg_class where oid = 'storage.objects'::regclass) then
    raise exception 'FAIL: Storage objects RLS must be enabled';
  end if;
  if (select count(*) from pg_policies
      where schemaname = 'storage' and tablename = 'objects'
        and policyname like 'sitequote_project_photos_%') <> 3 then
    raise exception 'FAIL: expected exactly three SiteQuote Storage policies';
  end if;
  for record_policy in
    select * from pg_policies where schemaname='storage' and tablename='objects'
      and policyname like 'sitequote_project_photos_%'
  loop
    if record_policy.roles <> array['authenticated'::name]
       or record_policy.permissive <> 'PERMISSIVE'
       or record_policy.cmd not in ('SELECT','INSERT','DELETE') then
      raise exception 'FAIL: invalid role/command on %', record_policy.policyname;
    end if;
    definition := coalesce(record_policy.qual,'') || coalesce(record_policy.with_check,'');
    if position('is_verified_photo_user' in definition)=0
       or position('owns_photo_path' in definition)=0
       or position('project-site-photos' in definition)=0 then
      raise exception 'FAIL: missing owner/bucket/verification checks in %', record_policy.policyname;
    end if;
    if position('allow_' in definition)=0 then
      raise exception 'FAIL: operation allowlist missing in %', record_policy.policyname;
    end if;
  end loop;
  if not exists (select 1 from pg_policies
       where schemaname='storage' and tablename='objects'
         and policyname='sitequote_project_photos_insert' and cmd='INSERT'
         and with_check like '%allow_only_operation%') then
    raise exception 'FAIL: upload operations not restricted';
  end if;
  if exists (select 1 from pg_policies where schemaname='storage'
    and tablename='objects' and policyname like 'sitequote_project_photos_%'
    and (cmd='UPDATE' or roles && array['anon'::name,'public'::name])) then
    raise exception 'FAIL: anonymous or UPDATE policy exists';
  end if;
  if not (select prosecdef from pg_proc
    where oid='sitequote_internal.is_verified_photo_user()'::regprocedure) then
    raise exception 'FAIL: verified-email helper needs restricted auth.users access';
  end if;
  if has_function_privilege('anon','sitequote_internal.is_verified_photo_user()','EXECUTE')
     or has_function_privilege('anon','sitequote_internal.owns_photo_path(text,text)','EXECUTE') then
    raise exception 'FAIL: anon may call internal helpers';
  end if;
  if not has_function_privilege('authenticated','sitequote_internal.is_verified_photo_user()','EXECUTE')
     or not has_function_privilege('authenticated','sitequote_internal.owns_photo_path(text,text)','EXECUTE') then
    raise exception 'FAIL: authenticated helpers not callable';
  end if;
  raise notice 'PASS: private bucket and operation-scoped policy definitions';
end;
$audit$;

-- The following auth.users/lead/project fixtures are rolled back. No Storage
-- object row is created. SET LOCAL ROLE mirrors the PostgREST database role.
insert into auth.users(id,instance_id,aud,role,email,email_confirmed_at,created_at,updated_at)
values
 ('33333333-3333-4333-8333-333333333333','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','photo-a@example.test',now(),now(),now()),
 ('44444444-4444-4444-8444-444444444444','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','photo-b@example.test',now(),now(),now()),
 ('55555555-5555-4555-8555-555555555555','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','photo-unconfirmed@example.test',null,now(),now());
insert into public.leads(id,user_id,customer_name,phone,source)
values
 ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','33333333-3333-4333-8333-333333333333','A fixture','123','Other'),
 ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','44444444-4444-4444-8444-444444444444','B fixture','123','Other');
insert into public.projects(id,user_id,lead_id,title)
values
 ('aaaaaaaa-0000-4000-8000-000000000001','33333333-3333-4333-8333-333333333333',
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','A project'),
 ('bbbbbbbb-0000-4000-8000-000000000001','44444444-4444-4444-8444-444444444444',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb','B project');

set local role authenticated;
select set_config('request.jwt.claim.sub','33333333-3333-4333-8333-333333333333',true);
select set_config('request.jwt.claims',
 '{"sub":"33333333-3333-4333-8333-333333333333","role":"authenticated","is_anonymous":false}',true);

do $role_a$
declare
  a_path text := '33333333-3333-4333-8333-333333333333/aaaaaaaa-0000-4000-8000-000000000001/cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg';
  b_path text := '44444444-4444-4444-8444-444444444444/bbbbbbbb-0000-4000-8000-000000000001/cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg';
  wrong_project text := '33333333-3333-4333-8333-333333333333/bbbbbbbb-0000-4000-8000-000000000001/cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg';
begin
  if not sitequote_internal.is_verified_photo_user() then
    raise exception 'FAIL: confirmed account A rejected'; end if;
  if not sitequote_internal.owns_photo_path('project-site-photos',a_path) then
    raise exception 'FAIL: correct A project path rejected'; end if;
  if sitequote_internal.owns_photo_path('project-site-photos',b_path)
    or sitequote_internal.owns_photo_path('project-site-photos',wrong_project)
    or sitequote_internal.owns_photo_path('unrelated-bucket',a_path)
    or sitequote_internal.owns_photo_path('project-site-photos',a_path || '/extra')
    or sitequote_internal.owns_photo_path('project-site-photos',replace(a_path,'.jpg','.png'))
    or sitequote_internal.owns_photo_path('project-site-photos',replace(a_path,'cccccccc-cccc-4ccc-8ccc-cccccccccccc','not-a-uuid'))
    or sitequote_internal.owns_photo_path('project-site-photos',replace(a_path,'aaaaaaaa-0000-4000-8000-000000000001','ffffffff-ffff-4fff-8fff-ffffffffffff')) then
    raise exception 'FAIL: malformed, foreign, or nonexistent path accepted';
  end if;
  raise notice 'PASS: authenticated A project/path checks';
end;
$role_a$;

select set_config('request.jwt.claim.sub','44444444-4444-4444-8444-444444444444',true);
select set_config('request.jwt.claims',
 '{"sub":"44444444-4444-4444-8444-444444444444","role":"authenticated","is_anonymous":false}',true);
do $role_b$
begin
  if not sitequote_internal.is_verified_photo_user() then
    raise exception 'FAIL: confirmed B rejected'; end if;
  if sitequote_internal.owns_photo_path('project-site-photos',
     '33333333-3333-4333-8333-333333333333/aaaaaaaa-0000-4000-8000-000000000001/cccccccc-cccc-4ccc-8ccc-cccccccccccc.jpg') then
    raise exception 'FAIL: B can access A path'; end if;
  raise notice 'PASS: B cannot use A path';
end;
$role_b$;

select set_config('request.jwt.claim.sub','55555555-5555-4555-8555-555555555555',true);
select set_config('request.jwt.claims',
 '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated","is_anonymous":false}',true);
do $unverified$
begin
  if sitequote_internal.is_verified_photo_user() then
    raise exception 'FAIL: unconfirmed Auth identity permitted'; end if;
  raise notice 'PASS: unconfirmed email rejected';
end;
$unverified$;

select set_config('request.jwt.claims',
 '{"sub":"55555555-5555-4555-8555-555555555555","role":"authenticated","is_anonymous":true}',true);
do $anonymous$
begin
  if sitequote_internal.is_verified_photo_user() then
    raise exception 'FAIL: anonymous Auth identity permitted'; end if;
  raise notice 'PASS: anonymous Auth identity rejected';
end;
$anonymous$;

rollback;
