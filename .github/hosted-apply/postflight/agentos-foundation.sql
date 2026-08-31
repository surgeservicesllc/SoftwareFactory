set search_path = pg_catalog;
with expected_types(type_name, labels) as (values
  ('agentos_network_mode', 'open,limited'),
  ('agentos_skill_kind', 'prompt,file'),
  ('agentos_repo_permission', 'git_read,git_write')
), type_state as (
  select expected_types.*, type_row.oid,
         string_agg(enum_row.enumlabel, ',' order by enum_row.enumsortorder) as actual_labels
  from expected_types
  left join pg_type type_row on type_row.typnamespace = 'public'::regnamespace
                            and type_row.typname = expected_types.type_name
  left join pg_enum enum_row on enum_row.enumtypid = type_row.oid
  group by expected_types.type_name, expected_types.labels, type_row.oid
), expected_tables(table_name, policy_name) as (values
  ('agentos_environments', 'agentos_environments_select_members'),
  ('agentos_mcp_connections', 'agentos_mcp_select_members'),
  ('agentos_skills', 'agentos_skills_select_members'),
  ('agentos_agent_grants', 'agentos_agent_grants_select_members'),
  ('agentos_agent_mcp_grants', 'agentos_agent_mcp_select_members'),
  ('agentos_agent_skill_grants', 'agentos_agent_skill_select_members'),
  ('agentos_agent_repo_grants', 'agentos_agent_repo_select_members'),
  ('agentos_agent_filesystem_grants', 'agentos_agent_fs_select_members'),
  ('agentos_agent_collaborators', 'agentos_agent_collaborator_select_members')
), table_state as (
  select expected_tables.*, relation.oid, relation.relowner, relation.relkind,
         relation.relrowsecurity, relation.relforcerowsecurity, relation.relacl,
         policy.oid as policy_oid, policy.polcmd, policy.polpermissive,
         policy.polroles, policy.polqual, policy.polwithcheck
  from expected_tables
  left join pg_class relation
    on relation.relnamespace = 'public'::regnamespace
   and relation.relname = expected_tables.table_name
  left join pg_policy policy
    on policy.polrelid = relation.oid
   and policy.polname = expected_tables.policy_name
), helper_state as (
  select routine.oid, routine.proname,
         routine.proowner, routine.prokind, routine.provolatile,
         routine.prosecdef, routine.proconfig, routine.proacl,
         routine_language.lanname
  from pg_proc routine
  join pg_language routine_language on routine_language.oid = routine.prolang
  where routine.oid in (
    to_regprocedure('public.agentos_hosts_are_bare_hostnames(text[])'),
    to_regprocedure('public.agentos_resolved_agent_grants(uuid)')
  )
)
select (select count(oid) = 3 and bool_and(actual_labels = labels) from type_state)
   and (select count(oid) = 9 and bool_and(
     relkind = 'r' and relrowsecurity and relforcerowsecurity
     and pg_get_userbyid(relowner) = 'postgres'
     and policy_oid is not null and polcmd = 'r' and polpermissive
     and polroles = array[to_regrole('authenticated')::oid]
     and polqual is not null and polwithcheck is null
     and has_table_privilege('authenticated', oid, 'SELECT')
     and not has_table_privilege('authenticated', oid, 'INSERT')
     and not has_table_privilege('authenticated', oid, 'UPDATE')
     and not has_table_privilege('authenticated', oid, 'DELETE')
     and not has_table_privilege('anon', oid, 'SELECT')
     and not has_table_privilege('service_role', oid, 'SELECT')
     and not exists (
       select 1 from aclexplode(relacl) acl
        where acl.grantor <> relowner
           or acl.grantee not in (relowner, to_regrole('authenticated')::oid)
           or acl.is_grantable
           or (acl.grantee = to_regrole('authenticated')::oid and acl.privilege_type <> 'SELECT')
     )
   ) from table_state)
   and (select count(*) = 9 from pg_policy policy
        join pg_class relation on relation.oid = policy.polrelid
        where relation.relnamespace = 'public'::regnamespace
          and relation.relname in (
            'agentos_environments', 'agentos_mcp_connections', 'agentos_skills',
            'agentos_agent_grants', 'agentos_agent_mcp_grants',
            'agentos_agent_skill_grants', 'agentos_agent_repo_grants',
            'agentos_agent_filesystem_grants', 'agentos_agent_collaborators'
          ))
   and (select count(oid) = 2 and bool_and(
     pg_get_userbyid(proowner) = 'postgres' and prokind = 'f'
     and proconfig = array['search_path=pg_catalog']::text[]
     and (
       (proname = 'agentos_hosts_are_bare_hostnames'
        and lanname = 'sql' and provolatile = 'i' and not prosecdef)
       or
       (proname = 'agentos_resolved_agent_grants'
        and lanname = 'plpgsql' and provolatile = 's' and prosecdef
        and has_function_privilege('authenticated', oid, 'EXECUTE')
        and not has_function_privilege('anon', oid, 'EXECUTE')
        and not has_function_privilege('service_role', oid, 'EXECUTE'))
     )
   ) from helper_state);
