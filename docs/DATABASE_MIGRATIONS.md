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
| `010_phase1d_observation_controls` | Lock the global kill switch ON and constrain Phase 1D to GREEN observation with all automatic actions OFF | Applied transactionally; hosted safety checks pass |
| `011_harden_direct_mutation_boundaries` | Remove direct authenticated connection/member mutations and align database secret detection with `github_pat_` | Local only; hosted promotion pending exact owner approval |
| `012_github_change_audit` | Add actor-attributed immutable completed/failed GitHub change-request evidence, including bounded branch/commit failure evidence | Local only; hosted promotion pending exact owner approval |
| `013_reconcile_github_repository_grants` | Add service-role-only bounded upsert of repositories newly granted through a verified webhook | Local only; hosted promotion pending exact owner approval |
| `014_sync_linked_project_repository_metadata` | Propagate provider-authoritative repository rename/default-branch changes to exact connection-linked projects with immutable redacted activity evidence | Local only; hosted promotion pending exact owner approval |
| `015_recover_draft_pr_completion` | Recover a reserved change request from actor-attributed branch/commit/existing-draft-PR evidence after an ambiguous completion response | Local only; hosted promotion pending exact owner approval |
| `016_guard_github_installation_terminal_state` | Make deletion terminal for an installation ID and order installation lifecycle events by provider time | Local only; hosted promotion pending exact owner approval |
| `017_close_authenticated_control_plane_writes` | Remove remaining direct authenticated writes to connections/projects/links/change requests and reserve exact live changes through a narrow authenticated RPC | Local only; hosted promotion pending exact owner approval |
| `018_order_github_repository_events` | Order repository metadata events by provider time; preserve terminal deletion and require explicit newer restore before unselected resynchronization | Local only; hosted promotion pending exact owner approval |
| `019_allow_service_role_sensitive_json_checks` | Grant the service-role provider-ingress boundary only the SECURITY DEFINER sensitive-JSON wrapper needed by table CHECK evaluation; keep recursive/text helpers inaccessible | Local only; hosted promotion pending exact owner approval |
| `020_safe_tenant_list_reads` | Revoke authenticated SELECT on sensitive control-plane base tables and add bounded caller-member safe-projection list RPCs | Local only; hosted promotion pending exact owner approval |
| `021_bind_projects_to_github_repository_ids` | Persist the immutable tenant-scoped GitHub repository UUID on project connections and require exact change/project/repository binding | Local only; hosted promotion pending exact owner approval |
| `022_owner_approved_protected_draft_changes` | Record immutable exact owner RED approval before protected-file provider execution and add a reclaimable five-minute pre-provider reservation lease | Local only; hosted promotion pending exact owner approval |
| `023_github_activity_details` | Project bounded verified GitHub activity details and attribute project events through the stable repository UUID | Local only; hosted promotion pending exact owner approval |
| `024_safe_activity_list_reads` | Revoke authenticated direct reads of raw Activity/webhook rows and expose a caller-member, 100-row `list_activity` projection with bounded allowlisted evidence | Local only; hosted promotion pending exact owner approval |
| `025_harden_sensitive_assignments_and_protected_approval_integrity` | Detect non-placeholder generic secret assignments, bind protected approvals to exact pre-provider reservations, order write-token creation after the provider boundary, and serialize stable repository relinking | Local only; hosted promotion pending exact owner approval |

There is no `006` in the current Phase 1B chain. Do not rename applied migrations to close the numeric gap; ordering is determined by the full timestamp filename.

## Current hosted status

Project `qpuofpmagrmyamahqwxw` is `ACTIVE_HEALTHY`. Hosted migration history includes `001`, `002`, `003`, `004`, `005`, `007`, `008`, `009`, and `010`. `20260812000800_fix_github_sync_ambiguity.sql` additively qualifies the repository installation column and uses the named `github_repositories_external_unique` conflict constraint. `20260812000900_harden_github_project_and_sync.sql` serializes first-or-existing installation synchronization and makes the synchronized GitHub default branch authoritative.

`20260812001000_phase1d_observation_controls.sql` was applied transactionally through the Supabase SQL Editor after preflight returned `unsafe_project_rows=0`. Post-application hosted queries confirmed the organization kill-switch default is true, both constraints are validated, zero organizations have the switch OFF, zero unsafe projects exist, authenticated users have execute on the owner-only controls RPC, and anonymous users do not. This applies locked observation controls only; it does not connect an executor.

The Supabase CLI is authorized as `surgeservicesllc@gmail.com` and linked to exact project `qpuofpmagrmyamahqwxw`. The hosted ledger still ends at `010`. Linked database lint is clean against that hosted state. A linked push dry run successfully plans the complete local `011`-`025` chain and applies nothing. Authenticated cross-tenant and broader RPC/audit verification remain pending.

Migrations `011` through `025` exist in the published repository release but have not been applied to project `qpuofpmagrmyamahqwxw` and do not appear in its hosted ledger. Because this chain changes authorization, grants, audit behavior, mutation reservation/recovery, linked-project propagation, privileged webhook lifecycle reconciliation, a service-role CHECK-helper grant, browser-visible base-table access, stable repository authorization/relinking, owner approval/token/lease behavior, generic secret detection, and Activity projection, promotion requires exact current owner approval for this complete production target and sequence. After application, verify the ledger, lint, table/function/helper grants, RLS/FORCE RLS, actor/tenant/resource checks, direct raw Activity/webhook denial, safe list RPC outputs, stable repository binding/relink concurrency across rename/same-name/archive cases, protected approval/expiry/lease/token-order invariants, generic assignment rejection/placeholder allowance, immutable bounded/redacted activity evidence, terminal/out-of-order event behavior, retry/recovery behavior, provider-ingress CHECK evaluation, and application health.

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
8. list/activity projections expose only approved bounded fields, while authenticated direct reads of raw Activity/webhook rows fail;
9. stable repository IDs authorize project/change attribution and serialize active project relinking;
10. protected approval snapshots and write-token ordering cannot cross the durable provider boundary; and
11. no test claiming tenant isolation uses service role as the user-under-test.

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
