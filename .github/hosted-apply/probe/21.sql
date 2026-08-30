            select count(*) filter (where extension_row.oid is not null) as extension_rows,
                   count(*) filter (where routine.oid is not null) as function_rows
              from (values (1)) seed(value)
              left join pg_extension extension_row on extension_row.extname = 'plpgsql_check'
              left join pg_proc routine on routine.proname like 'plpgsql_check_function%';
