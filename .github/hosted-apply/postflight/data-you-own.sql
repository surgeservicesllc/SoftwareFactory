-- Postflight for hosted apply scope `data-you-own` (ADR-230).
--
-- A merged account stays readable and points at the survivor; an import
-- is a record that cannot be edited; the merge runs as one definer that
-- checks membership itself. Each check here is a way one of those stops
-- being true.

do $$
declare
  v_grants integer;
  v_contradictions integer;
begin
  if not exists (
    select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public' and c.relname = 'crm_imports'
       and c.relrowsecurity and c.relforcerowsecurity
  ) then
    raise exception 'crm_imports is not RLS-enabled and forced';
  end if;

  select count(*) into v_grants
    from information_schema.role_table_grants
   where table_schema = 'public' and table_name = 'crm_imports'
     and grantee in ('service_role', 'anon', 'PUBLIC');
  if v_grants <> 0 then
    raise exception 'crm_imports carries % grant(s) outside authenticated', v_grants;
  end if;
  if exists (
    select 1 from information_schema.role_table_grants
     where table_schema = 'public' and table_name = 'crm_imports'
       and privilege_type in ('UPDATE', 'DELETE')
       and grantee in ('authenticated', 'anon', 'service_role', 'PUBLIC')
  ) then
    raise exception 'crm_imports gained an update or delete grant; what an import did is not editable';
  end if;

  if not exists (select 1 from pg_constraint where conname = 'crm_accounts_merged_is_inactive') then
    raise exception 'a merged account could still be a customer somewhere else';
  end if;
  if not exists (select 1 from pg_constraint where conname = 'crm_accounts_merged_not_self') then
    raise exception 'an account could be merged into itself';
  end if;

  -- The merge is the one definer here, and it is callable only by members
  -- through the browser role — its body checks membership itself.
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.prosecdef and p.proname = 'crm_merge_accounts'
  ) then
    raise exception 'crm_merge_accounts is not SECURITY DEFINER; it could not re-point the append-only ledgers';
  end if;
  if exists (
    select 1 from information_schema.routine_privileges
     where routine_schema = 'public' and routine_name = 'crm_merge_accounts'
       and grantee in ('anon', 'service_role', 'PUBLIC')
  ) then
    raise exception 'crm_merge_accounts is callable outside authenticated';
  end if;

  -- And the substantive one: no merged account is anything but inactive.
  select count(*) into v_contradictions
    from public.crm_accounts a
   where a.merged_into_id is not null and (a.status <> 'inactive' or a.merged_into_id = a.id);
  if v_contradictions <> 0 then
    raise exception '% merged account(s) contradict their own record', v_contradictions;
  end if;

  raise notice 'data you own: merged accounts stay and point home, imports are a record, the merge checks membership itself';
end;
$$;
