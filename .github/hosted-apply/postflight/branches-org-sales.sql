-- Postflight for hosted apply scope `branches-org-sales`.
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
          'crm_branches','crm_employees','crm_territories','crm_commissions')) <> 4 then
    raise exception 'the company tables are missing or not under forced RLS';
  end if;
  foreach v_table in array array[
    'crm_branches','crm_employees','crm_territories','crm_commissions'
  ] loop
    if has_table_privilege('authenticated', 'public.' || v_table, 'delete') then
      raise exception 'company records are deletable on %', v_table;
    end if;
    if has_table_privilege('anon', 'public.' || v_table, 'select')
      or has_table_privilege('service_role', 'public.' || v_table, 'select') then
      raise exception 'anon or service_role can reach %', v_table;
    end if;
  end loop;
  if not exists (
    select 1 from pg_trigger t join pg_class c on c.oid = t.tgrelid
     where c.relname = 'crm_commissions' and t.tgname = 'crm_commissions_derive_amount'
  ) then
    raise exception 'the commission amount is not derived by trigger';
  end if;
  -- The org chart's own columns, on the tables that gained them.
  if (select count(*) from information_schema.columns
       where table_schema = 'public' and table_name = 'crm_accounts'
         and column_name in ('branch_id','territory_id','owner_employee_id')) <> 3 then
    raise exception 'the book of business did not gain its place in the company';
  end if;
end
$$;
