-- Phase 2C: forward-only owner-controlled two-step photo deletion.
-- State change precedes Storage API removal; row delete is blocked while the
-- Storage object exists. Storage objects are NEVER mutated through SQL.
create function sitequote_internal.guard_photo_delete_transition()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.user_id is distinct from (select auth.uid()) or
     not sitequote_internal.is_verified_photo_user() or
     old.state <> 'active' or new.state <> 'deleting' or
     (to_jsonb(new) - 'state' - 'updated_at') is distinct from
     (to_jsonb(old) - 'state' - 'updated_at') then
    raise exception 'Invalid photo deletion transition' using errcode = '42501';
  end if;
  return new;
end;
$$;
revoke all on function sitequote_internal.guard_photo_delete_transition() from public, anon, authenticated;
create trigger project_photos_guard_delete_transition before update on public.project_photos
  for each row execute function sitequote_internal.guard_photo_delete_transition();

-- Restricted definer can verify physical Storage absence despite operation-gated
-- Storage SELECT policies. Even a malicious client cannot detach live objects.
create function sitequote_internal.verify_photo_removed()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if old.user_id is distinct from (select auth.uid()) or
     not sitequote_internal.is_verified_photo_user() or old.state <> 'deleting' then
    raise exception 'Photo delete access denied' using errcode = '42501';
  end if;
  if exists (select 1 from storage.objects o
             where o.bucket_id = 'project-site-photos' and o.name = old.storage_path) then
    raise exception 'Remove Storage object before metadata' using errcode = '23503';
  end if;
  return old;
end;
$$;
revoke all on function sitequote_internal.verify_photo_removed() from public, anon, authenticated;
create trigger project_photos_verify_removed before delete on public.project_photos
  for each row execute function sitequote_internal.verify_photo_removed();

-- Minimal column grants: no edits to owner, path, source, task, project, or timestamps.
grant update (state) on public.project_photos to authenticated;
grant delete on public.project_photos to authenticated;
create policy project_photos_owner_mark_deleting on public.project_photos
  for update to authenticated using (
    user_id = (select auth.uid()) and sitequote_internal.is_verified_photo_user()
  ) with check (
    user_id = (select auth.uid()) and sitequote_internal.is_verified_photo_user()
    and state = 'deleting'
  );
create policy project_photos_owner_remove on public.project_photos
  for delete to authenticated using (
    user_id = (select auth.uid()) and sitequote_internal.is_verified_photo_user()
    and state = 'deleting'
  );

-- Phase 0B4 permitted deleting an owned object while its metadata was ACTIVE.
-- Tighten deletion: only untracked or already-marked `deleting` objects may go.
-- Both the metadata RLS and exact owner/path gate still apply.
drop policy sitequote_project_photos_delete on storage.objects;
create policy sitequote_project_photos_delete on storage.objects
  for delete to authenticated using (
    bucket_id = 'project-site-photos'
    and sitequote_internal.is_verified_photo_user()
    and sitequote_internal.owns_photo_path(bucket_id, name)
    and storage.allow_any_operation(array['object.delete', 'object.delete_many']::text[])
    and not exists (
      select 1 from public.project_photos p
      where p.storage_path = name and p.user_id = (select auth.uid())
        and p.state = 'active'
    )
  );
