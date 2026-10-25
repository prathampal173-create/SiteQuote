-- Phase 5D targeted correctness fix (5D-01): match *all* Sent versions by
-- content fingerprint, preferring the highest-numbered matching Sent version.
-- Prior RPC examined only the newest Sent version overall. If that version did
-- not match but an older Sent did, it could incorrectly reuse a Prepared quote
-- or insert another version. This upgrade retains all existing authorization,
-- locks, arithmetic, immutable rows, grants, and request-key behavior.
-- Forward-only: do not edit the historical Phase 3C migration.
create or replace function public.prepare_quote(p_project_id uuid, p_preview_fingerprint text, p_request_key uuid)
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
    -- Prefer the highest-version *matching* Sent quote, not merely the newest
    -- Sent quote overall. Out-of-order sends may leave an older Sent matching
    -- this content while a newer Sent has a different fingerprint.
    -- Then reuse the highest-numbered matching Prepared, including A -> B -> A.
    select * into winner from public.quotes
      where user_id=actor and project_id=p_project_id and status='sent' and fingerprint=fp
      order by version desc limit 1;
    if found then
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
-- Existing grant is preserved by CREATE OR REPLACE, but make the intended
-- privileges explicit and idempotent for authenticated-only execution.
revoke all on function public.prepare_quote(uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.prepare_quote(uuid,text,uuid) to authenticated;
comment on function public.prepare_quote(uuid,text,uuid) is
 'Owner-checked, exact-cent Prepared quote; highest matching Sent precedence before matching Prepared; immutable versions.';
