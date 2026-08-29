-- Phase one of the graph-worker protocol cutover. This migration commits the
-- authority fence separately from the schema/body replacement in 00200.
-- Calls whose statements began before this commit may finish; 00200 refuses
-- to start while any such legacy call/lock remains, then installs only the
-- versioned protocol. No worker or autonomous mode is enabled here.

revoke all on function public.start_graph_run(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.claim_planned_graph(text, text[])
  from public, anon, authenticated, service_role;
revoke all on function public.claim_phase1c_run(text, text, text, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.decide_node_gate(uuid, boolean, text)
  from public, anon, authenticated, service_role;
revoke all on function public.record_node_state(
  uuid, public.graph_node_state, text, text, text, integer
) from public, anon, authenticated, service_role;
revoke all on function public.complete_graph_run(
  uuid, public.graph_run_state, boolean, bigint, bigint, text
) from public, anon, authenticated, service_role;
revoke all on function public.record_handoff(
  uuid, uuid, jsonb, boolean, jsonb, uuid, jsonb, jsonb, jsonb, text
) from public, anon, authenticated, service_role;
revoke all on function public.record_graph_artifact(
  uuid, public.graph_artifact_kind, jsonb, uuid, integer, integer
) from public, anon, authenticated, service_role;
revoke all on function public.record_verification(
  uuid, public.verification_lens, public.verification_verdict,
  jsonb, uuid, text, boolean
) from public, anon, authenticated, service_role;

do $legacy_graph_protocol_fence_postflight$
declare
  signature text;
  routine regprocedure;
  role_name text;
begin
  foreach signature in array array[
    'start_graph_run(uuid)',
    'claim_planned_graph(text,text[])',
    'claim_phase1c_run(text,text,text,integer)',
    'decide_node_gate(uuid,boolean,text)',
    'record_node_state(uuid,public.graph_node_state,text,text,text,integer)',
    'complete_graph_run(uuid,public.graph_run_state,boolean,bigint,bigint,text)',
    'record_handoff(uuid,uuid,jsonb,boolean,jsonb,uuid,jsonb,jsonb,jsonb,text)',
    'record_graph_artifact(uuid,public.graph_artifact_kind,jsonb,uuid,integer,integer)',
    'record_verification(uuid,public.verification_lens,public.verification_verdict,jsonb,uuid,text,boolean)'
  ]
  loop
    routine := pg_catalog.to_regprocedure('public.' || signature);
    if routine is null then
      raise exception 'legacy graph protocol function is missing during fence: %', signature;
    end if;
    foreach role_name in array array['anon', 'authenticated', 'service_role']
    loop
      if pg_catalog.has_function_privilege(role_name, routine, 'execute') then
        raise exception 'legacy graph protocol fence failed for % on %', role_name, signature;
      end if;
    end loop;
  end loop;
end;
$legacy_graph_protocol_fence_postflight$;
