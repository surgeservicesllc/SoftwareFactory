-- Restore claim_provider_connect_session to its 20260814002500 contract.
--
-- Hosted holds an earlier draft of this function, applied out of ledger before
-- 20260814002500 took its final shape: the RETURNS TABLE columns are still the
-- unprefixed `organization_id, purpose`, and the ACL carries the owner alone.
-- Probe run 32591774367 measured exactly that pair — contract md5
-- a7ca5a02b1faa50ebba452c4a4f46195 with a one-entry ACL — where the current
-- definition produces 8992610aa5f3749a013a3bdf9f7d4fef with EXECUTE granted to
-- service_role. The drifted draft is doubly dead: no browser or server role
-- may execute it, and its first execution would fail at the
-- ON CONFLICT (organization_id, purpose) clause, which is ambiguous against
-- identically named result columns — the defect the claimed_ prefix fixed.
-- Nothing can be calling it, so replacing it interrupts nothing.
--
-- CREATE OR REPLACE cannot rename result columns, so the known drifted draft
-- is dropped and the exact current definition recreated, then the exact
-- intended ACL rebuilt. The 20260822000900 sixteen-function pre-repair gate
-- requires precisely this end state before the protected record-only chain
-- may run; this file exists so that gate can pass without weakening it.
--
-- Three states are recognized, and only three:
--   the hosted draft            (source 9961e16b…, contract a7ca5a02…) — drop,
--                               recreate, and rebuild the ACL;
--   the 20260814002500 state    (source 9961e16b…, contract 8992610a…) — leave
--                               the definition, re-assert the ACL;
--   the post-20260822000900 one (source aa271ab3…, contract 8992610a…) — the
--                               protected chain owns the function now; touch
--                               nothing, because rewriting it here would
--                               regress the lint repair.
-- Anything else aborts before any DDL runs.

do $repair$
declare
  found_count integer;
  found_source text;
  found_contract text;
  acl_exact boolean;
  pre_source constant text := '9961e16bbe95da08903caac340633bca';
  post_source constant text := 'aa271ab3d2be6c5f2ce7182670e48099';
  drifted_contract constant text := 'a7ca5a02b1faa50ebba452c4a4f46195';
  expected_contract constant text := '8992610aa5f3749a013a3bdf9f7d4fef';
begin
  set local search_path = pg_catalog;

  select count(*) into found_count
  from pg_proc routine
  join pg_namespace space on space.oid = routine.pronamespace
  where space.nspname = 'public'
    and routine.proname = 'claim_provider_connect_session';
  if found_count is distinct from 1 then
    raise exception
      '20260822001300 preflight: expected exactly one claim_provider_connect_session, found %',
      found_count;
  end if;

  with function_state as (
    select routine.*, routine_schema.nspname, routine_language.lanname,
           md5(replace(replace(routine.prosrc, E'\r\n', E'\n'), E'\r', E'\n')) as source_md5,
           md5(jsonb_build_array(
             routine_schema.nspname, routine_language.lanname,
             pg_get_userbyid(routine.proowner), routine.prokind::text,
             format_type(routine.prorettype, null), routine.proretset,
             routine.pronargs, routine.pronargdefaults,
             coalesce(array_to_string(routine.proargnames, ','), ''),
             coalesce(array_to_string(routine.proargmodes, ','), ''),
             coalesce((
               select string_agg(format_type(argument.type_oid, null), ',' order by argument.ordinality)
               from unnest(routine.proallargtypes) with ordinality argument(type_oid, ordinality)
             ), ''),
             coalesce(pg_get_expr(routine.proargdefaults, 0), ''),
             routine.proisstrict, routine.proleakproof, routine.prosecdef,
             routine.proparallel::text, routine.provariadic = 0,
             routine.procost::text, routine.prorows::text,
             routine.prosupport = 0, routine.probin is null,
             routine.prosqlbody is null, routine.protrftypes is null,
             routine.proconfig, routine.proacl is null
           )::text) as contract_md5,
           (routine.proacl is not null
             and (select count(*) from aclexplode(routine.proacl)) = 2
             and has_function_privilege('service_role', routine.oid, 'EXECUTE')
             and not has_function_privilege('anon', routine.oid, 'EXECUTE')
             and not has_function_privilege('authenticated', routine.oid, 'EXECUTE')
           ) as acl_is_exact
    from pg_proc routine
    join pg_namespace routine_schema on routine_schema.oid = routine.pronamespace
    join pg_language routine_language on routine_language.oid = routine.prolang
    where routine.oid = to_regprocedure('public.claim_provider_connect_session(text,text)')
  )
  select source_md5, contract_md5, acl_is_exact
    into found_source, found_contract, acl_exact
  from function_state
  where nspname = 'public'
    and lanname = 'plpgsql'
    and pg_get_userbyid(proowner) = 'postgres'
    and prokind = 'f'
    and provolatile = 'v'
    and prosecdef
    and proconfig = array['search_path=pg_catalog']::text[];

  -- After the protected 20260822000900 lint repair, this function belongs to
  -- that chain's contract. Its state is required to already be exact; this
  -- file must neither rewrite the repaired body nor churn the ACL.
  if found_source = post_source then
    if found_contract = expected_contract and acl_exact then
      return;
    end if;
    raise exception
      '20260822001300 preflight: claim_provider_connect_session carries the post-repair body in an unexpected catalog or ACL state; refusing to touch what 20260822000900 owns';
  end if;

  if found_source is distinct from pre_source
    or found_contract not in (drifted_contract, expected_contract)
  then
    raise exception
      '20260822001300 preflight: claim_provider_connect_session source or catalog identity is neither the known draft nor the current definition; refusing to repair an unknown function';
  end if;

  if found_contract = drifted_contract then
    -- CREATE OR REPLACE cannot rename result columns, so the draft is dropped
    -- and the exact 20260814002500 definition recreated in its place.
    drop function public.claim_provider_connect_session(text, text);
    execute $create_provider_claim$
