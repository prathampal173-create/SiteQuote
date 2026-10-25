-- Required Phase 3D prerequisite: ONLY explicit confirmed delivery changes Prepared -> Sent.
-- Historical migrations and frozen quote snapshots remain untouched.
create or replace function sitequote_internal.guard_quote_send()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Quote history is immutable' using errcode = '23514';
  end if;
  -- Clients have no UPDATE grants. Even privileged callers cannot alter the
  -- financial/identity columns, or skip the narrowly scoped confirmation RPC.
  if current_setting('sitequote.confirm_quote_sent', true) is distinct from 'on'
     or old.status <> 'prepared' or new.status <> 'sent'
     or old.sent_at is not null or new.sent_at is null
     or (to_jsonb(new) - 'status' - 'sent_at') is distinct from
        (to_jsonb(old) - 'status' - 'sent_at') then
    raise exception 'Quote snapshots and history are immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;
revoke all on function sitequote_internal.guard_quote_send() from public, anon, authenticated;
drop trigger quotes_immutable on public.quotes;
create trigger quotes_guard_send before update or delete on public.quotes
  for each row execute function sitequote_internal.guard_quote_send();

create function public.confirm_quote_sent(p_quote_id uuid)
returns public.quotes
language plpgsql volatile security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  parent public.projects%rowtype;
  selected public.quotes%rowtype;
begin
  if actor is null or coalesce((select auth.jwt()->>'is_anonymous'),'false') <> 'false' then
    raise exception 'Verified account required' using errcode = '42501';
  end if;
  -- Lock parent before quote (same order as quote preparation and decisions).
  select p.* into parent from public.projects p
    join public.quotes q on q.project_id = p.id and q.user_id = p.user_id
    where q.id = p_quote_id and p.user_id = actor for update of p;
  if not found then raise exception 'Quote unavailable' using errcode = '42501'; end if;
  select * into selected from public.quotes where id = p_quote_id and user_id = actor
    and project_id = parent.id for update;
  if not found then raise exception 'Quote unavailable' using errcode = '42501'; end if;
  -- Duplicate confirmations must never undo a later Won/Lost decision.
  if selected.status = 'sent' then return selected; end if;
  if parent.status not in ('draft','quote_sent') then
    raise exception 'Reopen project before confirming a quote sent' using errcode = '23514';
  end if;
  perform set_config('sitequote.confirm_quote_sent', 'on', true);
  update public.quotes set status = 'sent', sent_at = clock_timestamp()
    where id = selected.id returning * into selected;
  perform set_config('sitequote.confirm_quote_sent', 'off', true);
  update public.projects set status = 'quote_sent'
    where id = parent.id and user_id = actor;
  insert into public.activities(user_id,lead_id,project_id,type,detail)
    values (actor,parent.lead_id,parent.id,'quote_marked_sent',
      jsonb_build_object('project_title',parent.title,'quote_id',selected.id,
        'version',selected.version,'total_minor',selected.total_minor,
        'from_status',parent.status::text,'to_status','quote_sent'));
  return selected;
end;
$$;
revoke all on function public.confirm_quote_sent(uuid) from public,anon,authenticated;
grant execute on function public.confirm_quote_sent(uuid) to authenticated;
comment on function public.confirm_quote_sent(uuid) is
  'Owner-checked explicit Prepared-to-Sent confirmation; idempotent; no share-sheet inference.';
