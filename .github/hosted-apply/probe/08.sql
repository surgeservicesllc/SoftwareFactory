            with lifecycle(kind, object, marker) as (values
              ('enum',     'sdlc_stage',                  'MONITORING'),
              ('enum',     'gate_kind',                   'HUMAN'),
              ('enum',     'gate_state',                  'APPROVED'),
              ('enum',     'activity_event_type',         'lifecycle.gate_approved'),
              ('table',    'graph_gates',                 null),
              ('column',   'graph_nodes.lifecycle_stage', null),
              ('column',   'graphs.max_iterations',       null),
              ('column',   'graph_edges.is_feedback',     null),
              ('column',   'node_runs.confidence',        null),
              ('function', 'open_node_gate_as_worker',    null),
              ('function', 'decide_node_gate',            null),
              ('function', 'advance_graph_iteration',     null),
              ('body',     'claim_planned_graph_v2',      'protocol version 2 is required'),
              ('body',     'list_graph_runs',             'gate_anchor_count')
            )
            select lifecycle.kind,
                   lifecycle.object,
                   case lifecycle.kind
                     when 'enum' then exists (
                       select 1 from pg_type kind_type
                         join pg_namespace space on space.oid = kind_type.typnamespace
                         join pg_enum label on label.enumtypid = kind_type.oid
                        where space.nspname = 'public'
                          and kind_type.typname = lifecycle.object
                          and label.enumlabel = lifecycle.marker)
                     when 'table' then exists (
                       select 1 from pg_class relation
                         join pg_namespace space on space.oid = relation.relnamespace
                        where space.nspname = 'public'
                          and relation.relkind = 'r'
                          and relation.relname = lifecycle.object)
                     when 'column' then exists (
                       select 1 from information_schema.columns
                        where table_schema = 'public'
                          and table_name = split_part(lifecycle.object, '.', 1)
                          and column_name = split_part(lifecycle.object, '.', 2))
                     when 'function' then exists (
                       select 1 from pg_proc routine
                         join pg_namespace space on space.oid = routine.pronamespace
                        where space.nspname = 'public'
                          and routine.proname = lifecycle.object)
                     else exists (
                       select 1 from pg_proc routine
                         join pg_namespace space on space.oid = routine.pronamespace
                        where space.nspname = 'public'
                          and routine.proname = lifecycle.object
                          and strpos(pg_get_functiondef(routine.oid), lifecycle.marker) > 0)
                   end as present
              from lifecycle;
