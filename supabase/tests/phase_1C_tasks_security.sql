-- Disposable Supabase only. Run after 20261022050000; transaction is rolled back.
-- psql -X -v ON_ERROR_STOP=1 -f supabase/tests/phase_1C_tasks_security.sql
\set ON_ERROR_STOP on
begin;

insert into auth.users(id, instance_id, aud, role, email, created_at, updated_at)
values
('cccccccc-cccc-4ccc-8ccc-ccccccccccc1','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','phase1c-owner-a@example.test',now(),now()),
('cccccccc-cccc-4ccc-8ccc-ccccccccccc2','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','phase1c-owner-b@example.test',now(),now());

do $acl$
begin
  if not (select relrowsecurity from pg_class where oid='public.project_tasks'::regclass) or
    has_table_privilege('anon','public.project_tasks','SELECT') or
    has_table_privilege('anon','public.project_tasks','DELETE') or
    not has_table_privilege('authenticated','public.project_tasks','DELETE') or
    has_column_privilege('authenticated','public.project_tasks','user_id','UPDATE') or
    has_column_privilege('authenticated','public.project_tasks','project_id','UPDATE') or
    has_column_privilege('authenticated','public.project_tasks','id','INSERT') or
    has_column_privilege('authenticated','public.project_tasks','updated_at','UPDATE') then
    raise exception 'FAIL: ACLs and RLS must be owner-scoped';
  end if;
  raise notice 'PASS: scoped task grants and RLS enabled';
end $acl$;

set local role authenticated;
select set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-ccccccccccc1',true);
select set_config('request.jwt.claims',
 '{"sub":"cccccccc-cccc-4ccc-8ccc-ccccccccccc1","role":"authenticated","is_anonymous":false}',true);
-- Deterministic IDs are privileged fixture setup; application grants stay unchanged.
reset role;
insert into public.leads(id,user_id,customer_name,phone,source)
values ('dddddddd-dddd-4ddd-8ddd-ddddddddddd1','cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
 'Customer A','555','Referral');
set local role authenticated;
-- Deterministic IDs are privileged fixture setup; application grants stay unchanged.
reset role;
insert into public.projects(id,user_id,lead_id,title)
values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
 'dddddddd-dddd-4ddd-8ddd-ddddddddddd1','Kitchen');
set local role authenticated;
-- Deterministic IDs are privileged fixture setup; application grants stay unchanged.
reset role;
insert into public.project_tasks(id,user_id,project_id,category,title,notes,amount_minor)
values
('ffffffff-ffff-4fff-8fff-fffffffffff1','cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','Kitchen Remodeling','Cabinets','Cabinets notes',150001),
('ffffffff-ffff-4fff-8fff-fffffffffff2','cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','Kitchen Remodeling','Countertop','Other notes',0);
set local role authenticated;

do $owned$
declare n integer;
begin
  select count(*) into n from public.project_tasks;
  if n <> 2 then raise exception 'FAIL: repeated categories were merged'; end if;
  update public.project_tasks set notes='Updated countertop', amount_minor=10010
    where id='ffffffff-ffff-4fff-8fff-fffffffffff2';
  if (select notes from public.project_tasks where id='ffffffff-ffff-4fff-8fff-fffffffffff1')
     <> 'Cabinets notes' then raise exception 'FAIL: sibling notes overwritten'; end if;
  if (select amount_minor from public.project_tasks where id='ffffffff-ffff-4fff-8fff-fffffffffff2')
     <> 10010 then raise exception 'FAIL: exact cents not persisted'; end if;
  begin
    insert into public.project_tasks(user_id,project_id,category,title,amount_minor)
    values ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','Flooring','Negative',-1);
    raise exception 'FAIL: negative amount accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.project_tasks(user_id,project_id,category,title,amount_minor)
    values ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','Flooring','Overflow',9007199254740992);
    raise exception 'FAIL: unsafe cents accepted';
  exception when check_violation then null;
  end;
  begin
    update public.project_tasks set project_id = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
    raise exception 'FAIL: project reassignment granted';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: duplicates, notes, cents, validation and protected identity';
end $owned$;

select set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-ccccccccccc2',true);
select set_config('request.jwt.claims',
 '{"sub":"cccccccc-cccc-4ccc-8ccc-ccccccccccc2","role":"authenticated","is_anonymous":false}',true);

do $other$
declare n integer;
begin
  select count(*) into n from public.project_tasks;
  if n <> 0 then raise exception 'FAIL: B saw A tasks'; end if;
  update public.project_tasks set notes='Wrong account';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B updated A tasks'; end if;
  delete from public.project_tasks;
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B deleted A tasks'; end if;
  begin
    insert into public.project_tasks(user_id,project_id,category,title,amount_minor)
    values ('cccccccc-cccc-4ccc-8ccc-ccccccccccc2',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','Flooring','Cross owner',0);
    raise exception 'FAIL: B created in A project';
  exception when foreign_key_violation then null;
  end;
  raise notice 'PASS: account isolation';
end $other$;

-- Simulate future protected project-status RPC/decision with privileged fixture only.
reset role;
update public.projects set status='lost' where id='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1';
set local role authenticated;
select set_config('request.jwt.claim.sub','cccccccc-cccc-4ccc-8ccc-ccccccccccc1',true);
select set_config('request.jwt.claims',
 '{"sub":"cccccccc-cccc-4ccc-8ccc-ccccccccccc1","role":"authenticated","is_anonymous":false}',true);

do $closed$
begin
  begin
    insert into public.project_tasks(user_id,project_id,category,title,amount_minor)
    values ('cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
      'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeee1','Flooring','Not allowed',0);
    raise exception 'FAIL: insert into closed project succeeded';
  exception when check_violation then null;
  end;
  begin
    update public.project_tasks set notes='Tampered';
    raise exception 'FAIL: closed-project task update succeeded';
  exception when check_violation then null;
  end;
  begin
    delete from public.project_tasks;
    raise exception 'FAIL: closed-project task delete succeeded';
  exception when check_violation then null;
  end;
  raise notice 'PASS: closed-project write protection';
end $closed$;

reset role;
rollback;
