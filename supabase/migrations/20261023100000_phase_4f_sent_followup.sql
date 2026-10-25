-- Phase 4F: keep the original idempotent Sent RPC; add an atomic transition
-- indicator for optional UX, and an owner-scoped reminder creation request key.
-- No reminder is created by this migration or by Mark Sent.
create function public.confirm_quote_sent_for_followup(p_quote_id uuid)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  parent public.projects%rowtype;
  selected public.quotes%rowtype;
begin
  if actor is null or coalesce((select auth.jwt()->>'is_anonymous'), 'false') <> 'false' then
    raise exception 'Verified account required' using errcode = '42501';
  end if;
  -- Match the Phase 3D lock ordering: parent first, then selected quote.
  select p.* into parent from public.projects p
    join public.quotes q on q.project_id = p.id and q.user_id = p.user_id
    where q.id = p_quote_id and p.user_id = actor for update of p;
  if not found then raise exception 'Quote unavailable' using errcode = '42501'; end if;
  select * into selected from public.quotes where id = p_quote_id and user_id = actor
    and project_id = parent.id for update;
  if not found then raise exception 'Quote unavailable' using errcode = '42501'; end if;
  if selected.status = 'sent' then
    return jsonb_build_object('transitioned', false, 'quote', to_jsonb(selected));
  end if;
  if selected.status <> 'prepared' or parent.status not in ('draft','quote_sent') then
    raise exception 'Reopen project before confirming a quote sent' using errcode = '23514';
  end if;
  perform set_config('sitequote.confirm_quote_sent', 'on', true);
  update public.quotes set status = 'sent', sent_at = clock_timestamp()
    where id = selected.id returning * into selected;
  perform set_config('sitequote.confirm_quote_sent', 'off', true);
  update public.projects set status = 'quote_sent'
    where id = parent.id and user_id = actor;
  insert into public.activities(user_id, lead_id, project_id, type, detail)
    values (actor, parent.lead_id, parent.id, 'quote_marked_sent',
      jsonb_build_object('project_title',parent.title,'quote_id',selected.id,
        'version',selected.version,'total_minor',selected.total_minor,
        'from_status',parent.status::text,'to_status','quote_sent'));
  return jsonb_build_object('transitioned', true, 'quote', to_jsonb(selected));
end;
$$;
revoke all on function public.confirm_quote_sent_for_followup(uuid) from public, anon, authenticated;
grant execute on function public.confirm_quote_sent_for_followup(uuid) to authenticated;
comment on function public.confirm_quote_sent_for_followup(uuid) is
  'Returns whether an explicit owner-checked Prepared-to-Sent transition actually committed; no reminder side effects.';

-- Stable identity for explicitly submitted reminder creation, not a notification
-- ID or globally visible quote marker. Older reminders keep NULL.
alter table public.reminders add column client_request_id uuid;
create unique index reminders_owner_client_request_uidx on public.reminders (user_id, client_request_id)
  where client_request_id is not null;
grant insert (client_request_id) on public.reminders to authenticated;
-- Client cannot UPDATE the request identity; existing owner RLS and lead/project
-- FKs still apply. No privilege to read or write another owner's reminders.
