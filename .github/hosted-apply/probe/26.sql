select case when to_regclass('public.command_analysis_graphs') is null
            then 'link table absent (pre-20260823000100 database)'
            else 'link rows: ' || (select count(*)::text from public.command_analysis_graphs)
       end as command_analysis_links;
