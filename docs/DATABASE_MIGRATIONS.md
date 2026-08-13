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
| `028_phase1e_production_operations` | Operations monitoring, incidents, freeze, diagnosis, bounded repair work, rollback decisions, and reports without a production mutator | **UNHOSTED**; source published on main |
| `130001_provider_execution_layer` | Phase 2A provider configuration, routing decisions, advisory-run events/metadata, owner execution switch, RLS/FORCE RLS, and owner/admin RPCs | **UNHOSTED**; source published on main |
| `130002_phase1e_synthetic_journeys` | Project-scoped Basic/Standard/Critical journeys with schema-enforced safe steps/profile coverage and observation-only execution | **UNHOSTED**; source published on main |
| `130003_bot_fabric_activity_types` | Add bot-fabric activity-event values before dependent use | **UNHOSTED**; source published on main |
| `130004_bot_fabric` | Provider-neutral bot/role/assignment registry, tenant isolation, configuration-only readiness, and audited transitions | **UNHOSTED**; source published on main |
| `130005_marketing_content` | Separate public marketing-content schema and bounded write-only newsletter subscription path | **UNHOSTED**; source published on main |
| `130006_phase1c_enums` | Add `architect`/`performance` roles and Phase 1C terminal/retry activity values | **UNHOSTED**; local Phase 1C candidate |
| `130007_phase1c_codex_execution` | Durable command/task/run orchestration, worker leases/evidence, safe RPCs, risk/config enforcement, cancellation/retry, reports/activity | **UNHOSTED**; local Phase 1C candidate |
| `130008_logical_agent_roster` | Eleven-role logical roster, owner/risk hardening, per-agent serialization, provider-table ACL reconciliation, coherent artifact/recovery rules, stale-lease/cancellation terminalization, structured reports and bounded projections | **UNHOSTED**; local Phase 1C candidate |

Production project `qpuofpmagrmyamahqwxw` is verified only through `027`. Migration `028` and migrations `130001` through `130008` are pending protected changes. Their presence in source, on main, or in passing migration tests is not hosted evidence.

## Why the `028` -> `130001` -> `130002` -> `130003` -> `130004` -> `130005` -> `130006` -> `130007` -> `130008` order is mandatory

`028` establishes the Phase 1E operations schema. `130001` establishes the Phase 2A provider columns, tables, and functions that every later layer must preserve. `130002` adds the Phase 1E synthetic-journey schema. Bot-fabric enum migration `130003` must commit before dependent registry migration `130004`; marketing migration `130005` then adds its separate public schema. PostgreSQL does not safely allow a value added with `ALTER TYPE ... ADD VALUE` to be used before the transaction that added it commits, so Phase 1C migration `130006` contains only enum additions and must commit before `130007` performs dependent casts and creates the execution schema. `130008` is the forward roster, recovery, report, and provider-ACL compatibility migration over the provider and worker schemas; it must not be folded into or applied before `130007`. Always apply all nine in timestamp order.

## Phase 2A schema summary

Migration `130001` adds per-organization provider model configuration, immutable routing decisions, append-only provider run events, provider/model/usage/routing metadata on runs, and an owner-controlled organization execution flag defaulting OFF. Its write functions revalidate organization role and tenant identity; new tables use RLS and FORCE RLS. This schema enables only advisory artifacts and does not grant repository or delivery authority.

## Phase 1C schema summary

Migration `130007`:

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

Migration `130008` then:

- provisions an idempotent provider-neutral roster for existing and future organizations: Orchestrator, Product, Architect, Frontend, Backend, Database, QA, Security, Performance, Release, and CEO Reporter;
- preserves user-created agents and explicit Phase 2A provider assignments, rebinds eligible factory-created work to logical roles, and removes obsolete factory rows only when unreferenced;
- reconciles provider-table service-role ACLs with the trusted Phase 2A persistence boundary rather than granting broad table access;
- maps general/`other` work to Orchestrator and serializes claims so one logical agent cannot hold concurrent active leases;
- makes `submit_command` owner-only, limits parameter/criteria size and top-level keys, rejects likely secrets, computes SQL risk from prompt plus acceptance criteria, and retains fixed provider/model/role/budget/workflow;
- validates exact lease-bound branch/commit/draft-PR artifacts and their `pull_requests` projection; accepts exact replay, rejects partial/conflicting evidence, and only resumes coherent state after revalidating remote branch SHA and PR identity;
- bounds retry to retryable failed attempts, terminalizes exhausted stale leases and cancellations with immutable evidence, and lets cancellation win at completion;
- creates or updates structured bounded reports for success, failure, cancellation, queued cancellation, and stale-lease terminalization; and
- reconstructs safe report PR links from authoritative database rows while bounding changed-file, check, validation, finding, security, retry, and cancellation content.