create or replace function public.claim_provider_connect_session(
  p_code_digest text,
  p_sealed_envelope text
)
-- Prefixed because a RETURNS TABLE column name becomes a plpgsql variable, and
-- a bare `organization_id` here would shadow the real column in the ON CONFLICT
-- clause below — which PostgreSQL rejects as ambiguous.
returns table (claimed_organization_id uuid, claimed_purpose text)
language plpgsql
volatile
security definer
set search_path = pg_catalog
as $function$
declare
  v_session record;
begin
  -- Locked, because two posts racing the same code must not both succeed.
  select * into v_session
  from public.provider_connect_sessions s
  where s.code_digest = p_code_digest
  for update;

  -- One message for every failure. Distinguishing "no such code" from "expired"
  -- from "already used" tells someone probing codes which guesses were close.
  if not found
    or v_session.claimed_at is not null
    or v_session.expires_at <= now()
  then
    raise exception using errcode = '42501',
      message = 'that sign-in link is not valid; start a new one';
  end if;

  update public.provider_connect_sessions
    set claimed_at = now(), claimed_by = v_session.created_by
  where id = v_session.id;

  insert into public.provider_credentials
    (organization_id, purpose, sealed_envelope, source, created_by)
  values (
    v_session.organization_id, v_session.purpose, p_sealed_envelope,
    'connect_session', v_session.created_by
  )
  on conflict (organization_id, purpose) do update
    set sealed_envelope = excluded.sealed_envelope,
        source = excluded.source,
        rotated_at = now(),
        -- A replaced credential has not been verified yet, and carrying the old
        -- timestamp forward would make a fresh token look already-checked.
        last_verified_at = null;

  insert into public.activity_events
    (organization_id, actor_user_id, event_type, entity_type, entity_id, description, metadata)
  values (
    v_session.organization_id, v_session.created_by, 'connection.changed',
    'provider_credential', v_session.id,
    format('Completed sign-in for %s', v_session.purpose),
    jsonb_build_object('purpose', v_session.purpose)
  );

  return query select v_session.organization_id, v_session.purpose;
