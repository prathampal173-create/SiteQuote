-- The project status is not PDF content and must not change its content hash:
-- Draft -> Quote Sent must be able to re-share a matching immutable version.
-- Keep status in preview content for existing UI but remove from the fingerprint.
-- This is a forward-only upgrade; older 3B previews revalidate as stale once.
create or replace function public.get_unsent_estimate_snapshot(p_project_id uuid)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with owned as (
    select p.id, p.user_id, p.title, p.site_address, p.status, p.tax_bps,
           l.customer_name, l.phone as customer_phone, l.email as customer_email,
           b.business_name, b.phone as business_phone, b.address as business_address
    from public.projects p
    join public.leads l on l.user_id = p.user_id and l.id = p.lead_id
    left join public.business_profiles b on b.user_id = p.user_id
    where p.id = p_project_id and p.user_id = (select auth.uid())
      and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  ), snapshot as (
    select jsonb_build_object(
      'project_id', o.id, 'user_id', o.user_id,
      'project_title', o.title, 'site_address', o.site_address,
      'status', o.status, 'tax_bps', o.tax_bps,
      'customer_name', o.customer_name, 'customer_phone', o.customer_phone,
      'customer_email', o.customer_email,
      'business_name', o.business_name, 'business_phone', o.business_phone,
      'business_address', o.business_address,
      'tasks', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id, 'category', t.category, 'title', t.title,
          'notes', t.notes, 'amount_minor', t.amount_minor,
          'sort_order', t.sort_order
        ) order by t.sort_order, t.created_at, t.id)
        from public.project_tasks t
        where t.user_id = o.user_id and t.project_id = o.id
      ), '[]'::jsonb),
      'charges', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', c.id, 'description', c.description,
          'amount_minor', c.amount_minor, 'sort_order', c.sort_order
        ) order by c.sort_order, c.created_at, c.id)
        from public.project_additional_charges c
        where c.user_id = o.user_id and c.project_id = o.id
      ), '[]'::jsonb)
    ) as content
    from owned o
  )
  select jsonb_build_object('fingerprint', encode(sha256(convert_to((s.content - 'status')::text, 'UTF8')), 'hex'),
                            'content', s.content)
  from snapshot s;
$$;

-- Phase 3C: immutable prepared quote versions. Forward-only; no Sent confirmation.
-- Only prepare_quote has write authority; mobile users can SELECT their own rows.
create table public.quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  project_id uuid not null,
  version integer not null check (version > 0),
  status text not null default 'prepared' check (status in ('prepared','sent')),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  request_key uuid not null,
  tasks_subtotal_minor bigint not null check (tasks_subtotal_minor >= 0),
  charges_total_minor bigint not null check (charges_total_minor >= 0),
  tax_bps integer not null check (tax_bps between 0 and 3000),
  tax_minor bigint not null check (tax_minor >= 0),
  total_minor bigint not null check (total_minor > 0 and total_minor <= 9007199254740991),
  issued_at timestamptz not null default now(),
  sent_at timestamptz,
  constraint quotes_project_owner foreign key (user_id, project_id)
    references public.projects(user_id, id) on delete restrict,
  constraint quotes_project_version_unique unique (project_id, version),
  constraint quotes_owner_request_key_unique unique (user_id, request_key),
  constraint quotes_status_sent_at_check check ((status = 'prepared' and sent_at is null) or status = 'sent'),
  constraint quotes_owner_project_id_unique unique (user_id, project_id, id)
);
create index quotes_owner_project_history on public.quotes(user_id,project_id,version desc);
-- Record keys even for reused/sent quotes; repeated requests cannot create a different version.
create table public.quote_prepare_requests (
  user_id uuid not null references auth.users(id),
  request_key uuid not null,
  project_id uuid not null,
  quote_id uuid not null,
  fingerprint text not null,
  primary key (user_id, request_key),
  foreign key (user_id, project_id, quote_id)
    references public.quotes(user_id,project_id,id) on delete restrict
);
-- Immutable by default, including for unexpected elevated direct modifications.
-- Phase 3D will introduce its own tightly scoped Prepared -> Sent transition.
create function sitequote_internal.reject_quote_mutation()
returns trigger language plpgsql set search_path = '' as $$
begin
  raise exception 'Quote snapshots and history are immutable' using errcode = '23514';
end; $$;
revoke all on function sitequote_internal.reject_quote_mutation() from public,anon,authenticated;
create trigger quotes_immutable before update or delete on public.quotes
  for each row execute function sitequote_internal.reject_quote_mutation();
create trigger quote_requests_immutable before update or delete on public.quote_prepare_requests
  for each row execute function sitequote_internal.reject_quote_mutation();
alter table public.quotes enable row level security;
alter table public.quote_prepare_requests enable row level security;
revoke all on public.quotes, public.quote_prepare_requests from public,anon,authenticated;
grant select on public.quotes to authenticated;
create policy quotes_owner_read on public.quotes for select to authenticated using (
  user_id = (select auth.uid()) and coalesce((select auth.jwt()->>'is_anonymous'),'false') = 'false'
);
-- No SELECT/INSERT/UPDATE/DELETE grants to mobile on request keys, or writes to quotes.
-- SECURITY DEFINER is intentionally restricted to this RPC, with explicit owner and
-- verified-user checks and a pinned empty search_path; never accepts user_id/snapshot/totals.
create function public.prepare_quote(p_project_id uuid, p_preview_fingerprint text, p_request_key uuid)
returns jsonb
language plpgsql volatile security definer set search_path = '' as $$
declare
  actor uuid := (select auth.uid());
  p public.projects%rowtype;
  customer_id uuid;
  business_owner uuid;
  source jsonb;
  content jsonb;
  fp text;
  task_sum numeric;
  charge_sum numeric;
  pretax numeric;
  tax_amount numeric;
  total_amount numeric;
  winner public.quotes%rowtype;
  req public.quote_prepare_requests%rowtype;
  mode text;
  max_safe constant numeric := 9007199254740991;
