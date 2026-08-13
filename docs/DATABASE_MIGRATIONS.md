# Database migrations

Supabase migrations under `supabase/migrations/` are immutable schema history after they are applied. Corrections use a new forward migration.

## Current inventory

| Sequence | Purpose | Hosted state on 2026-08-13 |
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
| `011_harden_direct_mutation_boundaries` | Remove direct authenticated connection/member mutations and align database secret detection with `github_pat_` | Applied |
| `012_github_change_audit` | Add actor-attributed immutable completed/failed GitHub change-request evidence, including bounded branch/commit failure evidence | Applied |
| `013_reconcile_github_repository_grants` | Add service-role-only bounded upsert of repositories newly granted through a verified webhook | Applied |
| `014_sync_linked_project_repository_metadata` | Propagate provider-authoritative repository rename/default-branch changes to exact connection-linked projects with immutable redacted activity evidence | Applied |
| `015_recover_draft_pr_completion` | Recover a reserved change request from actor-attributed branch/commit/existing-draft-PR evidence after an ambiguous completion response | Applied |
| `016_guard_github_installation_terminal_state` | Make deletion terminal for an installation ID and order installation lifecycle events by provider time | Applied |
| `017_close_authenticated_control_plane_writes` | Remove remaining direct authenticated writes to connections/projects/links/change requests and reserve exact live changes through a narrow authenticated RPC | Applied |
| `018_order_github_repository_events` | Order repository metadata events by provider time; preserve terminal deletion and require explicit newer restore before unselected resynchronization | Applied |
| `019_allow_service_role_sensitive_json_checks` | Grant the service-role provider-ingress boundary only the SECURITY DEFINER sensitive-JSON wrapper needed by table CHECK evaluation; keep recursive/text helpers inaccessible | Applied |
| `020_safe_tenant_list_reads` | Revoke authenticated SELECT on sensitive control-plane base tables and add bounded caller-member safe-projection list RPCs | Applied |
| `021_bind_projects_to_github_repository_ids` | Persist the immutable tenant-scoped GitHub repository UUID on project connections and require exact change/project/repository binding | Applied |
| `022_owner_approved_protected_draft_changes` | Record immutable exact owner RED approval before protected-file provider execution and add a reclaimable five-minute pre-provider reservation lease | Applied |
| `023_github_activity_details` | Project bounded verified GitHub activity details and attribute project events through the stable repository UUID | Applied |
| `024_safe_activity_list_reads` | Revoke authenticated direct reads of raw Activity/webhook rows and expose a caller-member, 100-row `list_activity` projection with bounded allowlisted evidence | Applied |
| `025_harden_sensitive_assignments_and_protected_approval_integrity` | Detect non-placeholder generic secret assignments, bind protected approvals to exact pre-provider reservations, order write-token creation after the provider boundary, and serialize stable repository relinking | Applied |
| `026_narrow_hosted_service_role_table_grants` | Revoke hosted default-ACL table grants from `service_role` and restore SELECT/INSERT/UPDATE only on four GitHub ingress tables | Applied and verified |

There is no `006` in the current Phase 1B chain. Do not rename applied migrations to close the numeric gap; ordering is determined by the full timestamp filename.

## Current hosted status

Project `qpuofpmagrmyamahqwxw` is `ACTIVE_HEALTHY`. Hosted migration history is current through `026`, including `001`-`005` and `007`-`026`; local and remote history match. `20260812000800_fix_github_sync_ambiguity.sql` additively qualifies the repository installation column and uses the named `github_repositories_external_unique` conflict constraint. `20260812000900_harden_github_project_and_sync.sql` serializes first-or-existing installation synchronization and makes the synchronized GitHub default branch authoritative.

`20260812001000_phase1d_observation_controls.sql` was applied transactionally through the Supabase SQL Editor after preflight returned `unsafe_project_rows=0`. Post-application hosted queries confirmed the organization kill-switch default is true, both constraints are validated, zero organizations have the switch OFF, zero unsafe projects exist, authenticated users have execute on the owner-only controls RPC, and anonymous users do not. This applies locked observation controls only; it does not connect an executor.

The hosted ledger is current through `026`; local and remote match, linked dry run is up to date, and lint is clean. Catalog verification reports 23/23 public tables with RLS and FORCE RLS, 32 policies, zero policyless tables, 22 secret guards, and false tested raw authenticated/browser grants.

Migration `026` remediates the Supabase-managed default ACL drift found after `025`. Exact post-apply verification reports zero ACL-matrix mismatches: `service_role` has only SELECT/INSERT/UPDATE on the four GitHub ingress tables and no table privileges on the other 19. Never reset or repair hosted migration history.

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
