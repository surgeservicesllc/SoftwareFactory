-- Record every migration whose objects are verified present. Run once.
--
-- This is the safe form of "insert the missing ledger rows". It does not take a
-- list of versions on trust -- it recomputes presence from the catalogue and
-- inserts only where EVERY expected object is there.
--
-- That property is the point. Recording a version whose objects are missing is
-- the one mistake `supabase db push` can never recover from: the version reads
-- as applied, the migration is skipped forever, and no amount of pushing brings
-- it back. Here that outcome is not merely discouraged, it is unreachable --
-- the `where` clause cannot select such a row.
--
-- Safe to re-run. `on conflict do nothing` leaves existing rows alone, and a
-- second run selects nothing because the rows now exist.
--
-- It does NOT touch `20260814000200`, the ledger row with no file. That row is
-- left from renumbering `graph_write_boundary` to `20260814002100`, and whatever
-- it recorded is accounted for by versions already in the ledger. It is inert:
-- `db push` reads files and asks whether each is recorded, so a row with no file
-- is never consulted. Deleting it buys nothing and risks re-applying something
-- already present, so it stays.

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
  -- 20260814000900 agentos_safe_list_reads (functions only)
  ('20260814000900', 'function', 'agentos_list_chains'),
  ('20260814000900', 'function', 'agentos_list_goals'),
  ('20260814000900', 'function', 'agentos_list_triggers'),
  -- 20260814001000 phase1d_decision_visibility (functions only)
  ('20260814001000', 'function', 'list_autonomy_decisions'),
  ('20260814001000', 'function', 'list_autonomy_status'),
  -- 20260814001300 agentos_config_activity_types (enum labels only). This one
  -- already uses `add value if not exists`, so it is safe to re-run whatever the
  -- ledger says -- but it still needs recording so `db push` stops trying.
  ('20260814001300', 'enum_label', 'agentos.config_applied'),
  ('20260814001300', 'enum_label', 'agentos.config_pruned'),
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
      when 'enum_label' then exists (
        select 1 from pg_enum n
          join pg_type t on t.oid = n.enumtypid
         where t.typnamespace = 'public'::regnamespace and n.enumlabel = e.name)
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
insert into supabase_migrations.schema_migrations (version)
select r.version
  from rolled r
 where r.present_objects = r.expected_objects
   and not r.in_ledger
on conflict (version) do nothing;

-- Confirm. Expect zero rows from the first query: every repository migration
-- whose objects this file knows how to check is now recorded.

select count(*) as ledger_rows, max(version) as high_water
  from supabase_migrations.schema_migrations;
