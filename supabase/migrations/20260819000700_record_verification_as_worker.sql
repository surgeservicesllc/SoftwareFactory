-- Verification verdicts, recorded by the executor.
--
-- `graph_verifications` and `record_verification` have existed since the
-- write boundary was built, and the engine has carried independence and
-- quorum rules for as long. The executed path used none of it: a graph's
-- reviewing node ran as an ordinary node and its verdict was stored as an
-- artifact like any other output, so nothing durable said "this was a
-- verification, of that subject, under this lens". A verification nobody
-- recorded is a verification nobody can audit.
--
-- This is the worker's half, mirroring the member function exactly —
-- including the rule that matters most: a verifier may not be the agent
-- that produced the subject. Recording a verdict is evidence about the
-- subject, not a re-judgement of whether the run executed; run outcomes
-- stay where they are, decided by what actually completed.

create or replace function public.record_verification_as_worker(
  p_worker_id text,
  p_subject_node_run_id uuid,
  p_lens public.verification_lens,
  p_verdict public.verification_verdict,
  p_evidence jsonb default '[]'::jsonb,
  p_verifier_agent_id uuid default null,
  p_verifier_provider text default null,
  p_shared_worker_context boolean default false
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_subject public.node_runs;
  v_subject_agent uuid;
  v_verification_id uuid;
begin
  perform public.assert_graph_worker_id(p_worker_id);

  select * into v_subject from public.node_runs where id = p_subject_node_run_id;
  if v_subject.id is null then
    raise exception 'node_run_not_found' using errcode = 'P0002';
  end if;

  select n.agent_id into v_subject_agent
    from public.graph_nodes n where n.id = v_subject.node_id;

  -- The same refusal the member path makes. An agent that reviews its own
  -- output is not a second opinion, and a system that records one as though
  -- it were has quietly lowered its own bar.
  if p_verifier_agent_id is not null
     and v_subject_agent is not null
     and p_verifier_agent_id = v_subject_agent then
    raise exception 'self_verification_forbidden' using errcode = '42501';
  end if;

  insert into public.graph_verifications (
    organization_id, graph_run_id, subject_node_run_id, verifier_agent_id,
    verifier_provider, lens, verdict, evidence, shared_worker_context
  )
  values (
    v_subject.organization_id, v_subject.graph_run_id, p_subject_node_run_id,
    p_verifier_agent_id, p_verifier_provider, p_lens, p_verdict,
    coalesce(p_evidence, '[]'::jsonb), coalesce(p_shared_worker_context, false)
  )
  returning id into v_verification_id;

  insert into public.graph_events (organization_id, graph_run_id, node_run_id, event_type, detail, payload)
  values (
    v_subject.organization_id, v_subject.graph_run_id, p_subject_node_run_id,
    'verification_recorded',
    format('Worker %s recorded a %s verdict under the %s lens.', p_worker_id, p_verdict, p_lens),
    jsonb_build_object('verdict', p_verdict, 'lens', p_lens)
  );

  return v_verification_id;
end;
$$;

revoke all on function public.record_verification_as_worker(
  text, uuid, public.verification_lens, public.verification_verdict, jsonb, uuid, text, boolean
) from public, anon, authenticated;
grant execute on function public.record_verification_as_worker(
  text, uuid, public.verification_lens, public.verification_verdict, jsonb, uuid, text, boolean
) to service_role;
