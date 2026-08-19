-- One rate-limited probe must not erase the last real measurement.
--
-- Usage observations are append-only, and the Bot Manager read only the
-- newest row per account. So the moment a probe failed — the provider
-- answered HTTP 429 on 2026-08-19 while the auth-broker was probing at its
-- push-triggered cadence — the console dropped the real numbers it had shown
-- minutes earlier and replaced them with an amber failure line, beside a green
-- Connected badge. The account was fine; the page said otherwise.
--
-- The list now returns two things per account: the latest observation (still
-- the truth about the most recent probe) and the latest MEASURED observation
-- (the last numbers the provider actually reported). The console renders the
-- numbers with their own timestamp and names the newer failed probe in a
-- side note, which is more truthful than either hiding the failure or hiding
-- the measurement.
--
-- Replay-safe: this file and 20260816001500 both define the function, so both
-- carry a guarded drop — `create or replace` cannot change a return table,
-- which is exactly how apply run 32272188607 broke on list_graph_runs.

drop function if exists public.list_ai_account_usage(uuid);

create function public.list_ai_account_usage(p_organization_id uuid)
returns table (
  usage_account_id uuid,
  usage_observed_at timestamptz,
  usage_status text,
  usage_windows jsonb,
  usage_detail text,
  usage_measured_at timestamptz,
  usage_measured_windows jsonb
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
    latest.ai_account_id,
    latest.observed_at,
    latest.status,
    latest.windows,
    latest.detail,
    measured.observed_at,
    measured.windows
  from (
    select distinct on (o.ai_account_id)
      o.ai_account_id, o.observed_at, o.status, o.windows, o.detail
    from public.ai_account_usage_observations o
    where o.organization_id = p_organization_id
    order by o.ai_account_id, o.observed_at desc
  ) latest
  left join lateral (
    select m.observed_at, m.windows
    from public.ai_account_usage_observations m
    where m.organization_id = p_organization_id
      and m.ai_account_id = latest.ai_account_id
      and m.status = 'measured'
    order by m.observed_at desc
    limit 1
  ) measured on true;
end;
$function$;

revoke all on function public.list_ai_account_usage(uuid)
  from public, anon, service_role;
grant execute on function public.list_ai_account_usage(uuid) to authenticated;
