# Database migrations

Supabase migrations under `supabase/migrations/` become immutable schema history after application. Corrections use a new forward migration. Never renumber, delete, edit, reset, or repair hosted history casually.

## Inventory and hosted state

| Sequence | Purpose | State on 2026-08-13 |
| --- | --- | --- |
| `001`-`003` | Core control plane, RLS/FORCE RLS, audited workflows | Hosted |
| `004`-`009` (no `006`) | GitHub integration, Auth onboarding, project linking, sync hardening | Hosted |
| `010` | Lock Phase 1D kill switch ON and automatic controls OFF | Hosted |
| `011`-`019` | Direct-write closure, GitHub audit/recovery/lifecycle, narrow provider-ingress helpers | Hosted |
| `020`-`026` | Safe browser projections, immutable repository binding, protected approvals, Activity boundary, secret/lease integrity, narrow service-role table ACL | Hosted |
| `027` | Dual-App owner approval and atomic history-preserving project handoff | Hosted and owner path verified |
| `028_phase1e_production_operations` | Operations monitoring, incidents, freeze, diagnosis, bounded repair work, rollback decisions, and reports without a production mutator | Hosted; schema/catalog mapping proven and ledger reconciled without DDL replay |
| `130001_provider_execution_layer` | Phase 2A provider configuration, routing decisions, advisory-run events/metadata, owner execution switch, RLS/FORCE RLS, and owner/admin RPCs | Hosted; schema/catalog mapping proven and ledger reconciled without DDL replay |
| `130002_phase1e_synthetic_journeys` | Project-scoped Basic/Standard/Critical journeys with schema-enforced safe steps/profile coverage and observation-only execution | Hosted; ledger reconciled without DDL replay |
| `130003_bot_fabric_activity_types` | Add bot-fabric activity-event values before dependent use | Hosted; ledger reconciled without DDL replay |
| `130004_bot_fabric` | Provider-neutral bot/role/assignment registry, tenant isolation, configuration-only readiness, and audited transitions | Hosted; ledger reconciled without DDL replay |
| `130005_marketing_content` | Separate public marketing-content schema and bounded write-only newsletter subscription path | Hosted; ledger reconciled without DDL replay |
| `130006_phase1d_autonomy_controls` | Execution-inert nine-action/two-scope decision controls; all actions remain constrained OFF | Hosted; all actions OFF, kill switch ON, no executor |
| `130007_provider_phase1c_compatibility` | Additive/narrowing compatibility over immutable hosted-source provider schema | Hosted |
| `130008_phase1c_enums` | Add `architect`/`performance` roles and Phase 1C terminal/retry activity values | Hosted |
| `130009_phase1c_codex_execution` | Durable command/task/run orchestration, worker leases/evidence, safe RPCs, risk/config enforcement, cancellation/retry, reports/activity | Hosted |
| `130010_logical_agent_roster` | Eleven-role roster, owner/risk/ACL/recovery/report hardening and bounded projections | Hosted |
| `130011_phase1c_task_dependencies` | Canonical same-project dependencies, derived criteria, idempotent replay, and cumulative retry budgets | Hosted |
| `130012_fix_bot_nullif_functions` | Forward-only repair of invalid bot `pg_catalog.nullif` qualification without widening function or ACL boundaries | Hosted; runtime/audit verification passed |
| `130013_fix_phase1c_function_lint` | Forward-only Phase 1C function lint repair with preserved locking/security/ACL behavior | Hosted; linked lint clean |
| `130014_resolve_emergency_stop` | Expose the existing emergency-stop state in the autonomy resolver without enabling an action | Hosted; all actions OFF, kill switch ON |
| `130015_expose_bounded_run_routing` | Restore assignment/run model checks from 120 to the original 128-character provider catalogue/API bound; add four no-secret constraints covering catalogue model/display-name, assignment model, and routing policy-version/selected-model text; expose capped/allowlisted run-detail routing evidence with rolling compatibility; revoke authenticated raw routing-decision/event SELECT while retaining model-catalogue SELECT | Local/unhosted; fresh exact RED approval required |

Production project `qpuofpmagrmyamahqwxw` is reconciled and current through `130014`. Before repair, the ledger ended at `027` while catalog evidence proved the effects of `028`/`130001`-`130005`, including a historical duplicate `130002` source-version collision. Under exact owner RED approval, those proven rows were repaired in history only and their DDL was not rerun. Forward migrations `130006`-`130014` were then applied in order. Linked lint and focused catalog/runtime/ACL checks pass. Future corrections must use a new forward migration; never reset, down-migrate, replay `130004`, or casually edit repaired history.

## Why history repair preceded `130006` -> `130014`

