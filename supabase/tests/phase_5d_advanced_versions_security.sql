-- Phase 5D disposable-DB transaction fixture. REQUIRES all 19 migrations.
-- Execute as migration/test owner using psql -X -v ON_ERROR_STOP=1 -f <file>.
-- Each authenticated context is a simulated JWT claim, NOT a replacement
-- for real GoTrue-issued two-account PostgREST/Storage tests.
\set ON_ERROR_STOP on
begin;
insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at) values
 ('d1111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','5d-a@example.test',now(),now()),
 ('d2222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','5d-b@example.test',now(),now());
insert into public.business_profiles(user_id,business_name,phone) values
 ('d1111111-1111-4111-8111-111111111111','Original Builder','111');
insert into public.leads(id,user_id,customer_name,phone,source) values
 ('d3333333-3333-4333-8333-333333333333','d1111111-1111-4111-8111-111111111111','Original Customer','222','Other'),
 ('d4444444-4444-4444-8444-444444444444','d2222222-2222-4222-8222-222222222222','Other Customer','333','Other');
insert into public.projects(id,user_id,lead_id,title,tax_bps) values
 ('d5555555-5555-4555-8555-555555555555','d1111111-1111-4111-8111-111111111111','d3333333-3333-4333-8333-333333333333','Kitchen',800),
 ('d6666666-6666-4666-8666-666666666666','d1111111-1111-4111-8111-111111111111','d3333333-3333-4333-8333-333333333333','Bathroom',800),
 ('d7777777-7777-4777-8777-777777777777','d2222222-2222-4222-8222-222222222222','d4444444-4444-4444-8444-444444444444','Other Project',0);
insert into public.project_tasks(user_id,project_id,category,title,notes,amount_minor) values
 ('d1111111-1111-4111-8111-111111111111','d5555555-5555-4555-8555-555555555555','Painting','Cabinets','Permitted public task note',150000),
 ('d1111111-1111-4111-8111-111111111111','d5555555-5555-4555-8555-555555555555','Painting','Hardware',null,50000),
 ('d1111111-1111-4111-8111-111111111111','d5555555-5555-4555-8555-555555555555','Painting','Countertop',null,100000);
insert into public.project_additional_charges(user_id,project_id,description,amount_minor) values
 ('d1111111-1111-4111-8111-111111111111','d5555555-5555-4555-8555-555555555555','Permit',10000),
 ('d1111111-1111-4111-8111-111111111111','d5555555-5555-4555-8555-555555555555','Disposal',5000);
set local role authenticated;
select set_config('request.jwt.claim.sub','d1111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims','{"sub":"d1111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',true);
do $phase5d$
declare
  p constant uuid := 'd5555555-5555-4555-8555-555555555555';
  sibling constant uuid := 'd6666666-6666-4666-8666-666666666666';
  fp_a text; fp_b text; fp_c text;
  a jsonb; b jsonb; c jsonb; reused jsonb; result jsonb;
  a_id uuid; b_id uuid; c_id uuid; issue_a text; snapshot_a jsonb;
  accepted public.projects%rowtype;
