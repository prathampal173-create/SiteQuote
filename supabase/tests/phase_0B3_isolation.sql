-- Phase 0B3 LOCAL PostgreSQL isolation test (psql, not a client API test).
-- Requires a local Supabase database-owner connection; auth users are fixtures.
-- SET LOCAL ROLE authenticated/anon means RLS and ACL apply to every tested
-- operation. The admin role is used ONLY to create fixtures and inspect ACLs.
-- Entire test is rolled back. Never run on a shared/production database.
\set ON_ERROR_STOP on
begin;

-- Unchanging test UUIDs are fixtures, not user credentials.
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values
  ('11111111-1111-4111-8111-111111111111', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rls-a-0b3@example.test', now(), now()),
  ('22222222-2222-4222-8222-222222222222', '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'rls-b-0b3@example.test', now(), now());

-- Check ACL structure as database owner; these are NOT RLS-access tests.
do $checks$
declare
  tab text;
  protected_col text;
begin
  foreach tab in array array['business_profiles','leads','projects'] loop
    if not (select relrowsecurity from pg_class
            where oid = format('public.%I',tab)::regclass) then
      raise exception 'FAIL: RLS disabled on %',tab;
    end if;
    if (select count(*) from pg_policies
        where schemaname='public' and tablename=tab
          and roles = array['authenticated'::name]) <> 3 then
      raise exception 'FAIL: expected three authenticated policies on %',tab;
    end if;
    if has_table_privilege('anon',format('public.%I',tab),'SELECT') or
       has_table_privilege('anon',format('public.%I',tab),'INSERT') or
       has_table_privilege('anon',format('public.%I',tab),'UPDATE') or
       has_table_privilege('anon',format('public.%I',tab),'DELETE') then
      raise exception 'FAIL: anon privilege on %',tab;
    end if;
    if not has_table_privilege('authenticated',format('public.%I',tab),'SELECT') or
       has_table_privilege('authenticated',format('public.%I',tab),'DELETE') then
      raise exception 'FAIL: authenticated SELECT/DELETE ACL on %',tab;
    end if;
  end loop;
  if has_column_privilege('authenticated','public.business_profiles','user_id','UPDATE') or
     has_column_privilege('authenticated','public.leads','user_id','UPDATE') or
     has_column_privilege('authenticated','public.leads','id','UPDATE') or
     has_column_privilege('authenticated','public.projects','user_id','UPDATE') or
     has_column_privilege('authenticated','public.projects','status','UPDATE') or
     has_column_privilege('authenticated','public.projects','accepted_quote_id','UPDATE') or
     has_column_privilege('authenticated','public.projects','status','INSERT') or
     has_column_privilege('authenticated','public.projects','accepted_quote_id','INSERT') or
     has_column_privilege('authenticated','public.projects','id','INSERT') or
     has_column_privilege('authenticated','public.projects','updated_at','UPDATE') then
    raise exception 'FAIL: protected field has a client write grant';
  end if;
  raise notice 'PASS: RLS policies and column/table ACLs';
end;
$checks$;

-- Test account A: role and claims match what PostgREST obtains from a JWT.
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',true);

do $a$
declare
  a uuid := '11111111-1111-4111-8111-111111111111';
  b uuid := '22222222-2222-4222-8222-222222222222';
  lead uuid;
  first_project uuid;
  second_project uuid;
  n bigint;
  stage public.lead_contact_stage;
  current_status public.project_status;
  tax integer;
  stamp timestamptz;
begin
  if auth.uid() is distinct from a then
    raise exception 'FAIL: simulated authenticated context does not reach auth.uid()';
  end if;
  insert into public.business_profiles(user_id,business_name)
  values(a,'A Contractors');
  update public.business_profiles set business_name='A Builders' where user_id=a;
  get diagnostics n = row_count;
  if n<>1 then raise exception 'FAIL: A cannot edit own business profile'; end if;

  insert into public.leads(user_id,customer_name,phone,source)
  values(a,'A Customer','555-0101','Referral') returning id,contact_stage into lead,stage;
  if lead is null or stage<>'new' then
    raise exception 'FAIL: generated lead ID or contact stage default';
  end if;
  perform set_config('sitequote_test.lead_a',lead::text,true);
  update public.leads set contact_stage='contacted', notes='Follow-up'
    where id=lead;
  get diagnostics n = row_count;
  if n<>1 then raise exception 'FAIL: A cannot update own lead'; end if;

  insert into public.projects(user_id,lead_id,title)
  values(a,lead,'Kitchen Renovation')
  returning id,status,tax_bps into first_project,current_status,tax;
  if first_project is null or current_status<>'draft' or tax<>0 then
    raise exception 'FAIL: project generated ID or default state/tax';
  end if;
  perform set_config('sitequote_test.project_a',first_project::text,true);
  insert into public.projects(user_id,lead_id,title,tax_bps)
  values(a,lead,'Bathroom Upgrade',3000) returning id into second_project;
  if second_project=first_project or
     (select count(*) from public.projects where lead_id=lead)<>2 then
    raise exception 'FAIL: two independent projects under one lead';
  end if;
  if (select count(*) from public.business_profiles where user_id=a)<>1 or
     (select count(*) from public.leads where id=lead)<>1 or
     (select count(*) from public.projects where lead_id=lead)<>2 then
    raise exception 'FAIL: A cannot SELECT own records';
  end if;
  update public.projects set notes='Own project updated', tax_bps=800
    where id=first_project;
  get diagnostics n = row_count;
  if n<>1 then raise exception 'FAIL: A cannot edit own project'; end if;
  select updated_at into stamp from public.projects where id=first_project;
  if stamp is distinct from transaction_timestamp() then
    raise exception 'FAIL: timestamp update trigger';
  end if;

  begin
    insert into public.business_profiles(user_id,business_name)
    values(b,'Not my account');
    raise exception 'FAIL: foreign business profile accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.leads(user_id,customer_name,email,source)
    values(b,'Foreign lead','notmine@example.test','Other');
    raise exception 'FAIL: foreign lead ownership accepted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.projects(user_id,lead_id,title)
    values(b,lead,'Foreign project');
    raise exception 'FAIL: foreign project ownership accepted';
  exception when insufficient_privilege then null;
  end;

  begin
    insert into public.leads(user_id,customer_name,source)
    values(a,'Missing contact','Phone');
    raise exception 'FAIL: lead without contact accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.leads(user_id,customer_name,phone,source)
    values(a,E' \t ','555-0102','Phone');
    raise exception 'FAIL: blank lead name accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.projects(user_id,lead_id,title,tax_bps)
    values(a,lead,'Bad tax',3001);
    raise exception 'FAIL: tax above 3000 accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.projects(user_id,lead_id,title,tax_bps)
    values(a,lead,'Bad tax',-1);
    raise exception 'FAIL: negative tax accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.projects(user_id,lead_id,title)
    values(a,lead,E'  \n');
    raise exception 'FAIL: blank project title accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.projects(user_id,lead_id,title)
    values(a,gen_random_uuid(),'Unknown lead');
    raise exception 'FAIL: orphan project accepted';
  exception when foreign_key_violation then null;
  end;
  raise notice 'PASS: A permitted CRUD subset, defaults, validation, FKs, two projects, other-owner INSERT denied';
end;
$a$;

-- Test account B: switches both actual SQL role context and JWT identity.
select set_config('request.jwt.claim.sub','22222222-2222-4222-8222-222222222222',true);
select set_config('request.jwt.claims',
  '{"sub":"22222222-2222-4222-8222-222222222222","role":"authenticated","is_anonymous":false}',true);

do $b$
declare
  b uuid := '22222222-2222-4222-8222-222222222222';
  a_lead uuid := current_setting('sitequote_test.lead_a')::uuid;
  a_project uuid := current_setting('sitequote_test.project_a')::uuid;
  b_lead uuid;
  b_project uuid;
  n bigint;
begin
  if auth.uid() is distinct from b then
    raise exception 'FAIL: switching JWT user failed';
  end if;
  if exists(select 1 from public.business_profiles) or
     exists(select 1 from public.leads) or
     exists(select 1 from public.projects) then
    raise exception 'FAIL: B can read A records';
  end if;
  update public.business_profiles set business_name='Taken' where user_id <> b;
  get diagnostics n = row_count;
  if n<>0 then raise exception 'FAIL: B updated A business profile'; end if;
  update public.leads set customer_name='Taken' where id=a_lead;
  get diagnostics n = row_count;
  if n<>0 then raise exception 'FAIL: B updated A lead'; end if;
  update public.projects set title='Taken' where id=a_project;
  get diagnostics n = row_count;
  if n<>0 then raise exception 'FAIL: B updated A project'; end if;

  insert into public.business_profiles(user_id,business_name) values(b,'B Contractors');
  insert into public.leads(user_id,customer_name,email,source)
  values(b,'B Customer','b@example.test','Email') returning id into b_lead;
  insert into public.projects(user_id,lead_id,title)
  values(b,b_lead,'B Own Project') returning id into b_project;
  if (select count(*) from public.business_profiles)<>1 or
     (select count(*) from public.leads)<>1 or
     (select count(*) from public.projects)<>1 then
    raise exception 'FAIL: B own records not visible';
  end if;
  update public.projects set title='B Own Project Updated' where id=b_project;
  get diagnostics n = row_count;
  if n<>1 then raise exception 'FAIL: B cannot edit own project'; end if;
  begin
    insert into public.projects(user_id,lead_id,title)
    values(b,a_lead,'Cross-account FK');
    raise exception 'FAIL: B project references A lead';
  exception when foreign_key_violation then null;
  end;
  begin
    update public.projects set lead_id=a_lead where id=b_project;
    raise exception 'FAIL: B project moved onto A lead';
  exception when foreign_key_violation then null;
  end;
  raise notice 'PASS: B can access only B rows; cannot read/update A; cross-owner FK blocked';
end;
$b$;

-- Account A: SQL grants, not client behavior, deny protected writes and deletes.
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":false}',true);

do $protected$
declare
  a uuid := '11111111-1111-4111-8111-111111111111';
  lead uuid := current_setting('sitequote_test.lead_a')::uuid;
  project uuid := current_setting('sitequote_test.project_a')::uuid;
begin
  begin
    update public.business_profiles set user_id=gen_random_uuid() where user_id=a;
    raise exception 'FAIL: business owner reassignment allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.leads set user_id=gen_random_uuid() where id=lead;
    raise exception 'FAIL: lead owner reassignment allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.projects set user_id=gen_random_uuid() where id=project;
    raise exception 'FAIL: project owner reassignment allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.projects set status='won' where id=project;
    raise exception 'FAIL: direct status UPDATE allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.projects set accepted_quote_id=gen_random_uuid() where id=project;
    raise exception 'FAIL: accepted quote UPDATE allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.projects(user_id,lead_id,title,status)
    values(a,lead,'Forced sent','quote_sent');
    raise exception 'FAIL: direct status INSERT allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.projects(user_id,lead_id,title,accepted_quote_id)
    values(a,lead,'Forced approval',gen_random_uuid());
    raise exception 'FAIL: direct accepted quote INSERT allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.leads where id=lead;
    raise exception 'FAIL: lead DELETE allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.projects where id=project;
    raise exception 'FAIL: project DELETE allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.business_profiles where user_id=a;
    raise exception 'FAIL: profile DELETE allowed';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: owner identity, protected status/approval and all direct deletes denied';
end;
$protected$;

-- Signed-out anon role cannot read or write even with a forged test claim.
set local role anon;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"anon"}',true);
do $anon$
begin
  begin
    perform count(*) from public.leads;
    raise exception 'FAIL: anon SELECT permitted';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.business_profiles(user_id,business_name)
    values(gen_random_uuid(),'Anon');
    raise exception 'FAIL: anon INSERT permitted';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.projects set title='Anon edit';
    raise exception 'FAIL: anon UPDATE permitted';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.projects;
    raise exception 'FAIL: anon DELETE permitted';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: signed-out anon denied all table operations';
end;
$anon$;

-- Supabase anonymous Auth user carries authenticated SQL role, but should
-- still be rejected by the extra is_anonymous JWT policy predicate.
set local role authenticated;
select set_config('request.jwt.claim.sub','11111111-1111-4111-8111-111111111111',true);
select set_config('request.jwt.claims',
  '{"sub":"11111111-1111-4111-8111-111111111111","role":"authenticated","is_anonymous":true}',true);
do $anonymous_auth$
begin
  if exists(select 1 from public.business_profiles) or
     exists(select 1 from public.leads) or
     exists(select 1 from public.projects) then
    raise exception 'FAIL: anonymous Auth session reads owner data';
  end if;
  begin
    insert into public.leads(user_id,customer_name,phone,source)
    values('11111111-1111-4111-8111-111111111111','Anonymous','555','Other');
    raise exception 'FAIL: anonymous Auth session inserted data';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: anonymous Auth session denied';
end;
$anonymous_auth$;

rollback;
