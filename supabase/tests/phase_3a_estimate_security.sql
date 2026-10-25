-- Phase 3A disposable security test. Execute as the disposable database owner
-- AFTER all 10 migrations: psql -X -v ON_ERROR_STOP=1 -f ...
-- All fixtures are rolled back. Never execute against production.
\set ON_ERROR_STOP on
begin;
do $acl$
begin
  if (select relrowsecurity from pg_class where oid='public.project_additional_charges'::regclass) is not true or
     has_table_privilege('anon','public.project_additional_charges','SELECT') or
     has_table_privilege('anon','public.project_additional_charges','INSERT') or
     has_table_privilege('authenticated','public.project_additional_charges','UPDATE') or
     not has_column_privilege('authenticated','public.project_additional_charges','amount_minor','UPDATE') or
     has_column_privilege('authenticated','public.project_additional_charges','user_id','UPDATE') or
     has_column_privilege('authenticated','public.project_additional_charges','project_id','UPDATE') or
     has_column_privilege('authenticated','public.project_additional_charges','id','INSERT') or
     has_column_privilege('authenticated','public.projects','status','UPDATE') then
    raise exception 'Phase 3A RLS/grant configuration failed';
  end if;
  if (select count(*) from pg_policies where schemaname='public' and tablename='project_additional_charges') <> 4 then
    raise exception 'Expected four owner-scoped charge policies';
  end if;
  if not exists (select 1 from pg_constraint where conname='project_additional_charges_owner_project_fk') or
     not exists (select 1 from pg_trigger where tgname='project_additional_charges_edit_guard' and not tgisinternal) then
    raise exception 'Missing owner/project FK or closed-project edit guard';
  end if;
  raise notice 'PASS: charge grants, RLS, FK and edit guard present';
end $acl$;
insert into auth.users (id,instance_id,aud,role,email,created_at,updated_at) values
 ('c1111111-1111-4111-8111-111111111111','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase3a-a@example.test',now(),now()),
 ('c2222222-2222-4222-8222-222222222222','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase3a-b@example.test',now(),now());
insert into public.leads (id,user_id,customer_name,phone,source) values
 ('c3333333-3333-4333-8333-333333333333','c1111111-1111-4111-8111-111111111111','A','123','Other'),
 ('c4444444-4444-4444-8444-444444444444','c2222222-2222-4222-8222-222222222222','B','123','Other');
insert into public.projects (id,user_id,lead_id,title) values
 ('c5555555-5555-4555-8555-555555555555','c1111111-1111-4111-8111-111111111111','c3333333-3333-4333-8333-333333333333','Kitchen'),
 ('c6666666-6666-4666-8666-666666666666','c2222222-2222-4222-8222-222222222222','c4444444-4444-4444-8444-444444444444','Bathroom');
insert into public.project_tasks (user_id,project_id,category,title,amount_minor) values
 ('c1111111-1111-4111-8111-111111111111','c5555555-5555-4555-8555-555555555555','Kitchen Remodeling','Cabinets',100000),
 ('c1111111-1111-4111-8111-111111111111','c5555555-5555-4555-8555-555555555555','Kitchen Remodeling','Counters',200000);
set local role authenticated;
select set_config('request.jwt.claim.sub','c1111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims','{"sub":"c1111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',true);
insert into public.project_additional_charges (user_id,project_id,description,amount_minor) values
 ('c1111111-1111-4111-8111-111111111111','c5555555-5555-4555-8555-555555555555','Permit',10000),
 ('c1111111-1111-4111-8111-111111111111','c5555555-5555-4555-8555-555555555555','Removal',5000);
