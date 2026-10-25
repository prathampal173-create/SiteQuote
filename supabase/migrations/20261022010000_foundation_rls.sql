-- SiteQuote Phase 0B3: minimum client grants + owner-scoped RLS.
-- Phase 0B2 schema/constraints are unchanged; no RPCs or feature tables.
-- Supabase Auth issues the trusted JWT; clients cannot choose auth.uid().

-- Explicitly reset the exposed-table ACL. No grants to anon or PUBLIC.
revoke all on table
  public.business_profiles,
  public.leads,
  public.projects
from public, anon, authenticated;

-- The authenticated role needs public schema name resolution, but it does
-- not receive privileges on other tables through this statement.
grant usage on schema public to authenticated;

-- Read entire owner-scoped rows. RLS additionally restricts which rows exist
-- in each user's result set.
grant select on table
  public.business_profiles,
  public.leads,
  public.projects
  to authenticated;

-- Insert owner identity explicitly, checked against auth.uid() below.
-- Omit database-generated IDs, timestamp fields and protected project state.
grant insert (user_id, business_name, phone, address)
  on public.business_profiles to authenticated;
grant insert (user_id, customer_name, phone, email, source, notes, contact_stage)
  on public.leads to authenticated;
grant insert (user_id, lead_id, title, site_address, notes, tax_bps)
  on public.projects to authenticated;

-- Column-level UPDATE only; never grant table-wide UPDATE or DELETE.
-- Immutable identity, ownership, timestamps and protected project decision
-- fields cannot be directly updated by the mobile authenticated role.
grant update (business_name, phone, address)
  on public.business_profiles to authenticated;
grant update (customer_name, phone, email, source, notes, contact_stage)
  on public.leads to authenticated;
grant update (lead_id, title, site_address, notes, tax_bps)
  on public.projects to authenticated;

-- RLS is already enabled in Phase 0B2. Explicit here for a safe replay.
alter table public.business_profiles enable row level security;
alter table public.leads enable row level security;
alter table public.projects enable row level security;

-- For both Supabase's signed-out `anon` role and an anonymous Auth account
-- (which may hold the `authenticated` role), deny account data access.
-- Missing `is_anonymous` is false for older verified-user JWT formats.
-- Policies are scoped TO authenticated; there are no anon policies.
create policy business_profiles_owner_select
  on public.business_profiles for select to authenticated
  using (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  );
create policy business_profiles_owner_insert
  on public.business_profiles for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  );
create policy business_profiles_owner_update
  on public.business_profiles for update to authenticated
  using (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  )
  with check (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  );

create policy leads_owner_select
  on public.leads for select to authenticated
  using (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  );
create policy leads_owner_insert
  on public.leads for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  );
create policy leads_owner_update
  on public.leads for update to authenticated
  using (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  )
  with check (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  );

create policy projects_owner_select
  on public.projects for select to authenticated
  using (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  );
create policy projects_owner_insert
  on public.projects for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  );
create policy projects_owner_update
  on public.projects for update to authenticated
  using (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  )
  with check (
    user_id = (select auth.uid())
    and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  );

-- No DELETE policy; no DELETE grant. Status/accepted_quote_id changes remain
-- for future validated, authenticated, owner-checked transactional RPCs.
