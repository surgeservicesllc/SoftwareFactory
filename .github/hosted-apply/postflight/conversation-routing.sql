-- Postflight for scope=conversation-routing (20260902001100): the
-- assignment columns exist with their pairing check, and the five functions
-- are INVOKER and granted to authenticated only.
do $$
declare
  v_fn text;
  v_secdef boolean;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'crm_portal_requests'
       and column_name in ('assignee_employee_id', 'assigned_at', 'assigned_by')
    group by table_name having count(*) = 3
  ) then
    raise exception 'postflight: crm_portal_requests lacks the assignment columns';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_portal_requests_assignment_whole') then
    raise exception 'postflight: the assignment pairing check is missing';
  end if;
  foreach v_fn in array array['crm_my_employee', 'crm_request_open_load', 'crm_request_suggested_assignee', 'crm_request_assign', 'crm_request_queue'] loop
    select p.prosecdef into v_secdef
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_secdef is null then
      raise exception 'postflight: public.% is missing', v_fn;
    end if;
    if v_secdef then
      raise exception 'postflight: public.% must be SECURITY INVOKER', v_fn;
    end if;
    if has_function_privilege('anon', (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = v_fn), 'execute')
       or has_function_privilege('service_role', (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = v_fn), 'execute')
       or not has_function_privilege('authenticated', (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = v_fn), 'execute') then
      raise exception 'postflight: public.% grants are wrong', v_fn;
    end if;
  end loop;
  raise notice 'postflight conversation-routing: assignment columns paired; suggestion, assignment, queue and load functions invoker, authenticated-only';
end $$;