end;
$function$;
$create_provider_claim$;
  end if;

  -- Rebuild the exact intended ACL from a clean slate: owner implicitly plus
  -- service_role explicitly, exactly as 20260814002500 grants it. The route
  -- that claims a connect code holds no signed-in caller; the code itself is
  -- the authorization, checked inside the function. Idempotent when the state
  -- was already correct.
  revoke all on function public.claim_provider_connect_session(text, text)
    from public, anon, authenticated, service_role;
  grant execute on function public.claim_provider_connect_session(text, text)
    to service_role;
end
$repair$;

do $postflight$
declare
  ready boolean;
begin
  set local search_path = pg_catalog;

  with function_state as (
    select routine.*, routine_schema.nspname, routine_language.lanname,
           md5(replace(replace(routine.prosrc, E'\r\n', E'\n'), E'\r', E'\n')) as source_md5,
           md5(jsonb_build_array(
             routine_schema.nspname, routine_language.lanname,
             pg_get_userbyid(routine.proowner), routine.prokind::text,
             format_type(routine.prorettype, null), routine.proretset,
             routine.pronargs, routine.pronargdefaults,
             coalesce(array_to_string(routine.proargnames, ','), ''),
             coalesce(array_to_string(routine.proargmodes, ','), ''),
             coalesce((
               select string_agg(format_type(argument.type_oid, null), ',' order by argument.ordinality)
               from unnest(routine.proallargtypes) with ordinality argument(type_oid, ordinality)
             ), ''),
             coalesce(pg_get_expr(routine.proargdefaults, 0), ''),
             routine.proisstrict, routine.proleakproof, routine.prosecdef,
             routine.proparallel::text, routine.provariadic = 0,
             routine.procost::text, routine.prorows::text,
             routine.prosupport = 0, routine.probin is null,
             routine.prosqlbody is null, routine.protrftypes is null,
             routine.proconfig, routine.proacl is null
           )::text) as contract_md5
    from pg_proc routine
    join pg_namespace routine_schema on routine_schema.oid = routine.pronamespace
    join pg_language routine_language on routine_language.oid = routine.prolang
    where routine.oid = to_regprocedure('public.claim_provider_connect_session(text,text)')
  )
  select count(*) = 1
     and bool_and(
       nspname = 'public'
       and lanname = 'plpgsql'
       and pg_get_userbyid(proowner) = 'postgres'
       and prokind = 'f'
       and provolatile = 'v'
       and prosecdef
       and proconfig = array['search_path=pg_catalog']::text[]
       and source_md5 in (
         '9961e16bbe95da08903caac340633bca',   -- 20260814002500, this file's target
         'aa271ab3d2be6c5f2ce7182670e48099'    -- after the protected 20260822000900 repair
       )
       and contract_md5 = '8992610aa5f3749a013a3bdf9f7d4fef'
       and array_to_string(proargnames, ',') =
           'p_code_digest,p_sealed_envelope,claimed_organization_id,claimed_purpose'
       and proacl is not null
       and (select count(*) from aclexplode(proacl)) = 2
       and exists (
         select 1 from aclexplode(proacl) acl
         where acl.grantor = proowner and acl.grantee = proowner
           and acl.privilege_type = 'EXECUTE' and not acl.is_grantable
       )
       and exists (
         select 1 from aclexplode(proacl) acl
         where acl.grantor = proowner
           and acl.grantee = to_regrole('service_role')::oid
           and acl.privilege_type = 'EXECUTE' and not acl.is_grantable
       )
       and not exists (
         select 1 from aclexplode(proacl) acl
         where acl.grantor <> proowner
            or acl.grantee not in (proowner, to_regrole('service_role')::oid)
            or acl.privilege_type <> 'EXECUTE'
            or acl.is_grantable
       )
       and has_function_privilege('service_role', oid, 'EXECUTE')
       and not has_function_privilege('anon', oid, 'EXECUTE')
       and not has_function_privilege('authenticated', oid, 'EXECUTE')
     )
    into ready
  from function_state;

  if ready is distinct from true
    or (select count(*)
        from pg_proc routine
        join pg_namespace space on space.oid = routine.pronamespace
        where space.nspname = 'public'
          and routine.proname = 'claim_provider_connect_session') is distinct from 1
  then
    raise exception
      '20260822001300 postflight: claim_provider_connect_session was not restored to the exact 20260814002500 contract';
  end if;
end
$postflight$;
