-- Disposable Supabase ONLY, after all migrations through 20261022060000.
-- psql -X -v ON_ERROR_STOP=1 -f supabase/tests/phase_1D_project_decisions_security.sql
-- The entire test transaction is rolled back. NO production database target.
\set ON_ERROR_STOP on
begin;

insert into auth.users(id, instance_id, aud, role, email, created_at, updated_at)
values
 ('d1d1d1d1-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','phase1d-a@example.test',now(),now()),
 ('d2d2d2d2-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000',
  'authenticated','authenticated','phase1d-b@example.test',now(),now());
insert into public.leads(id,user_id,customer_name,phone,source)
values
 ('d3d3d3d3-3333-4333-8333-333333333333','d1d1d1d1-1111-4111-8111-111111111111','Customer A','555','Referral'),
 ('d4d4d4d4-4444-4444-8444-444444444444','d2d2d2d2-2222-4222-8222-222222222222','Customer B','555','Referral');
insert into public.projects(id,user_id,lead_id,title) values
 ('d5d5d5d5-5555-4555-8555-555555555555','d1d1d1d1-1111-4111-8111-111111111111',
  'd3d3d3d3-3333-4333-8333-333333333333','Kitchen'),
 ('d6d6d6d6-6666-4666-8666-666666666666','d1d1d1d1-1111-4111-8111-111111111111',
  'd3d3d3d3-3333-4333-8333-333333333333','Bathroom'),
 ('d7d7d7d7-7777-4777-8777-777777777777','d2d2d2d2-2222-4222-8222-222222222222',
  'd4d4d4d4-4444-4444-8444-444444444444','Other account');

insert into public.project_tasks(user_id,project_id,category,title,amount_minor)
values ('d1d1d1d1-1111-4111-8111-111111111111',
 'd5d5d5d5-5555-4555-8555-555555555555','Kitchen Remodeling','Cabinets',100);

-- Verify ACL/RLS without changing any grants.
do $acl$
begin
  if not (select relrowsecurity from pg_class where oid='public.projects'::regclass) or
     not (select relrowsecurity from pg_class where oid='public.activities'::regclass) or
     has_function_privilege('anon','public.mark_project_lost(uuid)','EXECUTE') or
     has_function_privilege('anon','public.reopen_project(uuid)','EXECUTE') or
     not has_function_privilege('authenticated','public.mark_project_won(uuid,uuid)','EXECUTE') or
     not has_function_privilege('authenticated','public.mark_project_lost(uuid)','EXECUTE') or
     not has_function_privilege('authenticated','public.reopen_project(uuid)','EXECUTE') or
     has_column_privilege('authenticated','public.projects','status','UPDATE') or
     has_column_privilege('authenticated','public.projects','accepted_quote_id','UPDATE') or
     has_column_privilege('authenticated','public.activities','project_id','INSERT') or
     has_table_privilege('authenticated','public.activities','DELETE') then
    raise exception 'FAIL: Decision RPC, protected state or history ACL';
  end if;
  raise notice 'PASS: RLS, transition-only RPC grants, forbidden direct writes';
end $acl$;

set local role authenticated;
select set_config('request.jwt.claim.sub','d1d1d1d1-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims',
 '{"sub":"d1d1d1d1-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',true);

-- Account A marks Kitchen Lost; Bathroom must remain Draft.
do $decide$
declare changed public.projects;
begin
  changed := public.mark_project_lost('d5d5d5d5-5555-4555-8555-555555555555');
  if changed.status <> 'lost' then raise exception 'FAIL: Lost not persisted'; end if;
  if (select status from public.projects where id='d6d6d6d6-6666-4666-8666-666666666666') <> 'draft' then
    raise exception 'FAIL: Mark Lost changed sibling';
  end if;
  if (select count(*) from public.activities where project_id='d5d5d5d5-5555-4555-8555-555555555555'
    and type='project_marked_lost') <> 1 then raise exception 'FAIL: Lost history absent'; end if;
  begin
    perform public.mark_project_lost('d5d5d5d5-5555-4555-8555-555555555555');
    raise exception 'FAIL: duplicate Lost transition was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.project_tasks set notes='Closed edit' where project_id='d5d5d5d5-5555-4555-8555-555555555555';
    raise exception 'FAIL: Lost project allowed task update';
  exception when check_violation then null;
  end;
  begin
    update public.projects set title='Closed edit' where id='d5d5d5d5-5555-4555-8555-555555555555';
    raise exception 'FAIL: Lost project allowed title update';
  exception when check_violation then null;
  end;
  if (select count(*) from public.activities where type='project_marked_lost') <> 1 then
    raise exception 'FAIL: duplicate decision activity'; end if;
  begin
    update public.projects set status='draft' where id='d5d5d5d5-5555-4555-8555-555555555555';
    raise exception 'FAIL: direct project status UPDATE available';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.activities(user_id,lead_id,project_id,type,detail)
      values ('d1d1d1d1-1111-4111-8111-111111111111','d3d3d3d3-3333-4333-8333-333333333333',
        'd5d5d5d5-5555-4555-8555-555555555555','project_marked_lost','{}');
    raise exception 'FAIL: client inserted fake decision activity';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.mark_project_won('d5d5d5d5-5555-4555-8555-555555555555',
      'd8d8d8d8-8888-4888-8888-888888888888');
    raise exception 'FAIL: invalid Sent quote was accepted';
  exception when check_violation then null;
  end;
  raise notice 'PASS: Lost, independent sibling, direct update denied, history append-only';