The schema effects of `028`/`130001`-`130005` already exist, so first prove their exact catalog/source mapping and repair only the missing history rows. `130006` adds the Phase 1D decision schema without enabling an action. `130007` carries Phase 1C compatibility without changing immutable `130001`. PostgreSQL does not safely allow a value added with `ALTER TYPE ... ADD VALUE` to be used before that transaction commits, so `130008` contains only enums and must commit before `130009`. `130010` then provisions/hardens the logical roster and recovery/report boundary. `130011` finally adds canonical dependencies and cumulative retry budgets over the completed execution schema.

## Phase 2A schema summary

Migration `130001` adds per-organization provider model configuration, immutable routing decisions, append-only provider run events, provider/model/usage/routing metadata on runs, and an owner-controlled organization execution flag defaulting OFF. Its write functions revalidate organization role and tenant identity; new tables use RLS and FORCE RLS. This schema enables only advisory artifacts and does not grant repository or delivery authority.

## Phase 1C schema summary

Migration `130009`:

- adds command type, acceptance criteria, execution plan, and risk assessment;
- adds task criteria, blocked reason, result summary, and dependency links;
- extends runs with command/connection/repository identity, risk, logical role, provider/model, exact base/head branches and SHAs, lease/attempt/cancellation/retry/result/usage/check/change evidence;
- adds `task_dependencies`, `phase1c_workers`, `phase1c_run_events`, `phase1c_run_artifacts`, and `phase1c_run_validations` with foreign keys, indexes, size/shape/secret constraints, RLS, and FORCE RLS;
- revokes direct table access and exposes bounded caller-member worker status and agent/task/run/report detail functions;
- exposes service-role-only worker registration, heartbeat, claim, run heartbeat, event, validation, artifact, and terminal-completion functions;
- adds owner/admin cancellation and eligible retry functions plus dispatch-outcome evidence;
- wraps command submission with authoritative SQL risk escalation and fixed provider/model/role/budget/workflow validation;
- creates logical role agents and queued runs only for manual GREEN/YELLOW work;
- prevents RED commands/tasks from becoming executable, including through legacy approval transitions;
- makes run events, artifacts, and validations append-only; and
- appends redacted activity and bounded report evidence for terminal transitions.

Migration `130010` then:

- provisions an idempotent provider-neutral roster for existing and future organizations: Orchestrator, Product, Architect, Frontend, Backend, Database, QA, Security, Performance, Release, and CEO Reporter;
- preserves user-created agents and explicit Phase 2A provider assignments, rebinds eligible factory-created work to logical roles, and removes obsolete factory rows only when unreferenced;
- reconciles provider-table service-role ACLs with the trusted Phase 2A persistence boundary rather than granting broad table access;
- maps general/`other` work to Orchestrator and serializes claims so one logical agent cannot hold concurrent active leases;
- makes `submit_command` owner-only, limits parameter/criteria size and top-level keys, rejects likely secrets, computes SQL risk from prompt plus acceptance criteria, and retains fixed provider/model/role/budget/workflow;
- validates exact lease-bound branch/commit/draft-PR artifacts and their `pull_requests` projection; accepts exact replay, rejects partial/conflicting evidence, and only resumes coherent state after revalidating remote branch SHA and PR identity;
- bounds retry to retryable failed attempts, terminalizes exhausted stale leases and cancellations with immutable evidence, and lets cancellation win at completion;
- creates or updates structured bounded reports for success, failure, cancellation, queued cancellation, and stale-lease terminalization; and
- reconstructs safe report PR links from authoritative database rows while bounding changed-file, check, validation, finding, security, retry, and cancellation content.

Migration `130011` then atomically stores canonical dependencies only for existing earlier tasks in the same organization/project, derives one deterministic acceptance criterion when none is supplied, repairs missing dependency rows on exact idempotent replay, and makes every retry claim receive only the remaining total turn/input/output budgets after persisted prior usage.

## Required local verification

Apply the complete chain to a disposable database or run the repository migration behavior suite. Verify:

