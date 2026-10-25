-- Disposable Supabase/Postgres ONLY. Apply all 18 migrations first.
-- psql -X -v ON_ERROR_STOP=1 -f supabase/tests/phase_4f_followup_security.sql
\set ON_ERROR_STOP on
begin;
do $acl$
begin
  if has_function_privilege('anon','public.confirm_quote_sent_for_followup(uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.confirm_quote_sent_for_followup(uuid)','EXECUTE')
     or has_column_privilege('authenticated','public.reminders','client_request_id','UPDATE')
     or not has_column_privilege('authenticated','public.reminders','client_request_id','INSERT') then
    raise exception 'Phase 4F access privileges invalid';
  end if;
  if not exists (select 1 from pg_indexes where schemaname='public' and indexname='reminders_owner_client_request_uidx') then
    raise exception 'Missing owner-scoped reminder request identity uniqueness';
  end if;
end $acl$;
insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at) values
 ('fa111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase4f-a@example.test',now(),now()),
 ('fb222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase4f-b@example.test',now(),now());
insert into public.business_profiles(user_id,business_name) values
 ('fa111111-1111-4111-8111-111111111111','Company A'),
 ('fb222222-2222-4222-8222-222222222222','Company B');
insert into public.leads(id,user_id,customer_name,phone,source) values
 ('fc333333-3333-4333-8333-333333333333','fa111111-1111-4111-8111-111111111111','Customer A','555','Other'),
 ('fd444444-4444-4444-8444-444444444444','fb222222-2222-4222-8222-222222222222','Customer B','555','Other');
insert into public.projects(id,user_id,lead_id,title,tax_bps) values
 ('fe555555-5555-4555-8555-555555555555','fa111111-1111-4111-8111-111111111111','fc333333-3333-4333-8333-333333333333','Kitchen',800),
 ('ff666666-6666-4666-8666-666666666666','fb222222-2222-4222-8222-222222222222','fd444444-4444-4444-8444-444444444444','Foreign',0);
insert into public.project_tasks(user_id,project_id,category,title,amount_minor) values
 ('fa111111-1111-4111-8111-111111111111','fe555555-5555-4555-8555-555555555555','Painting','Paint',300000),
 ('fb222222-2222-4222-8222-222222222222','ff666666-6666-4666-8666-666666666666','Painting','Foreign task',10000);
insert into public.project_additional_charges(user_id,project_id,description,amount_minor) values
 ('fa111111-1111-4111-8111-111111111111','fe555555-5555-4555-8555-555555555555','Permit',15000);
set local role authenticated;
select set_config('request.jwt.claim.sub','fa111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims','{"sub":"fa111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',true);
do $test$
declare fp text; q uuid; foreign_quote uuid; res jsonb; request_id uuid := 'f9000000-0000-4000-8000-000000000001';
begin
  fp := public.get_unsent_estimate_snapshot('fe555555-5555-4555-8555-555555555555')->>'fingerprint';
  q := (public.prepare_quote('fe555555-5555-4555-8555-555555555555',fp,'f9000000-0000-4000-8000-000000000002')->'quote'->>'id')::uuid;
  res := public.confirm_quote_sent_for_followup(q);
  if res->>'transitioned' <> 'true' or res->'quote'->>'status' <> 'sent' then
    raise exception 'New Sent transition not returned'; end if;
  if (res->'quote'->>'total_minor')::bigint <> 340200 then raise exception 'Quote total changed'; end if;
  if (public.confirm_quote_sent_for_followup(q)->>'transitioned') <> 'false' then
    raise exception 'Idempotent Sent retry flagged as new'; end if;
  if (select count(*) from public.activities where type='quote_marked_sent' and project_id='fe555555-5555-4555-8555-555555555555') <> 1 then
    raise exception 'Duplicate Sent activity'; end if;
  insert into public.reminders(user_id,lead_id,project_id,kind,title,due_at,client_request_id)
    values ('fa111111-1111-4111-8111-111111111111','fc333333-3333-4333-8333-333333333333',
      'fe555555-5555-4555-8555-555555555555','follow_up','Follow up on sent quote',now()+interval '3 days',request_id);
  begin
    insert into public.reminders(user_id,lead_id,project_id,kind,title,due_at,client_request_id)
      values ('fa111111-1111-4111-8111-111111111111','fc333333-3333-4333-8333-333333333333',
        'fe555555-5555-4555-8555-555555555555','follow_up','Duplicate',now()+interval '4 days',request_id);
    raise exception 'Duplicate request key allowed';
  exception when unique_violation then null; end;
  begin
    insert into public.reminders(user_id,lead_id,project_id,kind,title,due_at)
      values ('fa111111-1111-4111-8111-111111111111','fc333333-3333-4333-8333-333333333333',
        'ff666666-6666-4666-8666-666666666666','follow_up','Invalid project',now()+interval '3 days');
    raise exception 'Cross-owner project reminder created';
  exception when foreign_key_violation then null; end;
  -- A genuine owner B Prepared quote is invisible/unconfirmable to owner A.
  perform set_config('request.jwt.claim.sub','fb222222-2222-4222-8222-222222222222',true);
  perform set_config('request.jwt.claims','{"sub":"fb222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":false}',true);
  fp := public.get_unsent_estimate_snapshot('ff666666-6666-4666-8666-666666666666')->>'fingerprint';
  foreign_quote := (public.prepare_quote('ff666666-6666-4666-8666-666666666666',fp,
    'f9000000-0000-4000-8000-000000000003')->'quote'->>'id')::uuid;
  perform set_config('request.jwt.claim.sub','fa111111-1111-4111-8111-111111111111',true);
  perform set_config('request.jwt.claims','{"sub":"fa111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',true);
  begin
    perform public.confirm_quote_sent_for_followup(foreign_quote);
    raise exception 'Foreign account quote accepted';
  exception when insufficient_privilege then null; end;
end $test$;
rollback;
