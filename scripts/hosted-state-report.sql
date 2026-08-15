-- What is actually in hosted. Read-only. Paste into the Supabase SQL editor.
--
-- This exists because the PostgREST-based audit
-- (scripts/hosted-schema-audit.mts) has a blind spot that produced a wrong
-- answer, and the wrong answer was the dangerous direction.
--
-- That audit infers existence from PostgREST. PostgREST answers 404 for a table
-- that is not in its schema cache, and a table is missing from that cache when
-- it does not exist **or** when it exists with no privileges granted on it.
-- Those are different facts and the audit cannot separate them. A migration that
-- created a table and then failed before its grants ran leaves exactly the
-- second shape -- and reads, to that audit, as "not applied".
--
-- `20260814000210_phase2c_resource_persistence` is in that state:
-- `resource_breakers` exists, the audit reported it absent, and re-running the
-- file fails with `42P07: relation "resource_breakers" already exists`.
--
-- The catalogue has no such blind spot. `pg_class` does not care about grants,
-- and this runs as the SQL editor's role, which can read it.

-- ---------------------------------------------------------------------------
-- 1. Which expected tables exist
-- ---------------------------------------------------------------------------
with expected(migration, name) as (values
  ('20260814000210_phase2c_resource_persistence', 'resource_breakers'),
  ('20260814000210_phase2c_resource_persistence', 'resource_breaker_events'),
  ('20260814000210_phase2c_resource_persistence', 'resource_assignments'),
  ('20260814001200_phase2b_task_graph_and_handoffs', 'agent_handoffs'),
  ('20260814001200_phase2b_task_graph_and_handoffs', 'task_work_locks'),
  ('20260814000100_graph_engineering', 'graphs'),
  ('20260814000100_graph_engineering', 'graph_templates'),
  ('20260814000100_graph_engineering', 'graph_budgets'),
  ('20260814000100_graph_engineering', 'graph_nodes'),
  ('20260814000100_graph_engineering', 'node_contracts'),
  ('20260814000100_graph_engineering', 'graph_edges'),
  ('20260814000100_graph_engineering', 'graph_runs'),
  ('20260814000100_graph_engineering', 'node_runs'),
  ('20260814000100_graph_engineering', 'graph_artifacts'),
  ('20260814000100_graph_engineering', 'graph_handoffs'),
  ('20260814000100_graph_engineering', 'graph_verifications'),
  ('20260814000100_graph_engineering', 'work_locks'),
  ('20260814000100_graph_engineering', 'graph_events'),
  ('20260814002200_graph_anchors', 'graph_anchors'),
  ('20260814002200_graph_anchors', 'node_run_claims'),
  ('20260814002200_graph_anchors', 'claim_anchors'),
  ('20260814002200_graph_anchors', 'claim_acceptable_anchors')
)
select
  e.migration,
  e.name,
  case when c.oid is null then 'MISSING' else 'present' end as status,
  -- A present table with no grants is what the REST audit cannot see, and is
  -- also the signature of a migration that died before its grant statements.
  case when c.oid is null then null
       else coalesce((
         select count(*) from information_schema.role_table_grants g
          where g.table_schema = 'public' and g.table_name = e.name
            and g.grantee in ('anon', 'authenticated', 'service_role')
       ), 0) end as browser_grants,
  case when c.oid is null then null
       when c.relrowsecurity and c.relforcerowsecurity then 'rls+force'
       when c.relrowsecurity then 'rls only'
       else 'NO RLS' end as rls
from expected e
left join pg_class c
  on c.relname = e.name
 and c.relnamespace = 'public'::regnamespace
 and c.relkind = 'r'
order by e.migration, e.name;

-- ---------------------------------------------------------------------------
-- 2. Which expected types exist
-- ---------------------------------------------------------------------------
-- A migration that failed midway often leaves its enums behind, and those are
-- what make a re-run fail with 42710 rather than 42P07.

with expected(name) as (values
  ('graph_topology'), ('work_lock_state'), ('graph_resource_kind'),
  ('graph_node_state'), ('resource_breaker_state'), ('agent_role')
)
select e.name,
       case when t.oid is null then 'MISSING' else 'present' end as status
from expected e
left join pg_type t
  on t.typname = e.name and t.typnamespace = 'public'::regnamespace
order by e.name;

-- ---------------------------------------------------------------------------
-- 3. The ledger's own view, for comparison with 1 and 2
-- ---------------------------------------------------------------------------
-- Where these disagree with the tables above is where `db push` will misbehave:
-- a version recorded here whose tables are missing gets skipped forever, and a
-- version absent here whose tables exist gets re-applied and fails.

select version
  from supabase_migrations.schema_migrations
 where version >= '20260813001500'
 order by version;

select count(*) as ledger_rows, max(version) as high_water
  from supabase_migrations.schema_migrations;
