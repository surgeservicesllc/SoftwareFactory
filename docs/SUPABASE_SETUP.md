# Supabase setup

Production project: `qpuofpmagrmyamahqwxw` (`softwarefactory`). The owner-approved history repair and forward-only migration sequence are complete through `20260813001400_resolve_emergency_stop.sql`. Post-apply catalog, RLS/FORCE RLS, ACL, function-boundary, bot-runtime, autonomy-OFF/kill-ON, and linked-lint checks passed. Do not reset, down-migrate, or replay the historical colliding DDL.

The only live SoftwareFactory owner is `surgeservicesllc@gmail.com`. Any future linked command must re-confirm that identity and exact project ref; an unrelated CLI profile must not be used.

## Existing hosted boundary

Hosted `001`-`027` provide Auth/onboarding, tenant/project/control-plane tables, RLS/FORCE RLS, GitHub App metadata and audited workflows, safe browser projections, immutable repository binding, protected draft approvals, narrow service-role ACLs, and dual-App handoff. Candidate installation `153479019` is connected for the owner repository path. Remaining second-tenant/reverse/disconnect/adverse Phase 1B acceptance gaps remain.

## Reconciled historical migrations

The hosted catalog effects of `028`, provider `130001`, synthetic journeys, bot fabric, and marketing were matched to their exact source objects before their history rows were repaired. Do not execute those historical DDL files again.

## Hosted forward migrations

- `20260813000600_phase1d_autonomy_controls.sql`: execution-inert nine-action/two-scope decision schema; global kill ON and every action OFF.
- `20260813000700_provider_phase1c_compatibility.sql`: additive/narrowing Phase 1C compatibility over immutable canonical provider migration `130001`.
- `20260813000800_phase1c_enums.sql`: Phase 1C enum values only; commit before dependent use.
- `20260813000900_phase1c_codex_execution.sql`: durable orchestration, workers/leases/evidence, safe projections, cancellation/retry, service-role RPCs, independent planning, RED blocks, RLS/FORCE RLS, and exact grants.
- `20260813001000_logical_agent_roster.sql`: eleven-role roster, owner/risk/ACL hardening, per-agent serialization, coherent recovery, bounded terminal reports, and safe projections.
- `20260813001100_phase1c_task_dependencies.sql`: canonical same-project dependencies, derived non-empty criteria, idempotent replay, and cumulative total turn/input/output budgets across retries.
- `20260813001200_fix_bot_nullif_functions.sql`, `20260813001300_fix_phase1c_function_lint.sql`, and `20260813001400_resolve_emergency_stop.sql`: forward-only lint and emergency-stop repairs that preserve reviewed signatures, ACLs, and fail-closed autonomy state.

These migrations are hosted and verified. Their presence does not make the worker Connected: the OpenAI secret and activation variable are absent, and no successful Codex-to-draft-PR acceptance run exists.

## Local forward migration awaiting approval

`20260813001500_expose_bounded_run_routing.sql` is local and unhosted. It restores `provider_agent_assignments_model_check` and `agent_runs_model_check` from the accidental 120-character narrowing to the original 128-character provider catalogue/API contract while retaining the assignment regex and all other semantics. It adds `provider_model_configurations_text_not_secret`, `provider_routing_decisions_policy_version_not_secret`, `provider_agent_assignments_model_not_secret`, and `provider_routing_decisions_selected_model_not_secret`, using immutable likely-secret checks for catalogue model/display-name, assignment model, and routing policy-version/selected-model text. It also preserves the `get_agent_run_detail(uuid, uuid)` signature/security/ACL boundary while adding capped, allowlisted Phase 1C/Phase 2A routing evidence and supporting commandless advisory runs; revokes authenticated raw SELECT on routing decisions/events; and retains tenant-scoped model-configuration SELECT. The application accepts an absent/null routing field against hosted `130014` and fails closed on credential-shaped pre-migration catalogue scalars.

No existing approval authorizes this migration. Before applying it, obtain fresh exact RED approval naming the complete file, frozen size 13,121 bytes, SHA-256 `3E1BEA8F5DAB912D5D7D6251E4503C319816B27EF2465DB5E8612E26A3DD1A13`, both widened constraints, all four new no-secret constraints, both raw-SELECT revokes, retained model-catalogue SELECT, projection, target `qpuofpmagrmyamahqwxw`, window, validation, and containment. Apply only `130015`; verify ledger, all six changed/added constraint definitions, 128-character assignment/run/project behavior, valid and negative credential-shaped catalogue/assignment/routing scalar behavior through reviewed paths, exact table ACLs, function definition/signature/`SECURITY DEFINER`/search path/ACL, bounded routing behavior, raw-table/tenant/anonymous denial, retained model-catalogue reads, linked lint, health, all actions OFF, and kill switch ON. Stop on any mismatch and use only a new forward migration for containment.

## Hosted Auth configuration

Retain exact redirect origins for the production alias and local loopback callbacks. Do not add wildcard redirects. Email sign-up/confirmation and the existing owner onboarding remain the application identity boundary; worker service role is never an interactive user.

## Protected promotion record and future changes

The protected repair/promotion was executed under exact owner approval, with before/after ledger evidence, catalog verification, linked lint, and forward-only containment. For any future production schema change: keep the worker and every autonomous action OFF; authenticate as the exact owner; bind the exact project, source hash, migration name, risk, expiry, validation, and containment in fresh approval; stop on drift; and use only a new forward migration. Re-run tenant, anonymous, ACL, RLS, function, append-only, lease, and report checks affected by that change.

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
