            set search_path = pg_catalog;
            select relation.relname, (select count(*) from pg_stat_user_tables stat where stat.relid = relation.oid) as has_stats,
                   pg_catalog.pg_relation_size(relation.oid) as size_bytes
              from pg_class relation
              join pg_namespace space on space.oid = relation.relnamespace
             where space.nspname = 'public' and relation.relkind = 'r'
               and relation.relname in (
                 'agentos_environments', 'agentos_mcp_connections', 'agentos_skills',
                 'agentos_agent_grants', 'agentos_agent_mcp_grants', 'agentos_agent_skill_grants',
                 'agentos_agent_repo_grants', 'agentos_agent_filesystem_grants',
                 'agentos_agent_collaborators')
             order by relation.relname;
