-- Postflight for hosted apply scope `operating-dashboards`.
--
-- Extracted alongside the other CRM scopes; see
-- .github/hosted-apply/postflight/customer-portal.sql for why the
-- verification lives in a file rather than inline in the workflow.
--
-- This migration creates no tables, so there is no RLS or grant posture to
-- re-prove. What must be proven is the opposite of the portal's case: that
-- these five functions are NOT definers. Each aggregates across a whole
-- book of business, and a definer would aggregate across every tenant's
-- book at once. Running as the caller is the entire security argument, and
-- a later "optimization" that added `security definer` to make them faster
-- would silently turn five dashboards into five cross-tenant leaks.

do $$
declare
  v_role text;
  v_all text[] := array[
    'crm_revenue_by_month', 'crm_receivable_aging', 'crm_retention_summary',
    'crm_technician_productivity', 'crm_route_density'];
begin
  if (select count(*) from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any(v_all)) <> 5 then
    raise exception 'a dashboard function is missing';
  end if;

  -- The whole argument, asserted: none of them runs as its owner.
  if exists (
    select 1 from pg_proc p
     join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public' and p.proname = any(v_all) and p.prosecdef
  ) then
    raise exception 'a dashboard function is a definer and would aggregate across tenants';
  end if;

  if (select count(*) from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any(v_all)
        and has_function_privilege('authenticated', p.oid, 'execute')) <> 5 then
    raise exception 'a dashboard function is not reachable by authenticated';
  end if;

  foreach v_role in array array['anon', 'service_role'] loop
    if exists (
      select 1 from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any(v_all)
        and has_function_privilege(v_role, p.oid, 'execute')
    ) then
      raise exception 'a dashboard function is executable by %', v_role;
    end if;
  end loop;

  -- The two indexes the aggregates actually walk, and which nothing else
  -- created. A missing one is a sequential scan over the whole ledger on
  -- every page load rather than a wrong answer, so it is checked here
  -- rather than left to be discovered under load.
  if (select count(*) from pg_indexes
       where schemaname = 'public'
         and indexname in ('crm_invoices_org_issued_idx', 'crm_refunds_org_refunded_idx')) <> 2 then
    raise exception 'a dashboard index is missing';
  end if;
end
$$;
