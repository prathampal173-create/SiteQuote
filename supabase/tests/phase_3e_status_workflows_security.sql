-- Disposable Supabase only: apply ALL 14 chronological migrations first.
-- psql -X -v ON_ERROR_STOP=1 -f supabase/tests/phase_3e_status_workflows_security.sql
-- Transaction rolls back every fixture. Run authenticated requests with real JWTs separately.
\set ON_ERROR_STOP on
begin;
do $acl$
begin
 if has_function_privilege('anon','public.confirm_quote_sent(uuid)','EXECUTE')
    or has_function_privilege('anon','public.mark_project_won(uuid,uuid)','EXECUTE')
    or not has_function_privilege('authenticated','public.confirm_quote_sent(uuid)','EXECUTE')
    or not has_function_privilege('authenticated','public.mark_project_won(uuid,uuid)','EXECUTE')
    or has_table_privilege('authenticated','public.quotes','UPDATE')
    or has_column_privilege('authenticated','public.projects','status','UPDATE')
    or has_column_privilege('authenticated','public.projects','accepted_quote_id','UPDATE') then
   raise exception 'Phase 3D/3E ACLs are unsafe';
 end if;
 if not exists (select 1 from pg_constraint where conname='projects_accepted_quote_owner_project_fk')
    or not exists (select 1 from pg_constraint where conname='projects_won_requires_acceptance') then
   raise exception 'Missing acceptance relationship constraints';
 end if;
end $acl$;
insert into auth.users(id,instance_id,aud,role,email,created_at,updated_at) values
 ('e1111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','3e-a@example.test',now(),now()),
 ('e2222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','3e-b@example.test',now(),now());
insert into public.business_profiles(user_id,business_name) values ('e1111111-1111-4111-8111-111111111111','Builder A');
insert into public.leads(id,user_id,customer_name,phone,source) values
 ('e3333333-3333-4333-8333-333333333333','e1111111-1111-4111-8111-111111111111','Customer A','123','Other'),
 ('e4444444-4444-4444-8444-444444444444','e2222222-2222-4222-8222-222222222222','Customer B','456','Other');
insert into public.projects(id,user_id,lead_id,title,tax_bps) values
 ('e5555555-5555-4555-8555-555555555555','e1111111-1111-4111-8111-111111111111','e3333333-3333-4333-8333-333333333333','Kitchen',800),
 ('e6666666-6666-4666-8666-666666666666','e1111111-1111-4111-8111-111111111111','e3333333-3333-4333-8333-333333333333','Sibling',0),
 ('e7777777-7777-4777-8777-777777777777','e2222222-2222-4222-8222-222222222222','e4444444-4444-4444-8444-444444444444','Foreign',0);
insert into public.project_tasks(user_id,project_id,category,title,amount_minor) values
 ('e1111111-1111-4111-8111-111111111111','e5555555-5555-4555-8555-555555555555','Painting','Paint',300000),
 ('e1111111-1111-4111-8111-111111111111','e6666666-6666-4666-8666-666666666666','Painting','Sibling task',10000);
insert into public.project_additional_charges(user_id,project_id,description,amount_minor) values
 ('e1111111-1111-4111-8111-111111111111','e5555555-5555-4555-8555-555555555555','Permit',15000);
