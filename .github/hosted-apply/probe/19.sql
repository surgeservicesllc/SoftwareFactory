            select count(*) as worker_rows,
                   count(*) filter (where last_heartbeat_at > now() + interval '1 minute')
                     as heartbeats_in_future,
                   count(*) filter (where last_heartbeat_at > now() - interval '10 minutes')
                     as heartbeats_last_10_minutes,
                   count(*) filter (where current_run_id is not null) as holding_a_run,
                   max(last_heartbeat_at) as newest_heartbeat
              from public.phase1c_workers;
