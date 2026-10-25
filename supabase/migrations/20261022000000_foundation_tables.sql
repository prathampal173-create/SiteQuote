-- SiteQuote Phase 0B2. Schema only: NO client policies or application CRUD.
-- auth.users and the Supabase public schema must already exist.
-- All timestamptz values represent UTC instants (independent of session timezone).

create type public.lead_source as enum (
  'Referral', 'Google', 'Phone', 'Email', 'Other'
);
create type public.lead_contact_stage as enum (
  'new', 'contacted', 'site_visit_completed'
);
create type public.project_status as enum (
  'draft', 'quote_sent', 'won', 'lost'
);

create table public.business_profiles (
  user_id uuid primary key references auth.users (id),
  business_name text not null,
  phone text,
  address text,
  constraint business_profiles_business_name_nonblank
    check (business_name ~ '[^[:space:]]')
);

create table public.leads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  customer_name text not null,
  phone text,
  email text,
  source public.lead_source not null,
  notes text,
  contact_stage public.lead_contact_stage not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leads_customer_name_nonblank
    check (customer_name ~ '[^[:space:]]'),
  constraint leads_contact_required
    check (
      (phone is not null and phone ~ '[^[:space:]]')
      or (email is not null and email ~ '[^[:space:]]')
    ),
  -- Required target for the projects (user_id, lead_id) same-owner FK.
  constraint leads_user_id_id_key unique (user_id, id)
);

create table public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id),
  lead_id uuid not null,
  title text not null,
  site_address text,
  notes text,
  status public.project_status not null default 'draft',
  -- Phase 3 creates quotes and adds the same-owner/project FK and
  -- transactional Won/accepted-version validation. No FK is valid yet.
  accepted_quote_id uuid,
  tax_bps integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_title_nonblank
    check (title ~ '[^[:space:]]'),
  constraint projects_tax_bps_range
    check (tax_bps between 0 and 3000),
  constraint projects_owner_lead_fkey
    foreign key (user_id, lead_id)
      references public.leads (user_id, id) on delete restrict,
  -- Target for future owner/project composite FKs.
  constraint projects_user_id_id_key unique (user_id, id)
);

create index leads_user_id_contact_stage_idx
  on public.leads (user_id, contact_stage);
create index projects_user_id_lead_id_status_idx
  on public.projects (user_id, lead_id, status);

-- Internal trigger function: not an app RPC / public API endpoint.
create schema if not exists sitequote_internal;
revoke all on schema sitequote_internal from public, anon, authenticated;

create function sitequote_internal.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke all on function sitequote_internal.touch_updated_at() from public, anon, authenticated;

create trigger leads_touch_updated_at
before update on public.leads
for each row execute function sitequote_internal.touch_updated_at();

create trigger projects_touch_updated_at
before update on public.projects
for each row execute function sitequote_internal.touch_updated_at();

-- Phase 0B2 DENIES all mobile clients. Phase 0B3 must add audited,
-- owner-scoped policies AND the minimum required grants before CRUD is exposed.
alter table public.business_profiles enable row level security;
alter table public.leads enable row level security;
alter table public.projects enable row level security;
revoke all on table public.business_profiles, public.leads, public.projects
  from public, anon, authenticated;
