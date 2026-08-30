select run.id, run.status, run.provider, run.model, run.attempt_number,
       run.lease_worker_id, run.error_code, left(coalesce(run.error_message,''), 80) as error_message,
       run.head_branch, run.created_at
  from public.agent_runs run
 order by run.created_at desc
 limit 5;
