-- Graph anchors: evidence that does not come from a model.
--
-- `lib/graph/anchors.ts` models the rule — a worker saying "the tests pass" is
-- a hypothesis, the test result is evidence — but until now that reasoning
-- lived only in memory. A claim checked once and then forgotten is not much
-- better than a claim never checked, because the next reader has no way to see
-- what it rested on.
--
-- Two decisions here are load-bearing:
--
-- 1. **The database decides whether a claim is anchored.** `record_claim_anchoring`
--    is handed anchor IDs, not a verdict. It looks each one up, checks the kind
--    is acceptable for the claim and that the observation actually passed, and
--    computes `anchored` itself. A caller cannot assert that its claim is
--    supported; it can only offer evidence and be told. This is the same shape
--    as the rest of the engine: the thing being judged does not supply the
--    verdict.
--
-- 2. **Anchors are append-only and carry no provider column.** There is
--    deliberately nowhere to record "which model produced this observation",
--    because a model producing it would disqualify it. The absence is the
--    constraint.

-- ---------------------------------------------------------------------------
-- Vocabulary
-- ---------------------------------------------------------------------------

create type public.anchor_kind as enum (
  'test_run',
  'ci_check',
  'deployment_state',
  'http_health',
  'database_query',
  'synthetic_journey',
  'repository_diff',
  'security_scan',
  'production_error_signal'
);

create type public.anchored_claim as enum (
  'TESTS_PASS',
  'BUILD_SUCCEEDS',
  'LINT_CLEAN',
  'TYPECHECK_CLEAN',
  'DEPLOYED',
  'SERVICE_HEALTHY',
  'MIGRATION_APPLIED',
  'NO_SECURITY_FINDINGS',
  'CHANGE_LANDED'
);

-- ---------------------------------------------------------------------------
-- Observations
-- ---------------------------------------------------------------------------

create table public.graph_anchors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  graph_run_id uuid not null,
  -- Optional: an anchor can belong to the run as a whole (a CI result for the
  -- branch) rather than to one node.
  node_run_id uuid,
  kind public.anchor_kind not null,
  source text not null check (char_length(btrim(source)) between 1 and 500),
  -- When the world was observed, not when someone got around to recording it.
  -- Freshness is judged against this, so the distinction matters.
  observed_at timestamptz not null,
  -- Null means the anchor reports state without a success notion. It must never
  -- be coerced to false, which would turn "unknown" into "failed".
  passed boolean,
  reference text check (reference is null or char_length(reference) <= 2000),
  detail text not null check (char_length(btrim(detail)) between 1 and 2000),
  created_at timestamptz not null default now(),
  constraint graph_anchors_id_organization_unique unique (id, organization_id),
  constraint graph_anchors_run_fk foreign key (graph_run_id, organization_id)
    references public.graph_runs(id, organization_id) on delete cascade,
  constraint graph_anchors_node_run_fk foreign key (node_run_id, organization_id)
    references public.node_runs(id, organization_id) on delete cascade,
  -- An observation dated in the future is a clock problem or a fabrication, and
  -- either way it must not be usable as fresh evidence.
  constraint graph_anchors_not_future check (observed_at <= now() + interval '5 minutes')
);

create index graph_anchors_run_idx on public.graph_anchors (graph_run_id, observed_at desc);
create index graph_anchors_node_run_idx on public.graph_anchors (node_run_id)
  where node_run_id is not null;

-- ---------------------------------------------------------------------------
-- Claims, and what they rest on
-- ---------------------------------------------------------------------------

create table public.node_run_claims (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  node_run_id uuid not null,
  claim public.anchored_claim not null,
  -- Computed by record_claim_anchoring, never supplied by the caller.
  anchored boolean not null,
  reason text not null check (char_length(btrim(reason)) between 1 and 2000),
  created_at timestamptz not null default now(),
  constraint node_run_claims_id_organization_unique unique (id, organization_id),
  -- One verdict per claim per node run. A second attempt at the same claim
  -- replaces nothing; it is refused, so a failed anchoring cannot be quietly
  -- retried until it passes.
  constraint node_run_claims_unique unique (node_run_id, claim),
  constraint node_run_claims_node_run_fk foreign key (node_run_id, organization_id)
    references public.node_runs(id, organization_id) on delete cascade
);

create index node_run_claims_node_run_idx on public.node_run_claims (node_run_id);

-- The join is the audit trail: which observations were accepted as supporting
-- which claim. Without it, "anchored = true" is another bare assertion.
create table public.claim_anchors (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  claim_id uuid not null,
  anchor_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (claim_id, anchor_id),
  constraint claim_anchors_claim_fk foreign key (claim_id, organization_id)
    references public.node_run_claims(id, organization_id) on delete cascade,
  constraint claim_anchors_anchor_fk foreign key (anchor_id, organization_id)
    references public.graph_anchors(id, organization_id) on delete cascade
);

