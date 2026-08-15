-- Reconcile the ledger with the schema. Run part 1, then part 2.
--
-- `scripts/hosted-next-actions.sql` reported, on 2026-08-15, that every
-- migration it checks has ALL of its objects present in hosted:
--
--   20260814000100  6/6  in ledger      NOTHING
--   20260814000210  3/3  in ledger      NOTHING
--   20260814001100  1/1  NOT in ledger  RECORD ONLY
--   20260814001200  2/2  NOT in ledger  RECORD ONLY
--   20260814001400  2/2  NOT in ledger  RECORD ONLY
--   20260814002100  2/2  NOT in ledger  RECORD ONLY
--   20260814002200  4/4  in ledger      NOTHING
--   20260814002300  1/1  NOT in ledger  RECORD ONLY
--
-- Nothing needs pushing. Nothing is half-applied. No ledger row points at
-- missing objects. The schema is complete and the record of it is not, which is
-- the state hand-applying migrations in the SQL editor produces: the editor runs
-- DDL, `supabase db push` writes ledger rows, and doing the first never does the
-- second.
--
-- Left as-is, `db push` would try to re-apply all five and fail on the first
-- `create`. So these are recorded rather than pushed.

-- ---------------------------------------------------------------------------
-- Part 1 - record the five whose objects were verified present
-- ---------------------------------------------------------------------------
-- Safe to re-run: `on conflict do nothing` leaves an existing row alone. Only
-- these five are recorded here, because only these five were checked object by
-- object. A version is not written into the ledger on the strength of a guess --
-- that is how the drift being repaired here started.

insert into supabase_migrations.schema_migrations (version) values
  ('20260814001100'),  -- harden_github_connection_loss          1/1 objects present
  ('20260814001200'),  -- phase2b_task_graph_and_handoffs        2/2 objects present
  ('20260814001400'),  -- agentos_project_config_sync            2/2 objects present
  ('20260814002100'),  -- graph_write_boundary                   2/2 objects present
  ('20260814002300')   -- guard_resource_assignment_candidates   1/1 objects present
on conflict (version) do nothing;

-- ---------------------------------------------------------------------------
-- Part 2 - what, if anything, is still out of step
-- ---------------------------------------------------------------------------
-- The repository holds 64 migrations. After part 1 the ledger should hold at
-- least 62 of those versions. This lists both directions of any remaining
-- disagreement, so nothing is assumed closed that is not.
--
-- A "file not in ledger" row is NOT automatically safe to insert. Check its
-- objects exist first -- add it to scripts/hosted-next-actions.sql and re-run
-- that -- because recording a version whose objects are missing is the one
-- error that cannot be recovered by pushing.

with files(version) as (values
  ('20260812000100'),
  ('20260812000200'),
  ('20260812000300'),
  ('20260812000400'),
  ('20260812000500'),
  ('20260812000700'),
  ('20260812000800'),
  ('20260812000900'),
  ('20260812001000'),
  ('20260812001100'),
  ('20260812001200'),
  ('20260812001300'),
  ('20260812001400'),
  ('20260812001500'),
  ('20260812001600'),
  ('20260812001700'),
  ('20260812001800'),
  ('20260812001900'),
  ('20260812002000'),
  ('20260812002100'),
  ('20260812002200'),
  ('20260812002300'),
  ('20260812002400'),
  ('20260812002500'),
  ('20260812002600'),
  ('20260812002700'),
  ('20260812002800'),
  ('20260813000100'),
  ('20260813000200'),
  ('20260813000300'),
  ('20260813000400'),
  ('20260813000500'),
  ('20260813000600'),
  ('20260813000700'),
  ('20260813000800'),
  ('20260813000900'),
  ('20260813001000'),
  ('20260813001100'),
  ('20260813001200'),
  ('20260813001300'),
  ('20260813001400'),
  ('20260813001500'),
  ('20260813001550'),
  ('20260813001600'),
  ('20260813001700'),
  ('20260814000100'),
  ('20260814000210'),
  ('20260814000220'),
  ('20260814000250'),
  ('20260814000300'),
  ('20260814000400'),
  ('20260814000500'),
  ('20260814000600'),
  ('20260814000700'),
  ('20260814000800'),
  ('20260814000900'),
  ('20260814001000'),
  ('20260814001100'),
  ('20260814001200'),
  ('20260814001300'),
  ('20260814001400'),
  ('20260814002100'),
  ('20260814002200'),
  ('20260814002300')
)
select 'file not in ledger' as problem, f.version
  from files f
 where not exists (
   select 1 from supabase_migrations.schema_migrations m where m.version = f.version)
union all
select 'ledger row has no file', m.version
  from supabase_migrations.schema_migrations m
 where not exists (select 1 from files f where f.version = m.version)
order by 1, 2;
