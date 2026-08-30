select 'column' as kind, table_name || '.' || column_name as object
  from information_schema.columns
 where table_schema = 'public'
   and (table_name, column_name) in (
     ('projects','engineering_priority'), ('projects','strategic_focus'),
     ('projects','engineering_paused'), ('projects','engineering_pause_reason'),
     ('projects','maximum_concurrent_runs'),
     ('organizations','maximum_concurrent_runs'),
     ('agent_runs','review_status'), ('agent_runs','review_note'))
union all
select 'table', c.relname from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
   and c.relname in ('scheduling_decisions','provider_capacity_limits')
union all
select 'function', p.proname from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public'
   and p.proname in (
     'archive_project','unarchive_project','update_project_details',
     'set_project_engineering_priority','set_project_engineering_pause',
     'focus_portfolio_engineering','set_portfolio_capacity_limits',
     'update_agent_run_review','delete_agent_run')
order by 1, 2;
