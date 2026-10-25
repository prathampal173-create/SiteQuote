-- Phase 3E: accepted quote must be in same owner/project; only a Sent quote
-- can be approved, atomically while holding the project lock.
alter table public.projects add constraint projects_accepted_quote_owner_project_fk
  foreign key (user_id,id,accepted_quote_id)
    references public.quotes(user_id,project_id,id) on delete restrict;
alter table public.projects add constraint projects_won_requires_acceptance
  check ((status = 'won') = (accepted_quote_id is not null));

create or replace function public.mark_project_won(p_project_id uuid, p_quote_id uuid)
returns public.projects
language plpgsql volatile security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  previous public.projects%rowtype;
  chosen public.quotes%rowtype;
  changed public.projects%rowtype;
begin
  if actor is null or coalesce((select auth.jwt()->>'is_anonymous'),'false') <> 'false' then
    raise exception 'Verified account required' using errcode = '42501';
  end if;
  select * into previous from public.projects where id=p_project_id and user_id=actor for update;
  if not found then raise exception 'Project unavailable' using errcode = '42501'; end if;
  if previous.status <> 'quote_sent' or previous.accepted_quote_id is not null then
    raise exception 'Only Quote Sent projects may be marked Won' using errcode = '23514';
  end if;
  select * into chosen from public.quotes
    where id=p_quote_id and project_id=p_project_id and user_id=actor and status='sent';
  if not found then
    raise exception 'Choose a Sent version belonging to this project' using errcode = '23514';
  end if;
  update public.projects set status='won', accepted_quote_id=chosen.id
    where id=p_project_id and user_id=actor returning * into changed;
  insert into public.activities(user_id,lead_id,project_id,type,detail)
    values(actor,previous.lead_id,previous.id,'project_marked_won',
      jsonb_build_object('project_title',previous.title,'from_status',previous.status::text,
        'to_status','won','accepted_quote_id',chosen.id,'accepted_quote_version',chosen.version,
        'accepted_quote_total_minor',chosen.total_minor));
  return changed;
end;
$$;
revoke all on function public.mark_project_won(uuid,uuid) from public,anon,authenticated;
grant execute on function public.mark_project_won(uuid,uuid) to authenticated;
comment on function public.mark_project_won(uuid,uuid) is
 'Accept only a selected owned Sent quote from the same Quote Sent project; permanent decision activity.';

-- Existing Mark Lost and Reopen functions already lock parent, do not mutate
-- quotes, and preserve the old approval in append-only activity before clearing.
