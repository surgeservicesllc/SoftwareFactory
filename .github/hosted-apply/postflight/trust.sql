-- Postflight for scope=trust (20260902000700): the assumptions table is
-- fenced and forced with one row per workspace, and the two functions are
-- INVOKER, STABLE and granted to authenticated only.
do $$
declare
  v_rls boolean;
  v_forced boolean;
  v_fn text;
  v_secdef boolean;
  v_volatile char;
begin
  select c.relrowsecurity, c.relforcerowsecurity into v_rls, v_forced
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'crm_forecast_assumptions';
  if v_rls is null then
    raise exception 'postflight: public.crm_forecast_assumptions is missing';
  end if;
  if not v_rls or not v_forced then
    raise exception 'postflight: crm_forecast_assumptions must have RLS enabled and forced';
  end if;
  if not exists (
    select 1 from pg_indexes where schemaname = 'public' and indexname = 'crm_forecast_assumptions_org_key'
  ) then
    raise exception 'postflight: one set of assumptions per workspace is not enforced';
  end if;
  foreach v_fn in array array['crm_revenue_forecast_scenario', 'crm_contact_hygiene'] loop
    select p.prosecdef, p.provolatile into v_secdef, v_volatile
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_secdef is null then
      raise exception 'postflight: public.% is missing', v_fn;
    end if;
    if v_secdef or v_volatile <> 's' then
      raise exception 'postflight: public.% must be SECURITY INVOKER and STABLE', v_fn;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.crm_contact_hygiene(uuid)', 'execute')
     or has_function_privilege('service_role', 'public.crm_contact_hygiene(uuid)', 'execute')
     or not has_function_privilege('authenticated', 'public.crm_contact_hygiene(uuid)', 'execute')
     or has_function_privilege('anon', 'public.crm_revenue_forecast_scenario(integer, integer, integer)', 'execute')
     or has_function_privilege('service_role', 'public.crm_revenue_forecast_scenario(integer, integer, integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.crm_revenue_forecast_scenario(integer, integer, integer)', 'execute') then
    raise exception 'postflight: trust function grants are wrong';
  end if;
  raise notice 'postflight trust: assumptions fenced one-per-workspace; scenario and hygiene invoker, stable, authenticated-only';
end $$;
