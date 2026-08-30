  select link.command_id, link.graph_id, link.created_at
    from public.command_analysis_graphs link
   order by link.created_at desc
   limit 5;" || true
psql "$DB_URL" -v ON_ERROR_STOP=1 -q -c "
  select run.id, run.graph_id, run.state, run.started_at, run.completed_at,
         (select count(*) from public.graph_artifacts artifact where artifact.graph_run_id = run.id) as artifacts
    from public.graph_runs run
   order by run.created_at desc
   limit 5;
