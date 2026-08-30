            select worker_id, status, last_heartbeat_at, current_run_id
              from public.phase1c_workers
             where current_run_id is not null
                or last_heartbeat_at > now() - interval '10 minutes'
             order by last_heartbeat_at desc
             limit 10;
