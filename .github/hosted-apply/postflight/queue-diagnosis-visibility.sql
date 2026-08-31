-- Postflight for hosted apply scope `queue-diagnosis-visibility`.
--
-- Extracted like every other file here and executed against the fully
-- migrated chain by tests/integration/hosted-scope-replay.behavior.test.ts.
--
-- 20260831001400 DROPs and recreates diagnose_graph_queue_as_worker_v2 to
-- widen its projection, so what must be re-proved is that the drop did not
-- loosen anything: still a definer, still worker-only, and the two new
-- columns actually present (a stale cached definition would pass a mere
-- existence check).

do $$
declare
  v_result text;
begin
  select pg_get_function_result(p.oid) into v_result
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'diagnose_graph_queue_as_worker_v2'
     and p.prosecdef;
  if v_result is null then
    raise exception 'diagnose_graph_queue_as_worker_v2 is missing or not a definer';
  end if;
  if position('withdrawn_at' in v_result) = 0
    or position('pause_requested_at' in v_result) = 0 then
    raise exception 'the diagnosis projection does not carry withdrawn_at/pause_requested_at';
  end if;
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'diagnose_graph_queue_as_worker_v2'
       and (has_function_privilege('anon', p.oid, 'execute')
         or has_function_privilege('authenticated', p.oid, 'execute'))) then
    raise exception 'the queue diagnosis is reachable by a browser role';
  end if;
  if not exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'diagnose_graph_queue_as_worker_v2'
       and has_function_privilege('service_role', p.oid, 'execute')) then
    raise exception 'the worker cannot reach its own queue diagnosis';
  end if;
end
$$;