set local role authenticated;
select set_config('request.jwt.claim.sub','e1111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims','{"sub":"e1111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',true);
do $verify$
declare fp text; prepared jsonb; second jsonb; a uuid; b uuid; accepted public.projects%rowtype; prior text; history_count integer;
begin
 fp := public.get_unsent_estimate_snapshot('e5555555-5555-4555-8555-555555555555')->>'fingerprint';
 prepared := public.prepare_quote('e5555555-5555-4555-8555-555555555555',fp,'e8000000-0000-4000-8000-000000000001');
 a := (prepared->'quote'->>'id')::uuid;
 if (prepared->'quote'->>'total_minor')::bigint <> 340200 then raise exception '$3402 acceptance failed'; end if;
 begin
   perform public.mark_project_won('e5555555-5555-4555-8555-555555555555',a);
   raise exception 'Prepared quote was accepted';
 exception when check_violation then null; end;
 begin
   perform public.confirm_quote_sent('e5555555-5555-4555-8555-555555555555');
   raise exception 'Project UUID was accepted as quote ID';
 exception when insufficient_privilege then null; end;
 if (public.confirm_quote_sent(a)).status <> 'sent' then raise exception 'Confirm did not mark quote Sent'; end if;
 prior := (select snapshot::text from public.quotes where id=a);
 if (select status from public.projects where id='e5555555-5555-4555-8555-555555555555') <> 'quote_sent' then
   raise exception 'Explicit Sent did not set project Quote Sent'; end if;
 if (select status from public.projects where id='e6666666-6666-4666-8666-666666666666') <> 'draft' then
   raise exception 'Sent changed sibling'; end if;
 if (public.confirm_quote_sent(a)).status <> 'sent' then raise exception 'Retry not idempotent'; end if;
 if (select count(*) from public.activities where type='quote_marked_sent' and project_id='e5555555-5555-4555-8555-555555555555') <> 1 then
   raise exception 'Duplicate Sent activity'; end if;
 begin
   update public.quotes set snapshot='{}'::jsonb where id=a;
   raise exception 'Direct quote mutation succeeded';
 exception when insufficient_privilege then null; end;
 -- Revise and explicitly send v2, but approve older v1.
 update public.project_tasks set amount_minor=310000 where project_id='e5555555-5555-4555-8555-555555555555';
 fp := public.get_unsent_estimate_snapshot('e5555555-5555-4555-8555-555555555555')->>'fingerprint';
 second := public.prepare_quote('e5555555-5555-4555-8555-555555555555',fp,'e8000000-0000-4000-8000-000000000002');
 b := (second->'quote'->>'id')::uuid;
 if (second->'quote'->>'version')::integer <> 2 then raise exception 'v2 expected'; end if;
 perform public.confirm_quote_sent(b);
 begin
   perform public.mark_project_won('e5555555-5555-4555-8555-555555555555',
      'e9999999-9999-4999-8999-999999999999');
   raise exception 'Unknown quote accepted';
 exception when check_violation then null; end;
 accepted := public.mark_project_won('e5555555-5555-4555-8555-555555555555',a);
 if accepted.status <> 'won' or accepted.accepted_quote_id <> a then
    raise exception 'Wrong accepted quote'; end if;
 if (select status from public.projects where id='e6666666-6666-4666-8666-666666666666') <> 'draft' then
   raise exception 'Won changed sibling'; end if;
 if (select snapshot::text from public.quotes where id=a) <> prior then
   raise exception 'Frozen quote changed'; end if;
 begin
   update public.project_tasks set amount_minor=1 where project_id=accepted.id;
   raise exception 'Won allowed task update';
 exception when check_violation then null; end;
 begin
   update public.project_additional_charges set amount_minor=1 where project_id=accepted.id;
   raise exception 'Won allowed charge update';
 exception when check_violation then null; end;
 begin
   update public.projects set tax_bps=100 where id=accepted.id;
   raise exception 'Won allowed tax update';
 exception when check_violation then null; end;
 begin
   perform public.confirm_quote_sent(a); -- already Sent: must not change Won
   if (select status from public.projects where id=accepted.id) <> 'won' then
     raise exception 'Sent retry undid Won'; end if;
 end;
 update public.projects set notes='internal note allowed' where id=accepted.id;
 update public.leads set customer_name='Customer changed' where id=accepted.lead_id;
 update public.business_profiles set business_name='Builder renamed' where user_id=accepted.user_id;
 begin
   perform public.mark_project_lost(accepted.id);
   raise exception 'Won allowed direct Lost';
 exception when check_violation then null; end;
 accepted := public.reopen_project(accepted.id);
 if accepted.status <> 'quote_sent' or accepted.accepted_quote_id is not null then
   raise exception 'Reopen must clear active acceptance and keep Sent history'; end if;
 if (select count(*) from public.activities where type='project_marked_won' and project_id=accepted.id)<>1 or
    (select detail->>'previous_accepted_quote_id' from public.activities where type='project_reopened' and project_id=accepted.id limit 1)<>a::text then
   raise exception 'Reopen lost acceptance history'; end if;
 accepted := public.mark_project_lost(accepted.id);
 if accepted.status<>'lost' then raise exception 'Mark Lost failed'; end if;
 begin
   perform public.confirm_quote_sent(b); -- idempotent even after Lost
   if (select status from public.projects where id=accepted.id)<>'lost' then
     raise exception 'Sent retry undid Lost'; end if;
 end;
 begin
   perform public.mark_project_won(accepted.id,b);
   raise exception 'Lost allowed Won';
 exception when check_violation then null; end;
 accepted := public.reopen_project(accepted.id);
 if accepted.status<>'quote_sent' then raise exception 'Lost reopened to wrong state'; end if;
 if (select count(*) from public.activities where project_id=accepted.id and type in
     ('quote_marked_sent','project_marked_won','project_reopened','project_marked_lost'))<>6 then
   raise exception 'Unexpected append-only activity count'; end if;
 raise notice 'PASS: Prepared denied, Sent idempotent, $3402, older accepted, ownership, locks, history, siblings';
end $verify$;
select set_config('request.jwt.claim.sub','e2222222-2222-4222-8222-222222222222',true);
select set_config('request.jwt.claims','{"sub":"e2222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":false}',true);
do $other$
declare quote_id uuid;
begin
 if (select count(*) from public.quotes) <> 0 then raise exception 'Foreign quote visible to B'; end if;
 quote_id := 'e8000000-0000-4000-8000-000000000001';
 begin
   perform public.mark_project_won('e5555555-5555-4555-8555-555555555555',quote_id);
   raise exception 'B marked A Won';
 exception when insufficient_privilege then null; end;
 begin
   perform public.confirm_quote_sent(quote_id);
   raise exception 'B confirmed foreign quote';
 exception when insufficient_privilege then null; end;
end $other$;
select set_config('request.jwt.claims','{"sub":"e2222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":true}',true);
do $anon$
begin
 begin
   perform public.mark_project_won('e7777777-7777-4777-8777-777777777777','e8000000-0000-4000-8000-000000000001');
   raise exception 'Anonymous user marked Won';
 exception when insufficient_privilege then null; end;
end $anon$;
rollback;
