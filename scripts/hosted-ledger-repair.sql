-- Hosted ledger repair.
--
-- Measured against the live database 2026-08-14 22:10Z, then revised 2026-08-15
-- after two migrations were renumbered. Read step 0 before trusting any number
-- below it: the snapshot is a starting point, not the current position, and this
-- file has already been stale once.
--
-- ---------------------------------------------------------------------------
-- Step 0 - measure, before doing anything
-- ---------------------------------------------------------------------------
-- Run this first. It answers the only two questions that matter, and it needs
-- one input: the list of migration filenames in supabase/migrations. Generate it
-- with `ls supabase/migrations | sed -E "s/_.*//"` and paste it in.
--
--   with files(version) as (values
--     -- paste the versions here, e.g. ('20260812000100'), ('20260812000200'), ...
--   )
--   select 'file not in ledger' as problem, f.version
--     from files f
--    where not exists (select 1 from supabase_migrations.schema_migrations m
--                       where m.version = f.version)
--   union all
--   select 'ledger row has no file', m.version
--     from supabase_migrations.schema_migrations m
--    where not exists (select 1 from files f where f.version = m.version)
--   order by 1, 2;
--
-- "file not in ledger" is the ordinary case: `db push` will apply it. Check the
-- schema first, because a file that is *already applied* but unrecorded is the
-- dangerous one -- push will try to re-run it and fail on the first
-- `create table` that already exists. That is problem 2 below.
--
-- "ledger row has no file" means a version was recorded and then the file
-- carrying it was renumbered or deleted. Whatever it applied is still in the
-- schema; the record now points at nothing.
--
-- ---------------------------------------------------------------------------
-- What the 2026-08-14 measurement found
-- ---------------------------------------------------------------------------
-- 1. TWO migrations were genuinely not applied:
--      20260814000210_phase2c_resource_persistence.sql   (resource_breakers absent)
--      20260814002200_graph_anchors.sql                  (graph_anchors absent)
--    Every dependency they need was present -- text_has_likely_secret,
--    is_organization_member, and the projects/graph_runs/node_runs composite
--    unique constraints -- and neither left an enum behind, so neither partially
--    applied. They should apply cleanly as-is.
--
-- 2. TEN migrations WERE applied but NONE recorded in the ledger.
--    The ledger held 45 rows ending at 20260814000200, while the schema
--    contained agentos_goals, agentos_inbox_messages, agentos_task_templates,
--    agentos_triggers, link_repair_promotion, declare_model_characteristics
--    and the two provider_model_configurations columns.
--
--    This is the more serious of the two. `supabase db push` decides what to run
--    from the ledger, not from the schema, so with these rows missing it will try
--    to re-apply all ten and fail. The database is fine; the record of it is
--    wrong, and the record is what tooling believes.
--
-- Four of the migrations the dashboard marked "not applied" were in fact
-- applied: 20260814000220, 20260814000250, 20260814000400 and 20260814000700.
-- Their objects are present. Do not re-run them.
--
-- ---------------------------------------------------------------------------
-- Added 2026-08-15 - two ledger rows now point at nothing
-- ---------------------------------------------------------------------------
-- Merging `main` brought a second migration creating `public.work_locks`, so
-- the graph engine's two migrations were renumbered out of the way:
--
--     20260814000100_graph_engineering.sql  ->  20260814002000_graph_engineering.sql
--     20260814000200_graph_write_boundary.sql -> 20260814002100_graph_write_boundary.sql
--
-- Both were unapplied, so the rename carries no schema consequence. It does have
-- a ledger consequence, and it is the reason to run step 0 rather than trust the
-- snapshot above: **versions 20260814000100 and 20260814000200 are rows in the
-- ledger, and no file carries those versions any more.**
--
-- Do not delete those rows on the strength of this comment. Whatever they
-- recorded is in the hosted schema and something has to account for it. The
-- hosted `provider_model_configurations` columns are the likely content of the
-- 20260814000200 row -- that migration used to hold that version before an
-- earlier renumbering moved it to 20260814000220, which is in the insert list
-- below. If step 0 confirms that reading, the two orphan rows are safe to leave
-- in place: they are inert, and removing them buys nothing while risking a
-- re-apply of something already present.
--
-- The renumbering has a second, good consequence. At 20260814000100 and
-- 20260814000200 the graph migrations sat under ledger rows that already claimed
-- those versions, so `db push` believed them applied and would have skipped them
-- forever. At 20260814002000 and 20260814002100 they are in free version space
-- and apply normally.

