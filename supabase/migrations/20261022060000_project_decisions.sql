-- Phase 1D: owner-checked project decisions; future quote versions remain Phase 3.
-- No earlier migration is rewritten. All RPCs are explicitly granted to authenticated only.
-- Project-linked decision history is immutable; the app can still insert only manual lead notes.

alter table public.activities drop constraint activities_no_unvalidated_project;
alter table public.projects add constraint projects_owner_project_lead_unique
  unique (user_id, id, lead_id);
alter table public.activities add constraint activities_owner_project_lead_fkey
  foreign key (user_id, project_id, lead_id)
  references public.projects(user_id, id, lead_id) on delete restrict;
create index activities_owner_project_date_idx
  on public.activities(user_id, project_id, created_at, id) where project_id is not null;

-- The project row lock serializes decisions and task edits. SQL functions run as
-- their trusted DB owner because column-level status grants are never exposed.
create function public.mark_project_lost(p_project_id uuid)
returns public.projects
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  previous public.projects%rowtype;
  changed public.projects%rowtype;
begin
  if actor is null or coalesce(auth.jwt() ->> 'is_anonymous','false') <> 'false' then
    raise exception 'A verified account is required' using errcode = '42501';
  end if;
  select * into previous from public.projects
    where id = p_project_id and user_id = actor for update;
  if not found then
    raise exception 'Project unavailable' using errcode = '42501';
  end if;
  if previous.status not in ('draft', 'quote_sent') then
    raise exception 'Only Draft or Quote Sent projects may be marked Lost' using errcode = '23514';
  end if;
  if previous.accepted_quote_id is not null then
    raise exception 'An active approval cannot be marked Lost' using errcode = '23514';
  end if;
  update public.projects set status = 'lost'
    where user_id = actor and id = p_project_id returning * into changed;
  insert into public.activities(user_id, lead_id, project_id, type, detail)
    values (actor, previous.lead_id, previous.id, 'project_marked_lost',
      jsonb_build_object('project_title', previous.title, 'from_status', previous.status::text, 'to_status', 'lost',
        'previous_accepted_quote_id', previous.accepted_quote_id));
  return changed;
end;
$$;

create function public.reopen_project(p_project_id uuid)
returns public.projects
language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  previous public.projects%rowtype;
  changed public.projects%rowtype;
  has_sent boolean := false;
  next_status public.project_status;
begin
  if actor is null or coalesce(auth.jwt() ->> 'is_anonymous','false') <> 'false' then
    raise exception 'A verified account is required' using errcode = '42501';
  end if;
  select * into previous from public.projects
    where id = p_project_id and user_id = actor for update;
  if not found then
    raise exception 'Project unavailable' using errcode = '42501';
  end if;
  if previous.status not in ('won', 'lost') then
    raise exception 'Only Won or Lost projects may be reopened' using errcode = '23514';
  end if;
  -- Phase 3 creates public.quotes. Until it exists, no Sent quote can exist.
  -- Dynamic SQL is restricted to a fixed, fully qualified table name. In Phase 3,
  -- the quote migration must provide these owner/project/status columns and locks.
  if to_regclass('public.quotes') is not null then
    execute 'select exists (select 1 from public.quotes where user_id = $1 and project_id = $2 and status = ''sent'')'
      into has_sent using actor, p_project_id;
  end if;
  next_status := case when has_sent then 'quote_sent'::public.project_status
    else 'draft'::public.project_status end;
  -- The event retains the exact former decision and original approved quote ID,
  -- before clearing only the active pointer. Prior quote rows are never touched.
  insert into public.activities(user_id, lead_id, project_id, type, detail)
    values (actor, previous.lead_id, previous.id, 'project_reopened',
      jsonb_build_object('project_title', previous.title, 'from_status', previous.status::text, 'to_status', next_status::text,
        'previous_accepted_quote_id', previous.accepted_quote_id));
  update public.projects set status = next_status, accepted_quote_id = null
    where user_id = actor and id = p_project_id returning * into changed;
  return changed;
end;
$$;

-- Reserved signature for Phase 3E. Deliberately fails closed until sent quote
-- versions exist and the full same-owner, Sent-version approval check is added.
create function public.mark_project_won(p_project_id uuid, p_quote_id uuid)
returns public.projects
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Mark Won requires a selected Sent quote version (Phase 3E)'
    using errcode = '0A000';
end;
$$;

revoke all on function public.mark_project_lost(uuid), public.reopen_project(uuid),
  public.mark_project_won(uuid,uuid) from public, anon, authenticated;
grant execute on function public.mark_project_lost(uuid), public.reopen_project(uuid)
  to authenticated;
-- The unavailable Won RPC is intentionally NOT executable by mobile clients.
-- Phase 3E must replace and separately grant its owner-checked implementation.
