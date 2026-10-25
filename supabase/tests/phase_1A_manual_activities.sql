-- Phase 1A isolation / append-only test. Run ONLY in a disposable Supabase DB.
-- psql -X -v ON_ERROR_STOP=1 -f supabase/tests/phase_1A_manual_activities.sql
-- Requires database-owner connection for test fixtures; all writes are rolled back.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values
('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'phase1a-a@example.test', now(), now()),
('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', '00000000-0000-0000-0000-000000000000',
 'authenticated', 'authenticated', 'phase1a-b@example.test', now(), now());

do $acl$
begin
  if not (select relrowsecurity from pg_class where oid='public.activities'::regclass) or
     has_table_privilege('anon','public.activities','SELECT') or
     has_table_privilege('anon','public.activities','INSERT') or
     has_table_privilege('authenticated','public.activities','UPDATE') or
     has_table_privilege('authenticated','public.activities','DELETE') or
     has_column_privilege('authenticated','public.activities','id','INSERT') or
     has_column_privilege('authenticated','public.activities','created_at','INSERT') or
     has_column_privilege('authenticated','public.activities','project_id','INSERT') or
     has_column_privilege('authenticated','public.activities','user_id','UPDATE') or
     not has_table_privilege('authenticated','public.activities','SELECT') or
     not has_column_privilege('authenticated','public.activities','detail','INSERT') then
    raise exception 'FAIL: activities RLS/grants invalid';
  end if;
  raise notice 'PASS: append-only grants and owner RLS enabled';
end;
$acl$;

set local role authenticated;
select set_config('request.jwt.claim.sub','aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',true);
select set_config('request.jwt.claims',
'{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","is_anonymous":false}',true);

-- Deterministic IDs are privileged fixture setup; application grants stay unchanged.
reset role;
insert into public.leads (id,user_id,customer_name,phone,source)
values ('cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa','A Customer','555','Phone');
set local role authenticated;
insert into public.activities (user_id,lead_id,type,detail)
values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc','manual_note','{"note":"First call"}');

do $a$
declare n integer;
begin
  select count(*) into n from public.activities;
  if n <> 1 then raise exception 'FAIL: owner note not readable'; end if;
  if (select created_at from public.activities limit 1) is null then
    raise exception 'FAIL: DB-generated creation date missing';
  end if;
  begin
    insert into public.activities (user_id,lead_id,type,detail)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc','manual_note','{"note":"\t\n  "}');
    raise exception 'FAIL: blank note accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.activities (user_id,lead_id,type,detail)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc','quote_sent','{}');
    raise exception 'FAIL: non-manual type was forgeable';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.activities set detail='{"note":"Tampered"}';
    raise exception 'FAIL: append-only UPDATE allowed';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.activities;
    raise exception 'FAIL: append-only DELETE allowed';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: own history, DB timestamp, validation, and immutability';
end;
$a$;

-- JWT swap: Account B cannot read or modify A's lead/history.
select set_config('request.jwt.claim.sub','bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',true);
select set_config('request.jwt.claims',
'{"sub":"bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb","role":"authenticated","is_anonymous":false}',true);

do $b$
declare n integer;
begin
  select count(*) into n from public.activities;
  if n <> 0 then raise exception 'FAIL: B can read A history'; end if;
  begin
    insert into public.activities (user_id,lead_id,type,detail)
    values ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc','manual_note','{"note":"Attack"}');
    raise exception 'FAIL: B attached note to A lead';
  exception when foreign_key_violation then null;
  end;
  begin
    insert into public.activities (user_id,lead_id,type,detail)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc','manual_note','{"note":"Impersonated A"}');
    raise exception 'FAIL: B impersonated owner A';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: second-account read/write isolation and same-owner FK';
end;
$b$;

-- Anonymous Auth users are not eligible even when PostgreSQL role is authenticated.
select set_config('request.jwt.claims',
'{"sub":"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa","role":"authenticated","is_anonymous":true}',true);
do $anonymous$
begin
  if exists (select 1 from public.activities) then
    raise exception 'FAIL: anonymous Auth user read history';
  end if;
  begin
    insert into public.activities (user_id,lead_id,type,detail)
    values ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      'cccccccc-cccc-4ccc-8ccc-cccccccccccc','manual_note','{"note":"Anonymous"}');
    raise exception 'FAIL: anonymous Auth user wrote history';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: anonymous account denied';
end;
$anonymous$;

reset role;
rollback;
