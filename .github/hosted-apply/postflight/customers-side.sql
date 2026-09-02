-- Postflight for scope=customers-side (20260902000600): the three tables
-- exist with RLS forced, the request stamps exist, the customer-facing
-- definers and the staff invoker functions are granted to authenticated
-- only, and a rating cannot be edited by staff (no UPDATE grant).
do $$
declare
  v_name text;
  v_rls boolean;
  v_forced boolean;
  v_fn text;
begin
  foreach v_name in array array['crm_portal_surveys', 'crm_portal_messages', 'crm_sla_policies'] loop
    select c.relrowsecurity, c.relforcerowsecurity into v_rls, v_forced
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = v_name;
    if v_rls is null then
      raise exception 'postflight: public.% is missing', v_name;
    end if;
    if not v_rls or not v_forced then
      raise exception 'postflight: public.% must have RLS enabled and forced', v_name;
    end if;
  end loop;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'crm_portal_requests' and column_name = 'acknowledged_at'
  ) or not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'crm_portal_requests' and column_name = 'first_response_at'
  ) then
    raise exception 'postflight: crm_portal_requests is missing its SLA stamps';
  end if;
  if has_table_privilege('authenticated', 'public.crm_portal_surveys', 'update')
     or has_table_privilege('authenticated', 'public.crm_portal_surveys', 'delete')
     or has_table_privilege('authenticated', 'public.crm_portal_surveys', 'insert') then
    raise exception 'postflight: staff must not write crm_portal_surveys directly';
  end if;
  if has_table_privilege('authenticated', 'public.crm_portal_messages', 'delete') then
    raise exception 'postflight: a message cannot be deleted';
  end if;
  foreach v_fn in array array[
    'public.crm_request_sla(uuid, integer)', 'public.crm_effective_sla(uuid)', 'public.crm_sla_defaults()',
    'public.crm_portal_survey_submit(uuid, integer, text)', 'public.crm_portal_surveys_mine()',
    'public.crm_survey_responses(uuid, integer)', 'public.crm_portal_message_send(text, uuid)',
    'public.crm_portal_messages_mine()', 'public.crm_portal_messages_mark_read()'
  ] loop
    if has_function_privilege('anon', v_fn, 'execute')
       or has_function_privilege('service_role', v_fn, 'execute')
       or not has_function_privilege('authenticated', v_fn, 'execute') then
      raise exception 'postflight: % grants are wrong', v_fn;
    end if;
  end loop;
  raise notice 'postflight customers-side: three fenced tables, two request stamps, nine functions granted to authenticated only';
end $$;
