-- Clear the Runs page in one action, without weakening a single per-run rule.
--
-- `delete_agent_run` (20260817000300) already answers what deleting one run
-- means: owner-only, reason required, live work refused, external evidence
-- kept unless detachment is explicit, and the deletion recorded before it
-- happens in a table with no key back to the run. Clearing all finished runs
-- is that same decision applied to each finished run — so this function calls
-- the per-run path for every terminal run and counts what it refused, rather
-- than reimplementing (and inevitably diverging from) those guards.
--
-- A run the per-run path refuses is skipped and counted, never forced: with
-- detachment off, runs whose work produced pull requests, deployments or test
-- runs stay, and the caller is told how many. Queued and running work is
-- untouched by construction — only terminal statuses enter the loop.

create or replace function public.delete_finished_agent_runs(
  p_organization_id uuid,
  p_reason text,
  p_detach_evidence boolean default false
)
returns table (
  deleted_count integer,
  kept_for_evidence integer,
  kept_for_activity integer
)
language plpgsql
security definer
set search_path = pg_catalog
as $function$
declare
  run_row record;
  removed integer := 0;
  kept_evidence integer := 0;
  kept_active integer := 0;
begin
  if auth.uid() is null then
    raise exception using errcode = '42501', message = 'authentication is required';
  end if;
  -- Mirrors the per-run rule; the per-run function re-checks on every call.
  if not public.is_organization_owner(p_organization_id) then
    raise exception using errcode = '42501',
      message = 'only an organization owner may clear finished runs';
  end if;

  for run_row in
    select run.id from public.agent_runs run
    where run.organization_id = p_organization_id
      and run.status in (
        'succeeded'::public.run_status,
        'failed'::public.run_status,
        'cancelled'::public.run_status
      )
    order by run.created_at
  loop
    begin
      perform public.delete_agent_run(
        p_organization_id, run_row.id, p_reason, p_detach_evidence
      );
      removed := removed + 1;
    exception
      when foreign_key_violation then
        -- The per-run path refused because the run's work exists outside it.
        kept_evidence := kept_evidence + 1;
      when sqlstate '55000' then
        -- The run became active between the select and the delete.
        kept_active := kept_active + 1;
    end;
  end loop;

  return query select removed, kept_evidence, kept_active;
end;
$function$;

revoke all on function public.delete_finished_agent_runs(uuid, text, boolean) from public, anon;
grant execute on function public.delete_finished_agent_runs(uuid, text, boolean) to authenticated;
