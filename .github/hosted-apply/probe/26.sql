            select count(*) as record_only_agent_runs
              from public.agent_runs run
              join public.tasks task on task.id = run.task_id
              join public.commands command on command.id = task.command_id
             where command.parameters ->> 'executionMode' = 'record_only';
