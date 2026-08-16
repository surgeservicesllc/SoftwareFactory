-- A queued command plans against the exact main HEAD at submission, but on a
-- continuously merging repository that plan is stale before any worker beat
-- can claim it: on 2026-08-16 three live owner commands died `stale_base_sha`
-- without ever executing, because the loop's own fix merges kept moving main.
--
-- Re-planning is honest only while nothing was ever built on the old base.
-- The guard is structural, not advisory: the run must still be held by the
-- calling worker's live lease and must hold no commit (`head_sha is null`).
-- The worker separately refuses to proceed when a remote factory branch
-- exists, so a re-planned run can never orphan pushed work. The command's
-- own submitted parameters are untouched — the run row is the execution
-- record, and the worker writes a `replanned_base` run event naming both
-- SHAs so the move is audit-visible.
--
-- Idempotent: this file is on the surgical apply path and may be replayed.

create or replace function public.replan_phase1c_run(
  p_worker_id text,
  p_run_id uuid,
  p_lease_token uuid,
  p_base_sha text
)
returns boolean
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_updated integer;
begin
  if p_base_sha is null or p_base_sha !~ '^[0-9a-f]{40}$' then
    return false;
  end if;
  update public.agent_runs
  set base_sha = p_base_sha, updated_at = now()
  where id = p_run_id
    and status = 'running'::public.run_status
    and lease_worker_id = p_worker_id
    and lease_token = p_lease_token
    and lease_expires_at > now()
    and head_sha is null
    and base_sha is distinct from p_base_sha;
  get diagnostics v_updated = row_count;
  return v_updated > 0;
end;
$function$;

revoke all on function public.replan_phase1c_run(text, uuid, uuid, text)
  from public, anon, authenticated;
grant execute on function public.replan_phase1c_run(text, uuid, uuid, text) to service_role;
