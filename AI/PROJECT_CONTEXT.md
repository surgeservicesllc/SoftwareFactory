# Project context

## Product

SoftwareFactory is a tenant-scoped software-engineering control plane. It joins authenticated projects to provider connections, logical agents, durable commands, tasks, runs, validation, source-control artifacts, reports, approvals, and immutable audit evidence. A logical agent, provider credential, model, user, project, and repository are separate records and must never be treated as interchangeable.

## Active delivery tracks

Main commit `b1060b83a0698a83e202aafdf9792886cf60a8b3` contains the Phase 2A advisory provider layer: official Anthropic/OpenAI adapters, model discovery, deterministic routing, controlled fallback, independent-review enforcement, server APIs, and settings/run surfaces. Its migration `20260813000100_provider_execution_layer.sql` is not hosted, provider credentials are not verified configured, the organization execution switch defaults OFF, and no live provider call exists. The code is published; outbound provider execution remains **Not Connected**.

The repository contains a **local Phase 1C implementation candidate** for a manually requested Codex execution path:

`Owner command -> deterministic plan -> durable run -> Codex SDK worker -> isolated factory branch -> validation -> draft pull request -> CI observation -> SoftwareFactory result`

This implementation is not yet a Connected worker capability. Hosted Supabase has post-`027` Phase 1E/provider/synthetic/bot/marketing schema objects, but its migration ledger still contains exactly 26 rows through `027`; a prior normal push hit a duplicate-object failure. The duplicate applied `130002` source version and five unrecorded applied versions require exact catalog-to-source reconciliation and an owner-approved history repair before any further push. Phase 1C migrations remain unhosted. The Phase 1C GitHub Actions secrets and activation variable are absent, the worker has not produced a live heartbeat, and no real Codex run has completed. OpenAI/Codex therefore remains **Not Connected**.

The final reconciled tree passes its Node `24.19.0` gate set: lint/typecheck, 97 test files/959 tests, production build with 62/62 page-data entries, coverage 72.37/66.79/68.80/74.13, Playwright/axe 117/117 across desktop/tablet/mobile, dependency audit 0, safe disabled-worker smoke, clean high-confidence source/static secret-value scans, clean diff check apart from line-ending notices, and focused migration/API security audits with no remaining P0/P1 blocker. Local results still do not prove hosted or live-provider acceptance.

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

Phase 1C is complete only after the exact reconciled tree passes all final gates, migration `028` and the full pending chain `130001` -> `130002` -> `130003` -> `130004` -> `130005` -> `130006` -> `130007` -> `130008` are explicitly owner-approved and verified on hosted Supabase, required GitHub Actions secrets are stored server-side, `SOFTWAREFACTORY_REQUIRED_CHECKS` exactly matches the protected CI jobs, the reviewed workflow is published while its activation variable remains OFF, and one owner-approved activation/run produces a real Codex thread, isolated branch/commit, open draft pull request, deterministic validation, stable exact-head required-check success, safe UI/detail evidence, and immutable audit trail. `AI/QUALITY_SCORECARD.md` is the evidence record.
