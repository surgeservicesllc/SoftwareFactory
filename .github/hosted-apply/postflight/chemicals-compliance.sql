-- Postflight for hosted apply scope `chemicals-compliance`.
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
begin
  if (select count(*) from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relrowsecurity and c.relforcerowsecurity
        and c.relname in ('crm_products','crm_product_lots','crm_applications','crm_compliance_rules')) <> 4 then
    raise exception 'the compliance tables are missing or not under forced RLS';
  end if;
  if has_table_privilege('authenticated', 'public.crm_applications', 'update')
    or has_table_privilege('authenticated', 'public.crm_applications', 'delete') then
    raise exception 'the application log is not append-only';
  end if;
  foreach v_table in array array['crm_products','crm_product_lots','crm_applications','crm_compliance_rules'] loop
    if has_table_privilege('authenticated', 'public.' || v_table, 'delete') then
      raise exception 'compliance records are deletable on %', v_table;
    end if;
    if has_table_privilege('anon', 'public.' || v_table, 'select')
      or has_table_privilege('service_role', 'public.' || v_table, 'select') then
      raise exception 'anon or service_role can reach %', v_table;
    end if;
  end loop;
  if (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relname = 'crm_applications'
        and t.tgname in ('crm_applications_draw_lot','crm_applications_record_event')) <> 2 then
    raise exception 'an application trigger is missing';
  end if;
end
$$;