create index claim_anchors_anchor_idx on public.claim_anchors (anchor_id);

-- ---------------------------------------------------------------------------
-- Which observations can support which claim
-- ---------------------------------------------------------------------------
--
-- This mirrors CLAIM_ACCEPTABLE_ANCHORS in lib/graph/anchors.ts. The mapping is
-- duplicated here rather than passed in by the caller, deliberately: this is a
-- security boundary, and a caller that could declare what counts as acceptable
-- evidence could anchor anything with anything.
--
-- The cost of duplication is drift, so it is paid for by a test —
-- tests/integration/graph-anchors-persistence.test.ts reads both and fails if
-- they disagree. Drift becomes a red build rather than a silent divergence.

create table public.claim_acceptable_anchors (
  claim public.anchored_claim not null,
  kind public.anchor_kind not null,
  primary key (claim, kind)
);

insert into public.claim_acceptable_anchors (claim, kind) values
  ('TESTS_PASS', 'test_run'),
  ('TESTS_PASS', 'ci_check'),
  ('BUILD_SUCCEEDS', 'test_run'),
  ('BUILD_SUCCEEDS', 'ci_check'),
  ('LINT_CLEAN', 'test_run'),
  ('LINT_CLEAN', 'ci_check'),
  ('TYPECHECK_CLEAN', 'test_run'),
  ('TYPECHECK_CLEAN', 'ci_check'),
  ('DEPLOYED', 'deployment_state'),
  ('SERVICE_HEALTHY', 'http_health'),
  ('SERVICE_HEALTHY', 'synthetic_journey'),
  ('SERVICE_HEALTHY', 'production_error_signal'),
  ('MIGRATION_APPLIED', 'database_query'),
  ('NO_SECURITY_FINDINGS', 'security_scan'),
  ('CHANGE_LANDED', 'repository_diff'),
  ('CHANGE_LANDED', 'ci_check');

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.graph_anchors enable row level security;
alter table public.graph_anchors force row level security;
alter table public.node_run_claims enable row level security;
alter table public.node_run_claims force row level security;
alter table public.claim_anchors enable row level security;
alter table public.claim_anchors force row level security;
alter table public.claim_acceptable_anchors enable row level security;
alter table public.claim_acceptable_anchors force row level security;

create policy graph_anchors_member_select on public.graph_anchors
  for select using (public.is_organization_member(organization_id));

create policy node_run_claims_member_select on public.node_run_claims
  for select using (public.is_organization_member(organization_id));

create policy claim_anchors_member_select on public.claim_anchors
  for select using (public.is_organization_member(organization_id));

-- The mapping is not tenant data; it is the vocabulary. Readable by any signed
-- in caller so the UI can explain why a claim was refused, writable by nobody.
create policy claim_acceptable_anchors_read on public.claim_acceptable_anchors
  for select to authenticated using (true);

grant select on public.graph_anchors to authenticated;
grant select on public.node_run_claims to authenticated;
grant select on public.claim_anchors to authenticated;
grant select on public.claim_acceptable_anchors to authenticated;

-- No insert, update or delete grant to any browser role, on purpose. Every
-- write goes through the SECURITY DEFINER functions below.

-- ---------------------------------------------------------------------------
-- Write boundary
-- ---------------------------------------------------------------------------

