-- Phase 1B: server-side protection for edits to existing closed projects.
-- Foundation RLS, same-owner project/lead FK, and protected status grants are retained.
-- Project form does not expose reassignment. No new mobile permissions are granted.
create function sitequote_internal.enforce_closed_project_fields()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status in ('won', 'lost') and
    (new.lead_id is distinct from old.lead_id or
     new.title is distinct from old.title or
     new.site_address is distinct from old.site_address or
     new.tax_bps is distinct from old.tax_bps) then
    raise exception 'Reopen project before changing locked fields' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function sitequote_internal.enforce_closed_project_fields() from public, anon, authenticated;

create trigger projects_enforce_closed_fields
before update on public.projects
for each row execute function sitequote_internal.enforce_closed_project_fields();
