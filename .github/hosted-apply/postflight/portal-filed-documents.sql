-- Postflight for hosted apply scope `portal-filed-documents`.
--
-- Extracted from .github/workflows/apply-hosted-migrations.yml for the
-- same size reason as every other file here, and executed against the
-- fully migrated chain by
-- tests/integration/hosted-scope-replay.behavior.test.ts so a mangled
-- extraction fails a test rather than a production dispatch.
--
-- ADR-222 hands a signed-in customer the body of their own filed copy.
-- The checks are therefore about reach: both functions must be
-- SECURITY DEFINER (the customer is not an organization member and holds
-- no table grant), reachable by authenticated, and by nobody else — the
-- body function takes a uuid, so any other role holding execute could
-- read another tenant's paperwork by guessing ids.

do $$
declare
  v_name text;
  v_role text;
begin
  foreach v_name in array array[
    'crm_portal_filed_documents', 'crm_portal_filed_document_body'] loop
    if (select count(*) from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = v_name
          and p.prosecdef and p.provolatile = 's'
          and has_function_privilege('authenticated', p.oid, 'execute')) <> 1 then
      raise exception '% is missing, not a stable definer, or unreachable by authenticated', v_name;
    end if;
    foreach v_role in array array['anon','service_role'] loop
      if exists (
        select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
         where n.nspname = 'public' and p.proname = v_name
           and has_function_privilege(v_role, p.oid, 'execute')) then
        raise exception '% is executable by %', v_name, v_role;
      end if;
    end loop;
  end loop;
  -- The portal-wide rule ADR-198 established still holds after this
  -- migration: no crm_portal% function is reachable signed out.
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname like 'crm_portal%'
       and has_function_privilege('anon', p.oid, 'execute')) then
    raise exception 'a portal function is executable by anon';
  end if;
end
$$;
