-- ---------------------------------------------------------------------------
-- The artifacts a run recorded, readable by the members who own the run
-- ---------------------------------------------------------------------------
--
-- The owner's per-run stage page shows what a stage actually produced — the
-- typed stage package the node recorded, not a paraphrase of it. Until now
-- the only member-facing read, `list_graph_runs`, projected artifact *counts*
-- by design: a run listing needs to say an artifact exists, not carry its
-- body. The stage page asks the opposite question — "show me the recorded
-- result" — and that read did not exist. This adds it.
--
-- Deliberate bounds:
--   * Scoped to one run, and the run must belong to the caller's
--     organization; the same membership rule `list_graph_runs` applies, and
--     the run id alone is never enough.
--   * Payloads are returned verbatim. They are the worker's recorded stage
--     packages and observations — bounded by the node contracts that
--     validated them — and a reader deciding on a gate deserves the exact
--     recorded content, not a summary the browser invented.
--   * authenticated only. The worker writes artifacts through its own
--     *_as_worker functions; nothing here is for service_role, and anon has
--     no business reading run evidence.

create or replace function public.list_graph_run_artifacts(
  p_organization_id uuid,
  p_graph_run_id uuid
)
returns table (
  artifact_id uuid,
  node_run_id uuid,
  node_key text,
  kind text,
  payload jsonb,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = pg_catalog
as $function$
begin
  if not public.is_organization_member(p_organization_id) then
    raise exception using errcode = '42501', message = 'organization membership is required';
  end if;

  return query
  select
    artifact.id,
    artifact.node_run_id,
    node.node_key,
    artifact.kind::text,
    artifact.payload,
    artifact.created_at
  from public.graph_artifacts artifact
  join public.graph_runs run
    on run.id = artifact.graph_run_id
   and run.organization_id = p_organization_id
  left join public.node_runs node_run on node_run.id = artifact.node_run_id
  left join public.graph_nodes node on node.id = node_run.node_id
  where artifact.graph_run_id = p_graph_run_id
  order by artifact.created_at asc, artifact.id asc;
end;
$function$;

revoke all on function public.list_graph_run_artifacts(uuid, uuid)
  from public, anon, service_role;
grant execute on function public.list_graph_run_artifacts(uuid, uuid) to authenticated;

-- Postflight: the function exists with this signature, is a definer, and is
-- executable by authenticated alone among the API roles.
do $$
declare
  v_oid oid;
  v_secdef boolean;
begin
  select p.oid, p.prosecdef into v_oid, v_secdef
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname = 'list_graph_run_artifacts'
     and pg_get_function_identity_arguments(p.oid) = 'p_organization_id uuid, p_graph_run_id uuid';
  if v_oid is null then
    raise exception 'postflight: list_graph_run_artifacts(uuid, uuid) is missing';
  end if;
  if not v_secdef then
    raise exception 'postflight: list_graph_run_artifacts must be security definer';
  end if;
  if not has_function_privilege('authenticated', v_oid, 'execute') then
    raise exception 'postflight: authenticated cannot execute list_graph_run_artifacts';
  end if;
  if has_function_privilege('anon', v_oid, 'execute')
     or has_function_privilege('service_role', v_oid, 'execute') then
    raise exception 'postflight: only authenticated may execute list_graph_run_artifacts';
  end if;
end $$;
