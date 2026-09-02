-- Postflight for scope=nothing-hidden (20260902000500): three INVOKER
-- functions exist, are STABLE, and are executable by authenticated only.
do $$
declare
  v_name text;
  v_secdef boolean;
  v_volatile char;
begin
  foreach v_name in array array['crm_schedule_audit', 'crm_automation_dry_run', 'crm_dashboard_rows'] loop
    select p.prosecdef, p.provolatile into v_secdef, v_volatile
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_name;
    if v_secdef is null then
      raise exception 'postflight: public.% is missing', v_name;
    end if;
    if v_secdef then
      raise exception 'postflight: public.% must be SECURITY INVOKER', v_name;
    end if;
    if v_volatile <> 's' then
      raise exception 'postflight: public.% must be STABLE (it stores nothing)', v_name;
    end if;
  end loop;
  if has_function_privilege('anon', 'public.crm_schedule_audit(uuid, integer)', 'execute')
     or has_function_privilege('service_role', 'public.crm_schedule_audit(uuid, integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.crm_schedule_audit(uuid, integer)', 'execute') then
    raise exception 'postflight: crm_schedule_audit grants are wrong';
  end if;
  if has_function_privilege('anon', 'public.crm_automation_dry_run(uuid, uuid, integer)', 'execute')
     or has_function_privilege('service_role', 'public.crm_automation_dry_run(uuid, uuid, integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.crm_automation_dry_run(uuid, uuid, integer)', 'execute') then
    raise exception 'postflight: crm_automation_dry_run grants are wrong';
  end if;
  if has_function_privilege('anon', 'public.crm_dashboard_rows(uuid, text, text, integer)', 'execute')
     or has_function_privilege('service_role', 'public.crm_dashboard_rows(uuid, text, text, integer)', 'execute')
     or not has_function_privilege('authenticated', 'public.crm_dashboard_rows(uuid, text, text, integer)', 'execute') then
    raise exception 'postflight: crm_dashboard_rows grants are wrong';
  end if;
  raise notice 'postflight nothing-hidden: three invoker functions present, stable, authenticated-only';
end $$;
