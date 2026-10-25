-- Disposable database only. Run after ALL forward migrations, with psql -X -v ON_ERROR_STOP=1.
-- This transaction rolls back every fixture, including auth.users.
\set ON_ERROR_STOP on
begin;
do $ddl$
begin
 if has_function_privilege('anon','public.prepare_quote(uuid,text,uuid)','EXECUTE') or
    not has_function_privilege('authenticated','public.prepare_quote(uuid,text,uuid)','EXECUTE') or
    has_table_privilege('authenticated','public.quotes','INSERT') or
    has_table_privilege('authenticated','public.quotes','UPDATE') or
    has_table_privilege('authenticated','public.quotes','DELETE') or
    has_table_privilege('authenticated','public.quote_prepare_requests','SELECT') or
    not (select p.prosecdef from pg_proc p where p.oid='public.prepare_quote(uuid,text,uuid)'::regprocedure) then
   raise exception 'Unexpected quote/RPC ACL';
 end if;
end $ddl$;
insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at) values
 ('c1111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','3c-a@example.test',now(),now()),
 ('c2222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','3c-b@example.test',now(),now());
insert into public.business_profiles(user_id,business_name) values ('c1111111-1111-4111-8111-111111111111','Builder A');
insert into public.leads(id,user_id,customer_name,phone,source,notes) values
 ('c3333333-3333-4333-8333-333333333333','c1111111-1111-4111-8111-111111111111','Customer A','123','Other','HIDDEN LEAD NOTE'),
 ('c4444444-4444-4444-8444-444444444444','c2222222-2222-4222-8222-222222222222','Customer B','456','Other','HIDDEN B');
insert into public.projects(id,user_id,lead_id,title,tax_bps,notes) values
 ('c5555555-5555-4555-8555-555555555555','c1111111-1111-4111-8111-111111111111','c3333333-3333-4333-8333-333333333333','Kitchen',800,'HIDDEN PROJECT NOTE'),
 ('c6666666-6666-4666-8666-666666666666','c2222222-2222-4222-8222-222222222222','c4444444-4444-4444-8444-444444444444','Bathroom',0,'HIDDEN B');
insert into public.project_tasks(user_id,project_id,category,title,notes,amount_minor) values
 ('c1111111-1111-4111-8111-111111111111','c5555555-5555-4555-8555-555555555555','Painting','Task A','Allowed public note',150000),
 ('c1111111-1111-4111-8111-111111111111','c5555555-5555-4555-8555-555555555555','Painting','Task B',null,50000),
 ('c1111111-1111-4111-8111-111111111111','c5555555-5555-4555-8555-555555555555','Painting','Task C',null,100000);
insert into public.project_additional_charges(user_id,project_id,description,amount_minor) values
 ('c1111111-1111-4111-8111-111111111111','c5555555-5555-4555-8555-555555555555','Permit',10000),
 ('c1111111-1111-4111-8111-111111111111','c5555555-5555-4555-8555-555555555555','Disposal',5000);
