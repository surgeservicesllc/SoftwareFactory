  select table_name, column_name, data_type, is_nullable
    from information_schema.columns
   where table_schema = 'public'
     and table_name in ('provider_credentials', 'provider_connect_sessions')
   order by table_name, ordinal_position;" || true

echo ""
echo "RLS posture and client grants on those tables - the part a"
echo "migration that died before its grants would have skipped."
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c "
  select relation.relname,
         relation.relrowsecurity as rls,
         relation.relforcerowsecurity as force_rls,
         (select count(*) from pg_policy policy where policy.polrelid = relation.oid) as policies,
         has_table_privilege('authenticated', relation.oid, 'SELECT') as authenticated_select,
         has_table_privilege('service_role', relation.oid, 'SELECT') as service_role_select
    from pg_class relation
    join pg_namespace space on space.oid = relation.relnamespace
   where space.nspname = 'public'
     and relation.relname in ('provider_credentials', 'provider_connect_sessions')
   order by relation.relname;" || true

echo ""
echo "The Pipelines page's selection delete, as the database actually"
echo "declares it: which output columns it returns tells you whether a"
echo "selected pipeline is stopped before removal (stopped_count) or"
echo "merely skipped (kept_running). Tolerant of either era."
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c "
  select coalesce(
    (select array_to_string(proargnames, ', ')
       from pg_proc
      where oid = to_regprocedure('public.delete_selected_pipelines(uuid,uuid[],text,boolean)')),
    'delete_selected_pipelines absent (pre-20260823000200 database)'
  ) as selection_delete_arguments;" || true

echo ""
echo "Analysis graphs and their command links - the record-only execution"
echo "surface. Tolerant of a database that predates the link migration."
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c "
  select graph.id, left(graph.goal, 60) as goal, graph.risk_level,
         graph.requires_owner_approval, graph.created_at,
         (select count(*) from public.graph_nodes node where node.graph_id = graph.id) as nodes,
         (select count(*) from public.graph_runs run where run.graph_id = graph.id) as runs
    from public.graphs graph
   order by graph.created_at desc
   limit 5;
