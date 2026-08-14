-- Hosted repair, measured against the live database 2026-08-14 22:10Z.
--
-- Two separate problems, and the second is the dangerous one.
--
-- 1. TWO migrations are genuinely not applied:
--      20260814000210_phase2c_resource_persistence.sql   (resource_breakers absent)
--      20260814002200_graph_anchors.sql                  (graph_anchors absent)
--    Every dependency they need is present in hosted -- text_has_likely_secret,
--    is_organization_member, and the projects/graph_runs/node_runs composite
--    unique constraints all exist -- and neither left an enum behind, so
--    neither partially applied. They should apply cleanly as-is.
--
-- 2. TEN migrations ARE applied but NONE are recorded in the ledger.
--    The ledger still holds 45 rows ending at 20260814000200, while the schema
--    contains agentos_goals, agentos_inbox_messages, agentos_task_templates,
--    agentos_triggers, link_repair_promotion, declare_model_characteristics
--    and the two provider_model_configurations columns.
--
--    This is the more serious of the two. `supabase db push` decides what to
--    run from the ledger, not from the schema, so with these rows missing it
--    will try to re-apply all ten and fail on the first `create table` that
--    already exists. The database is fine; the record of it is wrong, and the
--    record is what tooling believes.
--
-- Four of the migrations marked "not applied" in the dashboard are in fact
-- applied: 20260814000220, 20260814000250, 20260814000400 and 20260814000700.
-- Their objects are present. Do not re-run them.

-- ---------------------------------------------------------------------------
-- Step 1 - apply the two that are genuinely missing
-- ---------------------------------------------------------------------------
-- Run these two files' contents first, in this order, in the SQL editor:
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
-- Step 2 - record all twelve versions in the ledger
-- ---------------------------------------------------------------------------
-- Safe to run more than once: `on conflict do nothing` means a version already
-- present is left alone. Run this only after step 1 verified.

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
-- Step 3 - confirm
-- ---------------------------------------------------------------------------
-- Expect 57 rows and a high-water mark of 20260814002200, matching the 57
-- migration files in supabase/migrations.

select count(*) as ledger_rows, max(version) as latest
  from supabase_migrations.schema_migrations;

-- Every public table must still carry RLS and FORCE RLS. Expect zero rows.

select c.relname
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public'
   and c.relkind = 'r'
   and (not c.relrowsecurity or not c.relforcerowsecurity);