## Required local verification

Apply the complete chain to a disposable database or run the repository migration behavior suite. Verify:

1. `028` applies before the `130xxx` chain; `130001` establishes the provider layer; `130002` adds synthetic journeys; `130003` commits before `130004` uses the bot-fabric event values; `130005` adds marketing; `130006` commits before `130007` uses the Phase 1C enum values; and `130008` applies only after both provider and core Phase 1C schemas exist.
2. Every public table has RLS and FORCE RLS; every new table has deliberate policies and grants.
3. Authenticated callers cannot directly mutate or broadly select worker/evidence tables.
4. Member list/detail/status functions enforce organization membership, size caps, and allowlisted fields.
5. Service role can execute only the reviewed worker functions, not gain broad direct table rights.
6. Only an organization owner can call `submit_command`; direct authenticated input cannot lower prompt/criteria-derived risk, exceed the exact key/size contract, contain likely secrets, or change provider/model/role/budget/workflow.
7. RED cannot queue/claim/run even if approval state changes.
8. Every organization has the standard logical roster without overwriting user-created agents or explicit provider assignments, general Phase 1C work maps to Orchestrator, provider-account identity remains separate, and no logical agent can have two active leases.
9. Repository binding, base SHA, lease token, worker ID, attempt, cancellation, branch/commit/PR coherence, and projected pull request are all revalidated; conflicting replay is rejected.
10. Events/artifacts/validations reject update/delete and secret-bearing evidence.
11. Completion, queued cancellation, and exhausted stale leases update state and create bounded structured report/activity evidence atomically; cancellation wins at the final safe boundary.
12. Owner/cross-tenant/anonymous paths are tested with caller sessions, not service role as the user-under-test.

Typical disposable local commands:

```bash
npx supabase db reset
npx supabase db lint
npm run test:integration
```

`db reset` is destructive and may be used only against a verified disposable local database. Never run it against hosted production.

## Protected hosted promotion

Applying `028` and `130001` through `130008` to production is RED because it changes RLS/authorization, service-role RPCs, operations/provider state, synthetic/bot/marketing schemas, roster/recovery/report behavior, audit state, and the production schema. It requires exact current owner approval naming the project, files, risks, expiry, validation, and containment plan.

1. Authenticate the Supabase CLI as `surgeservicesllc@gmail.com`.
2. Reconfirm exact project ref `qpuofpmagrmyamahqwxw`; stop if profile/project identity is ambiguous.
3. Compare local and remote history and verify only reviewed `028` and `130001` through `130008` are pending.
4. Review SQL, risk, grants, ownership, RLS/FORCE RLS, secret checks, and recovery/containment.
5. Run the complete local chain, migration tests, lint, and linked dry run.
6. Apply and confirm the ledger commit for `028`, then `130001`, `130002`, `130003`, `130004`, `130005`, `130006`, `130007`, and `130008` through the approved path. Stop immediately on any mismatch or failure.
7. Re-list migrations and run linked database lint.
8. Verify catalog, policies, table/function ACLs, indexes, constraints, trigger/function definitions, append-only behavior, and zero unintended service-role grants.
9. Exercise owner, member, second-tenant, and anonymous caller behavior plus Phase 2A trusted persistence and service-role worker behavior separately, including provider execution default OFF, the standard roster, per-agent serialization, coherent recovery, cancellation/stale-lease reports, and safe report projection.
10. Verify application health, both provider and worker execution remain disabled until separately activated, and no existing Phase 1B data/binding changed.
11. Record exact hosted evidence in `AI/CURRENT_STATE.md` and `AI/QUALITY_SCORECARD.md`.

Never run production migrations from untrusted pull-request code or a fork. A migration apply does not itself connect the Codex worker.