-- Record one observation. Deliberately dumb: it stores what was seen and makes
-- no judgement about what the observation supports.
create or replace function public.record_anchor(
  p_graph_run_id uuid,
  p_kind public.anchor_kind,
  p_source text,
  p_observed_at timestamptz,
  p_detail text,
  p_passed boolean default null,
  p_reference text default null,
  p_node_run_id uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_run public.graph_runs;
  v_anchor_id uuid;
begin
  select * into v_run from public.graph_runs where id = p_graph_run_id;

  if v_run.id is null or not public.is_organization_member(v_run.organization_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  if p_node_run_id is not null then
    perform 1 from public.node_runs
      where id = p_node_run_id and graph_run_id = p_graph_run_id;
    if not found then
      raise exception 'node_run_not_in_run' using errcode = '23503';
    end if;
  end if;

  insert into public.graph_anchors (
    organization_id, graph_run_id, node_run_id, kind, source,
    observed_at, passed, reference, detail
  )
  values (
    v_run.organization_id, p_graph_run_id, p_node_run_id, p_kind, p_source,
    p_observed_at, p_passed, p_reference, p_detail
  )
  returning id into v_anchor_id;

  return v_anchor_id;
end;
$$;

-- Decide whether a claim is anchored, from evidence, and record the decision.
--
-- The caller offers anchor IDs. It does not get to say whether they are good
-- enough — that is computed here from the kind mapping and the observations'
-- own `passed` values, and the reason is stored alongside so a later reader can
-- see the reasoning rather than re-deriving it.
create or replace function public.record_claim_anchoring(
  p_node_run_id uuid,
  p_claim public.anchored_claim,
  p_anchor_ids uuid[] default '{}'::uuid[]
)
returns table (claim_id uuid, anchored boolean, reason text)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_node_run public.node_runs;
  v_acceptable_count integer;
  v_relevant_count integer;
  v_failing_count integer;
  v_supporting_count integer;
  v_state_only_count integer;
  v_anchored boolean;
  v_reason text;
  v_claim_id uuid;
  v_acceptable_kinds text;
begin
  select * into v_node_run from public.node_runs where id = p_node_run_id;

  if v_node_run.id is null or not public.is_organization_member(v_node_run.organization_id) then
    raise exception 'not_a_member' using errcode = '42501';
  end if;

  -- Anchors must belong to the same organization and the same run. Evidence
  -- borrowed from another run is not evidence about this one.
  create temporary table if not exists _offered_anchors (
    id uuid primary key,
    kind public.anchor_kind not null,
    passed boolean
  ) on commit drop;
  delete from _offered_anchors;

  insert into _offered_anchors (id, kind, passed)
  select a.id, a.kind, a.passed
    from public.graph_anchors a
   where a.id = any(p_anchor_ids)
     and a.organization_id = v_node_run.organization_id
     and a.graph_run_id = v_node_run.graph_run_id;

  select count(*) into v_acceptable_count
    from public.claim_acceptable_anchors where claim = p_claim;

  select string_agg(kind::text, ' or ' order by kind::text) into v_acceptable_kinds
    from public.claim_acceptable_anchors where claim = p_claim;

  select count(*) into v_relevant_count
    from _offered_anchors o
    join public.claim_acceptable_anchors m
      on m.claim = p_claim and m.kind = o.kind;

  select count(*) into v_failing_count
    from _offered_anchors o
    join public.claim_acceptable_anchors m
      on m.claim = p_claim and m.kind = o.kind
   where o.passed is false;

  select count(*) into v_supporting_count
    from _offered_anchors o
    join public.claim_acceptable_anchors m
      on m.claim = p_claim and m.kind = o.kind
   where o.passed is true;

  v_state_only_count := v_relevant_count - v_failing_count - v_supporting_count;

  if v_acceptable_count = 0 then
    v_anchored := false;
    v_reason := format('No observation kind can support "%s".', p_claim);
  elsif v_relevant_count = 0 then
    v_anchored := false;
    v_reason := format(
      'No %s evidence was attached, so "%s" is an assertion rather than an observation.',
      coalesce(v_acceptable_kinds, 'acceptable'), p_claim
    );
  elsif v_failing_count > 0 then
    -- Evidence against is still evidence. "We ran the tests" must never become
    -- "the tests pass".
    v_anchored := false;
    v_reason := format(
      'Evidence exists and contradicts the claim: %s observation(s) did not pass.',
      v_failing_count
    );
  elsif v_supporting_count = 0 then
    v_anchored := false;
    v_reason := format(
      'Evidence exists but reports state rather than success (%s observation(s)), so it cannot support "%s".',
      v_state_only_count, p_claim
    );
  else
    v_anchored := true;
    v_reason := format('Supported by %s observation(s).', v_supporting_count);
  end if;

  insert into public.node_run_claims (
    organization_id, node_run_id, claim, anchored, reason
  )
  values (
    v_node_run.organization_id, p_node_run_id, p_claim, v_anchored, v_reason
  )
  returning id into v_claim_id;

  -- Only the observations that actually supported it are linked. Linking the
  -- contradicting ones would make the audit trail read as if they helped.
  insert into public.claim_anchors (organization_id, claim_id, anchor_id)
  select v_node_run.organization_id, v_claim_id, o.id
    from _offered_anchors o
    join public.claim_acceptable_anchors m
      on m.claim = p_claim and m.kind = o.kind
   where o.passed is true;

  return query select v_claim_id, v_anchored, v_reason;
end;
$$;

revoke all on function public.record_anchor(
  uuid, public.anchor_kind, text, timestamptz, text, boolean, text, uuid
) from public, anon;
grant execute on function public.record_anchor(
  uuid, public.anchor_kind, text, timestamptz, text, boolean, text, uuid
) to authenticated;

revoke all on function public.record_claim_anchoring(
  uuid, public.anchored_claim, uuid[]
) from public, anon;
grant execute on function public.record_claim_anchoring(
  uuid, public.anchored_claim, uuid[]
) to authenticated;

-- ---------------------------------------------------------------------------
-- Attaching evidence to a verification
-- ---------------------------------------------------------------------------

alter table public.graph_verifications
  add column anchor_count integer not null default 0 check (anchor_count >= 0);

comment on column public.graph_verifications.anchor_count is
  'How many non-model observations backed this verdict. Zero means the verifier reasoned without evidence, which is a fact worth being able to query.';