-- ---------------------------------------------------------------------------
-- Step 1 - apply the ones that are genuinely missing
-- ---------------------------------------------------------------------------
-- Run these files' contents in the SQL editor, in this order:
--
--   supabase/migrations/20260814000210_phase2c_resource_persistence.sql
--   supabase/migrations/20260814002200_graph_anchors.sql
--
-- Then verify before continuing. Both must return 1:
--
--   select count(*) from information_schema.tables
--    where table_schema = 'public' and table_name = 'resource_breakers';
--   select count(*) from information_schema.tables
--    where table_schema = 'public' and table_name = 'graph_anchors';
--
-- If either returns 0, stop and read the error rather than running step 2:
-- recording a version that did not apply is exactly how this drift started.

-- ---------------------------------------------------------------------------
-- Step 2 - record the twelve versions in the ledger
-- ---------------------------------------------------------------------------
-- Safe to run more than once: `on conflict do nothing` leaves a version already
-- present alone. Run this only after step 1 verified. Every version named here
-- exists as a file in supabase/migrations -- check that again if you arrive
-- after another renumbering.

insert into supabase_migrations.schema_migrations (version) values
  ('20260813001550'),  -- serialize_concurrent_operations_writes   (applied)
  ('20260813001700'),  -- link_promoted_repair_task                (applied)
  ('20260814000210'),  -- phase2c_resource_persistence             (step 1)
  ('20260814000220'),  -- declare_model_strength_and_context       (applied)
  ('20260814000250'),  -- declare_model_characteristics            (applied)
  ('20260814000300'),  -- agentos_isolation_model                  (applied)
  ('20260814000400'),  -- agentos_inbox                            (applied)
  ('20260814000500'),  -- agentos_templates_and_chains             (applied)
  ('20260814000600'),  -- agentos_compound_engineer_template       (applied)
  ('20260814000700'),  -- agentos_goals                            (applied)
  ('20260814000800'),  -- agentos_triggers_and_automations         (applied)
  ('20260814002200')   -- graph_anchors                            (step 1)
on conflict (version) do nothing;

-- ---------------------------------------------------------------------------
-- Step 3 - let `db push` apply the rest, then confirm
-- ---------------------------------------------------------------------------
-- Six files remain unrecorded after step 2 and are ordinary forward migrations:
--
--   20260814001100_harden_github_connection_loss.sql
--   20260814001200_phase2b_task_graph_and_handoffs.sql
--   20260814001300_agentos_config_activity_types.sql
--   20260814001400_agentos_project_config_sync.sql
--   20260814002000_graph_engineering.sql
--   20260814002100_graph_write_boundary.sql
--
-- Re-run step 0 first. If any of the six is already present in the schema, it
-- belongs in step 2's list instead -- pushing it would fail on a `create table`
-- that already exists, which is the same trap as problem 2.
--
-- The whole chain of 63 migrations applies in order from empty against real
-- PostgreSQL, verified by tests/integration/migration-object-collisions.test.ts,
-- which also asserts that no two migrations create the same table or type. That
-- guard exists because the work_locks collision above reached a merge undetected.
--
-- After the push, expect the ledger to cover all 63 files, plus the two orphan
-- rows discussed above if they are still there.

select count(*) as ledger_rows, max(version) as latest
  from supabase_migrations.schema_migrations;

-- Every public table must carry RLS and FORCE RLS. Expect zero rows.

select c.relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relkind = 'r'
   and (not c.relrowsecurity or not c.relforcerowsecurity);

-- And 102 public tables, matching the count asserted by
-- tests/integration/phase1e-operations.behavior.test.ts.

select count(*) as public_tables
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r';
