            with expected(version, kind, object, marker) as (values
              ('20260814002500', 'table',    'provider_credentials',                 null),
              ('20260814002600', 'function', 'store_provider_credential',            null),
              ('20260815000200', 'table',    'scheduling_decisions',                 null),
              ('20260815000300', 'function', 'portfolio_capacity_verdict',           null),
              ('20260815000400', 'body',     'plan_phase1c_task_and_run',            'agent.project_id = new.project_id'),
              ('20260815000500', 'function', 'breaker_cooldown_seconds',             null),
              ('20260815000600', 'function', 'portfolio_scheduling_queue',           null),
              ('20260815000800', 'body',     'generate_operations_report',           'phase1e-operations-v2'),
              ('20260815000900', 'function', 'refuse_project_deletion',              null),
              ('20260815001000', 'function', 'declare_cross_project_dependency',     null),
              ('20260815001100', 'table',    'connection_routing_decisions',         null),
              ('20260815001200', 'table',    'improvement_ledger',                   null),
              ('20260815001300', 'function', 'capture_improvement_baseline',         null),
              ('20260815001400', 'function', 'audit_factory_health',                 null),
              ('20260815001500', 'function', 'detect_factory_improvements',          null),
              ('20260815001600', 'function', 'propose_improvements_from_detections', null),
              ('20260816000100', 'table',    'ai_accounts',                          null),
              ('20260816000200', 'function', 'list_ai_accounts_for_verification',    null),
              ('20260816000300', 'function', 'find_open_ai_auth_session',            null),
              -- The command path itself, and the two migrations either side of it.
              -- Their history rows are blank on the remote, and a blank row means
              -- nothing on its own: every Phase 2E object below reads blank in the
              -- ledger and `t` here. Issue a Command runs through
              -- `list_factory_command_routing_candidates` and `submit_factory_command`,
              -- so leaving them unprobed left the one surface an owner actually uses
              -- as the only thing this report could not answer for.
              ('20260816001600', 'table',    'resource_reservations',                null),
              ('20260821000200', 'table',    'graph_gates',                          null),
              ('20260821000400', 'table',    'factory_command_routes',               null),
              ('20260821000400', 'function', 'list_factory_command_routing_candidates', null),
              ('20260821000400', 'function', 'submit_factory_command',               null),
              ('20260822000600', 'body',     'normalize_phase1c_command',            'gpt-5.3-codex'),
              -- Presence only: the migration is a pure ACL contraction, and the
              -- containment report below prints the guard's actual privileges.
              ('20260822001300', 'function', 'reject_activity_event_mutation',       null)
            )
            select expected.version,
                   expected.kind,
                   expected.object,
                   case expected.kind
                     when 'table' then exists (
                       select 1 from pg_class relation
                         join pg_namespace space on space.oid = relation.relnamespace
                        where space.nspname = 'public'
                          and relation.relkind = 'r'
                          and relation.relname = expected.object)
                     when 'function' then exists (
                       select 1 from pg_proc routine
                         join pg_namespace space on space.oid = routine.pronamespace
                        where space.nspname = 'public'
                          and routine.proname = expected.object)
                     else exists (
                       select 1 from pg_proc routine
                         join pg_namespace space on space.oid = routine.pronamespace
                        where space.nspname = 'public'
                          and routine.proname = expected.object
                          and strpos(pg_get_functiondef(routine.oid), expected.marker) > 0)
                   end as present
              from expected
             order by expected.version;
