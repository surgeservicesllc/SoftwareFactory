-- Postflight for hosted apply scope `documents-canvassing-marketing`.
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
    'crm_documents','crm_canvass_routes','crm_knocks','crm_marketing_lists',
    'crm_list_members','crm_campaigns','crm_messages','crm_automations',
    'crm_attributions'];
begin
  if (select count(*) from pg_class c
       join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public' and c.relrowsecurity and c.relforcerowsecurity
        and c.relname = any(v_all)) <> 9 then
    raise exception 'the marketing tables are missing or not under forced RLS';
  end if;
  foreach v_table in array array['crm_knocks','crm_messages','crm_attributions'] loop
    if has_table_privilege('authenticated', 'public.' || v_table, 'update') then
      raise exception 'a recorded fact is rewritable on %', v_table;
    end if;
  end loop;
  foreach v_table in array v_all loop
    if has_table_privilege('authenticated', 'public.' || v_table, 'delete') then
      raise exception 'records are deletable on %', v_table;
    end if;
    if has_table_privilege('anon', 'public.' || v_table, 'select')
      or has_table_privilege('service_role', 'public.' || v_table, 'select') then
      raise exception 'anon or service_role can reach %', v_table;
    end if;
  end loop;
  -- The document reference must be a path, not a link.
  begin
    insert into public.crm_documents
      (organization_id, account_id, title, kind, storage_path, created_by)
    values (gen_random_uuid(), gen_random_uuid(), 'probe', 'other',
            'https://example.com/x.pdf', gen_random_uuid());
    raise exception 'a URL was accepted as a document storage path';
  exception
    when check_violation then null;
    when others then null;
  end;
end
$$;