begin
  -- Prepared A ($3402) -> B -> A, original issue date and ID retained.
  fp_a := public.get_unsent_estimate_snapshot(p)->>'fingerprint';
  a := public.prepare_quote(p, fp_a, 'd8000000-0000-4000-8000-000000000001');
  a_id := (a->'quote'->>'id')::uuid;
  issue_a := a->'quote'->>'issued_at';
  snapshot_a := a->'quote'->'snapshot';
  if a->>'result'<>'created' or (a->'quote'->>'version')::int<>1 or
     (a->'quote'->>'total_minor')::bigint<>340200 then
    raise exception 'A was not immutable v1 worth 340200 cents'; end if;
  update public.project_tasks set amount_minor=160000 where project_id=p and title='Cabinets';
  fp_b := public.get_unsent_estimate_snapshot(p)->>'fingerprint';
  if fp_b=fp_a then raise exception 'Edit did not change content fingerprint'; end if;
  b := public.prepare_quote(p,fp_b,'d8000000-0000-4000-8000-000000000002');
  b_id := (b->'quote'->>'id')::uuid;
  if b->>'result'<>'created' or (b->'quote'->>'version')::int<>2 or
     (b->'quote'->>'total_minor')::bigint<>351000 then raise exception 'B version/total'; end if;
  update public.project_tasks set amount_minor=150000 where project_id=p and title='Cabinets';
  if public.get_unsent_estimate_snapshot(p)->>'fingerprint'<>fp_a then
    raise exception 'Restored content A does not hash identically'; end if;
  reused := public.prepare_quote(p,fp_a,'d8000000-0000-4000-8000-000000000003');
  if reused->>'result'<>'reused_prepared' or (reused->'quote'->>'id')::uuid<>a_id or
     reused->'quote'->>'issued_at'<>issue_a then raise exception 'A-B-A reuse changed v1'; end if;
  -- Send v2 BEFORE v1. Highest numbered Sent remains v2 in UI.
  perform public.confirm_quote_sent(b_id);
  perform public.confirm_quote_sent(a_id);
  if (select count(*) from public.activities where project_id=p and type='quote_marked_sent')<>2 then
    raise exception 'Out-of-order confirmations generated wrong history'; end if;
  if (select version from public.quotes where user_id='d1111111-1111-4111-8111-111111111111' and project_id=p and status='sent' order by version desc limit 1)<>2 then
    raise exception 'Latest Sent must be highest version, not latest sent_at'; end if;
  result := public.prepare_quote(p,fp_a,'d8000000-0000-4000-8000-000000000004');
  if result->>'result'<>'reshare_sent' or (result->'quote'->>'id')::uuid<>a_id then
    raise exception '5D-01: older matching Sent was not reused over newer nonmatching Sent'; end if;
  if (select count(*) from public.quotes where project_id=p)<>2 then
    raise exception 'Matching Sent reuse unnecessarily inserted a new version'; end if;
  if (select issued_at::text from public.quotes where id=a_id) is null or
     (result->'quote'->>'issued_at')<>issue_a then raise exception 'Sent reuse reset issued_at'; end if;
  -- Test shared-profile changes do not mutate historical snapshots or issue date.
  update public.leads set customer_name='Renamed Customer' where id='d3333333-3333-4333-8333-333333333333';
  update public.business_profiles set business_name='Renamed Builder' where user_id='d1111111-1111-4111-8111-111111111111';
  if public.get_unsent_estimate_snapshot(p)->>'fingerprint'=fp_a then
    raise exception 'Live profile edit failed to invalidate working preview'; end if;
  if (select snapshot from public.quotes where id=a_id) is distinct from snapshot_a or
     (select fingerprint from public.quotes where id=a_id)<>fp_a then
    raise exception 'Historical quote snapshot was mutated by shared profile edits'; end if;
  -- v3 Prepared is made while project is still editable; cannot newly mark
  -- it Sent after Won, but idempotent Sent recheck must not undo Won.
  fp_c := public.get_unsent_estimate_snapshot(p)->>'fingerprint';
  c := public.prepare_quote(p,fp_c,'d8000000-0000-4000-8000-000000000005');
  c_id := (c->'quote'->>'id')::uuid;
  if c->>'result'<>'created' or (c->'quote'->>'version')::int<>3 then raise exception 'Expected v3'; end if;
  accepted := public.mark_project_won(p,a_id);
  if accepted.status<>'won' or accepted.accepted_quote_id<>a_id then
    raise exception 'Wrong historical Sent version accepted'; end if;
  if (select status from public.projects where id=sibling)<>'draft' then
    raise exception 'Sibling project status was modified'; end if;
  begin
    perform public.confirm_quote_sent(c_id);
    raise exception 'Closed project newly confirmed Prepared v3';
  exception when check_violation then null; end;
  if (public.confirm_quote_sent(b_id)).status<>'sent' or
     (select status from public.projects where id=p)<>'won' then
    raise exception 'Sent retry undid Won status'; end if;
  begin
    update public.project_tasks set amount_minor=1 where project_id=p and title='Cabinets';
    raise exception 'Won allowed task price change';
  exception when check_violation then null; end;
  begin
    update public.projects set tax_bps=10 where id=p;
    raise exception 'Won allowed tax change';
  exception when check_violation then null; end;
  begin
    update public.quotes set total_minor=1 where id=a_id;
    raise exception 'Client changed immutable quote';
  exception when insufficient_privilege then null; end;
  accepted := public.reopen_project(p);
  if accepted.status<>'quote_sent' or accepted.accepted_quote_id is not null or
     (select count(*) from public.activities where type='project_marked_won' and project_id=p)<>1 then
    raise exception 'Reopen removed historical decision'; end if;
  if (select snapshot from public.quotes where id=a_id) is distinct from snapshot_a then
    raise exception 'Reopen altered historical quote'; end if;
  raise notice 'PASS: 5D quote A-B-A, $3402, 2 Sent out-of-order, older matching Sent, accepted older, profile-frozen quote, locks, sibling';
end $phase5d$;
reset role;
-- The fixture owner captures the REAL foreign quote ID to probe B's RPC ACL.
select set_config('phase5d.foreign_quote_id',(select id::text from public.quotes
  where project_id='d5555555-5555-4555-8555-555555555555' and version=1),true);
set local role authenticated;
select set_config('request.jwt.claim.sub','d2222222-2222-4222-8222-222222222222',true);
select set_config('request.jwt.claims','{"sub":"d2222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":false}',true);
do $foreign$
begin
  if (select count(*) from public.quotes where project_id='d5555555-5555-4555-8555-555555555555')<>0 then
    raise exception 'Foreign quote visible'; end if;
  begin
    perform public.prepare_quote('d5555555-5555-4555-8555-555555555555',repeat('0',64),'d8000000-0000-4000-8000-000000000006');
    raise exception 'Foreign Prepare succeeded';
  exception when insufficient_privilege then null; end;
  begin
    perform public.confirm_quote_sent(current_setting('phase5d.foreign_quote_id')::uuid);
    raise exception 'Foreign Sent succeeded';
  exception when insufficient_privilege then null; end;
end $foreign$;
reset role;
rollback;
