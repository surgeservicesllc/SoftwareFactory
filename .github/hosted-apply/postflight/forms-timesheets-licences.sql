-- Postflight for hosted apply scope `forms-timesheets-licences`.
--
-- Extracted from .github/workflows/apply-hosted-migrations.yml, which is
-- within ~2KB of the 490,000-byte guard in
-- tests/unit/hosted-apply-graph-protocol-cutover-scope.test.ts. The probe
-- SQL was extracted for the same reason; the same rule applies here, and
-- tests/integration/hosted-scope-replay.behavior.test.ts executes every
-- one of these against the fully migrated chain so a mangled extraction
-- fails a test rather than a production dispatch.

do $$
declare
  v_table text;
  v_all text[] := array[
    'crm_form_templates','crm_form_fields','crm_form_instances',
    'crm_form_answers','crm_timesheets'];
begin
  if (select count(*) from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relrowsecurity and c.relforcerowsecurity
        and c.relname = any(v_all)) <> 5 then
    raise exception 'the forms tables are missing or not under forced RLS';
  end if;
  foreach v_table in array v_all loop
    if has_table_privilege('authenticated', 'public.' || v_table, 'delete') then
      raise exception 'form records are deletable on %', v_table;
    end if;
    if has_table_privilege('anon', 'public.' || v_table, 'select')
      or has_table_privilege('service_role', 'public.' || v_table, 'select') then
      raise exception 'anon or service_role can reach %', v_table;
    end if;
  end loop;
  if (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where t.tgname in (
        'crm_form_answers_check_shape',
        'crm_form_instances_check_completeness',
        'crm_form_fields_guard_in_use',
        'crm_timesheets_guard_overlap')) <> 4 then
    raise exception 'a forms guard is missing';
  end if;
  -- Licence expiry is a column the compliance report reads.
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'crm_technicians'
         and column_name in ('license_expires_on','license_state')) <> 2 then
    raise exception 'the licence expiry columns are missing';
  end if;
end
$$;
