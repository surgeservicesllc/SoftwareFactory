-- Admit exactly the Full Lifecycle v2 plan whose dependency inputs carry the
-- typed handoff envelopes persisted by the current compiler.
--
-- This is an identity-only, forward migration. The launch boundary may create
-- only the new canonical plan. The validated completion boundary deliberately
-- retains the immediately preceding post-deploy plan as an in-flight identity:
-- those graphs have the same strong DEPLOY/MONITOR output contract and must not
-- fall back to the pre-validation completion path merely because their input
-- schemas predate typed handoffs. The immutable pre-validation digest remains
-- excluded from both mutations.
do $full_lifecycle_typed_input_identity$
declare
  launch_signature constant text :=
    'public.create_graph_from_plan_with_release_identity_as_server(uuid,uuid,uuid,text,public.graph_topology,jsonb,public.risk_level,boolean,jsonb,jsonb,jsonb,text,integer,uuid,text,text,jsonb)';
  completion_signature constant text :=
    'public.complete_graph_run_with_validated_release_as_worker(text,uuid,public.graph_run_state,boolean,bigint,bigint,text,text)';
  immutable_legacy_digest constant text :=
    'ac9bde8fc1cdd21e735f02b1fa7d940ab680c2bde8c1ec24d704d42c59045a09';
  prior_postdeploy_digest constant text :=
    '0ec1e97b80dc8696872d88162c5271f9ea822e7dea79556c5470730a025d3b49';
  typed_input_digest constant text :=
    '02bb1e7b35782fad9f6024c080bd149f7ade4edb9d68326fd3b04ff94ba589ad';
  completion_old_guard text;
  completion_new_guard text;
  source_line_break text;
  launch_record record;
  completion_record record;
  after_record record;
  updated_launch_definition text;
  updated_completion_definition text;
  expected_launch_source text;
  expected_completion_source text;
  occurrence_count integer;
