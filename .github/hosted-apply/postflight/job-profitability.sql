-- Postflight for hosted apply scope `job-profitability` (ADR-231).
--
-- Two cost columns and one function that reads as the caller. A margin
-- is null whenever an input is unknown; the checks here are the ways
-- that promise breaks — a cost column missing or unbounded, the function
-- running as somebody other than the caller, or a browser role other than
-- authenticated able to call it.

do $$
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'crm_technicians' and column_name = 'hourly_cost_cents'
  ) then
    raise exception 'crm_technicians.hourly_cost_cents is missing';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'crm_product_lots' and column_name = 'unit_cost_cents'
  ) then
    raise exception 'crm_product_lots.unit_cost_cents is missing';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'crm_technicians_hourly_cost_cents_check'
  ) then
    raise exception 'the hourly cost is unbounded';
  end if;
  if not exists (
    select 1 from pg_constraint
     where conname = 'crm_product_lots_unit_cost_cents_check'
  ) then
    raise exception 'the lot unit cost is unbounded';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.proname = 'crm_visit_profitability'
  ) then
    raise exception 'crm_visit_profitability is SECURITY DEFINER; it must read as the caller';
  end if;
  if exists (
    select 1 from information_schema.routine_privileges
     where routine_schema = 'public' and routine_name = 'crm_visit_profitability'
       and grantee in ('anon', 'service_role', 'PUBLIC')
  ) then
    raise exception 'crm_visit_profitability is callable outside authenticated';
  end if;
  if not exists (
    select 1 from information_schema.routine_privileges
     where routine_schema = 'public' and routine_name = 'crm_visit_profitability'
       and grantee = 'authenticated' and privilege_type = 'EXECUTE'
  ) then
    raise exception 'authenticated cannot execute crm_visit_profitability';
  end if;

  raise notice 'job profitability: two bounded cost columns, one function reading as the caller, unknowns counted not zeroed';
end;
$$;
