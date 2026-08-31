-- Postflight for hosted apply scope `customer-portal`.
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
  v_role text;
  v_all text[] := array['crm_portal_users','crm_portal_requests'];
  v_callable text[] := array[
    'crm_portal_me','crm_portal_touch','crm_portal_summary',
    'crm_portal_invoices','crm_portal_visits','crm_portal_documents',
    'crm_portal_requests_mine','crm_portal_submit_request',
    'crm_portal_accept_invitation'];
begin
  if (select count(*) from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relrowsecurity and c.relforcerowsecurity
        and c.relname = any(v_all)) <> 2 then
    raise exception 'the portal tables are missing or not under forced RLS';
  end if;
  foreach v_table in array v_all loop
    if has_table_privilege('authenticated', 'public.' || v_table, 'delete') then
      raise exception 'portal records are deletable on %', v_table;
    end if;
    if has_table_privilege('anon', 'public.' || v_table, 'select')
      or has_table_privilege('service_role', 'public.' || v_table, 'select') then
      raise exception 'anon or service_role can reach %', v_table;
    end if;
  end loop;
  foreach v_role in array array['anon','authenticated','service_role'] loop
    if exists (
      select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'crm_portal_account_for'
         and has_function_privilege(v_role, p.oid, 'execute')) then
      raise exception 'the portal resolver is executable by %', v_role;
    end if;
  end loop;
  if (select count(*) from pg_trigger t
       where t.tgname = 'crm_portal_users_guard_activation') <> 1 then
    raise exception 'the portal activation guard is missing';
  end if;
  if (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = any(v_callable)
         and p.prosecdef
         and has_function_privilege('authenticated', p.oid, 'execute')
         and not has_function_privilege('anon', p.oid, 'execute')
         and not has_function_privilege('service_role', p.oid, 'execute')
      ) <> 9 then
    raise exception 'a portal function is missing, not a definer, or reachable by the wrong role';
  end if;
end
$$;
