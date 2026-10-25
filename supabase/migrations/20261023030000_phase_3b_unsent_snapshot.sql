-- Phase 3B: one statement-consistent, read-only, owner-scoped unsent estimate.
-- SQL STABLE runs all SELECTs under the invoking statement's MVCC snapshot.
-- SECURITY INVOKER intentionally keeps existing table RLS/column grants in force.
-- No quote/version table, mutation or privileged credentials are introduced.
create function public.get_unsent_estimate_snapshot(p_project_id uuid)
returns jsonb
language sql stable security invoker set search_path = ''
as $$
  with owned as (
    select p.id, p.user_id, p.title, p.site_address, p.status, p.tax_bps,
           l.customer_name, l.phone as customer_phone, l.email as customer_email,
           b.business_name, b.phone as business_phone, b.address as business_address
    from public.projects p
    join public.leads l on l.user_id = p.user_id and l.id = p.lead_id
    left join public.business_profiles b on b.user_id = p.user_id
    where p.id = p_project_id and p.user_id = (select auth.uid())
      and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'false'
  ), snapshot as (
    select jsonb_build_object(
      'project_id', o.id, 'user_id', o.user_id,
      'project_title', o.title, 'site_address', o.site_address,
      'status', o.status, 'tax_bps', o.tax_bps,
      'customer_name', o.customer_name, 'customer_phone', o.customer_phone,
      'customer_email', o.customer_email,
      'business_name', o.business_name, 'business_phone', o.business_phone,
      'business_address', o.business_address,
      'tasks', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', t.id, 'category', t.category, 'title', t.title,
          'notes', t.notes, 'amount_minor', t.amount_minor,
          'sort_order', t.sort_order
        ) order by t.sort_order, t.created_at, t.id)
        from public.project_tasks t
        where t.user_id = o.user_id and t.project_id = o.id
      ), '[]'::jsonb),
      'charges', coalesce((
        select jsonb_agg(jsonb_build_object(
          'id', c.id, 'description', c.description,
          'amount_minor', c.amount_minor, 'sort_order', c.sort_order
        ) order by c.sort_order, c.created_at, c.id)
        from public.project_additional_charges c
        where c.user_id = o.user_id and c.project_id = o.id
      ), '[]'::jsonb)
    ) as content
    from owned o
  )
  select jsonb_build_object('fingerprint', encode(sha256(convert_to(s.content::text, 'UTF8')), 'hex'),
                            'content', s.content)
  from snapshot s;
$$;
revoke all on function public.get_unsent_estimate_snapshot(uuid) from public, anon, authenticated;
grant execute on function public.get_unsent_estimate_snapshot(uuid) to authenticated;
comment on function public.get_unsent_estimate_snapshot(uuid) is
  'Read-only Phase 3B authoritative MVCC snapshot; returns only quote-permitted columns plus SHA-256 content fingerprint.';
