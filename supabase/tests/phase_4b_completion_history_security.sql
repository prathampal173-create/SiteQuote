-- Run only against a DISPOSABLE Supabase DB after all 16 chronological migrations.
-- psql -v ON_ERROR_STOP=1 -f supabase/tests/phase_4b_completion_history_security.sql
-- One-connection fixture; concurrent two-session behavior is a separate release gate.
\set ON_ERROR_STOP on
begin;
do $$
begin
  if not (select relrowsecurity from pg_class where oid='public.reminder_completion_events'::regclass)
    or has_table_privilege('anon','public.reminder_completion_events','SELECT')
    or has_table_privilege('authenticated','public.reminder_completion_events','INSERT')
    or has_table_privilege('authenticated','public.reminder_completion_events','UPDATE')
    or has_table_privilege('authenticated','public.reminder_completion_events','DELETE')
    or not has_table_privilege('authenticated','public.reminder_completion_events','SELECT')
    or (select count(*) from pg_policies where schemaname='public' and tablename='reminder_completion_events') <> 1
  then raise exception 'history permissions/RLS invalid'; end if;
end $$;
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
 ('a3300000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase4b-a@example.test',now(),now()),
 ('b4400000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase4b-b@example.test',now(),now());
insert into public.leads (id,user_id,customer_name,phone,source) values
 ('a3300000-0000-4000-8000-000000000011','a3300000-0000-4000-8000-000000000001','A','123','Other'),
 ('a3300000-0000-4000-8000-000000000012','a3300000-0000-4000-8000-000000000001','A2','123','Other'),
 ('b4400000-0000-4000-8000-000000000022','b4400000-0000-4000-8000-000000000002','B','123','Other');
insert into public.projects (id,user_id,lead_id,title) values
 ('a3300000-0000-4000-8000-000000000031','a3300000-0000-4000-8000-000000000001','a3300000-0000-4000-8000-000000000011','Project A'),
 ('a3300000-0000-4000-8000-000000000032','a3300000-0000-4000-8000-000000000001','a3300000-0000-4000-8000-000000000012','Project A2');
set local role authenticated;
select set_config('request.jwt.claim.sub','a3300000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a3300000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}',true);
-- Deterministic IDs are privileged fixture setup; application grants stay unchanged.
reset role;
insert into public.reminders (id,user_id,lead_id,project_id,kind,title,due_at) values
 ('a3300000-0000-4000-8000-000000000041','a3300000-0000-4000-8000-000000000001','a3300000-0000-4000-8000-000000000011','a3300000-0000-4000-8000-000000000031','site_visit','Walk',now()+interval '5 days');
set local role authenticated;
do $$ begin
  if (select count(*) from public.reminder_completion_events) <> 0 then raise exception 'create incorrectly wrote history'; end if;
end $$;
update public.reminders set status='completed' where id='a3300000-0000-4000-8000-000000000041';
update public.reminders set status='completed' where id='a3300000-0000-4000-8000-000000000041';
do $$ begin
  if (select count(*) from public.reminder_completion_events where event_type='completed') <> 1
    then raise exception 'completion must write exactly one event'; end if;
  if (select completed_at is null from public.reminders where id='a3300000-0000-4000-8000-000000000041')
    then raise exception 'server completed_at missing'; end if;
end $$;
update public.reminders set status='open' where id='a3300000-0000-4000-8000-000000000041';
update public.reminders set status='open' where id='a3300000-0000-4000-8000-000000000041';
update public.reminders set title='Renamed' where id='a3300000-0000-4000-8000-000000000041';
update public.reminders set status='completed' where id='a3300000-0000-4000-8000-000000000041';
do $$ begin
  if (select count(*) from public.reminder_completion_events) <> 3
    or (select count(*) from public.reminder_completion_events where event_type='completed') <> 2
    or (select count(*) from public.reminder_completion_events where event_type='reopened') <> 1
    or (select count(*) from public.reminder_completion_events where reminder_title='Walk') <> 2
    or (select count(*) from public.reminder_completion_events where reminder_title='Renamed') <> 1
    then raise exception 'history cycles, snapshots, or idempotency failed'; end if;
end $$;
-- A status change followed by rollback must roll back its event as well.
savepoint before_rollback;
update public.reminders set status='open' where id='a3300000-0000-4000-8000-000000000041';
do $$ begin if (select count(*) from public.reminder_completion_events) <> 4 then raise exception 'transactional event missing'; end if; end $$;
rollback to savepoint before_rollback;
do $$ begin if (select count(*) from public.reminder_completion_events) <> 3 then raise exception 'history not transactional'; end if; end $$;
-- Table is read-only, even to its owner. A forged transition timestamp is blocked.
do $$ begin
  begin
    execute 'insert into public.reminder_completion_events (user_id,reminder_id,event_type,occurred_at,lead_id,reminder_title,reminder_kind,reminder_due_at) values (''a3300000-0000-4000-8000-000000000001'',''a3300000-0000-4000-8000-000000000041'',''reopened'',now(),''a3300000-0000-4000-8000-000000000011'',''Forged'',''other'',now())';
    raise exception 'Direct history insert unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  begin
    execute 'update public.reminder_completion_events set event_type=''reopened''';
    raise exception 'History mutation unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  begin
    execute 'delete from public.reminder_completion_events';
    raise exception 'History deletion unexpectedly allowed';
  exception when insufficient_privilege then null; end;
  begin
    execute 'update public.reminders set completed_at=now()';
    raise exception 'Forged completed_at unexpectedly allowed';
  exception when insufficient_privilege then null; end;
end $$;
-- Validated relationships are still enforced after migration.
do $$ begin
  begin
    insert into public.reminders (user_id,lead_id,project_id,kind,title,due_at)
      values ('a3300000-0000-4000-8000-000000000001','a3300000-0000-4000-8000-000000000011',
      'a3300000-0000-4000-8000-000000000032','other','Mismatched',now()+interval '1 day');
    raise exception 'Wrong lead/project permitted';
  exception when foreign_key_violation then null; end;
end $$;
-- Anonymous role has no table access (RLS is not the only barrier).
set local role anon;
do $$ begin
  begin
    execute 'select count(*) from public.reminder_completion_events';
    raise exception 'Anonymous history read unexpectedly allowed';
  exception when insufficient_privilege then null; end;
end $$;
set local role authenticated;
-- Account B must neither see nor mutate account A rows/events.
select set_config('request.jwt.claim.sub','b4400000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"b4400000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}',true);
do $$ begin
  if (select count(*) from public.reminders) <> 0 or
     (select count(*) from public.reminder_completion_events) <> 0
  then raise exception 'Cross-account reminder/event read'; end if;
end $$;
update public.reminders set status='open' where id='a3300000-0000-4000-8000-000000000041';
delete from public.reminders where id='a3300000-0000-4000-8000-000000000041';
select set_config('request.jwt.claim.sub','a3300000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a3300000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}',true);
do $$ begin if (select count(*) from public.reminder_completion_events) <> 3
  then raise exception 'Other account mutated history'; end if; end $$;
-- Deliberate delete removes linked history as documented for privacy.
delete from public.reminders where id='a3300000-0000-4000-8000-000000000041';
do $$ begin if (select count(*) from public.reminder_completion_events) <> 0
  then raise exception 'History was not cascaded on reminder deletion'; end if; end $$;
rollback;
