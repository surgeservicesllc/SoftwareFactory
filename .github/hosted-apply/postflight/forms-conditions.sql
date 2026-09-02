-- Postflight for scope=forms-conditions (20260902000900): the condition
-- columns exist with their shape check, the asked/completeness/assignment
-- triggers are installed, the readable functions are INVOKER and granted
-- to authenticated only, and the trigger functions are granted to nobody.
do $$
declare
  v_fn text;
  v_secdef boolean;
  v_volatile char;
begin
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'crm_form_fields' and column_name in ('depends_on_field_id', 'show_when')
    group by table_name having count(*) = 2
  ) then
    raise exception 'postflight: crm_form_fields lacks the condition columns';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'crm_form_templates' and column_name = 'trigger_service_types'
  ) then
    raise exception 'postflight: crm_form_templates lacks trigger_service_types';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_form_fields_show_when_shape') then
    raise exception 'postflight: the condition shape check is missing';
  end if;
  foreach v_fn in array array['crm_form_fields_check_condition', 'crm_form_answers_check_asked', 'crm_work_orders_assign_forms'] loop
    if not exists (select 1 from pg_trigger where tgname = v_fn and not tgisinternal) then
      raise exception 'postflight: trigger % is missing', v_fn;
    end if;
  end loop;
  foreach v_fn in array array['crm_form_question_asked', 'crm_form_instance_questions', 'crm_form_condition_met', 'crm_service_type_list_valid'] loop
    select p.prosecdef, p.provolatile into v_secdef, v_volatile
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = v_fn;
    if v_secdef is null then
      raise exception 'postflight: public.% is missing', v_fn;
    end if;
    if v_secdef or v_volatile = 'v' then
      raise exception 'postflight: public.% must be SECURITY INVOKER and not VOLATILE', v_fn;
    end if;
    if has_function_privilege('anon', (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = v_fn), 'execute')
       or has_function_privilege('service_role', (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = v_fn), 'execute')
       or not has_function_privilege('authenticated', (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = v_fn), 'execute') then
      raise exception 'postflight: public.% grants are wrong', v_fn;
    end if;
  end loop;
  foreach v_fn in array array['crm_check_field_condition', 'crm_check_answer_asked', 'crm_assign_forms_for_visit', 'crm_check_form_completeness'] loop
    if has_function_privilege('anon', (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = v_fn), 'execute')
       or has_function_privilege('authenticated', (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = v_fn), 'execute')
       or has_function_privilege('service_role', (select p.oid from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = v_fn), 'execute') then
      raise exception 'postflight: trigger function public.% must be granted to nobody', v_fn;
    end if;
  end loop;
  raise notice 'postflight forms-conditions: condition columns and shape check present; asked, completeness and assignment triggers installed; readable functions invoker and authenticated-only';
end $$;
