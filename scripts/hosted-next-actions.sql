-- What to do next, one row per migration. Read-only. Single statement, so the
-- Supabase SQL editor shows the whole answer rather than only the last result.
--
-- This exists because the two facts that decide the next action live in
-- different places and disagree:
--
--   * the **schema** says what is actually there;
--   * the **ledger** says what `supabase db push` believes is there.
--
-- Neither alone tells you what to run. A version recorded whose objects are
-- missing gets skipped forever. Objects present whose version is unrecorded gets
-- re-applied and fails on the first `create`. Both states exist in this database
-- right now, which is why the ACTION column is computed from the pair.

with expected(version, kind, name) as (values
  -- 20260814000100 graph_engineering (a representative sample of its 13 tables)
  ('20260814000100', 'table', 'graphs'),
  ('20260814000100', 'table', 'graph_runs'),
  ('20260814000100', 'table', 'node_runs'),
  ('20260814000100', 'table', 'graph_verifications'),
  ('20260814000100', 'table', 'work_locks'),
  ('20260814000100', 'table', 'graph_events'),
  -- 20260814000210 phase2c_resource_persistence
  ('20260814000210', 'table', 'resource_breakers'),
  ('20260814000210', 'table', 'resource_breaker_events'),
  ('20260814000210', 'table', 'resource_assignments'),
  -- 20260814001100 harden_github_connection_loss (function only)
  ('20260814001100', 'function', 'mark_github_connection_lost'),
  -- 20260814001200 phase2b_task_graph_and_handoffs
  ('20260814001200', 'table', 'agent_handoffs'),
  ('20260814001200', 'table', 'task_work_locks'),
  -- 20260814001400 agentos_project_config_sync (functions only)
  ('20260814001400', 'function', 'agentos_export_project_config'),
  ('20260814001400', 'function', 'agentos_apply_project_config'),
  -- 20260814002100 graph_write_boundary (functions only)
  ('20260814002100', 'function', 'create_graph_from_plan'),
  ('20260814002100', 'function', 'record_verification'),
  -- 20260814002200 graph_anchors
  ('20260814002200', 'table', 'graph_anchors'),
  ('20260814002200', 'table', 'node_run_claims'),
  ('20260814002200', 'table', 'claim_anchors'),
  ('20260814002200', 'table', 'claim_acceptable_anchors'),
  -- 20260814002300 guard_resource_assignment_candidates (constraint only)
  ('20260814002300', 'constraint', 'resource_assignments_candidates_not_sensitive')
),
observed as (
  select
    e.version,
    e.kind,
    e.name,
    case e.kind
      when 'table' then exists (
        select 1 from pg_class c
         where c.relnamespace = 'public'::regnamespace
           and c.relkind = 'r' and c.relname = e.name)
      when 'function' then exists (
        select 1 from pg_proc p
         where p.pronamespace = 'public'::regnamespace and p.proname = e.name)
      when 'constraint' then exists (
        select 1 from pg_constraint k where k.conname = e.name)
    end as present
  from expected e
),
rolled as (
  select
    o.version,
    count(*) as expected_objects,
    count(*) filter (where o.present) as present_objects,
    exists (
      select 1 from supabase_migrations.schema_migrations m where m.version = o.version
    ) as in_ledger
  from observed o
  group by o.version
)
select
  r.version,
  r.present_objects || '/' || r.expected_objects as objects,
  case when r.in_ledger then 'yes' else 'no' end as in_ledger,
  case
    when r.present_objects = 0 and not r.in_ledger
      then 'PUSH - not applied, not recorded. Ordinary forward migration.'
    when r.present_objects = r.expected_objects and r.in_ledger
      then 'NOTHING - applied and recorded.'
    when r.present_objects = r.expected_objects and not r.in_ledger
      then 'RECORD ONLY - objects exist but no ledger row. A push would re-apply and fail; insert the version instead.'
    when r.present_objects = 0 and r.in_ledger
      then 'LEDGER WRONG - recorded but nothing is there. db push will SKIP this forever. Delete the row, then push.'
    when r.present_objects > 0 and r.present_objects < r.expected_objects
      then 'HALF APPLIED - needs an idempotent repair, not a re-run. Do not push.'
    else 'INSPECT'
  end as action
from rolled r
order by r.version;
