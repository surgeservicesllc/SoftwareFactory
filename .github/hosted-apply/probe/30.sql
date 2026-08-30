select command.id, command.status, command.requested_risk, command.command_type,
       command.parameters ->> 'executionMode' as execution_mode,
       command.parameters ->> 'provider' as provider,
       command.parameters ->> 'model' as model,
       command.created_at
  from public.commands command
 order by command.created_at desc
 limit 5;
