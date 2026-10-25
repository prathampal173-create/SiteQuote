-- Execute against disposable Supabase AFTER all 15 migrations, with ON_ERROR_STOP.
-- Uses transaction rollback, not persistent accounts. NEVER run on production.
\set ON_ERROR_STOP on
begin;
do $$
begin
  if (select relrowsecurity from pg_class where oid='public.reminders'::regclass) is not true
    or has_table_privilege('anon','public.reminders','SELECT')
    or has_table_privilege('anon','public.reminders','INSERT')
    or has_column_privilege('authenticated','public.reminders','user_id','UPDATE')
    or has_column_privilege('authenticated','public.reminders','completed_at','UPDATE')
    or has_column_privilege('authenticated','public.reminders','created_at','INSERT')
    or not has_column_privilege('authenticated','public.reminders','status','UPDATE')
    or (select count(*) from pg_policies where schemaname='public' and tablename='reminders') <> 4 then
    raise exception 'Reminder RLS/grant failure';
  end if;
end $$;
insert into auth.users (id, instance_id, aud, role, email, created_at, updated_at) values
 ('a1100000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase4a-a@example.test',now(),now()),
 ('b2200000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','phase4a-b@example.test',now(),now());
insert into public.leads (id,user_id,customer_name,phone,source) values
 ('a1100000-0000-4000-8000-000000000011','a1100000-0000-4000-8000-000000000001','A','123','Other'),
 ('a1100000-0000-4000-8000-000000000012','a1100000-0000-4000-8000-000000000001','A2','123','Other'),
 ('b2200000-0000-4000-8000-000000000022','b2200000-0000-4000-8000-000000000002','B','123','Other');
insert into public.projects (id,user_id,lead_id,title) values
 ('a1100000-0000-4000-8000-000000000031','a1100000-0000-4000-8000-000000000001','a1100000-0000-4000-8000-000000000011','Kitchen'),
 ('a1100000-0000-4000-8000-000000000032','a1100000-0000-4000-8000-000000000001','a1100000-0000-4000-8000-000000000012','Bathroom'),
 ('b2200000-0000-4000-8000-000000000033','b2200000-0000-4000-8000-000000000002','b2200000-0000-4000-8000-000000000022','Other');
set local role authenticated;
select set_config('request.jwt.claim.sub','a1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a1100000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}',true);
-- Deterministic IDs are privileged fixture setup; application grants stay unchanged.
reset role;
insert into public.reminders (id,user_id,lead_id,project_id,kind,title,due_at)
 values ('a1100000-0000-4000-8000-000000000041','a1100000-0000-4000-8000-000000000001',
 'a1100000-0000-4000-8000-000000000011','a1100000-0000-4000-8000-000000000031','site_visit','Walkthrough',now()+interval '3 days');
set local role authenticated;
-- Deterministic IDs are privileged fixture setup; application grants stay unchanged.
reset role;
insert into public.reminders (id,user_id,lead_id,kind,title,due_at)
 values ('a1100000-0000-4000-8000-000000000042','a1100000-0000-4000-8000-000000000001',
 'a1100000-0000-4000-8000-000000000012','other','Call',now()+interval '4 days');
set local role authenticated;
update public.reminders set status='completed' where id='a1100000-0000-4000-8000-000000000041';
do $$ begin
 if (select completed_at is null from public.reminders where id='a1100000-0000-4000-8000-000000000041') then
   raise exception 'Completion timestamp was not written'; end if;
end $$;
update public.reminders set status='open' where id='a1100000-0000-4000-8000-000000000041';
do $$ begin
 if (select completed_at is not null from public.reminders where id='a1100000-0000-4000-8000-000000000041') then
   raise exception 'Reopen did not clear completion timestamp'; end if;
end $$;
do $$ begin
 begin
   insert into public.reminders (user_id,lead_id,project_id,kind,title,due_at)
     values ('a1100000-0000-4000-8000-000000000001','a1100000-0000-4000-8000-000000000011',
       'a1100000-0000-4000-8000-000000000032','other','Cross lead',now()+interval '1 day');
   raise exception 'Allowed wrong lead/project association';
 exception when foreign_key_violation then null; end;
 begin
   insert into public.reminders (user_id,lead_id,project_id,kind,title,due_at)
     values ('a1100000-0000-4000-8000-000000000001','a1100000-0000-4000-8000-000000000011',
       'b2200000-0000-4000-8000-000000000033','other','Other project',now()+interval '1 day');
   raise exception 'Allowed foreign project association';
 exception when foreign_key_violation then null; end;
 begin
   insert into public.reminders (user_id,lead_id,kind,title,due_at)
     values ('a1100000-0000-4000-8000-000000000001','a1100000-0000-4000-8000-000000000011',
       'other','Past',now()-interval '1 day');
   raise exception 'Allowed past due insert';
 exception when check_violation then null; end;
 begin
   insert into public.reminders (user_id,lead_id,kind,title,due_at)
     values ('b2200000-0000-4000-8000-000000000002','b2200000-0000-4000-8000-000000000022',
       'other','Other owner',now()+interval '1 day');
   raise exception 'Allowed foreign owner insert';
 exception when insufficient_privilege then null; end;
end $$;
do $$ begin
 if (select count(*) from public.reminders) <> 2 then raise exception 'Expected two owned reminders'; end if;
end $$;
-- Two-account read/write isolation; account B must see none of A's rows.
select set_config('request.jwt.claim.sub','b2200000-0000-4000-8000-000000000002',true);
select set_config('request.jwt.claims','{"sub":"b2200000-0000-4000-8000-000000000002","role":"authenticated","is_anonymous":false}',true);
do $$ begin
 if (select count(*) from public.reminders) <> 0 then raise exception 'Leaked A reminders to B'; end if;
end $$;
update public.reminders set title='Hacked' where id='a1100000-0000-4000-8000-000000000041';
delete from public.reminders where id='a1100000-0000-4000-8000-000000000041';
do $$ begin
 if (select count(*) from public.reminders) <> 0 then raise exception 'Unexpected cross-owner visibility'; end if;
end $$;
-- Check allowed delete as owner A.
select set_config('request.jwt.claim.sub','a1100000-0000-4000-8000-000000000001',true);
select set_config('request.jwt.claims','{"sub":"a1100000-0000-4000-8000-000000000001","role":"authenticated","is_anonymous":false}',true);
delete from public.reminders where id='a1100000-0000-4000-8000-000000000041';
do $$ begin if (select count(*) from public.reminders) <> 1 then raise exception 'Delete failed'; end if; end $$;
rollback;
