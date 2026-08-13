# Supabase setup

Production project: `qpuofpmagrmyamahqwxw` (`softwarefactory`). Hosted migration history currently has exactly 26 rows through `027`, but the hosted schema visibly contains post-`027` Phase 1E/provider/synthetic/bot/marketing objects. Draft PR #15 records the independent 53-table/61-policy catalog comparison and prior duplicate-object push failure. The ledger is stale and a normal push is prohibited until an exact owner-approved history repair reconciles it. Phase 1C migrations remain unhosted.

The only live SoftwareFactory owner is `surgeservicesllc@gmail.com`. The currently selected Supabase CLI profile returns `403`; reauthenticate as that owner and reconfirm the exact project ref before any linked command. The unauthorized profile must not be used.

## Existing hosted boundary

Hosted `001`-`027` provide Auth/onboarding, tenant/project/control-plane tables, RLS/FORCE RLS, GitHub App metadata and audited workflows, safe browser projections, immutable repository binding, protected draft approvals, narrow service-role ACLs, and dual-App handoff. Candidate installation `153479019` is connected for the owner repository path. Remaining second-tenant/reverse/disconnect/adverse Phase 1B acceptance gaps remain.

## Schema-present but ledger-unreconciled migrations

The hosted catalog contains the effects of `028`, provider `130001`, both historically colliding `130002` source files, bot fabric, and marketing. Do not execute these DDL files again. First map their exact source hashes and objects to the hosted catalog, then use only the owner-approved history-repair mechanism documented by Supabase.

## Forward migrations absent from hosted Supabase

- `20260813000600_phase1d_autonomy_controls.sql`: execution-inert nine-action/two-scope decision schema; global kill ON and every action OFF.
- `20260813000700_provider_phase1c_compatibility.sql`: additive/narrowing Phase 1C compatibility over immutable canonical provider migration `130001`.
- `20260813000800_phase1c_enums.sql`: Phase 1C enum values only; commit before dependent use.
- `20260813000900_phase1c_codex_execution.sql`: durable orchestration, workers/leases/evidence, safe projections, cancellation/retry, service-role RPCs, independent planning, RED blocks, RLS/FORCE RLS, and exact grants.
- `20260813001000_logical_agent_roster.sql`: eleven-role roster, owner/risk/ACL hardening, per-agent serialization, coherent recovery, bounded terminal reports, and safe projections.
- `20260813001100_phase1c_task_dependencies.sql`: canonical same-project dependencies, derived non-empty criteria, idempotent replay, and cumulative total turn/input/output budgets across retries.

Their local presence does not make the database current or the worker Connected. Applying them is RED protected work because it changes production schema, RLS/authorization, service-role functions, provider execution state, and audit behavior.

## Hosted Auth configuration

Retain exact redirect origins for the production alias and local loopback callbacks. Do not add wildcard redirects. Email sign-up/confirmation and the existing owner onboarding remain the application identity boundary; worker service role is never an interactive user.

## Protected promotion workflow

1. Keep provider execution, all Phase 1D actions, and `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` OFF/false. Obtain exact owner approval naming project `qpuofpmagrmyamahqwxw`, ledger repair for catalog-proven `028`/`130001`-`130005`, apply of absent `130006`-`130011`, protected secrets, disabled publication, bounded Phase 1C activation/run/deactivation, risks, expiry, validation, and containment.
2. Authenticate CLI as `surgeservicesllc@gmail.com`; verify account and exact project ref.
3. Compare exact local/linked history, catalog, and source hashes. Stop on any unexpected entry or mismatch; never reset hosted history or rerun schema-present DDL.
4. Review the history-repair matrix and all six forward SQL files; run the complete local chain, behavior tests, lint, and dry run.
5. Repair only the history for catalog-proven `028`/`130001`-`130005`; re-list and dry-run. Then apply and ledger-verify absent `130006`, `130007`, `130008`, `130009`, `130010`, and `130011` in timestamp order.
6. Re-list linked migrations and run linked database lint.
7. Verify every public table has RLS and FORCE RLS; inspect policies, table ACLs, function ACLs/search paths, foreign keys, indexes, constraints, triggers, and append-only guards.
8. Confirm authenticated/anonymous users have no direct worker-table mutation or broad reads; confirm member projections are bounded.
9. Confirm service role has only reviewed function execution and no unintended direct table privileges.
10. Exercise owner, member, second-tenant, anonymous, cancel/retry/status/detail, and service-worker claim/lease/terminal behavior separately. Include owner-only submission, criteria-derived risk, dependency tenant/project/order constraints, idempotent dependency replay, neutral roster preservation/rebinding, per-agent serialization, cumulative retry budgets, coherent artifact replay/conflict rejection, stale-lease/cancellation reports, and bounded report PR projection. Never use service role as the user-under-test.
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
- **Enum unsafe-use failure:** confirm catalog-proven bot-fabric `130003` precedes `130004`, and Phase 1C enum migration `130008` commits before `130009`.
- **Roster/dependency/recovery function missing:** confirm `130010` follows `130009` and `130011` follows `130010`, after ledger/catalog reconciliation.
- **Permission denied:** inspect session, active organization, function grant, role, lease tuple, and policy. Never disable RLS or grant broad table access.
- **Migration history differs:** stop and investigate; do not rename/delete/repair production history casually.
- **Worker says Not Connected:** a migration alone is insufficient; require protected secrets, a real workflow run, and fresh heartbeat.
- **Secret detector rejects evidence:** redact/summarize at the trusted boundary; never weaken the detector or store the raw value.
