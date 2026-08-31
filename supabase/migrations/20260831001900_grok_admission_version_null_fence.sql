-- Forward-only containment for JSON null admission versions.
--
-- PostgreSQL ordinary-inequality comparisons against extracted JSON evaluate to
-- UNKNOWN for a JSON null. In a PL/pgSQL IF, UNKNOWN does not enter the
-- rejection branch. The original immutable-identity checks still prevented
-- identity substitution, but the declared protocol version was not exact.
-- These wrappers reject non-object and null/missing/wrong versions before any
-- older launcher can write, then delegate to the existing audited boundaries.

create function public.record_grok_specialist_roster_v2_as_server(
  p_organization_id uuid,
  p_requested_by uuid,
  p_project_id uuid,
  p_session_id uuid,
  p_message_id uuid,
  p_idempotency_key text,
  p_expected_event_sequence bigint
)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  v_metadata jsonb;
  v_roster jsonb;
begin
  select message.metadata into v_metadata
    from public.grok_messages message
   where message.id = p_message_id
     and message.organization_id = p_organization_id
     and message.project_id = p_project_id
     and message.session_id = p_session_id
     and message.role = 'assistant'
     and message.metadata ->> 'kind' = 'grok.plan';

  if not found
      or v_metadata #>> '{plan,planner,version}' is distinct from '3'
  then
    raise exception using errcode = 'P0002',
      message = 'grok_plan_v3_roster_not_found';
  end if;

  v_roster := v_metadata #> '{plan,admissionRoster}';
  if pg_catalog.jsonb_typeof(coalesce(v_roster, 'null'::jsonb))
      is distinct from 'array'
  then
    raise exception using errcode = '22023',
      message = 'invalid grok specialist roster protocol version';
  end if;
  if pg_catalog.jsonb_array_length(v_roster) not between 1 and 64
      or exists (
        select 1
          from pg_catalog.jsonb_array_elements(v_roster) entry
         where pg_catalog.jsonb_typeof(entry.value) is distinct from 'object'
            or entry.value ->> 'version' is distinct from '1'
      )
  then
    raise exception using errcode = '22023',
      message = 'invalid grok specialist roster protocol version';
  end if;

  return public.record_grok_specialist_roster_v1_as_server(
    p_organization_id,
    p_requested_by,
    p_project_id,
    p_session_id,
    p_message_id,
    p_idempotency_key,
    p_expected_event_sequence
  );
end;
$function$;

create function public.launch_grok_full_lifecycle_v4_as_server(
  p_organization_id uuid,
  p_requested_by uuid,
  p_project_id uuid,
  p_session_id uuid,
  p_message_id uuid,
  p_idempotency_key text,
  p_goal text,
  p_topology public.graph_topology,
  p_topology_reasons jsonb,
  p_risk_level public.risk_level,
  p_requires_owner_approval boolean,
  p_nodes jsonb,
  p_edges jsonb,
  p_budget jsonb,
  p_github_repository_id uuid,
  p_base_branch text,
  p_base_sha text,
  p_required_check_names jsonb,
  p_roster_idempotency_key text,
  p_admissions jsonb
)
returns public.grok_graph_launches
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if pg_catalog.jsonb_typeof(coalesce(p_admissions, 'null'::jsonb))
      is distinct from 'array'
  then
    raise exception using errcode = '22023',
      message = 'invalid grok v4 provider admission protocol version';
  end if;
  if pg_catalog.jsonb_array_length(p_admissions) not between 1 and 64
      or exists (
        select 1
          from pg_catalog.jsonb_array_elements(p_admissions) admission
         where pg_catalog.jsonb_typeof(admission.value) is distinct from 'object'
            or admission.value ->> 'version' is distinct from '2'
      )
  then
    raise exception using errcode = '22023',
      message = 'invalid grok v4 provider admission protocol version';
  end if;

  perform public.record_grok_specialist_roster_v2_as_server(
    p_organization_id,
    p_requested_by,
    p_project_id,
    p_session_id,
    p_message_id,
    p_roster_idempotency_key,
    3
  );

  return public.launch_grok_full_lifecycle_v3_as_server(
    p_organization_id,
    p_requested_by,
    p_project_id,
    p_session_id,
    p_message_id,
    p_idempotency_key,
    p_goal,
    p_topology,
    p_topology_reasons,
    p_risk_level,
    p_requires_owner_approval,
    p_nodes,
    p_edges,
    p_budget,
    p_github_repository_id,
    p_base_branch,
    p_base_sha,
    p_required_check_names,
    p_roster_idempotency_key,
    p_admissions
  );
