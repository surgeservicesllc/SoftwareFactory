-- Postflight for hosted apply scope `billing-contracts`.
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
        and c.relname in (
          'crm_estimates','crm_estimate_lines','crm_contracts','crm_invoices',
          'crm_invoice_lines','crm_payments','crm_refunds')) <> 7 then
    raise exception 'the billing tables are missing or not under forced RLS';
  end if;
  foreach v_table in array array['crm_payments','crm_refunds'] loop
    if has_table_privilege('authenticated', 'public.' || v_table, 'update') then
      raise exception 'money that moved is rewritable on %', v_table;
    end if;
  end loop;
  foreach v_table in array array[
    'crm_estimates','crm_estimate_lines','crm_contracts','crm_invoices',
    'crm_invoice_lines','crm_payments','crm_refunds'
  ] loop
    if has_table_privilege('authenticated', 'public.' || v_table, 'delete') then
      raise exception 'billing records are deletable on %', v_table;
    end if;
    if has_table_privilege('anon', 'public.' || v_table, 'select')
      or has_table_privilege('service_role', 'public.' || v_table, 'select') then
      raise exception 'anon or service_role can reach %', v_table;
    end if;
  end loop;
  if (select count(*) from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where c.relname in ('crm_payments','crm_refunds')
        and t.tgname in (
          'crm_payments_record','crm_refunds_guard_total','crm_refunds_resettle')) <> 3 then
    raise exception 'a settlement trigger is missing';
  end if;
end
$$;
