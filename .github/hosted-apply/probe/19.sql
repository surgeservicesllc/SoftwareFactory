select count(*) filter (where version in ('20260822000300','20260822000850','20260822000900',
                                          '20260822001000','20260822001100','20260822001200')) as protected_rows_recorded
  from supabase_migrations.schema_migrations;