end;
$function$;

create function public.launch_grok_read_only_research_v2_as_server(
  p_organization_id uuid,
  p_requested_by uuid,
  p_project_id uuid,
  p_session_id uuid,
  p_message_id uuid,
  p_idempotency_key text,
  p_goal text,
  p_topology public.graph_topology,
  p_topology_reasons jsonb,
  p_risk_level public.risk_level,
  p_requires_owner_approval boolean,
  p_nodes jsonb,
  p_edges jsonb,
  p_budget jsonb,
  p_roster_idempotency_key text,
  p_admissions jsonb
)
returns public.grok_graph_launches
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  if pg_catalog.jsonb_typeof(coalesce(p_admissions, 'null'::jsonb))
      is distinct from 'array'
  then
    raise exception using errcode = '22023',
      message = 'invalid grok research v2 admission protocol version';
  end if;
  if pg_catalog.jsonb_array_length(p_admissions) not between 1 and 64
      or exists (
        select 1
          from pg_catalog.jsonb_array_elements(p_admissions) admission
         where pg_catalog.jsonb_typeof(admission.value) is distinct from 'object'
            or admission.value ->> 'version' is distinct from '2'
      )
  then
    raise exception using errcode = '22023',
      message = 'invalid grok research v2 admission protocol version';
  end if;

  perform public.record_grok_specialist_roster_v2_as_server(
    p_organization_id,
    p_requested_by,
    p_project_id,
    p_session_id,
    p_message_id,
    p_roster_idempotency_key,
    3
  );

  return public.launch_grok_read_only_research_v1_as_server(
    p_organization_id,
    p_requested_by,
    p_project_id,
    p_session_id,
    p_message_id,
    p_idempotency_key,
    p_goal,
    p_topology,
    p_topology_reasons,
    p_risk_level,
    p_requires_owner_approval,
    p_nodes,
    p_edges,
    p_budget,
    p_roster_idempotency_key,
    p_admissions
  );
end;
$function$;

revoke all on function public.record_grok_specialist_roster_v1_as_server(
  uuid, uuid, uuid, uuid, uuid, text, bigint
) from public, anon, authenticated, service_role;
revoke all on function public.record_grok_specialist_roster_v2_as_server(
  uuid, uuid, uuid, uuid, uuid, text, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.record_grok_specialist_roster_v2_as_server(
  uuid, uuid, uuid, uuid, uuid, text, bigint
) to service_role;

revoke all on function public.launch_grok_full_lifecycle_v3_as_server(
  uuid, uuid, uuid, uuid, uuid, text, text, public.graph_topology, jsonb,
  public.risk_level, boolean, jsonb, jsonb, jsonb, uuid, text, text, jsonb,
  text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.launch_grok_full_lifecycle_v4_as_server(
  uuid, uuid, uuid, uuid, uuid, text, text, public.graph_topology, jsonb,
  public.risk_level, boolean, jsonb, jsonb, jsonb, uuid, text, text, jsonb,
  text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.launch_grok_full_lifecycle_v4_as_server(
  uuid, uuid, uuid, uuid, uuid, text, text, public.graph_topology, jsonb,
  public.risk_level, boolean, jsonb, jsonb, jsonb, uuid, text, text, jsonb,
  text, jsonb
) to service_role;

revoke all on function public.launch_grok_read_only_research_v1_as_server(
  uuid, uuid, uuid, uuid, uuid, text, text, public.graph_topology, jsonb,
  public.risk_level, boolean, jsonb, jsonb, jsonb, text, jsonb
) from public, anon, authenticated, service_role;
revoke all on function public.launch_grok_read_only_research_v2_as_server(
  uuid, uuid, uuid, uuid, uuid, text, text, public.graph_topology, jsonb,
  public.risk_level, boolean, jsonb, jsonb, jsonb, text, jsonb
) from public, anon, authenticated, service_role;
grant execute on function public.launch_grok_read_only_research_v2_as_server(
  uuid, uuid, uuid, uuid, uuid, text, text, public.graph_topology, jsonb,
  public.risk_level, boolean, jsonb, jsonb, jsonb, text, jsonb
) to service_role;
