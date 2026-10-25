-- SiteQuote 0B4: private bucket and Storage API policies only.
-- Requires 0B2/0B3 migrations. No photo metadata or application CRUD.
-- Do not write storage.objects directly: only the Storage API owns object lifecycle.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('project-site-photos', 'project-site-photos', false, 10485760, array['image/jpeg']::text[])
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- Email-confirmation status is NOT a standard trustworthy JWT claim.
-- A narrowly scoped SECURITY DEFINER helper reads auth.users instead.
-- It returns only a boolean for the calling JWT's own identity, not user data.
create function sitequote_internal.is_verified_photo_user()
returns boolean
language sql stable security definer
set search_path = ''
as $$
  select (select auth.role()) = 'authenticated'
     and (select auth.uid()) is not null
     and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
     and exists (
       select 1 from auth.users as u
       where u.id = (select auth.uid())
         and u.email_confirmed_at is not null
     );
$$;
revoke all on function sitequote_internal.is_verified_photo_user()
  from public, anon, authenticated;

-- Validate the exact 3-component UUID/UUID/UUID.jpg key and ownership.
-- SECURITY INVOKER by default: public.projects is read under 0B3 RLS.
-- CASE ensures malformed text is never cast to uuid.
create function sitequote_internal.owns_photo_path(p_bucket text, p_name text)
returns boolean
language sql stable
set search_path = ''
as $$
  select case
    when p_bucket = 'project-site-photos'
     and p_name ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.jpg$'
     and split_part(p_name, '/', 1) = (select auth.uid())::text
    then exists (
      select 1 from public.projects as p
      where p.id = split_part(p_name, '/', 2)::uuid
        and p.user_id = (select auth.uid())
    )
    else false
  end;
$$;
revoke all on function sitequote_internal.owns_photo_path(text, text)
  from public, anon, authenticated;

-- Internal helpers are not exposed RPCs (sitequote_internal is not an API schema).
-- Authenticated clients can resolve and execute ONLY these narrowly scoped helpers.
grant usage on schema sitequote_internal to authenticated;
grant execute on function sitequote_internal.is_verified_photo_user() to authenticated;
grant execute on function sitequote_internal.owns_photo_path(text, text) to authenticated;

-- Do NOT change storage.objects table grants or RLS globally: other buckets
-- depend on the Supabase-managed Storage role privileges and policies.
-- In particular, no UPDATE policy is defined for this bucket.
-- Operation allowlist prevents SELECT+INSERT from enabling copy or move.
create policy sitequote_project_photos_select
on storage.objects for select to authenticated
using (
  bucket_id = 'project-site-photos'
  and sitequote_internal.is_verified_photo_user()
  and sitequote_internal.owns_photo_path(bucket_id, name)
  and storage.allow_any_operation(array[
    'object.get_authenticated',
    'object.get_authenticated_info',
    'object.head_authenticated_info',
    'object.info_authenticated',
    'object.list',
    'object.list_v2',
    'object.sign',
    'object.sign_many',
    -- Storage may SELECT its own object before insert or deletion.
    'object.upload',
    'object.delete',
    'object.delete_many'
  ]::text[])
);

create policy sitequote_project_photos_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'project-site-photos'
  and sitequote_internal.is_verified_photo_user()
  and sitequote_internal.owns_photo_path(bucket_id, name)
  and storage.allow_only_operation('object.upload')
);

create policy sitequote_project_photos_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'project-site-photos'
  and sitequote_internal.is_verified_photo_user()
  and sitequote_internal.owns_photo_path(bucket_id, name)
  and storage.allow_any_operation(array['object.delete', 'object.delete_many']::text[])
);
