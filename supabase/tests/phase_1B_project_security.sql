-- Rollback-only Phase 1B test; run with a disposable Supabase database-owner connection.
-- Applies after all versioned migrations, including 20261022040000.
\set ON_ERROR_STOP on
begin;

insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at)
values
('dddddddd-dddd-4ddd-8ddd-dddddddddddd','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','phase1b-owner-a@example.test',now(),now()),
('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee','00000000-0000-0000-0000-000000000000',
 'authenticated','authenticated','phase1b-owner-b@example.test',now(),now());

do $acl$
begin
  if not (select relrowsecurity from pg_class where oid='public.projects'::regclass) or
    has_table_privilege('anon','public.projects','SELECT') or
    has_table_privilege('authenticated','public.projects','DELETE') or
    has_column_privilege('authenticated','public.projects','status','UPDATE') or
    has_column_privilege('authenticated','public.projects','status','INSERT') or
    has_column_privilege('authenticated','public.projects','user_id','UPDATE') then
    raise exception 'FAIL: project ACL or RLS';
  end if;
  raise notice 'PASS: owner scope and protected status grants';
end;
$acl$;

set local role authenticated;
select set_config('request.jwt.claim.sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd',true);
select set_config('request.jwt.claims',
'{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated","is_anonymous":false}',true);

-- Deterministic IDs are privileged fixture setup; application grants stay unchanged.
reset role;
insert into public.leads (id,user_id,customer_name,phone,source)
values ('aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaab','dddddddd-dddd-4ddd-8ddd-dddddddddddd',
 'Customer A','555','Referral');
set local role authenticated;
-- Deterministic IDs are privileged fixture setup; application grants stay unchanged.
reset role;
insert into public.projects (id,user_id,lead_id,title,notes)
values
 ('bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbb01','dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaab','Kitchen','Kitchen notes'),
 ('bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbb02','dddddddd-dddd-4ddd-8ddd-dddddddddddd',
  'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaab','Bathroom','Bathroom notes');
set local role authenticated;

do $owner$
declare n int;
begin
  select count(*) into n from public.projects;
  if n <> 2 then raise exception 'FAIL: multiple owned projects unreadable'; end if;
  update public.projects set title='Kitchen Renovation' where title='Kitchen';
  if (select notes from public.projects where title='Bathroom') <> 'Bathroom notes' then
    raise exception 'FAIL: unrelated sibling was overwritten';
  end if;
  begin
    update public.projects set status='quote_sent';
    raise exception 'FAIL: direct status edit granted';
  exception when insufficient_privilege then null;
  end;
  raise notice 'PASS: sibling isolation and protected status';
end;
$owner$;

select set_config('request.jwt.claim.sub','eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',true);
select set_config('request.jwt.claims',
'{"sub":"eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee","role":"authenticated","is_anonymous":false}',true);

do $other$
declare n int;
begin
  select count(*) into n from public.projects;
  if n <> 0 then raise exception 'FAIL: B reads A projects'; end if;
  update public.projects set notes='Tamper';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: B updates A projects'; end if;
  begin
    insert into public.projects(user_id,lead_id,title)
    values ('eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      'aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaab','Cross-account');
    raise exception 'FAIL: B created project on A lead';
  exception when foreign_key_violation then null;
  end;
  raise notice 'PASS: two-account read/update/create isolation';
end;
$other$;

-- SQL owner fixture for closed status: protected status cannot be set by mobile role.
reset role;
update public.projects set status='lost'
where id='bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbb01';
set local role authenticated;
select set_config('request.jwt.claim.sub','dddddddd-dddd-4ddd-8ddd-dddddddddddd',true);
select set_config('request.jwt.claims',
'{"sub":"dddddddd-dddd-4ddd-8ddd-dddddddddddd","role":"authenticated","is_anonymous":false}',true);

do $locked$
begin
  begin
    update public.projects set title='Tampered' where title='Kitchen Renovation';
    raise exception 'FAIL: closed project title changed';
  exception when check_violation then null;
  end;
  update public.projects set notes='Still editable' where title='Kitchen Renovation';
  if (select notes from public.projects where title='Kitchen Renovation') <> 'Still editable' then
    raise exception 'FAIL: closed internal notes not editable';
  end if;
  raise notice 'PASS: server closed-field locks and internal notes';
end;
$locked$;

reset role;
rollback;