begin
  select routine.oid, routine.prosecdef, routine.proconfig, routine.proacl,
         routine.prosrc,
         pg_catalog.pg_get_userbyid(routine.proowner) as owner_name,
         pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
           routine.prosrc, E'\r\n', E'\n'), E'\r', E'\n')) as source_md5,
         pg_catalog.pg_get_functiondef(routine.oid) as definition
    into launch_record
  from pg_catalog.pg_proc routine
  where routine.oid = pg_catalog.to_regprocedure(launch_signature);

  if not found
    or launch_record.owner_name <> 'postgres'
    or not launch_record.prosecdef
    or launch_record.proconfig is distinct from array['search_path=pg_catalog']::text[]
    or launch_record.proacl is distinct from
      array['postgres=X/postgres', 'service_role=X/postgres']::pg_catalog.aclitem[]
    or launch_record.source_md5 <> '878b6df53f450d723a4ef7da9dd677b2'
    or not pg_catalog.has_function_privilege('service_role', launch_signature, 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', launch_signature, 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', launch_signature, 'EXECUTE')
  then
    raise exception 'full_lifecycle launch boundary identity/security/ACL mismatch before typed-input admission';
  end if;

  occurrence_count := (
    pg_catalog.length(launch_record.definition)
      - pg_catalog.length(pg_catalog.replace(
          launch_record.definition, prior_postdeploy_digest, ''))
  ) / pg_catalog.length(prior_postdeploy_digest);
  if occurrence_count <> 1
    or pg_catalog.strpos(launch_record.definition, typed_input_digest) > 0
    or pg_catalog.strpos(launch_record.definition, immutable_legacy_digest) > 0
  then
    raise exception 'full_lifecycle launch boundary does not contain one exact prior post-deploy digest';
  end if;

  select routine.oid, routine.prosecdef, routine.proconfig, routine.proacl,
         routine.prosrc,
         pg_catalog.pg_get_userbyid(routine.proowner) as owner_name,
         pg_catalog.md5(pg_catalog.replace(pg_catalog.replace(
           routine.prosrc, E'\r\n', E'\n'), E'\r', E'\n')) as source_md5,
         pg_catalog.pg_get_functiondef(routine.oid) as definition
    into completion_record
  from pg_catalog.pg_proc routine
  where routine.oid = pg_catalog.to_regprocedure(completion_signature);

  if not found
    or completion_record.owner_name <> 'postgres'
    or not completion_record.prosecdef
    or completion_record.proconfig is distinct from array['search_path=pg_catalog']::text[]
    or completion_record.proacl is distinct from
      array['postgres=X/postgres', 'service_role=X/postgres']::pg_catalog.aclitem[]
    or completion_record.source_md5 <> '8c127b52d5961d49cba980e276edf414'
    or not pg_catalog.has_function_privilege('service_role', completion_signature, 'EXECUTE')
    or pg_catalog.has_function_privilege('authenticated', completion_signature, 'EXECUTE')
    or pg_catalog.has_function_privilege('anon', completion_signature, 'EXECUTE')
  then
    raise exception 'validated lifecycle completion identity/security/ACL mismatch before typed-input admission';
  end if;

  -- pg_proc retains the migration file's line endings. Match the installed
  -- source byte-for-byte so this remains an exact one-fragment mutation on
  -- both PostgreSQL/Linux and the CRLF-backed PGlite contract suite.
  source_line_break := case
    when pg_catalog.strpos(completion_record.definition, E'\r\n') > 0 then E'\r\n'
    else E'\n'
  end;
  completion_old_guard :=
    'or graph_record.template_plan_sha256 is distinct from'
    || source_line_break || '      ''' || prior_postdeploy_digest || '''';
  completion_new_guard :=
    'or ('
    || source_line_break || '      graph_record.template_plan_sha256 is distinct from'
    || source_line_break || '        ''' || prior_postdeploy_digest || ''''
    || source_line_break || '      and graph_record.template_plan_sha256 is distinct from'
    || source_line_break || '        ''' || typed_input_digest || ''''
    || source_line_break || '    )';

  occurrence_count := (
    pg_catalog.length(completion_record.definition)
      - pg_catalog.length(pg_catalog.replace(
          completion_record.definition, completion_old_guard, ''))
  ) / pg_catalog.length(completion_old_guard);
  if occurrence_count <> 1
    or pg_catalog.strpos(completion_record.definition, typed_input_digest) > 0
    or pg_catalog.strpos(completion_record.definition, immutable_legacy_digest) > 0
  then
    raise exception 'validated lifecycle completion does not contain one exact prior digest guard';
  end if;

  updated_launch_definition := pg_catalog.replace(
    launch_record.definition, prior_postdeploy_digest, typed_input_digest
  );
  updated_completion_definition := pg_catalog.replace(
    completion_record.definition, completion_old_guard, completion_new_guard
  );
  expected_launch_source := pg_catalog.replace(
    launch_record.prosrc, prior_postdeploy_digest, typed_input_digest
  );
  expected_completion_source := pg_catalog.replace(
    completion_record.prosrc, completion_old_guard, completion_new_guard
  );

  execute updated_launch_definition;
  execute updated_completion_definition;

  select routine.oid, routine.prosecdef, routine.proconfig, routine.proacl,
         routine.prosrc, pg_catalog.pg_get_userbyid(routine.proowner) as owner_name
    into after_record
  from pg_catalog.pg_proc routine
  where routine.oid = pg_catalog.to_regprocedure(launch_signature);
  if not found
    or after_record.oid is distinct from launch_record.oid
    or after_record.owner_name is distinct from launch_record.owner_name
    or after_record.prosecdef is distinct from launch_record.prosecdef
    or after_record.proconfig is distinct from launch_record.proconfig
    or after_record.proacl is distinct from launch_record.proacl
    or after_record.prosrc is distinct from expected_launch_source
  then
    raise exception 'full_lifecycle launch boundary identity/security/ACL changed during typed-input admission';
  end if;

  select routine.oid, routine.prosecdef, routine.proconfig, routine.proacl,
         routine.prosrc, pg_catalog.pg_get_userbyid(routine.proowner) as owner_name
    into after_record
  from pg_catalog.pg_proc routine
  where routine.oid = pg_catalog.to_regprocedure(completion_signature);
  if not found
    or after_record.oid is distinct from completion_record.oid
    or after_record.owner_name is distinct from completion_record.owner_name
    or after_record.prosecdef is distinct from completion_record.prosecdef
    or after_record.proconfig is distinct from completion_record.proconfig
    or after_record.proacl is distinct from completion_record.proacl
    or after_record.prosrc is distinct from expected_completion_source
  then
    raise exception 'validated lifecycle completion identity/security/ACL changed during typed-input admission';
  end if;
end;
$full_lifecycle_typed_input_identity$;