end $decide$;

-- Cross-account denial must hold even when B knows A's project UUID.
select set_config('request.jwt.claim.sub','d2d2d2d2-2222-4222-8222-222222222222',true);
select set_config('request.jwt.claims',
 '{"sub":"d2d2d2d2-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":false}',true);
do $isolation$
begin
  begin
    perform public.reopen_project('d5d5d5d5-5555-4555-8555-555555555555');
    raise exception 'FAIL: B reopened A project';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.mark_project_lost('d6d6d6d6-6666-4666-8666-666666666666');
    raise exception 'FAIL: B marked A project Lost';
  exception when insufficient_privilege then null;
  end;
  if (select count(*) from public.activities where project_id='d5d5d5d5-5555-4555-8555-555555555555') <> 0 then
    raise exception 'FAIL: B can see A history'; end if;
  raise notice 'PASS: cross-account denial';
end $isolation$;

-- Even authenticated role cannot mutate while JWT indicates anonymous auth.
select set_config('request.jwt.claims',
 '{"sub":"d2d2d2d2-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":true}',true);
do $anonymous$
begin
  begin
    perform public.mark_project_lost('d7d7d7d7-7777-4777-8777-777777777777');
    raise exception 'FAIL: anonymous token allowed decision';
  exception when insufficient_privilege then null;
  end;
end $anonymous$;

select set_config('request.jwt.claim.sub','d1d1d1d1-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims',
 '{"sub":"d1d1d1d1-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',true);
-- Reopen restores Draft while quote versions do not exist. Archived history survives.
do $reopen$
declare changed public.projects;
begin
  changed := public.reopen_project('d5d5d5d5-5555-4555-8555-555555555555');
  if changed.status <> 'draft' or changed.accepted_quote_id is not null then
    raise exception 'FAIL: Reopen without Sent quote must return Draft and clear active approval';
  end if;
  update public.project_tasks set notes='Reopened task editing works'
    where project_id=changed.id;
  if (select notes from public.project_tasks where project_id=changed.id) <> 'Reopened task editing works' then
    raise exception 'FAIL: task edit remained locked after Reopen'; end if;
  update public.projects set title='Kitchen reopened' where id=changed.id;
  if (select count(*) from public.activities where project_id=changed.id) <> 2 then
    raise exception 'FAIL: history lost during Reopen'; end if;
  if (select detail ->> 'from_status' from public.activities where type='project_marked_lost') <> 'draft' then
    raise exception 'FAIL: original decision overwritten'; end if;
  begin
    perform public.reopen_project(changed.id);
    raise exception 'FAIL: Reopen Draft accepted';
  exception when check_violation then null;
  end;
  raise notice 'PASS: Reopen, valid state, immutable decision history';
end $reopen$;

-- Final-schema regression: create a real immutable Sent quote before Won.
insert into public.business_profiles(user_id,business_name) values
 ('d1d1d1d1-1111-4111-8111-111111111111','Decision QA');
insert into public.project_tasks(user_id,project_id,category,title,amount_minor) values
 ('d1d1d1d1-1111-4111-8111-111111111111','d6d6d6d6-6666-4666-8666-666666666666','Painting','Paint',100);
do $historical$
declare
 p uuid := 'd6d6d6d6-6666-4666-8666-666666666666';
 preserved uuid; changed public.projects;
begin
 preserved := (public.prepare_quote(p, public.get_unsent_estimate_snapshot(p)->>'fingerprint',gen_random_uuid())->'quote'->>'id')::uuid;
 perform public.confirm_quote_sent(preserved);
 perform public.mark_project_won(p,preserved);
 changed := public.reopen_project(p);
 if changed.status <> 'quote_sent' or changed.accepted_quote_id is not null then
   raise exception 'FAIL: former approval remained active or Sent status lost'; end if;
 if (select detail->>'previous_accepted_quote_id' from public.activities
     where project_id=p and type='project_reopened') <> preserved::text then
   raise exception 'FAIL: earlier approved reference was not preserved'; end if;
 update public.projects set notes='Still editable' where id=p;
 if (select count(*) from public.activities where project_id=p and type='project_marked_won') <> 1 then
   raise exception 'FAIL: edit removed decision history'; end if;
 raise notice 'PASS: Won recovery preserves a real historical Sent approval';
end $historical$;
rollback;
