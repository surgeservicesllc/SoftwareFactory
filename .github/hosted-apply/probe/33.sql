            select link.command_id, link.graph_id, link.created_at
              from public.command_analysis_graphs link
             order by link.created_at desc
             limit 5;