do $owner$
begin
  if (select sum(amount_minor) from public.project_additional_charges) <> 15000 then raise exception 'Wrong own amounts'; end if;
  if (select coalesce(sum(amount_minor),0) from public.project_tasks) <> 300000 then raise exception 'Wrong task subtotal'; end if;
  if (315000::bigint * 800 + 5000) / 10000 <> 25200 or 315000 + 25200 <> 340200 then
    raise exception 'Acceptance example math failed';
  end if;
  begin
    insert into public.project_additional_charges (user_id,project_id,description,amount_minor) values
     ('c2222222-2222-4222-8222-222222222222','c6666666-6666-4666-8666-666666666666','B charge',1);
    raise exception 'A inserted as B';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.project_additional_charges (user_id,project_id,description,amount_minor) values
     ('c1111111-1111-4111-8111-111111111111','c6666666-6666-4666-8666-666666666666','Wrong project',1);
    raise exception 'Cross-project charge was allowed';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.project_additional_charges (user_id,project_id,description,amount_minor) values
     ('c1111111-1111-4111-8111-111111111111','c5555555-5555-4555-8555-555555555555','Negative',-1);
    raise exception 'Negative charge was accepted';
  exception when check_violation then null;
  end;
  begin
    update public.projects set tax_bps=3001 where id='c5555555-5555-4555-8555-555555555555';
    raise exception 'Tax >30%% was allowed';
  exception when check_violation then null;
  end;
  update public.projects set tax_bps=800 where id='c5555555-5555-4555-8555-555555555555';
  if (select tax_bps from public.projects where id='c5555555-5555-4555-8555-555555555555') <> 800 then raise exception 'Tax update failed'; end if;
  perform public.mark_project_lost('c5555555-5555-4555-8555-555555555555');
  begin
    insert into public.project_additional_charges (user_id,project_id,description,amount_minor) values
     ('c1111111-1111-4111-8111-111111111111','c5555555-5555-4555-8555-555555555555','Closed',1);
    raise exception 'Closed project accepted charge INSERT';
  exception when check_violation then null;
  end;
  begin
    update public.project_additional_charges set amount_minor=20000 where project_id='c5555555-5555-4555-8555-555555555555';
    raise exception 'Closed project accepted charge UPDATE';
  exception when check_violation then null;
  end;
  begin
    delete from public.project_additional_charges where project_id='c5555555-5555-4555-8555-555555555555';
    raise exception 'Closed project accepted charge DELETE';
  exception when check_violation then null;
  end;
  begin
    update public.projects set tax_bps=700 where id='c5555555-5555-4555-8555-555555555555';
    raise exception 'Closed project accepted tax change';
  exception when check_violation then null;
  end;
  raise notice 'PASS: amount/tax constraints, owner FK and Won/Lost locks';
end $owner$;
select set_config('request.jwt.claim.sub','c2222222-2222-4222-8222-222222222222',true);
select set_config('request.jwt.claims','{"sub":"c2222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":false}',true);
do $isolation$
begin
  if (select count(*) from public.project_additional_charges) <> 0 then raise exception 'B can read A charges'; end if;
  update public.projects set tax_bps=0 where id='c5555555-5555-4555-8555-555555555555';
  if found then raise exception 'B changed A tax'; end if;
  if (select count(*) from public.projects where id='c5555555-5555-4555-8555-555555555555') <> 0 then raise exception 'B can read A project'; end if;
  update public.project_additional_charges set amount_minor=1 where project_id='c5555555-5555-4555-8555-555555555555';
  if found then raise exception 'B updated A charge'; end if;
  delete from public.project_additional_charges where project_id='c5555555-5555-4555-8555-555555555555';
  if found then raise exception 'B deleted A charge'; end if;
  insert into public.project_additional_charges (user_id,project_id,description,amount_minor) values
   ('c2222222-2222-4222-8222-222222222222','c6666666-6666-4666-8666-666666666666','B own',200);
  if (select count(*) from public.project_additional_charges) <> 1 then raise exception 'B own insert or isolation failed'; end if;
  raise notice 'PASS: B owns its own charge; A charges and tax invisible/immutable';
end $isolation$;
select set_config('request.jwt.claims','{"sub":"c2222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":true}',true);
do $anon$
begin
  begin
    insert into public.project_additional_charges (user_id,project_id,description,amount_minor) values
     ('c2222222-2222-4222-8222-222222222222','c6666666-6666-4666-8666-666666666666','anonymous',1);
    raise exception 'Anonymous Auth account wrote charge';
  -- The invoker trigger cannot see the parent under anonymous-user RLS.
  exception when foreign_key_violation then null;
  end;
end $anon$;
rollback;
