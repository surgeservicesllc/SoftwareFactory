-- Forward-only containment for legacy graph artifacts that predate the
-- sensitive-payload and size guards. The original payload is removed; only a
-- bounded digest and classification evidence are retained in a
-- private, immutable audit table.

-- The committed 00150 fence makes every legacy graph mutator unreachable. Lock
-- the remaining state while this one transaction classifies and contains the
-- exact rows selected by the protected release workflow.
--
-- The transaction is opened explicitly: the hosted apply ran under psql's
-- single-transaction wrap, but the Supabase CLI executes a migration
-- statement by statement, where a bare LOCK TABLE is refused (25P01). An
-- explicit begin/commit locks correctly in both, and a runner that already
-- holds a transaction only reports the begin as redundant.
begin;
lock table public.organizations, public.projects, public.phase1c_workers,
  public.graph_runs, public.agent_runs, public.node_runs in share mode;
lock table public.graph_artifacts, public.graph_verifications
  in access exclusive mode;

do $graph_artifact_containment_preflight$
declare
  ledger_state text;
  legacy_fence_exact boolean;
  owner_gate_exact boolean := true;
  v2_present boolean;
begin
  if pg_catalog.to_regclass('supabase_migrations.schema_migrations') is not null then
    execute $ledger$
      select
        (select pg_catalog.count(*) from supabase_migrations.schema_migrations
          where version = '20260827000150') || '|' ||
        (select pg_catalog.count(*) from supabase_migrations.schema_migrations
          where version = '20260827000200') || '|' ||
        (select pg_catalog.count(*) from supabase_migrations.schema_migrations
          where version = '20260827000210')
    $ledger$ into ledger_state;

    -- Hosted containment runs before 00200 (1|0|0). A clean chronological
    -- replay reaches this later forward migration after 00200 (1|1|0).
    if ledger_state not in ('1|0|0', '1|1|0') then
      raise exception using errcode = '55000',
        message = 'graph artifact containment ledger identity is not exact';
    end if;
  end if;

  v2_present := pg_catalog.to_regprocedure(
    'public.claim_planned_graph_v2(text,text[],text,jsonb,integer)'
  ) is not null;

  with expected(signature, owner_gate) as (values
      ('public.start_graph_run(uuid)', false),
      ('public.claim_planned_graph(text,text[])', false),
      ('public.claim_phase1c_run(text,text,text,integer)', false),
      ('public.decide_node_gate(uuid,boolean,text)', true),
      ('public.record_node_state(uuid,public.graph_node_state,text,text,text,integer)', false),
      ('public.complete_graph_run(uuid,public.graph_run_state,boolean,bigint,bigint,text)', false),
      ('public.record_handoff(uuid,uuid,jsonb,boolean,jsonb,uuid,jsonb,jsonb,jsonb,text)', false),
      ('public.record_graph_artifact(uuid,public.graph_artifact_kind,jsonb,uuid,integer,integer)', false),
      ('public.record_verification(uuid,public.verification_lens,public.verification_verdict,jsonb,uuid,text,boolean)', false)
    ), routines as (
      select owner_gate, pg_catalog.to_regprocedure(signature) as routine
      from expected
    )
    select pg_catalog.count(routine) = 9
      and pg_catalog.bool_and(
        not pg_catalog.has_function_privilege('anon', routine, 'EXECUTE')
        and not pg_catalog.has_function_privilege('service_role', routine, 'EXECUTE')
        and case
          when v2_present and owner_gate then
            pg_catalog.has_function_privilege('authenticated', routine, 'EXECUTE')
          else
            not pg_catalog.has_function_privilege('authenticated', routine, 'EXECUTE')
        end
      )
      and not exists (
        select 1
        from routines expected_routine
        join pg_catalog.pg_proc routine_catalog
          on routine_catalog.oid = expected_routine.routine
        where pg_catalog.pg_get_userbyid(routine_catalog.proowner) <> 'postgres'
          or routine_catalog.proacl is null
          or (select pg_catalog.count(*)
              from pg_catalog.aclexplode(routine_catalog.proacl)) <>
            case when v2_present and expected_routine.owner_gate then 2 else 1 end
          or not exists (
            select 1 from pg_catalog.aclexplode(routine_catalog.proacl) privilege
            where privilege.grantor = routine_catalog.proowner
              and privilege.grantee = routine_catalog.proowner
              and privilege.privilege_type = 'EXECUTE'
              and not privilege.is_grantable
          )
          or (
            v2_present and expected_routine.owner_gate and not exists (
              select 1 from pg_catalog.aclexplode(routine_catalog.proacl) privilege
              where privilege.grantor = routine_catalog.proowner
                and privilege.grantee = pg_catalog.to_regrole('authenticated')::oid
                and privilege.privilege_type = 'EXECUTE'
                and not privilege.is_grantable
            )
          )
          or exists (
            select 1 from pg_catalog.aclexplode(routine_catalog.proacl) privilege
            where privilege.grantor <> routine_catalog.proowner
               or privilege.privilege_type <> 'EXECUTE'
               or privilege.is_grantable
               or privilege.grantee not in (
                 routine_catalog.proowner,
                 case when v2_present and expected_routine.owner_gate
                   then pg_catalog.to_regrole('authenticated')::oid
                   else routine_catalog.proowner
                 end
               )
          )
      ) into legacy_fence_exact
    from routines;

  -- 00200 deliberately reuses decide_node_gate for the owner-only manual
  -- decision surface. Once v2 exists, accept that one exact replacement (not
  -- the legacy worker authority) only when its definer and evidence guards are
  -- present; the other eight legacy signatures remain fully revoked.
  if v2_present then
    select
      routine.prosecdef
      and routine.proconfig = array['search_path=pg_catalog']::text[]
      and pg_catalog.strpos(
        pg_catalog.pg_get_functiondef(routine.oid),
        'full lifecycle release gates require evidence-bound approval'
      ) > 0
      and pg_catalog.strpos(
        pg_catalog.pg_get_functiondef(routine.oid),
        'owner or admin role is required to decide a gate'
      ) > 0
      and pg_catalog.strpos(
        pg_catalog.pg_get_functiondef(routine.oid),
        'automatic gate approval is worker-only and evidence-bound'
      ) > 0
    into owner_gate_exact
    from pg_catalog.pg_proc routine
    where routine.oid = pg_catalog.to_regprocedure(
      'public.decide_node_gate(uuid,boolean,text)'
    );
    legacy_fence_exact := legacy_fence_exact
      and coalesce(owner_gate_exact, false);
  end if;

  if not legacy_fence_exact then
    raise exception using errcode = '55000',
      message = 'legacy graph protocol authority fence is not committed';
  elsif ledger_state = '1|0|0' and v2_present then
    raise exception using errcode = '55000',
      message = 'pre-lineage graph catalog identity is not exact';
  elsif ledger_state = '1|1|0' and not v2_present then
    raise exception using errcode = '55000',
      message = 'clean replay is missing the committed v2 graph protocol';
  end if;

  if exists (
    select 1 from public.organizations organization
    where organization.autonomous_mode
       or not organization.autonomy_kill_switch_active
       or organization.auto_plan or organization.auto_code
       or organization.auto_test or organization.auto_repair
       or organization.auto_review or organization.auto_approve
       or organization.auto_merge or organization.auto_deploy
       or organization.auto_rollback
  ) or exists (
    select 1 from public.projects project
    where project.autonomous_mode
       or project.auto_plan or project.auto_code
       or project.auto_test or project.auto_repair
       or project.auto_review or project.auto_approve
       or project.auto_merge or project.auto_deploy
       or project.auto_rollback
  ) or exists (
    select 1 from public.phase1c_workers worker
    where worker.status in ('active', 'draining')
      and worker.last_heartbeat_at > pg_catalog.now() - interval '5 minutes'
  ) or exists (
    select 1 from public.graph_runs
    where state = 'RUNNING'::public.graph_run_state
  ) or exists (
    select 1 from public.agent_runs
    where status = 'running'::public.run_status
  ) then
    raise exception using errcode = '55000',
      message = 'graph artifact containment requires the fully stopped safety state';
  end if;

  if exists (
    select 1
    from public.graph_artifacts artifact
    left join public.node_runs node_run
      on node_run.id = artifact.node_run_id
     and node_run.organization_id = artifact.organization_id
    where artifact.node_run_id is not null
      and (node_run.id is null
        or artifact.graph_run_id is distinct from node_run.graph_run_id)
  ) then
    raise exception using errcode = '55000',
      message = 'legacy graph artifact has contradictory node/run identity';
  end if;

  if exists (
    select 1 from public.graph_artifacts artifact
    where artifact.node_run_id is not null
    group by artifact.node_run_id, artifact.kind
    having pg_catalog.count(*) > 1
  ) then
    raise exception using errcode = '55000',
      message = 'legacy graph artifact product slot is ambiguous';
  end if;

  if exists (
    select 1
    from public.graph_verifications verification
    left join public.node_runs subject
      on subject.id = verification.subject_node_run_id
     and subject.organization_id = verification.organization_id
    where subject.id is null
       or verification.graph_run_id is distinct from subject.graph_run_id
  ) then
    raise exception using errcode = '55000',
      message = 'legacy graph verification has contradictory subject/run identity';
  end if;

  if exists (
    select 1
    from public.graph_verifications verification
    where case
      when verification.evidence is null
        or pg_catalog.jsonb_typeof(verification.evidence) <> 'array' then true
      when pg_catalog.pg_column_size(verification.evidence) > 32768
        or pg_catalog.jsonb_array_length(verification.evidence) > 64
        or public.jsonb_has_sensitive_keys(verification.evidence) then true
      else exists (
        select 1
        from pg_catalog.jsonb_array_elements(verification.evidence) item(value)
        where pg_catalog.jsonb_typeof(item.value) <> 'string'
           or pg_catalog.char_length(item.value #>> '{}') > 1000
      )
    end
  ) then
    raise exception using errcode = '55000',
      message = 'legacy graph verification evidence is unsafe';
  end if;
end;
$graph_artifact_containment_preflight$;

create table public.graph_artifact_payload_containments (
  id uuid primary key default gen_random_uuid(),
  artifact_id uuid not null unique,
  organization_id uuid not null,
  graph_run_id uuid not null,
  node_run_id uuid,
  artifact_kind public.graph_artifact_kind not null,
  original_payload_sha256 text not null check (
    original_payload_sha256 ~ '^[0-9a-f]{64}$'
  ),
  original_payload_octets bigint not null check (original_payload_octets >= 0),
  sensitive_data_detected boolean not null,
  size_limit_exceeded boolean not null,
  reason text not null check (
    reason = 'legacy_sensitive_or_oversized_graph_artifact'
  ),
  contained_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint graph_artifact_payload_containments_reason_present check (
    sensitive_data_detected or size_limit_exceeded
  )
);

comment on table public.graph_artifact_payload_containments is
  'Private immutable audit evidence for forward-only removal of legacy sensitive or oversized graph artifact payloads. Stores no original payload.';

alter table public.graph_artifact_payload_containments enable row level security;
alter table public.graph_artifact_payload_containments force row level security;
revoke all on table public.graph_artifact_payload_containments
  from public, anon, authenticated, service_role;

create or replace function public.enforce_graph_artifact_payload_containment_immutable()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  raise exception using errcode = '55000',
    message = 'graph artifact payload containment evidence is immutable';
end;
$function$;

revoke all on function public.enforce_graph_artifact_payload_containment_immutable()
  from public, anon, authenticated, service_role;

create trigger graph_artifact_payload_containments_immutable
  before update or delete or truncate on public.graph_artifact_payload_containments
  for each statement
  execute function public.enforce_graph_artifact_payload_containment_immutable();

with offending as (
  select
    artifact.id,
    artifact.organization_id,
    artifact.graph_run_id,
    artifact.node_run_id,
    artifact.kind,
    pg_catalog.encode(
      pg_catalog.sha256(pg_catalog.convert_to(artifact.payload::text, 'UTF8')),
      'hex'
    ) as payload_sha256,
    pg_catalog.octet_length(artifact.payload::text) as payload_octets,
    public.jsonb_has_sensitive_keys(artifact.payload) as has_sensitive_data
  from public.graph_artifacts artifact
  where public.jsonb_has_sensitive_keys(artifact.payload)
     or pg_catalog.octet_length(artifact.payload::text) > 1048576
)
insert into public.graph_artifact_payload_containments (
  artifact_id,
  organization_id,
  graph_run_id,
  node_run_id,
  artifact_kind,
  original_payload_sha256,
  original_payload_octets,
  sensitive_data_detected,
  size_limit_exceeded,
  reason
)
select
  offending.id,
  offending.organization_id,
  offending.graph_run_id,
  offending.node_run_id,
  offending.kind,
  offending.payload_sha256,
  offending.payload_octets,
  offending.has_sensitive_data,
  offending.payload_octets > 1048576,
  'legacy_sensitive_or_oversized_graph_artifact'
from offending;

update public.graph_artifacts artifact
set payload = pg_catalog.jsonb_build_object(
  'contained', true,
  'containmentEvidenceId', containment.id,
  'reason', 'legacy_artifact_policy_violation'
)
from public.graph_artifact_payload_containments containment
where containment.artifact_id = artifact.id
  and (
    public.jsonb_has_sensitive_keys(artifact.payload)
    or pg_catalog.octet_length(artifact.payload::text) > 1048576
  );

-- Hold the safe tombstone boundary closed until unchanged migration 00200
-- installs the complete v2 worker surface and recreates this same guard.
create or replace function public.enforce_graph_artifact_update_immutable()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog
as $function$
begin
  raise exception using errcode = '55000',
    message = 'graph artifacts are immutable audit evidence';
end;
$function$;

revoke all on function public.enforce_graph_artifact_update_immutable()
  from public, anon, authenticated, service_role;

drop trigger if exists graph_artifacts_update_immutable on public.graph_artifacts;
create trigger graph_artifacts_update_immutable
  before update on public.graph_artifacts
  for each row execute function public.enforce_graph_artifact_update_immutable();

revoke insert, update, delete, truncate, references, trigger on table
  public.graph_artifacts, public.graph_verifications
from public, anon, authenticated, service_role;

do $graph_artifact_payload_constraints$
begin
  if not exists (
    select 1
    from pg_catalog.pg_constraint constraint_catalog
    where constraint_catalog.conname = 'graph_artifacts_payload_size_bounded'
      and constraint_catalog.conrelid = 'public.graph_artifacts'::regclass
  ) then
    alter table public.graph_artifacts
      add constraint graph_artifacts_payload_size_bounded
      check (pg_catalog.octet_length(payload::text) <= 1048576) not valid;
  end if;
end;
$graph_artifact_payload_constraints$;

alter table public.graph_artifacts
  validate constraint graph_artifacts_payload_no_sensitive_data;
alter table public.graph_artifacts
  validate constraint graph_artifacts_payload_size_bounded;

do $graph_artifact_payload_containment_postflight$
begin
  if exists (
    select 1
    from public.graph_artifacts artifact
    where public.jsonb_has_sensitive_keys(artifact.payload)
       or pg_catalog.octet_length(artifact.payload::text) > 1048576
  ) then
    raise exception using errcode = '55000',
      message = 'legacy graph artifact payload containment did not converge';
  end if;

  if exists (
    select 1
    from public.graph_artifact_payload_containments containment
    join public.graph_artifacts artifact on artifact.id = containment.artifact_id
    where artifact.payload is distinct from pg_catalog.jsonb_build_object(
      'contained', true,
      'containmentEvidenceId', containment.id,
      'reason', 'legacy_artifact_policy_violation'
    )
  ) then
    raise exception using errcode = '55000',
      message = 'contained graph artifact does not reference exact audit evidence';
  end if;

  if not exists (
    select 1
    from pg_catalog.pg_trigger trigger_catalog
    where trigger_catalog.tgrelid = 'public.graph_artifacts'::regclass
      and trigger_catalog.tgname = 'graph_artifacts_update_immutable'
      and not trigger_catalog.tgisinternal
      and trigger_catalog.tgenabled = 'O'
  ) then
    raise exception using errcode = '55000',
      message = 'graph artifact update immutability is not installed';
  end if;

  if not (
    select relation.relrowsecurity and relation.relforcerowsecurity
      and pg_catalog.pg_get_userbyid(relation.relowner) = 'postgres'
    from pg_catalog.pg_class relation
    where relation.oid = 'public.graph_artifact_payload_containments'::regclass
  ) or exists (
    select 1
    from (values
      ('anon'), ('authenticated'), ('service_role')
    ) role_name(name)
    where pg_catalog.has_table_privilege(
      role_name.name,
      'public.graph_artifact_payload_containments',
      'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    )
  ) or exists (
    select 1
    from pg_catalog.pg_class relation
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        relation.relacl,
        pg_catalog.acldefault('r', relation.relowner)
      )
    ) privilege
    where relation.oid =
      'public.graph_artifact_payload_containments'::regclass
      and privilege.grantee <> relation.relowner
  ) or exists (
    select 1
    from pg_catalog.pg_constraint constraint_catalog
    where constraint_catalog.conrelid =
      'public.graph_artifact_payload_containments'::regclass
      and constraint_catalog.contype = 'f'
  ) or not exists (
    select 1
    from pg_catalog.pg_trigger trigger_catalog
    where trigger_catalog.tgrelid =
      'public.graph_artifact_payload_containments'::regclass
      and trigger_catalog.tgname =
        'graph_artifact_payload_containments_immutable'
      and not trigger_catalog.tgisinternal
      and trigger_catalog.tgenabled = 'O'
      and trigger_catalog.tgtype = 58
      and trigger_catalog.tgfoid = pg_catalog.to_regprocedure(
        'public.enforce_graph_artifact_payload_containment_immutable()'
      )
  ) or exists (
    select 1
    from (values
      ('anon'), ('authenticated'), ('service_role')
    ) role_name(name)
    where pg_catalog.has_function_privilege(
      role_name.name,
      'public.enforce_graph_artifact_payload_containment_immutable()',
      'EXECUTE'
    )
  ) or not exists (
    select 1
    from pg_catalog.pg_proc routine
    join pg_catalog.pg_language routine_language
      on routine_language.oid = routine.prolang
    where routine.oid = pg_catalog.to_regprocedure(
        'public.enforce_graph_artifact_payload_containment_immutable()'
      )
      and pg_catalog.pg_get_userbyid(routine.proowner) = 'postgres'
      and routine_language.lanname = 'plpgsql'
      and routine.prokind = 'f'
      and routine.provolatile = 'v'
      and routine.prorettype = 'trigger'::regtype
      and routine.prosecdef
      and routine.proconfig = array['search_path=pg_catalog']::text[]
      and pg_catalog.btrim(
        pg_catalog.replace(
          pg_catalog.replace(routine.prosrc, E'\r\n', E'\n'),
          E'\r', E'\n'
        ),
        E' \n'
      ) = E'begin\n  raise exception using errcode = ''55000'',\n    message = ''graph artifact payload containment evidence is immutable'';\nend;'
      and routine.proacl is not null
      and (select pg_catalog.count(*)
           from pg_catalog.aclexplode(routine.proacl)) = 1
      and exists (
        select 1 from pg_catalog.aclexplode(routine.proacl) privilege
        where privilege.grantor = routine.proowner
          and privilege.grantee = routine.proowner
          and privilege.privilege_type = 'EXECUTE'
          and not privilege.is_grantable
      )
  ) then
    raise exception using errcode = '55000',
      message = 'graph artifact containment audit boundary is not exact';
  end if;

  if exists (
    select 1
    from (values
      ('anon'), ('authenticated'), ('service_role')
    ) role_name(name)
    cross join (values
      ('public.graph_artifacts'), ('public.graph_verifications')
    ) relation_name(name)
    where pg_catalog.has_table_privilege(
      role_name.name,
      relation_name.name,
      'INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER'
    )
  ) or exists (
    select 1
    from pg_catalog.pg_class relation
    cross join lateral pg_catalog.aclexplode(
      coalesce(
        relation.relacl,
        pg_catalog.acldefault('r', relation.relowner)
      )
    ) privilege
    where relation.oid in (
      'public.graph_artifacts'::regclass,
      'public.graph_verifications'::regclass
    )
      and privilege.grantee <> relation.relowner
      and privilege.privilege_type in (
        'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'
      )
  ) then
    raise exception using errcode = '55000',
      message = 'graph artifact mutation authority was not revoked';
  end if;

  if exists (
    select 1 from public.phase1c_workers worker
    where worker.status in ('active', 'draining')
      and worker.last_heartbeat_at > pg_catalog.now() - interval '5 minutes'
  ) then
    raise exception using errcode = '55000',
      message = 'graph artifact containment worker fence did not remain stopped';
  end if;
end;
$graph_artifact_payload_containment_postflight$;

commit;
