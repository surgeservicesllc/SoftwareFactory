-- Postflight for hosted apply scope `pest-ipm`.
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
        and c.relname in ('crm_devices','crm_device_events','crm_pest_sightings')) <> 3 then
    raise exception 'the pest/IPM tables are missing or not under forced RLS';
  end if;
  if has_table_privilege('authenticated', 'public.crm_device_events', 'update')
    or has_table_privilege('authenticated', 'public.crm_device_events', 'delete')
    or has_table_privilege('authenticated', 'public.crm_devices', 'delete')
    or has_table_privilege('authenticated', 'public.crm_pest_sightings', 'delete') then
    raise exception 'the pest/IPM immutability grants are wrong';
  end if;
  foreach v_table in array array['crm_devices','crm_device_events','crm_pest_sightings'] loop
    if has_table_privilege('anon', 'public.' || v_table, 'select')
      or has_table_privilege('service_role', 'public.' || v_table, 'select') then
      raise exception 'anon or service_role can reach %', v_table;
    end if;
  end loop;
  if (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where (c.relname = 'crm_devices' and t.tgname = 'crm_devices_record_install')
         or (c.relname = 'crm_device_events' and t.tgname = 'crm_device_events_apply')) <> 2 then
    raise exception 'a device ledger trigger is missing';
  end if;
  if not exists (
    select 1 from pg_indexes
    where schemaname = 'public' and indexname = 'crm_devices_org_barcode_key'
  ) then
    raise exception 'the per-organization barcode uniqueness is missing';
  end if;
end
$$;