1. Catalog/source hashes prove `028`/`130001`-`130005` before any history repair; `130006` preserves every Phase 1D interlock; `130007` applies provider compatibility; `130008` commits before `130009` uses Phase 1C enums; `130010` follows core execution; `130011` follows roster/recovery hardening; and local `130015` is tested after hosted-equivalent `130014`.
2. Every public table has RLS and FORCE RLS; every new table has deliberate policies and grants.
3. Authenticated callers cannot directly mutate or broadly select worker/evidence tables.
4. Member list/detail/status functions enforce organization membership, size caps, and allowlisted fields.
5. Service role can execute only the reviewed worker functions, not gain broad direct table rights.
6. Only an organization owner can call `submit_command`; direct authenticated input cannot lower prompt/criteria-derived risk, exceed the exact key/size/dependency contract, enumerate cross-tenant tasks, contain likely secrets, or change provider/model/role/budget/workflow.
7. RED cannot queue/claim/run even if approval state changes.
8. Every organization has the standard logical roster without overwriting user-created agents or explicit provider assignments, general Phase 1C work maps to Orchestrator, provider-account identity remains separate, and no logical agent can have two active leases.
9. Repository binding, base SHA, lease token, worker ID, attempt, cancellation, branch/commit/PR coherence, and projected pull request are all revalidated; conflicting replay is rejected.
10. Events/artifacts/validations reject update/delete and secret-bearing evidence.
11. Completion, queued cancellation, and exhausted stale leases update state and create bounded structured report/activity evidence atomically; cancellation wins at the final safe boundary, and retries cannot reset total provider budgets.
12. Owner/cross-tenant/anonymous paths are tested with caller sessions, not service role as the user-under-test.
13. `130015` preserves the exact assignment model regex and other constraint semantics while accepting 128-character model identifiers across assignment, run, and project-default flows; installs four named immutable-function no-secret checks covering catalogue model/display-name, assignment model, and routing policy-version/selected-model text; preserves `get_agent_run_detail(uuid, uuid)` signature, `SECURITY DEFINER`, pinned search path, and authenticated-only ACL; caps/allowlists Phase 1C and Phase 2A routing evidence; returns null/legacy absence without invented reasons; denies authenticated/anonymous raw reads of routing decisions/events; and retains the intended tenant-scoped model-configuration read. Valid boundary values and credential-shaped values are exercised through the reviewed catalogue/RPC/direct paths.

Typical disposable local commands:

```bash
npx supabase db reset
npx supabase db lint
npm run test:integration
```

`db reset` is destructive and may be used only against a verified disposable local database. Never run it against hosted production.

## Completed protected reconciliation record

The production history repair and promotion through `130014` were completed under exact owner RED approvals. The executor authenticated as the exact owner, reconfirmed project `qpuofpmagrmyamahqwxw`, matched source hashes and catalog objects, repaired only catalog-proven history rows, and never replayed schema-present DDL. The forward chain was applied in order; the final ledger, definitions, RLS/FORCE RLS, table/function ACLs, append-only behavior, focused runtime, linked lint, all-actions-OFF/kill-switch-ON state, and application health passed. The temporary release token was revoked. This is a historical evidence record, not an instruction to repeat the repair.

Supabase documents that `migration repair --status applied` changes only migration history and does not execute SQL. That property was used only after complete schema proof. Do not repair these rows again, reset hosted production, down-migrate, or replay `130004`.

## Pending `130015` forward promotion

Hosted production remains at `130014`. Applying `20260813001500_expose_bounded_run_routing.sql` is a new RED action because it widens two production constraints, adds four scalar no-secret constraints, changes a caller-visible SECURITY DEFINER projection, and changes two authenticated table ACLs while preserving the intended model-catalogue read. No prior approval covers it.

1. Obtain fresh exact owner approval naming project `qpuofpmagrmyamahqwxw`, exact file `20260813001500_expose_bounded_run_routing.sql`, frozen size 13,121 bytes, SHA-256 `3E1BEA8F5DAB912D5D7D6251E4503C319816B27EF2465DB5E8612E26A3DD1A13`, both 120-to-128 constraint changes, `provider_model_configurations_text_not_secret`, `provider_routing_decisions_policy_version_not_secret`, `provider_agent_assignments_model_not_secret`, `provider_routing_decisions_selected_model_not_secret`, both raw-SELECT revokes, retained model-catalogue SELECT, the run-detail projection, risk, expiry, validation, and forward-only containment.
2. Authenticate as the exact owner, reconfirm project identity and ledger through `130014`, and stop on any identity/history/catalog/hash drift.
3. Apply only `130015`; never reset, down-migrate, replay an earlier migration, or widen provider/autonomy execution.
4. Verify the exact definitions of both widened and all four new no-secret constraints; exercise 128-character assignment/run/project-default behavior, valid scalar values, and rejection of credential-shaped catalogue model/display-name, assignment model, and routing policy-version/selected-model text through reviewed RPC/direct paths; verify both routing-table ACL revokes and retained model-catalogue SELECT; verify `get_agent_run_detail(uuid, uuid)` definition, signature, `SECURITY DEFINER`, pinned search path, and ACL; then exercise bounded Phase 1C/Phase 2A/legacy routing behavior plus raw-table, tenant, and anonymous denial.
5. Re-list the ledger, run linked lint and health, confirm provider/worker execution remains OFF and the global kill switch remains ON, and record exact evidence. Stop on any mismatch and contain only with a new forward migration.

Never run production migrations from untrusted pull-request code or a fork. A migration apply does not itself connect the Codex worker.