set local role authenticated;
select set_config('request.jwt.claim.sub','c1111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims','{"sub":"c1111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',true);
do $owner$
declare old_fp text; new_fp text; a jsonb; again jsonb; second jsonb; reverted jsonb; before_json text;
begin
 old_fp := public.get_unsent_estimate_snapshot('c5555555-5555-4555-8555-555555555555')->>'fingerprint';
 a := public.prepare_quote('c5555555-5555-4555-8555-555555555555',old_fp,'c7000000-0000-4000-8000-000000000001');
 if a->>'result' <> 'created' or (a->'quote'->>'version')::int <> 1 or
    (a->'quote'->>'total_minor')::bigint <> 340200 or
    a->'quote'->>'status' <> 'prepared' then raise exception 'v1 or 3402 acceptance failed'; end if;
 before_json := (a->'quote'->'snapshot')::text;
 if position('HIDDEN LEAD NOTE' in before_json) > 0 or position('HIDDEN PROJECT NOTE' in before_json) > 0 or
    position('Allowed public note' in before_json)=0 then raise exception 'Quote snapshot leak or missing task note'; end if;
 again := public.prepare_quote('c5555555-5555-4555-8555-555555555555',old_fp,'c7000000-0000-4000-8000-000000000001');
 if (again->'quote'->>'id') <> (a->'quote'->>'id') then raise exception 'Idempotency key did not reuse'; end if;
 again := public.prepare_quote('c5555555-5555-4555-8555-555555555555',old_fp,'c7000000-0000-4000-8000-000000000002');
 if (again->'quote'->>'id') <> (a->'quote'->>'id') then raise exception 'Fingerprint did not reuse'; end if;
 begin
   perform public.prepare_quote('c6666666-6666-4666-8666-666666666666',old_fp,'c7000000-0000-4000-8000-000000000003');
   raise exception 'Foreign project preparation succeeded';
 exception when insufficient_privilege then null; end;
 begin
   update public.quotes set total_minor=1 where id=(a->'quote'->>'id')::uuid;
   raise exception 'Direct quote modification succeeded';
 exception when insufficient_privilege then null; end;
 update public.project_tasks set amount_minor=150001 where project_id='c5555555-5555-4555-8555-555555555555' and title='Task A';
 begin
   perform public.prepare_quote('c5555555-5555-4555-8555-555555555555',old_fp,'c7000000-0000-4000-8000-000000000004');
   raise exception 'Stale fingerprint accepted';
 exception when raise_exception then
   if sqlerrm <> 'Estimate changed — preview again.' then raise; end if;
 end;
 new_fp := public.get_unsent_estimate_snapshot('c5555555-5555-4555-8555-555555555555')->>'fingerprint';
 second := public.prepare_quote('c5555555-5555-4555-8555-555555555555',new_fp,'c7000000-0000-4000-8000-000000000005');
 if second->>'result'<>'created' or (second->'quote'->>'version')::int<>2 then raise exception 'v2 sequencing failed'; end if;
 update public.project_tasks set amount_minor=150000 where project_id='c5555555-5555-4555-8555-555555555555' and title='Task A';
 reverted := public.prepare_quote('c5555555-5555-4555-8555-555555555555',old_fp,'c7000000-0000-4000-8000-000000000006');
 if (reverted->'quote'->>'id') <> (a->'quote'->>'id') or
    (reverted->'quote'->>'issued_at') <> (a->'quote'->>'issued_at') then raise exception 'A-B-A original version/issued date not reused'; end if;
 if (select count(*) from public.quotes where project_id='c5555555-5555-4555-8555-555555555555')<>2 then
   raise exception 'Duplicate versions were generated'; end if;
 if (select snapshot::text from public.quotes where id=(a->'quote'->>'id')::uuid)<>before_json then
   raise exception 'Old snapshot mutated'; end if;
 if (select status from public.projects where id='c5555555-5555-4555-8555-555555555555')<>'draft' then
   raise exception 'Preparing changed project status'; end if;
 raise notice 'PASS $3402, no leakage, idempotency, v1-v2-v1, stale rejection and immutable versions';
end $owner$;
-- Database-owner fixture simulates future Phase 3D project status without permitting
-- client writes. Status must not change PDF-content hash or a prepared snapshot.
reset role;
update public.projects set status='quote_sent' where id='c5555555-5555-4555-8555-555555555555';
set local role authenticated;
do $statushash$
declare old_fp text; fresh_fp text;
begin
 select fingerprint into old_fp from public.quotes where project_id='c5555555-5555-4555-8555-555555555555' and version=1;
 fresh_fp := public.get_unsent_estimate_snapshot('c5555555-5555-4555-8555-555555555555')->>'fingerprint';
 if old_fp <> fresh_fp then raise exception 'Status-only change altered PDF content fingerprint'; end if;
end $statushash$;
reset role;
update public.projects set status='lost' where id='c5555555-5555-4555-8555-555555555555';
set local role authenticated;
do $closed$
begin
 begin
   perform public.prepare_quote('c5555555-5555-4555-8555-555555555555',
     public.get_unsent_estimate_snapshot('c5555555-5555-4555-8555-555555555555')->>'fingerprint',
     'c7000000-0000-4000-8000-000000000009');
   raise exception 'Lost project allowed preparation';
 exception when check_violation then null; end;
end $closed$;
select set_config('request.jwt.claim.sub','c2222222-2222-4222-8222-222222222222',true);
select set_config('request.jwt.claims','{"sub":"c2222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":false}',true);
do $other$
begin
 if (select count(*) from public.quotes) <> 0 then raise exception 'Foreign quote visible'; end if;
 if public.get_unsent_estimate_snapshot('c5555555-5555-4555-8555-555555555555') is not null then
   raise exception 'Foreign snapshot visible'; end if;
 begin
   perform public.prepare_quote('c5555555-5555-4555-8555-555555555555',repeat('0',64),'c7000000-0000-4000-8000-000000000007');
   raise exception 'B prepared A project';
 exception when insufficient_privilege then null; end;
end $other$;
select set_config('request.jwt.claims','{"sub":"c2222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":true}',true);
do $anon$
begin
 begin
   perform public.prepare_quote('c6666666-6666-4666-8666-666666666666',repeat('0',64),'c7000000-0000-4000-8000-000000000008');
   raise exception 'Anonymous prepared quote';
 exception when insufficient_privilege then null; end;
end $anon$;
reset role;
rollback;
