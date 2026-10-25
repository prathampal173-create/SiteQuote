-- DISPOSABLE Supabase only. After 17 migrations, run via psql -v ON_ERROR_STOP=1.
-- Exercises sequential authenticated operations/atomic rollback; run separate
-- two-session contention procedures from the Phase 4D report as a release gate.
\set ON_ERROR_STOP on
begin;
do $$ begin
  if has_table_privilege('anon','public.activities','SELECT')
    or has_column_privilege('authenticated','public.activities','type','UPDATE')
    or not has_table_privilege('authenticated','public.activities','SELECT')
    or has_function_privilege('authenticated',
         'sitequote_internal.advance_lead_on_site_visit_completion()','EXECUTE')
    or (select count(*) from pg_trigger where tgname='reminders_site_visit_stage' and not tgisinternal) <> 1
    or (select count(*) from pg_trigger where tgname='reminders_transition_history' and not tgisinternal) <> 1
  then raise exception 'Stage or history privileges/triggers missing'; end if;
end $$;
insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at) values
 ('a4500000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase4d-a@example.test',now(),now()),
 ('b4500000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase4d-b@example.test',now(),now());
insert into public.leads(id,user_id,customer_name,phone,source,contact_stage) values
 ('a4500000-0000-4000-8000-000000000011','a4500000-0000-4000-8000-000000000001','New','123','Other','new'),
 ('a4500000-0000-4000-8000-000000000012','a4500000-0000-4000-8000-000000000001','Contacted','123','Other','contacted'),
 ('a4500000-0000-4000-8000-000000000013','a4500000-0000-4000-8000-000000000001','Later','123','Other','site_visit_completed'),
 ('b4500000-0000-4000-8000-000000000021','b4500000-0000-4000-8000-000000000002','Foreign','123','Other','new');
insert into public.projects(id,user_id,lead_id,title) values
 ('a4500000-0000-4000-8000-000000000031','a4500000-0000-4000-8000-000000000001','a4500000-0000-4000-8000-000000000011','Owned project');
set local role authenticated;
select set_config('request.jwt.claim.sub','a4500000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a4500000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}',true);
-- Deterministic IDs are privileged fixture setup; application grants stay unchanged.
reset role;
insert into public.reminders(id,user_id,lead_id,project_id,kind,title,due_at) values
 ('a4500000-0000-4000-8000-000000000041','a4500000-0000-4000-8000-000000000001','a4500000-0000-4000-8000-000000000011','a4500000-0000-4000-8000-000000000031','site_visit','Site visit',now()+interval '4 days'),
 ('a4500000-0000-4000-8000-000000000042','a4500000-0000-4000-8000-000000000001','a4500000-0000-4000-8000-000000000012',null,'site_visit','Another visit',now()+interval '4 days'),
 ('a4500000-0000-4000-8000-000000000043','a4500000-0000-4000-8000-000000000001','a4500000-0000-4000-8000-000000000013',null,'site_visit','Already later',now()+interval '4 days'),
 ('a4500000-0000-4000-8000-000000000044','a4500000-0000-4000-8000-000000000001','a4500000-0000-4000-8000-000000000011',null,'follow_up','Follow-up',now()+interval '4 days'),
 ('a4500000-0000-4000-8000-000000000045','a4500000-0000-4000-8000-000000000001','a4500000-0000-4000-8000-000000000012',null,'other','Other',now()+interval '4 days'),
 ('a4500000-0000-4000-8000-000000000046','a4500000-0000-4000-8000-000000000001','a4500000-0000-4000-8000-000000000011',null,'site_visit','Second visit',now()+interval '4 days');
set local role authenticated;
-- Explicit completion: all four writes commit in the same transaction.
update public.reminders set status='completed' where id='a4500000-0000-4000-8000-000000000041';
do $$ begin
  if (select contact_stage from public.leads where id='a4500000-0000-4000-8000-000000000011') <> 'site_visit_completed'
    or (select count(*) from public.reminder_completion_events where reminder_id='a4500000-0000-4000-8000-000000000041' and event_type='completed') <> 1
    or (select count(*) from public.activities where type='site_visit_stage_advanced' and detail->>'reminder_id'='a4500000-0000-4000-8000-000000000041') <> 1
    or (select count(*) from public.activities where type='site_visit_stage_advanced' and detail->>'from_stage'='new') <> 1
  then raise exception 'New -> completed atomic advance failed'; end if;
end $$;
-- Repeated request cannot rewrite a later manual correction or append history.
update public.leads set contact_stage='contacted' where id='a4500000-0000-4000-8000-000000000011';
update public.reminders set status='completed' where id='a4500000-0000-4000-8000-000000000041';
do $$ begin
  if (select contact_stage from public.leads where id='a4500000-0000-4000-8000-000000000011') <> 'contacted'
    or (select count(*) from public.activities where type='site_visit_stage_advanced') <> 1
    or (select count(*) from public.reminder_completion_events where reminder_id='a4500000-0000-4000-8000-000000000041') <> 1
  then raise exception 'Retry overwrote manual correction / duplicated history'; end if;
