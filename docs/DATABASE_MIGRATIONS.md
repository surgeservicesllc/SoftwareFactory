# Database migrations

Supabase migrations under `supabase/migrations/` are immutable schema history after they are applied. Corrections use a new forward migration.

## Current inventory

| Sequence | Purpose | Hosted state on 2026-08-12 |
| --- | --- | --- |
| `001_control_plane_schema` | Core tenant/control-plane types and tables | Applied |
| `002_row_level_security` | RLS/FORCE RLS, policies, grants, tenant helpers | Applied |
| `003_control_plane_workflows` | Audited command/project/approval workflows and immutable activity events | Applied |
| `004_github_integration` | GitHub installations, repositories, webhook deliveries, change requests, sync/disconnect/webhook RPCs | Applied |
| `005_authenticated_onboarding` | Authenticated organization onboarding and profile/member hardening | Applied |
| `007_github_project_linking` | Transactional active GitHub repository-to-project linking | Applied |
| `008_fix_github_sync_ambiguity` | Additive qualification fix for hosted lint ambiguity in `sync_github_installation` | Applied and linked lint clean |
| `009_harden_github_project_and_sync` | Serialize external-installation sync, re-resolve authoritative binding, and force synchronized-default-branch project linking | Applied and linked lint clean |

There is no `006` in the current Phase 1B chain. Do not rename applied migrations to close the numeric gap; ordering is determined by the full timestamp filename.

## Current hosted status

Project `qpuofpmagrmyamahqwxw` is `ACTIVE_HEALTHY`. Hosted migration history is synchronized local-to-remote for `001`, `002`, `003`, `004`, `005`, `007`, `008`, and `009`. `20260812000800_fix_github_sync_ambiguity.sql` additively qualifies the repository installation column and uses the named `github_repositories_external_unique` conflict constraint. Local PGlite reproduced the `004` ambiguity and verified the `008` repair. `20260812000900_harden_github_project_and_sync.sql` then adds a transaction-scoped advisory lock before first-or-existing installation synchronization, re-reads the upserted installation as the authoritative tenant/connection binding, and makes a supplied project branch only a freshness expectation while persisting the synchronized GitHub default branch. The current integration suite passes 88 tests, and hosted `supabase db lint --linked --schema public --level warning --fail-on error` reports no schema errors (`[]`). Authenticated cross-tenant, anonymous-denial, and privileged-RPC behavioral verification against the hosted service remains pending.

## Creating a migration

```bash
npx supabase migration new descriptive_name
```

Each migration should include, where applicable, ownership, foreign keys, indexed query paths, constraints, timestamps, RLS/FORCE RLS, explicit policies/grants, audited state transitions, and pinned search paths for security-definer functions. Never store provider secrets or tokens in tables.

## Local verification

Apply the complete chain to a disposable local database:

```bash
npx supabase db reset
npx supabase db lint
```

Verify:

1. migrations apply from empty state in timestamp order;
2. required tables, functions, constraints, indexes, and foreign keys exist;
3. every exposed table reports both RLS and FORCE RLS;
4. intended user/session operations succeed;
5. a second tenant and anonymous session are denied;
6. privileged workflows verify tenant/actor/resource before mutation;
7. important mutations append immutable, redacted activity evidence; and
8. no test claiming tenant isolation uses service role as the user-under-test.

Useful catalog queries:

```sql
select schemaname, tablename, rowsecurity
from pg_tables
where schemaname = 'public'
order by tablename;

select schemaname, tablename, policyname, cmd, roles
from pg_policies
where schemaname = 'public'
order by tablename, policyname;
```

## Hosted promotion

1. Verify CLI account and exact project ref.
2. Compare local/remote migration lists.
3. Review the SQL, risk tier, tenant checks, grants, and recovery/containment plan.
4. Run local reset/lint and affected tests.
5. Use a linked dry run where supported.
6. Apply with protected credentials outside untrusted CI.
7. Rerun linked migration list, database lint, catalog/RLS checks, and application health.
8. Record exact evidence in `AI/CURRENT_STATE.md` and `AI/QUALITY_SCORECARD.md`.

Never run production migrations from pull-request CI or an untrusted fork. Never use `db reset` for a hosted project. A destructive or irreversible production migration is RED and needs exact owner approval and verified recovery measures.