begin
  if actor is null or coalesce((select auth.jwt()->>'is_anonymous'),'false') <> 'false' then
    raise exception 'Verified account required' using errcode = '42501';
  end if;
  if p_project_id is null or p_request_key is null or
     p_preview_fingerprint is null or p_preview_fingerprint !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid quote preparation request' using errcode = '22023';
  end if;
  -- Serializes version assignment AND interlocks with project/task/charge changes.
  select * into p from public.projects
    where id = p_project_id and user_id = actor for update;
  if not found then raise exception 'Project unavailable' using errcode = '42501'; end if;
  if p.status not in ('draft','quote_sent') then
    raise exception 'Reopen project before preparing a quote' using errcode = '23514';
  end if;
  -- Customer and business are independently editable. Their row locks extend
  -- through commit, blocking concurrent changes across snapshot+insert.
  select l.id into customer_id from public.leads l
    where l.id = p.lead_id and l.user_id = actor for share;
  if customer_id is null then raise exception 'Customer unavailable' using errcode = '23503'; end if;
  select b.user_id into business_owner from public.business_profiles b
    where b.user_id = actor and b.business_name ~ '[^[:space:]]' for share;
  if business_owner is null then raise exception 'Business name is required' using errcode = '23514'; end if;
  -- New statement following locks: one consistent MVCC snapshot using exactly
  -- Phase 3B's canonical content/hash function. It contains no internal notes.
  source := public.get_unsent_estimate_snapshot(p_project_id);
  if source is null then raise exception 'Estimate unavailable' using errcode = '42501'; end if;
  fp := source->>'fingerprint';
  if fp is distinct from p_preview_fingerprint then
    raise exception 'Estimate changed — preview again.' using errcode = 'P0001';
  end if;
  content := source->'content';
  if content->>'business_name' is null or btrim(content->>'business_name') = '' or
     jsonb_array_length(content->'tasks') < 1 then
    raise exception 'Business name and at least one task required' using errcode = '23514';
  end if;
  -- PostgreSQL numeric arithmetic (not floats), matching calculateEstimate().
  select coalesce(sum((x->>'amount_minor')::numeric),0) into task_sum
    from jsonb_array_elements(content->'tasks') x;
  select coalesce(sum((x->>'amount_minor')::numeric),0) into charge_sum
    from jsonb_array_elements(content->'charges') x;
  pretax := task_sum + charge_sum;
  tax_amount := floor((pretax * p.tax_bps + 5000) / 10000);
  total_amount := pretax + tax_amount;
  if task_sum < 0 or charge_sum < 0 or pretax > max_safe or tax_amount > max_safe or
     total_amount > max_safe or total_amount <= 0 or p.tax_bps not between 0 and 3000 then
    raise exception 'Invalid or excessive quote amounts' using errcode = '22003';
  end if;
  -- A repeated request key always refers to its original quote, never another.
  select * into req from public.quote_prepare_requests
    where user_id = actor and request_key = p_request_key;
  if found then
    if req.project_id <> p_project_id or req.fingerprint <> fp then
      raise exception 'Request key already used for a different quote' using errcode = '23505';
    end if;
    select * into winner from public.quotes where id=req.quote_id and user_id=actor;
    mode := case when winner.status='sent' then 'reshare_sent' else 'reused_prepared' end;
  else
    -- Latest Sent has first matching precedence, then highest-numbered matching
    -- Prepared, including A -> B -> A version reuse.
    select * into winner from public.quotes
      where user_id=actor and project_id=p_project_id and status='sent'
      order by version desc limit 1;
    if found and winner.fingerprint = fp then
      mode := 'reshare_sent';
    else
      select * into winner from public.quotes
        where user_id=actor and project_id=p_project_id and status='prepared' and fingerprint=fp
        order by version desc limit 1;
      if found then
        mode := 'reused_prepared';
      else
        insert into public.quotes(user_id,project_id,version,fingerprint,snapshot,request_key,
          tasks_subtotal_minor,charges_total_minor,tax_bps,tax_minor,total_minor)
        values (actor,p_project_id,
          (select coalesce(max(version),0)+1 from public.quotes where project_id=p_project_id),
          fp,jsonb_build_object('content',content,'totals',jsonb_build_object(
            'taskSubtotalMinor',task_sum,'chargesTotalMinor',charge_sum,'pretaxMinor',pretax,
            'taxMinor',tax_amount,'finalMinor',total_amount,'taxBps',p.tax_bps)),
          p_request_key,task_sum,charge_sum,p.tax_bps,tax_amount,total_amount)
        returning * into winner;
        mode := 'created';
      end if;
    end if;
    insert into public.quote_prepare_requests(user_id,request_key,project_id,quote_id,fingerprint)
      values (actor,p_request_key,p_project_id,winner.id,fp);
  end if;
  return jsonb_build_object('result',mode,'quote',to_jsonb(winner));
end;
$$;
revoke all on function public.prepare_quote(uuid,text,uuid) from public,anon,authenticated;
grant execute on function public.prepare_quote(uuid,text,uuid) to authenticated;
comment on function public.prepare_quote(uuid,text,uuid) is
  'Phase 3C only: owner-scoped atomic fingerprint match, exact-cent prepared quote insertion/reuse; never sends.';
