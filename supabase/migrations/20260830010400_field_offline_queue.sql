-- ---------------------------------------------------------------------------
-- Increment 18 — the technician field app, offline-capable (ADR-210).
--
-- The last two rows the competitor matrix listed as buildable — "technician
-- mobile app" and "offline mode, full capacity without signal" — are one
-- feature, and it was left until last because its correctness bar is the
-- highest in the product.
--
-- A crawlspace has no signal. A technician finishes a visit, taps
-- complete, and drives away. Whatever happens next, ONE of these must be
-- true and the technician must know which:
--
--   * the visit is recorded, or
--   * the visit is visibly still unsent.
--
-- The failure that is worse than having no offline mode at all is the
-- third outcome: the tap appeared to work, the queue lost it, and nobody
-- finds out until a customer disputes an invoice for a visit the system
-- says never happened.
--
-- THE MECHANISM: every field write carries a client-generated token,
-- minted BEFORE the attempt and stored with the queued write. The token is
-- unique per organization. Replaying a write that already landed is a
-- no-op that returns the original outcome, so the client may retry
-- forever without fear — and retrying forever is exactly what an offline
-- queue does when a tunnel drops the connection mid-request.
--
-- The insert into crm_field_submissions IS the lock. `on conflict do
-- nothing` returning zero rows means somebody already did this work, and
-- the function returns what they got rather than doing it twice. There is
-- no read-then-write window for two retries to race through.
-- ---------------------------------------------------------------------------

do $$ begin
  create type public.crm_field_submission_kind as enum (
    'complete_work_order', 'device_scan', 'pest_sighting'
  );
exception when duplicate_object then null; end $$;

create table if not exists public.crm_field_submissions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,

  -- Minted on the device before the first attempt. This is the whole
  -- idempotency story: same token, same outcome, however many times it
  -- arrives.
  client_token uuid not null,
  kind public.crm_field_submission_kind not null,

  -- What the write produced, so a replay can return it without redoing
  -- anything. Null only for a submission that was refused.
  result_id uuid,

  -- The technician's own clock when they acted, which is NOT when the
  -- server heard about it. Both are kept: a visit completed at 09:12 in a
  -- crawlspace and synced at 14:40 in the depot car park is one fact with
  -- two timestamps, and collapsing them would misreport the work.
  occurred_at timestamptz not null,
  accepted_at timestamptz not null default now(),

  submitted_by uuid not null references auth.users(id) on delete restrict,

  constraint crm_field_submissions_sync_after_event
    check (accepted_at >= occurred_at - interval '1 minute')
);

-- The lock. Everything above depends on this being unique.
create unique index if not exists crm_field_submissions_org_token_key
  on public.crm_field_submissions (organization_id, client_token);
create index if not exists crm_field_submissions_org_accepted_idx
  on public.crm_field_submissions (organization_id, accepted_at desc);

-- ---------------------------------------------------------------------------
-- The completion trigger has to stop overwriting the technician's clock.
--
-- `crm_work_order_set_completed_at` (increment 3) set `completed_at :=
-- now()` unconditionally on the transition to completed. That was right
-- while every completion happened at a desk with a connection. It is
-- wrong the moment a visit can be completed in a crawlspace and synced
-- five hours later: the trigger would record every offline visit as having
-- happened when the van found signal.
--
-- That is not a cosmetic error. `completed_at` feeds technician
-- productivity (ADR-199), route density, and the service dates on
-- recurring invoices (ADR-200). An offline day would report every visit
-- bunched at the moment the queue drained.
--
-- So the trigger now DEFERS to an explicitly supplied moment and defaults
-- to now() only when the caller gave none. The behaviour for every
-- existing caller is unchanged: they do not set the column, so they still
-- get now().
--
-- A wrong device clock cannot exploit this. `crm_field_submissions` checks
-- `accepted_at >= occurred_at - interval '1 minute'`, so a submission
-- claiming the future is refused at the door, loudly, rather than being
-- silently clamped into something plausible.
-- ---------------------------------------------------------------------------

create or replace function public.crm_work_order_set_completed_at()
returns trigger
language plpgsql
set search_path = pg_catalog
as $$
begin
  if new.status = 'completed' then
    if tg_op = 'INSERT' or old.status is distinct from new.status then
      -- The caller's moment wins when there is one. On this transition the
      -- column is null unless somebody set it deliberately, because the
      -- else branch below clears it on the way out of 'completed'.
      new.completed_at := coalesce(new.completed_at, now());
    end if;
  else
    new.completed_at := null;
  end if;
  return new;
end;
$$;

revoke all on function public.crm_work_order_set_completed_at()
  from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Completing a visit from the field.
--
-- SECURITY INVOKER: the caller is a member, and every table this touches
-- already has policies that say what they may reach. A definer here would
-- be widening authority to buy nothing.
-- ---------------------------------------------------------------------------

create or replace function public.crm_field_complete_visit(
  p_token uuid,
  p_work_order uuid,
  p_occurred_at timestamptz,
  p_notes text default null
)
returns table (work_order_id uuid, replayed boolean)
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_org uuid;
  v_claimed uuid;
  v_existing uuid;
