-- Run with psql as database owner against a DISPOSABLE migrated instance.
-- Real Storage API cross-account fixtures are in scripts/check-storage-two-accounts.mjs.
\set ON_ERROR_STOP on
begin;
do $checks$
declare
  p record;
  definition text;
begin
  if not (select relrowsecurity from pg_class where oid='public.project_photos'::regclass) then
    raise exception 'photo metadata RLS disabled';
  end if;
  if not has_column_privilege('authenticated', 'public.project_photos', 'state', 'UPDATE') or
     not has_table_privilege('authenticated', 'public.project_photos', 'DELETE') then
    raise exception 'required delete transition grants missing';
  end if;
  if has_column_privilege('authenticated', 'public.project_photos', 'storage_path', 'UPDATE') or
     has_column_privilege('authenticated', 'public.project_photos', 'source', 'UPDATE') or
     has_column_privilege('authenticated', 'public.project_photos', 'user_id', 'UPDATE') or
     has_table_privilege('anon', 'public.project_photos', 'DELETE') then
    raise exception 'excessive photo mutation grants';
  end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename='project_photos'
       and cmd in ('SELECT','INSERT','UPDATE','DELETE')) <> 4 then
    raise exception 'wrong metadata policy count';
  end if;
  for p in select * from pg_policies where schemaname='public'
    and tablename='project_photos' and cmd in ('UPDATE','DELETE') loop
    if p.roles <> array['authenticated'::name] or
       position('is_verified_photo_user' in coalesce(p.qual,'') || coalesce(p.with_check,''))=0 or
       position('auth.uid' in coalesce(p.qual,'') || coalesce(p.with_check,''))=0 then
      raise exception 'insecure photo % policy', p.cmd;
    end if;
  end loop;
  if not exists (select 1 from pg_trigger
    where tgname='project_photos_guard_delete_transition' and not tgisinternal) or
     not exists (select 1 from pg_trigger
    where tgname='project_photos_verify_removed' and not tgisinternal) then
    raise exception 'photo deletion triggers missing';
  end if;
  if not exists (select 1 from pg_proc
    where oid='sitequote_internal.verify_photo_removed()'::regprocedure and prosecdef) then
    raise exception 'Storage absence is not verified as restricted definer';
  end if;
  select qual into definition from pg_policies where schemaname='storage' and tablename='objects'
    and policyname='sitequote_project_photos_delete';
  if definition is null or position('project_photos' in definition)=0 or
     position('active' in definition)=0 or
     position('owns_photo_path' in definition)=0 then
    raise exception 'Storage DELETE policy must block active photo files';
  end if;
  raise notice 'PASS: owner-scoped 2C metadata transition and storage delete guards';
end;
$checks$;
rollback;
