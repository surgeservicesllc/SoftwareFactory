            select table_name, column_name, data_type, is_nullable
              from information_schema.columns
             where table_schema = 'public'
               and table_name in ('provider_credentials', 'provider_connect_sessions')
             order by table_name, ordinal_position;
