-- Activity vocabulary for the two bulk-clear controls.
--
-- Its own migration because PostgreSQL will not let a transaction use an enum
-- value it added itself, and 20260822000800 writes both of these in the
-- function bodies it creates. Same reason 20260820000100 exists.

alter type public.activity_event_type add value if not exists 'task.backlog_cleared';
alter type public.activity_event_type add value if not exists 'command.pipelines_cleared';
