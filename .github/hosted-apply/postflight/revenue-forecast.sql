-- Postflight for hosted apply scope `revenue-forecast`.
--
-- No tables, so there is no RLS posture to re-prove. What must hold is the
-- same property the dashboards depend on: neither function is a definer.
-- Both read across a whole book, and a definer would read across every
-- tenant's book at once.

do $$
declare
  v_role text;
  v_all text[] := array['crm_revenue_forecast', 'crm_forecast_basis'];
begin
  if (select count(*) from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any(v_all)) <> 2 then
    raise exception 'a forecast function is missing';
  end if;

  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = any(v_all) and p.prosecdef
  ) then
    raise exception 'a forecast function is a definer and would read across tenants';
  end if;

  if (select count(*) from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = any(v_all)
        and has_function_privilege('authenticated', p.oid, 'execute')) <> 2 then
    raise exception 'a forecast function is not reachable by authenticated';
  end if;

  foreach v_role in array array['anon', 'service_role'] loop
    if exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = any(v_all)
         and has_function_privilege(v_role, p.oid, 'execute')
    ) then
      raise exception 'a forecast function is executable by %', v_role;
    end if;
  end loop;
end
$$;
