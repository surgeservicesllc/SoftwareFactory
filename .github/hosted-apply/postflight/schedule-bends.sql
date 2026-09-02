-- Postflight for scope=schedule-bends (20260902001000): the projects table
-- is fenced and forced; visits carry project_id; the four functions are
-- INVOKER (the readers STABLE, the writers VOLATILE) and granted to
-- authenticated only.
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
   where n.nspname = 'public' and c.relname = 'crm_projects';
  if v_rls is null then
    raise exception 'postflight: public.crm_projects is missing';
  end if;
  if not v_rls or not v_forced then
    raise exception 'postflight: crm_projects must have RLS enabled and forced';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'crm_work_orders' and column_name = 'project_id'
  ) then
    raise exception 'postflight: crm_work_orders lacks project_id';
  end if;
  foreach v_fn in array array['crm_work_orders_bulk_edit', 'crm_project_create', 'crm_project_progress', 'crm_project_cancel'] loop
    select p.prosecdef, p.provolatile into v_secdef, v_volatile
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_secdef is null then
      raise exception 'postflight: public.% is missing', v_fn;
    end if;
    if v_secdef then
      raise exception 'postflight: public.% must be SECURITY INVOKER', v_fn;
    end if;
    if v_fn = 'crm_project_progress' and v_volatile <> 's' then
      raise exception 'postflight: public.crm_project_progress must be STABLE';
    end if;
    if has_function_privilege('anon', (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = v_fn), 'execute')
       or has_function_privilege('service_role', (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = v_fn), 'execute')
       or not has_function_privilege('authenticated', (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = v_fn), 'execute') then
      raise exception 'postflight: public.% grants are wrong', v_fn;
    end if;
  end loop;
  raise notice 'postflight schedule-bends: projects fenced; visits carry project_id; bulk edit and project functions invoker, authenticated-only';
end $$;
