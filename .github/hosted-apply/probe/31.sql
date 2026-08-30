            select graph.id, left(graph.goal, 60) as goal, graph.risk_level,
                   graph.requires_owner_approval, graph.created_at,
                   (select count(*) from public.graph_nodes node where node.graph_id = graph.id) as nodes,
                   (select count(*) from public.graph_runs run where run.graph_id = graph.id) as runs
              from public.graphs graph
             order by graph.created_at desc
             limit 5;