end $$;
-- Reopen does not reverse stage; a real recompletion CAN reapply eligibility.
update public.reminders set status='open' where id='a4500000-0000-4000-8000-000000000041';
do $$ begin
 if (select contact_stage from public.leads where id='a4500000-0000-4000-8000-000000000011') <> 'contacted'
 then raise exception 'Reopen reversed stage'; end if;
end $$;
update public.reminders set status='completed' where id='a4500000-0000-4000-8000-000000000041';
update public.reminders set status='completed' where id in
  ('a4500000-0000-4000-8000-000000000042','a4500000-0000-4000-8000-000000000043',
   'a4500000-0000-4000-8000-000000000044','a4500000-0000-4000-8000-000000000045',
   'a4500000-0000-4000-8000-000000000046');
do $$ begin
  if (select contact_stage from public.leads where id='a4500000-0000-4000-8000-000000000012') <> 'site_visit_completed'
    or (select count(*) from public.activities where type='site_visit_stage_advanced') <> 3
    or (select count(*) from public.reminder_completion_events where reminder_id='a4500000-0000-4000-8000-000000000041') <> 3
    or (select count(*) from public.reminder_completion_events where event_type='completed') <> 7
  then raise exception 'Contacted transition, non-site, repeated site, or events incorrect'; end if;
end $$;
-- Editing a completed Other to Site visit is not a completion transition.
update public.reminders set kind='site_visit' where id='a4500000-0000-4000-8000-000000000045';
do $$ begin
  if (select count(*) from public.activities where type='site_visit_stage_advanced') <> 3
  then raise exception 'Kind edit retroactively advanced lead'; end if;
end $$;
-- Coupling kind/lead reassignment with a completion should be rejected.
-- Deterministic IDs are privileged fixture setup; application grants stay unchanged.
reset role;
insert into public.reminders(id,user_id,lead_id,kind,title,due_at) values
 ('a4500000-0000-4000-8000-000000000047','a4500000-0000-4000-8000-000000000001','a4500000-0000-4000-8000-000000000011','other','Guarded',now()+interval '4 days');
set local role authenticated;
do $$ begin
  begin
    update public.reminders set status='completed', kind='site_visit'
      where id='a4500000-0000-4000-8000-000000000047';
    raise exception 'Changed type and completed in one update';
  exception when check_violation then null; end;
end $$;
-- History is read-only to owner and unrelated clients.
do $$ begin
  begin
    execute 'insert into public.activities(user_id,lead_id,type,detail) values
      (''a4500000-0000-4000-8000-000000000001'',
       ''a4500000-0000-4000-8000-000000000011'',
       ''site_visit_stage_advanced'', ''{}'')';
    raise exception 'Client forged stage history';
  exception when insufficient_privilege then null; end;
end $$;
-- Prepare a genuine Open Site visit transition after the spoofed combined edit was blocked.
update public.reminders set kind='site_visit' where id='a4500000-0000-4000-8000-000000000047';
-- Inject an activity constraint failure; all stage/reminder/event writes roll back.
reset role;
alter table public.activities add constraint phase4d_fixture_reject_history
 check (type <> 'site_visit_stage_advanced') not valid;
set local role authenticated;
select set_config('request.jwt.claim.sub','a4500000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a4500000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}',true);
update public.leads set contact_stage='new' where id='a4500000-0000-4000-8000-000000000011';
do $$ begin
  begin
    update public.reminders set status='completed' where id='a4500000-0000-4000-8000-000000000047';
    raise exception 'Failed required history write unexpectedly allowed';
  exception when check_violation then null; end;
  if (select status from public.reminders where id='a4500000-0000-4000-8000-000000000047') <> 'open'
    or (select contact_stage from public.leads where id='a4500000-0000-4000-8000-000000000011') <> 'new'
    or (select count(*) from public.reminder_completion_events where reminder_id='a4500000-0000-4000-8000-000000000047') <> 0
  then raise exception 'Incomplete rollback on required activity failure'; end if;
end $$;
reset role;
alter table public.activities drop constraint phase4d_fixture_reject_history;
set local role authenticated;
-- Account B cannot access A reminders, lead or their histories.
select set_config('request.jwt.claim.sub','b4500000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"b4500000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}',true);
do $$ begin
  if (select count(*) from public.activities) <> 0
    or (select count(*) from public.reminder_completion_events) <> 0
    or (select count(*) from public.reminders) <> 0
  then raise exception 'Cross-account read leaked'; end if;
end $$;
update public.reminders set status='open' where id='a4500000-0000-4000-8000-000000000041';
update public.leads set contact_stage='contacted' where id='a4500000-0000-4000-8000-000000000011';
select set_config('request.jwt.claim.sub','a4500000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a4500000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}',true);
do $$ begin
  if (select contact_stage from public.leads where id='a4500000-0000-4000-8000-000000000011') <> 'new'
  then raise exception 'Foreign account changed stage'; end if;
end $$;
set local role anon;
do $$ begin
  begin
    execute 'update public.reminders set status=''open'' where id=''a4500000-0000-4000-8000-000000000041''';
    raise exception 'Anonymous completion mutation unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  begin
    execute 'select count(*) from public.reminders';
    raise exception 'Anonymous read unexpectedly allowed';
  exception when insufficient_privilege then null; end;
end $$;
rollback;
