select enumlabel
  from pg_enum
  join pg_type on pg_type.oid = pg_enum.enumtypid
 where pg_type.typname = 'activity_event_type'
   and enumlabel in ('task.backlog_cleared', 'command.pipelines_cleared')
 order by enumlabel;
