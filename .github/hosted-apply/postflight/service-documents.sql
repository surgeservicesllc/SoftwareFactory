-- Postflight for hosted apply scope `service-documents` (ADR-216).
--
-- A filed copy that can be changed is not evidence. The guarantee is that
-- the bytes are frozen, the size cannot lie, and a correction is another
-- filing rather than an edit.

do $$
declare
  v_rls integer;
  v_grants integer;
  v_write integer;
  v_secdef integer;
begin
  select count(*) into v_rls
    from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relname = 'crm_service_documents'
     and c.relrowsecurity and c.relforcerowsecurity;
  if v_rls <> 1 then
    raise exception 'crm_service_documents is not RLS-enabled and forced';
  end if;

  select count(*) into v_grants
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'crm_service_documents'
     and grantee in ('service_role', 'anon', 'PUBLIC');
  if v_grants <> 0 then
    raise exception 'crm_service_documents carries % grant(s) outside authenticated', v_grants;
  end if;

  -- The whole value: no update, no delete, for anybody.
  select count(*) into v_write
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'crm_service_documents'
     and privilege_type in ('UPDATE', 'DELETE')
     and grantee in ('authenticated', 'anon', 'service_role', 'PUBLIC');
  if v_write <> 0 then
    raise exception 'crm_service_documents gained % update/delete grant(s); a filed copy must be frozen', v_write;
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'crm_service_documents_size_is_true'
  ) then
    raise exception 'the size agreement constraint is missing';
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'crm_service_documents_names_a_subject'
  ) then
    raise exception 'a filed document could be about nothing';
  end if;

  select count(*) into v_secdef
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.prosecdef
     and p.proname = 'crm_service_documents_filed';
  if v_secdef <> 0 then
    raise exception 'crm_service_documents_filed is SECURITY DEFINER';
  end if;

  raise notice 'service documents: frozen bytes, honest size, always about something, invoker boundary';
end;
$$;
