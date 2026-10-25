-- Disposable DB-only Phase 3B snapshot/RLS/consistency security fixture.
-- Apply all 11 migrations first; run as DB owner using psql. Entire fixture rolls back.
\set ON_ERROR_STOP on
begin;
do $acl$
begin
  if has_function_privilege('anon','public.get_unsent_estimate_snapshot(uuid)','EXECUTE')
     or not has_function_privilege('authenticated','public.get_unsent_estimate_snapshot(uuid)','EXECUTE')
     or not exists (select 1 from pg_proc p where p.oid='public.get_unsent_estimate_snapshot(uuid)'::regprocedure
       and p.provolatile='s' and not p.prosecdef) then
    raise exception 'Snapshot must be STABLE SECURITY INVOKER and only executable by authenticated';
  end if;
end $acl$;
insert into auth.users (id,instance_id,aud,role,email,created_at,updated_at) values
 ('d1111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase3b-a@example.test',now(),now()),
 ('d2222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase3b-b@example.test',now(),now());
insert into public.business_profiles (user_id,business_name,address) values
 ('d1111111-1111-4111-8111-111111111111','Builder A','1 Main');
insert into public.leads (id,user_id,customer_name,phone,notes,source) values
 ('d3333333-3333-4333-8333-333333333333','d1111111-1111-4111-8111-111111111111','Client A','111','PRIVATE LEAD NOTE','Other'),
 ('d4444444-4444-4444-8444-444444444444','d2222222-2222-4222-8222-222222222222','Client B','222','B PRIVATE','Other');
insert into public.projects (id,user_id,lead_id,title,notes,tax_bps) values
 ('d5555555-5555-4555-8555-555555555555','d1111111-1111-4111-8111-111111111111','d3333333-3333-4333-8333-333333333333','Kitchen A','PRIVATE PROJECT NOTE',800),
 ('d6666666-6666-4666-8666-666666666666','d2222222-2222-4222-8222-222222222222','d4444444-4444-4444-8444-444444444444','Kitchen B','B PRIVATE',0);
insert into public.project_tasks (user_id,project_id,category,title,notes,amount_minor) values
 ('d1111111-1111-4111-8111-111111111111','d5555555-5555-4555-8555-555555555555','Painting','Task A','Allowed task note',150000),
 ('d1111111-1111-4111-8111-111111111111','d5555555-5555-4555-8555-555555555555','Painting','Task B',null,50000),
 ('d1111111-1111-4111-8111-111111111111','d5555555-5555-4555-8555-555555555555','Painting','Task C',null,100000);
insert into public.project_additional_charges (user_id,project_id,description,amount_minor) values
 ('d1111111-1111-4111-8111-111111111111','d5555555-5555-4555-8555-555555555555','Permit',10000),
 ('d1111111-1111-4111-8111-111111111111','d5555555-5555-4555-8555-555555555555','Disposal',5000);
set local role authenticated;
select set_config('request.jwt.claim.sub','d1111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims','{"sub":"d1111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',true);
do $owner$
declare s jsonb; s2 jsonb; s3 jsonb;
begin
  s := public.get_unsent_estimate_snapshot('d5555555-5555-4555-8555-555555555555');
  s2 := public.get_unsent_estimate_snapshot('d5555555-5555-4555-8555-555555555555');
  if s is null or s->>'fingerprint' is null or s->>'fingerprint' <> s2->>'fingerprint'
    or length(s->>'fingerprint') <> 64 then raise exception 'missing or unstable fingerprint'; end if;
  if jsonb_array_length(s->'content'->'tasks') <> 3 or jsonb_array_length(s->'content'->'charges') <> 2
     or (select sum((v->>'amount_minor')::bigint) from jsonb_array_elements(s->'content'->'tasks') v) <> 300000
     or (select sum((v->>'amount_minor')::bigint) from jsonb_array_elements(s->'content'->'charges') v) <> 15000
     or (s->'content'->>'tax_bps')::int <> 800 then raise exception '3,402 saved acceptance inputs wrong'; end if;
  if position('PRIVATE LEAD NOTE' in s::text) > 0 or position('PRIVATE PROJECT NOTE' in s::text) > 0
     or position('Allowed task note' in s::text) = 0 then raise exception 'public/internal note selection wrong'; end if;
  if s->'content' ? 'notes' or s->'content' ? 'accepted_quote_id' then
    raise exception 'private fields included'; end if;
  if public.get_unsent_estimate_snapshot('d6666666-6666-4666-8666-666666666666') is not null then
    raise exception 'A can read B estimate'; end if;
  update public.projects set title = 'New Kitchen' where id='d5555555-5555-4555-8555-555555555555';
  s3 := public.get_unsent_estimate_snapshot('d5555555-5555-4555-8555-555555555555');
  if s3->>'fingerprint' = s->>'fingerprint' then raise exception 'project edit not fingerprinted'; end if;
  update public.project_tasks set amount_minor=150001 where title='Task A';
  if (public.get_unsent_estimate_snapshot('d5555555-5555-4555-8555-555555555555')->>'fingerprint') = s3->>'fingerprint'
    then raise exception 'task cost edit not fingerprinted'; end if;
  raise notice 'PASS owner snapshot, 3402 inputs, stability, field policy and invalidation';
end $owner$;
select set_config('request.jwt.claim.sub','d2222222-2222-4222-8222-222222222222',true);
select set_config('request.jwt.claims','{"sub":"d2222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":false}',true);
do $other$
begin
 if public.get_unsent_estimate_snapshot('d5555555-5555-4555-8555-555555555555') is not null then
   raise exception 'B can read A snapshot'; end if;
 if public.get_unsent_estimate_snapshot('d6666666-6666-4666-8666-666666666666') is null then
   raise exception 'B cannot read B snapshot'; end if;
end $other$;
select set_config('request.jwt.claims','{"sub":"d2222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":true}',true);
do $anonymous$
begin
 if public.get_unsent_estimate_snapshot('d6666666-6666-4666-8666-666666666666') is not null then
  raise exception 'anonymous auth user obtained snapshot'; end if;
end $anonymous$;
reset role;
rollback;
