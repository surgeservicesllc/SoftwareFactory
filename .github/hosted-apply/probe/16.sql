            set search_path = pg_catalog;
            select 'enum ' || expected.name as object, to_regtype('public.' || expected.name) is not null as present
              from (values ('agentos_network_mode'), ('agentos_skill_kind'), ('agentos_repo_permission')) expected(name)
            union all
            select 'table ' || expected.name, to_regclass('public.' || expected.name) is not null
              from (values ('agentos_environments'), ('agentos_mcp_connections'), ('agentos_skills'),
                           ('agentos_agent_grants'), ('agentos_agent_mcp_grants'), ('agentos_agent_skill_grants'),
                           ('agentos_agent_repo_grants'), ('agentos_agent_filesystem_grants'),
                           ('agentos_agent_collaborators')) expected(name)
            union all
            select 'index ' || expected.name, to_regclass('public.' || expected.name) is not null
              from (values ('agentos_environments_org_idx'), ('agentos_mcp_org_idx'), ('agentos_skills_org_idx'),
                           ('agentos_agent_grants_org_idx'), ('agentos_agent_mcp_agent_idx'),
                           ('agentos_agent_skill_agent_idx'), ('agentos_agent_repo_agent_idx'),
                           ('agentos_agent_fs_agent_idx'), ('agentos_agent_collaborator_agent_idx')) expected(name)
            union all
            select 'function ' || expected.name, exists (
                     select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                     where n.nspname = 'public' and p.proname = expected.name)
              from (values ('agentos_hosts_are_bare_hostnames'), ('agentos_resolved_agent_grants')) expected(name)
            union all
            select 'policy ' || expected.name, exists (
                     select 1 from pg_policy p where p.polname = expected.name
                       and p.polrelid = coalesce(to_regclass(expected.rel), 0))
              from (values ('agentos_environments_select_members', 'public.agentos_environments'),
                           ('agentos_mcp_select_members', 'public.agentos_mcp_connections'),
                           ('agentos_skills_select_members', 'public.agentos_skills'),
                           ('agentos_agent_grants_select_members', 'public.agentos_agent_grants'),
                           ('agentos_agent_mcp_select_members', 'public.agentos_agent_mcp_grants'),
                           ('agentos_agent_skill_select_members', 'public.agentos_agent_skill_grants'),
                           ('agentos_agent_repo_select_members', 'public.agentos_agent_repo_grants'),
                           ('agentos_agent_fs_select_members', 'public.agentos_agent_filesystem_grants'),
                           ('agentos_agent_collaborator_select_members', 'public.agentos_agent_collaborators')) expected(name, rel)
             order by 2 desc, 1;
