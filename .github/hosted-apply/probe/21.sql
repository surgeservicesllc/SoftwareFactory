set search_path = pg_catalog;
select relation.relname, relation.relrowsecurity as rls, relation.relforcerowsecurity as force_rls,
       coalesce(relation.relacl::text, '<null>') as relacl,
       has_table_privilege('anon', relation.oid, 'SELECT') as anon_sel,
       has_table_privilege('service_role', relation.oid, 'SELECT') as service_sel,
       has_table_privilege('authenticated', relation.oid, 'SELECT') as auth_sel,
       has_table_privilege('authenticated', relation.oid, 'INSERT') as auth_ins
  from pg_class relation
 where relation.relnamespace = 'public'::regnamespace
   and relation.relname in (
     'factory_record_only_submission_guards',
     'agentos_environments', 'agentos_mcp_connections', 'agentos_skills',
     'agentos_agent_grants', 'agentos_agent_mcp_grants',
     'agentos_agent_skill_grants', 'agentos_agent_repo_grants',
     'agentos_agent_filesystem_grants', 'agentos_agent_collaborators')
 order by relation.relname;
