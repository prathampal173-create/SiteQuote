-- Phase 4D: atomic, database-authoritative stage advancement on genuine
-- Site visit reminder Open -> Completed. Phase 4B's completion-event trigger
-- continues to own reminder history; this adds only the lead-stage activity.
-- Neither old completions nor edits to a Completed reminder are backfilled.
-- Lock order: the reminder UPDATE locks its own row, then this trigger takes
-- the lead row lock. Manual lead stage edits lock only the lead. Two different
-- reminders of one lead serialize on that lead; read the stage AFTER the lock.
create function sitequote_internal.advance_lead_on_site_visit_completion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor uuid := (select auth.uid());
  prior_stage public.lead_contact_stage;
begin
  if old.status <> 'open' or new.status <> 'completed' then
    return null;
  end if;

  -- Do not let a single status UPDATE silently reassign the reminder to a
  -- different customer/type and trigger automation against that new record.
  if new.user_id is distinct from old.user_id
     or new.lead_id is distinct from old.lead_id
     or new.kind is distinct from old.kind then
    raise exception 'Complete the saved Site visit reminder without changing its association'
      using errcode = '23514';
  end if;
  if new.kind <> 'site_visit' then
    return null;
  end if;
  if actor is null or actor <> new.user_id
     or coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') <> 'false' then
    raise exception 'Verified reminder owner required' using errcode = '42501';
  end if;

  -- PostgreSQL READ COMMITTED rechecks this row after waiting for a competing
  -- lead edit. This is the authoritative stage, not a React Native cached one.
  select contact_stage into prior_stage
    from public.leads
    where id = new.lead_id and user_id = actor
    for update;
  if not found then
    raise exception 'Owned reminder lead unavailable' using errcode = '42501';
  end if;

  if prior_stage in ('new'::public.lead_contact_stage,
                     'contacted'::public.lead_contact_stage) then
    update public.leads
      set contact_stage = 'site_visit_completed'::public.lead_contact_stage
      where id = new.lead_id and user_id = actor;
    -- Existing activities RLS permits owners to read, not forge this type.
    -- Insert, stage change, reminder update, and the original 4B event all
    -- commit or roll back as a single PostgreSQL transaction.
    insert into public.activities(user_id, lead_id, project_id, type, detail, created_at)
    values (
      actor, new.lead_id, new.project_id, 'site_visit_stage_advanced',
      pg_catalog.jsonb_build_object(
        'from_stage', prior_stage::text,
        'to_stage', 'site_visit_completed',
        'reminder_id', new.id,
        'reason', 'site_visit_reminder_completed'
      ),
      statement_timestamp()
    );
  end if;
  return null;
end;
$$;
revoke all on function sitequote_internal.advance_lead_on_site_visit_completion()
  from public, anon, authenticated;
create trigger reminders_site_visit_stage
  after update of status on public.reminders
  for each row execute function sitequote_internal.advance_lead_on_site_visit_completion();
comment on function sitequote_internal.advance_lead_on_site_visit_completion() is
  'On genuine owned Site visit completion, lock current lead and advance only New/Contacted. Phase 4B records status history in the same transaction.';
