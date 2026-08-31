\set ON_ERROR_STOP on

select pg_catalog.set_config(
  'softwarefactory.grok_runtime_release.lint_through', :'installed_through', false
) as lint_through_setting \gset

with expected(signature, introduced_at) as (values
  ('public.launch_grok_deploy_readiness_v1_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,text,jsonb)',
   '20260831001800'),
  ('public.record_grok_specialist_roster_v2_as_server(uuid,uuid,uuid,uuid,uuid,text,bigint)',
   '20260831001900'),
  ('public.launch_grok_full_lifecycle_v4_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,uuid,text,text,jsonb,text,jsonb)',
   '20260831001900'),
  ('public.launch_grok_read_only_research_v2_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,text,jsonb)',
   '20260831001900'),
  ('public.resolve_graph_execution_target_as_worker(uuid,integer)',
   '20260831002000'),
  ('public.claim_planned_graph_by_target_v4(text,text[],jsonb,integer)',
   '20260831002000'),
  ('public.launch_grok_read_only_research_v3_as_server(uuid,uuid,uuid,uuid,uuid,text,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,uuid,text,text,jsonb,text,jsonb)',
   '20260831002000'),
  ('public.assert_current_grok_graph_wake_intent(public.grok_graph_wake_intents)',
   '20260831002100'),
  ('public.apply_grok_graph_control_v2_as_owner(uuid,uuid,uuid,text,text,text)',
   '20260831002100'),
  ('public.apply_grok_graph_control_v3_as_owner(uuid,uuid,uuid,text,text,text)',
   '20260831002100'),
  ('public.record_grok_graph_wake_dispatch_as_server(uuid,uuid,bigint,text,text,text)',
   '20260831002100'),
  ('public.assert_no_grok_graph_wake_payload_required_as_worker(text,uuid,uuid,integer,integer)',
   '20260831002100'),
  ('public.acknowledge_grok_graph_wake_as_worker(text,uuid,bigint,uuid,uuid,integer,integer)',
   '20260831002100'),
  ('public.read_grok_graph_wake_state_as_owner(uuid,uuid,uuid)',
   '20260831002100')
), available as (
  select expected.signature, routine.oid
    from expected
    join pg_catalog.pg_proc routine
      on routine.oid = pg_catalog.to_regprocedure(expected.signature)
    join pg_catalog.pg_language language_row on language_row.oid = routine.prolang
   where expected.introduced_at <= pg_catalog.current_setting(
           'softwarefactory.grok_runtime_release.lint_through'
         )
     and language_row.lanname = 'plpgsql'
)
select 'LINTROW|' || available.signature || '|'
       || coalesce(finding.lineno::text, '') || '|'
       || coalesce(finding.level, '') || '|'
       || coalesce(finding.sqlstate, '') || '|'
       || coalesce(finding.message, '')
  from available
  cross join lateral extensions.plpgsql_check_function_tb(
    available.oid::regprocedure, 0::oid::regclass,
    false, true, true, false, false, false
  ) finding
 where finding.level in ('error', 'warning', 'extra')
 order by available.signature, finding.lineno, finding.position;