begin
  select organization_id into v_org from public.crm_work_orders where id = p_work_order;
  if v_org is null then
    -- RLS narrowed this away, so "not found" and "not yours" are the same
    -- answer on purpose.
    raise exception 'no such work order' using errcode = 'no_data_found';
  end if;

  -- Claim the token. A row back means we are the first to carry it; no row
  -- means somebody already did, and this is a retry of a write that landed.
  insert into public.crm_field_submissions
    (organization_id, client_token, kind, result_id, occurred_at, submitted_by)
  values (v_org, p_token, 'complete_work_order', p_work_order, p_occurred_at, auth.uid())
  on conflict (organization_id, client_token) do nothing
  returning id into v_claimed;

  if v_claimed is null then
    select s.result_id into v_existing
      from public.crm_field_submissions s
     where s.organization_id = v_org and s.client_token = p_token;
    -- The original outcome, not a second completion with a new timestamp.
    return query select v_existing, true;
    return;
  end if;

  update public.crm_work_orders
     set status = 'completed',
         completed_at = p_occurred_at,
         completion_notes = coalesce(p_notes, completion_notes)
   where id = p_work_order
     -- A visit already completed is not re-completed by a late arrival
     -- from a queue: its original moment stands.
     and status <> 'completed';

  return query select p_work_order, false;
end;
$$;

revoke all on function public.crm_field_complete_visit(uuid, uuid, timestamptz, text)
  from public, anon, service_role;
grant execute on function public.crm_field_complete_visit(uuid, uuid, timestamptz, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- A station scan from the field. Same token discipline; the scan ledger is
-- append-only, so a duplicate here would be a permanent double count.
-- ---------------------------------------------------------------------------

create or replace function public.crm_field_record_scan(
  p_token uuid,
  p_device uuid,
  p_occurred_at timestamptz,
  p_condition public.crm_device_condition default null,
  p_activity_count integer default null,
  p_pest_observed text default null,
  p_note text default null
)
returns table (device_event_id uuid, replayed boolean)
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_org uuid;
  v_claimed uuid;
  v_existing uuid;
  v_event uuid;
begin
  select organization_id into v_org from public.crm_devices where id = p_device;
  if v_org is null then
    raise exception 'no such station' using errcode = 'no_data_found';
  end if;

  insert into public.crm_field_submissions
    (organization_id, client_token, kind, occurred_at, submitted_by)
  values (v_org, p_token, 'device_scan', p_occurred_at, auth.uid())
  on conflict (organization_id, client_token) do nothing
  returning id into v_claimed;

  if v_claimed is null then
    select s.result_id into v_existing
      from public.crm_field_submissions s
     where s.organization_id = v_org and s.client_token = p_token;
    return query select v_existing, true;
    return;
  end if;

  insert into public.crm_device_events
    (organization_id, device_id, event, condition, activity_count, pest_observed,
     note, recorded_at, actor_user_id)
  values (v_org, p_device, 'service', p_condition, p_activity_count, p_pest_observed,
          p_note, p_occurred_at, auth.uid())
  returning id into v_event;

  -- The submission carries what it produced, so a later replay returns the
  -- same event rather than a null.
  update public.crm_field_submissions
     set result_id = v_event
   where id = v_claimed;

  return query select v_event, false;
end;
$$;

revoke all on function public.crm_field_record_scan(
  uuid, uuid, timestamptz, public.crm_device_condition, integer, text, text)
  from public, anon, service_role;
grant execute on function public.crm_field_record_scan(
  uuid, uuid, timestamptz, public.crm_device_condition, integer, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- What a technician's device still owes the server.
--
-- The client knows its own queue, but the SERVER's answer is the one that
-- settles an argument: given these tokens, which have you actually got?
-- A device coming back after a week offline asks this before deciding what
-- to replay, and a technician can be shown a number they can trust rather
-- than one their own storage computed.
-- ---------------------------------------------------------------------------

create or replace function public.crm_field_settled_tokens(p_tokens uuid[])
returns table (client_token uuid, kind public.crm_field_submission_kind, result_id uuid,
               occurred_at timestamptz, accepted_at timestamptz)
language sql
stable
security invoker
set search_path = pg_catalog, public
as $$
  select s.client_token, s.kind, s.result_id, s.occurred_at, s.accepted_at
    from public.crm_field_submissions s
   where s.client_token = any(p_tokens)
   limit 1000;
$$;

revoke all on function public.crm_field_settled_tokens(uuid[])
  from public, anon, service_role;
grant execute on function public.crm_field_settled_tokens(uuid[]) to authenticated;

-- ---------------------------------------------------------------------------
-- Row Level Security. The submission log is the evidence that a field
-- write was accepted, so it is append-only at the grant level: no update,
-- no delete. The functions above update `result_id` as their definer-free
-- selves, which works because the row was just inserted by the same
-- member in the same statement — and nothing else may.
-- ---------------------------------------------------------------------------

do $$
begin
  execute 'alter table public.crm_field_submissions enable row level security';
  execute 'alter table public.crm_field_submissions force row level security';
  execute 'revoke all on table public.crm_field_submissions
             from public, anon, authenticated, service_role';

  execute 'drop policy if exists crm_field_submissions_select_member on public.crm_field_submissions';
  execute 'create policy crm_field_submissions_select_member on public.crm_field_submissions
             for select to authenticated
             using (public.is_organization_member(organization_id))';

  execute 'drop policy if exists crm_field_submissions_insert_member on public.crm_field_submissions';
  execute 'create policy crm_field_submissions_insert_member on public.crm_field_submissions
             for insert to authenticated
             with check (public.is_organization_member(organization_id))';

  -- Only to fill in `result_id` on a row this member just claimed. There is
  -- deliberately no delete: a submission is the proof the work arrived.
  execute 'drop policy if exists crm_field_submissions_update_member on public.crm_field_submissions';
  execute 'create policy crm_field_submissions_update_member on public.crm_field_submissions
             for update to authenticated
             using (public.is_organization_member(organization_id))
             with check (public.is_organization_member(organization_id))';

  execute 'grant select, insert, update on table public.crm_field_submissions to authenticated';
end;
$$;
