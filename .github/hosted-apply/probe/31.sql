select task.id, task.command_id, task.status, task.assigned_agent_id is not null as has_agent,
       task.created_at
  from public.tasks task
 order by task.created_at desc
 limit 5;
