# Supabase setup

Production project: `qpuofpmagrmyamahqwxw` (`softwarefactory`). Hosted history is verified through migration `027` only. Phase 1E migration `028` and Phase 2A/synthetic-journey/bot-fabric/marketing/Phase 1C migrations `130001` through `130008` are **UNHOSTED**.

The only live SoftwareFactory owner is `surgeservicesllc@gmail.com`. Reauthenticate the Supabase CLI as that identity and reconfirm the exact project ref before any linked command. The previously selected wrong/unauthorized profile must not be used.

## Existing hosted boundary

Hosted `001`-`027` provide Auth/onboarding, tenant/project/control-plane tables, RLS/FORCE RLS, GitHub App metadata and audited workflows, safe browser projections, immutable repository binding, protected draft approvals, narrow service-role ACLs, and dual-App handoff. Candidate installation `153479019` is connected for the owner repository path. Remaining second-tenant/reverse/disconnect/adverse Phase 1B acceptance gaps remain.

## Pending migrations

- `20260812002800_phase1e_production_operations.sql`: production-monitoring, incident, freeze, diagnosis, bounded repair-work, rollback-decision, reporting, and durable operations control-plane records. It does not connect a production target or authorize production mutation.
- `20260813000100_provider_execution_layer.sql`: Phase 2A provider configuration, routing, advisory-run events/metadata, execution flag defaulting OFF, RLS/FORCE RLS, and owner/admin functions.
- `20260813000200_phase1e_synthetic_journeys.sql`: project-scoped Basic/Standard/Critical journeys with database-enforced safe steps and profile coverage; read steps may be observed, while declared writes are recorded as skipped and never issued.
- `20260813000300_bot_fabric_activity_types.sql`: bot-fabric activity-event enum additions committed before dependent bot-fabric use.
- `20260813000400_bot_fabric.sql`: provider-neutral bot, role, and project-assignment registry with tenant isolation and configuration-only readiness; it is not an execution surface.
- `20260813000500_marketing_content.sql`: separate public marketing-content schema and bounded write-only newsletter subscription path.
- `20260813000600_phase1c_enums.sql`: Phase 1C enum values only. PostgreSQL must commit these before dependent use.
- `20260813000700_phase1c_codex_execution.sql`: durable orchestration, worker heartbeat/leases, execution evidence, safe detail/status, cancellation/retry, service-role worker functions, independent risk/plan enforcement, logical agents, RED blocking, terminal reports/activity, RLS/FORCE RLS, and exact grants.
- `20260813000800_logical_agent_roster.sql`: eleven-role logical roster and existing-row reconciliation, explicit provider-assignment preservation, owner-only submission and acceptance-criteria risk parity, per-agent lease serialization, provider-table ACL reconciliation, coherent branch/commit/draft-PR evidence and recovery, bounded retry/stale-lease/cancellation terminalization, structured reports, and safer projections.

Their local presence does not make the database current or the worker Connected. Applying them is RED protected work because it changes production schema, RLS/authorization, service-role functions, provider execution state, and audit behavior.

## Hosted Auth configuration

Retain exact redirect origins for the production alias and local loopback callbacks. Do not add wildcard redirects. Email sign-up/confirmation and the existing owner onboarding remain the application identity boundary; worker service role is never an interactive user.

## Protected promotion workflow

1. Keep the organization provider-execution flag and `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` OFF/false and obtain exact current owner approval naming project `qpuofpmagrmyamahqwxw`, migration `028`, migrations `130001` through `130008`, protected secret configuration, disabled publication, the bounded activation/run/deactivation window, risks, expiry, validation, and containment.
2. Authenticate CLI as `surgeservicesllc@gmail.com`; verify account and exact project ref.
3. Compare local/linked migration history. Stop on any unexpected entry or mismatch; never repair or reset hosted history to force alignment.
4. Review all nine SQL files and run the complete local migration chain, behavior tests, lint, and linked dry run.
5. Apply and ledger-verify `028`, then `130001`, `130002`, `130003`, `130004`, `130005`, `130006`, `130007`, and `130008` in timestamp order. Stop on any failure or unexpected catalog/history change.
6. Re-list linked migrations and run linked database lint.
7. Verify every public table has RLS and FORCE RLS; inspect policies, table ACLs, function ACLs/search paths, foreign keys, indexes, constraints, triggers, and append-only guards.
8. Confirm authenticated/anonymous users have no direct worker-table mutation or broad reads; confirm member projections are bounded.
9. Confirm service role has only reviewed function execution and no unintended direct table privileges.
10. Exercise owner, member, second-tenant, anonymous, cancel/retry/status/detail, and service-worker claim/lease/terminal behavior separately. Include owner-only submission, criteria-derived risk, neutral roster preservation/rebinding, per-agent serialization, coherent artifact replay/conflict rejection, stale-lease/cancellation reports, and bounded report PR projection. Never use service role as the user-under-test.
11. Confirm existing Phase 1B installation/project/history is unchanged and the worker remains disabled until protected Actions configuration is complete.
12. Record exact hosted evidence in repository memory.

Never use `supabase db reset` against hosted production. It is allowed only for a confirmed disposable local database.

## Phase 1C RLS expectations

- `task_dependencies`, `phase1c_workers`, `phase1c_run_events`, `phase1c_run_artifacts`, and `phase1c_run_validations` use RLS and FORCE RLS.
- Every existing and future organization receives the eleven provider-neutral standard roles idempotently; user-created agents are preserved and provider/model remain on runs rather than logical identities.
- Browser sessions do not directly read workers and do not directly mutate any execution evidence.
- Member reads use bounded safe list/detail/status functions.
- Submission requires organization ownership. Owner/admin cancellation and retry functions revalidate role, organization, run state, bounded reason, attempt/retryability, and audit evidence.
- Service-role worker functions revalidate worker ID, lease UUID, run, logical-agent serialization, attempt, cancellation, status, data shape, coherent artifact/PR identity, and secret constraints.
- Run event/artifact/validation evidence is append-only.
- RED commands/tasks cannot enter a claimable state.
- Success/failure/cancellation, queued cancellation, and exhausted stale leases create bounded result/report/activity evidence that rejects likely secrets and derives safe PR links from authoritative rows.

## Secret handling

The Supabase URL and publishable key may reach the browser. Service role, database credentials, OpenAI API key, App private keys, and installation tokens may not. Phase 1C rows store only non-secret identity, plan, status, references, bounded summaries, usage/check metadata, and immutable evidence. They are not a credential store.

The GitHub Actions worker uses `SOFTWAREFACTORY_SUPABASE_URL` and `SOFTWAREFACTORY_SUPABASE_SERVICE_ROLE_KEY` repository secrets, mapped to runtime variables only for the worker step. Their values must never be printed or copied into source.

## Troubleshooting

- **Profile/project mismatch:** stop. Reauthenticate and reconfirm `qpuofpmagrmyamahqwxw`; do not mutate.
- **Enum unsafe-use failure:** confirm bot-fabric enum migration `130003` completed before `130004`, and Phase 1C enum migration `130006` completed before `130007`.
- **Roster/recovery/report function missing:** confirm `130008` applied only after `028` and `130001` through `130007` completed with ledger/catalog verification.
- **Permission denied:** inspect session, active organization, function grant, role, lease tuple, and policy. Never disable RLS or grant broad table access.
- **Migration history differs:** stop and investigate; do not rename/delete/repair production history casually.
- **Worker says Not Connected:** a migration alone is insufficient; require protected secrets, a real workflow run, and fresh heartbeat.
- **Secret detector rejects evidence:** redact/summarize at the trusted boundary; never weaken the detector or store the raw value.
