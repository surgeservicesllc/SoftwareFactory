            select run.id, run.graph_id, run.state, run.started_at, run.completed_at,
                   (select count(*) from public.graph_artifacts artifact where artifact.graph_run_id = run.id) as artifacts
              from public.graph_runs run
             order by run.created_at desc
             limit 5;
