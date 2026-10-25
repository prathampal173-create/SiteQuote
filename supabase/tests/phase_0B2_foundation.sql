-- Phase 0B2 integration assertions for a LOCAL Supabase Postgres database.
-- Run with psql -X -v ON_ERROR_STOP=1 -f supabase/tests/phase_0B2_foundation.sql
-- Requires local DB owner privileges for disposable auth.users fixtures.
-- Entire test (including auth.users fixtures) is rolled back, even on success.
begin;

do $test$
declare
  owner_a uuid := gen_random_uuid();
  owner_b uuid := gen_random_uuid();
  lead_a uuid;
  project_a uuid;
  project_b uuid;
  actual_stage public.lead_contact_stage;
  actual_status public.project_status;
  actual_tax integer;
  stamp timestamptz;
  tab text;
begin
  -- Test-only identities: never signed in; never persisted by this script.
  insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
  values
    (owner_a, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'phase0b2-' || owner_a::text || '@example.test', now(), now()),
    (owner_b, '00000000-0000-0000-0000-000000000000', 'authenticated',
     'authenticated', 'phase0b2-' || owner_b::text || '@example.test', now(), now());

  insert into public.business_profiles (user_id, business_name)
  values (owner_a, 'Renovation Co');

  begin
    insert into public.business_profiles (user_id, business_name)
    values (owner_b, E'\t \n');
    raise exception 'FAILED: blank business name accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.business_profiles (user_id, business_name)
    values (gen_random_uuid(), 'Orphan');
    raise exception 'FAILED: orphaned business profile accepted';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into public.leads (user_id, customer_name, source)
    values (owner_a, 'No contact', 'Referral');
    raise exception 'FAILED: lead without contact accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.leads (user_id, customer_name, phone, email, source)
    values (owner_a, 'Blank contact', E' \t ', E'\n ', 'Email');
    raise exception 'FAILED: whitespace-only lead contact accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.leads (user_id, customer_name, phone, source)
    values (owner_a, E'\n\t', '555-0100', 'Phone');
    raise exception 'FAILED: whitespace-only customer name accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.leads (user_id, customer_name, email, source)
    values (gen_random_uuid(), 'Orphan', 'orphan@example.test', 'Other');
    raise exception 'FAILED: orphaned lead owner accepted';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into public.leads (user_id, customer_name, phone, source)
    values (owner_a, 'Missing source', '555-0101', null);
    raise exception 'FAILED: missing lead source accepted';
  exception when not_null_violation then null;
  end;

  begin
    insert into public.leads (user_id, customer_name, phone, source)
    values (owner_a, 'Invalid source', '555-0101', 'SocialMedia');
    raise exception 'FAILED: invalid lead source accepted';
  exception when invalid_text_representation then null;
  end;

  insert into public.leads (user_id, customer_name, phone, source)
  values (owner_a, 'Jordan Lee', '555-0100', 'Referral')
  returning id, contact_stage into lead_a, actual_stage;
  if lead_a is null or actual_stage <> 'new' then
    raise exception 'FAILED: database-generated lead UUID or default stage';
  end if;

  begin
    insert into public.projects (user_id, lead_id, title)
    values (owner_a, lead_a, E'  \n ');
    raise exception 'FAILED: whitespace-only project title accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.projects (user_id, lead_id, title, tax_bps)
    values (owner_a, lead_a, 'Invalid tax', -1);
    raise exception 'FAILED: negative tax accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.projects (user_id, lead_id, title, tax_bps)
    values (owner_a, lead_a, 'Invalid tax', 3001);
    raise exception 'FAILED: tax over 3000 bps accepted';
  exception when check_violation then null;
  end;

  begin
    insert into public.projects (user_id, lead_id, title)
    values (owner_b, lead_a, 'Cross-owner project');
    raise exception 'FAILED: cross-owner project accepted';
  exception when foreign_key_violation then null;
  end;

  begin
    insert into public.projects (user_id, lead_id, title)
    values (owner_a, gen_random_uuid(), 'Missing lead');
    raise exception 'FAILED: nonexistent lead reference accepted';
  exception when foreign_key_violation then null;
  end;

  insert into public.projects (user_id, lead_id, title)
  values (owner_a, lead_a, 'Kitchen Renovation')
  returning id, status, tax_bps into project_a, actual_status, actual_tax;
  if project_a is null or actual_status <> 'draft' or actual_tax <> 0 then
    raise exception 'FAILED: project UUID/status/tax defaults';
  end if;

  insert into public.projects (user_id, lead_id, title, tax_bps)
  values (owner_a, lead_a, 'Bathroom Upgrade', 3000)
  returning id into project_b;
  if project_a = project_b or
     (select count(*) from public.projects where user_id = owner_a and lead_id = lead_a) <> 2 then
    raise exception 'FAILED: independent projects under one lead';
  end if;

  begin
    update public.projects set user_id = owner_b where id = project_a;
    raise exception 'FAILED: cross-owner project reassignment accepted';
  exception when foreign_key_violation then null;
  end;

  update public.leads set updated_at = '2000-01-01'::timestamptz where id = lead_a;
  select updated_at into stamp from public.leads where id = lead_a;
  if stamp <> transaction_timestamp() then
    raise exception 'FAILED: leads update timestamp trigger';
  end if;
  update public.projects set updated_at = '2000-01-01'::timestamptz where id = project_a;
  select updated_at into stamp from public.projects where id = project_a;
  if stamp <> transaction_timestamp() then
    raise exception 'FAILED: projects update timestamp trigger';
  end if;

  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'projects'
      and column_name = 'accepted_quote_id' and is_nullable = 'YES'
  ) then
    raise exception 'FAILED: future nullable quote reference missing';
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.projects'::regclass and contype = 'f'
      and pg_get_constraintdef(oid) like '%accepted_quote_id%'
  ) then
    raise exception 'FAILED: Phase 3E accepted_quote_id foreign key missing';
  end if;

  -- Schema-only invariant. Phase 0B3 has its own grant and RLS tests;
  -- its new policies must not make this foundation constraint test obsolete.
  foreach tab in array array['business_profiles', 'leads', 'projects'] loop
    if not (select relrowsecurity from pg_class
            where oid = format('public.%I', tab)::regclass) then
      raise exception 'FAILED: RLS not enabled on %', tab;
    end if;
  end loop;

  raise notice 'PASS: foundation constraints, defaults, same-owner FK, two projects, timestamps and RLS enabled';
end;
$test$;

rollback;
