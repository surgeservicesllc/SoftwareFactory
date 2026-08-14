# Project context

## Product

SoftwareFactory is a tenant-scoped software-engineering control plane. It joins authenticated projects to provider connections, logical agents, durable commands, tasks, runs, validation, source-control artifacts, reports, approvals, and immutable audit evidence. A logical agent, provider credential, model, user, project, and repository are separate records and must never be treated as interchangeable.

## Active delivery tracks

The published default branch contains the Phase 2A advisory provider layer and the execution-inert Phase 1D decision layer. Hosted Supabase is reconciled through migration `20260813001400_resolve_emergency_stop.sql`; local migration `20260813001500_expose_bounded_run_routing.sql` is not hosted and awaits its own exact RED approval. `130015` restores the original 128-character provider catalogue/API bound for assignment/run model checks, rejects credential-shaped catalogue model/display-name, assignment model, and routing policy-version/selected-model text in browser-readable rows, adds bounded run-detail routing evidence, and closes raw authenticated reads of routing decisions/events while retaining RLS-scoped model-configuration reads. Provider execution remains OFF, provider credentials/live calls are unverified, the global kill switch remains ON, all nine automatic actions remain OFF, and no autonomous executor exists. Both provider execution and Phase 1D execution remain **Not Connected**.

The published repository contains a **Phase 1C implementation** for a manually requested Codex execution path:

`Owner command -> deterministic plan -> durable run -> Codex SDK worker -> isolated factory branch -> validation -> draft pull request -> CI observation -> SoftwareFactory result`

This implementation is not yet a Connected worker capability. Under exact owner RED approval and scoped forward-only deltas, the hosted ledger was reconciled for catalog-proven `028`/`130001`-`130005` without rerunning their DDL, and forward migrations `130006`-`130014` were applied to exact project `qpuofpmagrmyamahqwxw`. Linked lint is clean; bot register/update/readiness runtime and audit behavior passed `1/1/1`; the repaired bot functions contain zero `pg_catalog.nullif` while retaining signatures, `SECURITY DEFINER`, pinned `search_path`, and ACLs; and the hosted autonomy resolver reports emergency-stop state while all actions remain OFF and the kill switch remains ON. The workflow is published and six non-OpenAI worker secrets remain configured, but activation is absent/OFF and the exposed OpenAI key was removed. The first live claim recorded a heartbeat and provider thread before failing safely without a repository change; no-claim diagnostic run `31748582858` then identified `credit_balance_exhausted`. The failed run's immutable base SHA now predates current `main`, so it must not be retried; a new command must be bound to the then-current base after funded-provider proof. OpenAI/Codex therefore remains **Not Connected**.

The frozen current-update candidate passes local Node `24.19.0` lint/typecheck, 118 Vitest files/1,311 tests, coverage 76.70/71.47/74.04/78.11, a 74/74-route production build, Playwright/axe 117/117, production dependency audit 0, and clean diff-check. These are local final-candidate results only; publication commit, CI, matching Vercel deployment, and hosted `130015` proof remain pending. The prior verified production baseline remains `0c662a24393f682073e6002c5aff9339292226d8`, CI run `31749352644`, and READY deployment `dpl_FJKMapsyLB4hQPDsaykUo1cVUQp7`. Neither evidence set proves a successful provider execution or draft-PR journey.

Phase 1B retains its verified owner path: candidate GitHub App `4582606`, installation `153479019`, connection `85591f43-dd4e-46d2-8a1b-0f036b32639f`, and project `b1f23696-437e-4d89-b55f-d7a949980e8f` are connected for exactly `surgeservicesllc/SoftwareFactory`. Primary installation `153445938` remains the rollback path while its webhook defect is tracked by GitHub Support ticket `#4660724`. The live second-tenant, reverse-handoff, disconnect, and remaining adverse matrix are still incomplete.

The only live SoftwareFactory owner identity is `surgeservicesllc@gmail.com`. Reviewed commits and worker-created commits use `surgeservicesllc <surgeservicesllc@gmail.com>` as both author and committer.

## Phase 1C authority boundary

Phase 1C allows only an authenticated, manually submitted GREEN or YELLOW command against the exact active project/repository binding captured at submission. The database independently recomputes the risk floor and fixes the provider, model, logical role, budgets, and draft-PR workflow so browser input cannot widen execution authority.

RED commands are persisted truthfully but remain blocked from worker execution. An owner approval does not widen the Phase 1C ceiling. Autonomous Mode remains OFF, the Phase 1D global kill switch remains ON, and automatic approval, merge, deployment, and rollback remain OFF.

The implementation uses the server-side TypeScript `@openai/codex-sdk` from a reviewed GitHub Actions worker. Vercel request handlers only persist and dispatch intent; they never run Codex. The worker must claim a short lease from Supabase, revalidate an immutable repository snapshot, execute in an isolated workspace, pass deterministic validation and protected-path/secret policy scans, push a `factory/*` branch, create or recover only a draft pull request, observe exact-head CI, and persist bounded redacted evidence.

## Truthful status language

- **Demo Data** means seeded or static presentation data.
- **Not Connected** means no verified end-to-end provider session or worker heartbeat/run is available.
- **Configured** means code or protected configuration exists; it does not prove connectivity.
- **Queued** means intent and a durable run exist; it does not prove a worker claimed or executed it.
- A draft pull request is not a merge or deployment.
- Local migrations and passing mocks are not hosted database evidence.

## Product principles

1. Truth before theater: status follows fresh durable evidence.
2. Safe by default: external mutation starts OFF and fails closed.
3. Server-side trust: provider credentials and privileged workflows never enter the browser.
4. Independent tenant defense: application checks and Supabase RLS both enforce ownership.
5. Immutable provider identity: execution is bound to repository IDs and an exact base SHA, not prompt text or a mutable repository name.
6. Bounded execution: time, turns, tokens, retries, output, changed files, and CI observation have hard limits.
7. Review before delivery: Phase 1C ends at a validated draft pull request and recorded CI state.
8. Auditability: leases, events, artifacts, validations, cancellation, retry, and results are durable and redacted.
9. Progressive authority: the Phase 1C draft-PR worker, Phase 2A advisory provider execution, and Phase 1D autonomy are separate authority surfaces; enabling one never enables another.

## Phase 1C exit criteria

Phase 1C is complete only after the exact reconciled and published tree passes all release and live-acceptance gates. Hosted reconciliation through `130014`, prior workflow/publication evidence, and the frozen current update's local final-candidate gates are complete; current publication CI/deployment and exact RED promotion/verification of local `130015` remain pending. The remaining provider exit gate is a funded-provider diagnostic followed by a new current-base command producing a real Codex execution, isolated branch/commit, open draft pull request, deterministic validation, stable exact-head required-check success, safe UI/detail evidence, and immutable audit trail. Applying `130006` or `130015` does not authorize Phase 1D or provider execution. `AI/QUALITY_SCORECARD.md` is the evidence record.
