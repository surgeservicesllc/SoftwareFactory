# Roadmap

Roadmap order follows safety dependencies. A later phase never inherits authority implicitly.

## Phase 1A - trustworthy control-plane foundation

Status: **Complete baseline; deployed evidence retained.**

Tenant/auth foundations, RLS/audit, truthful Demo Data/Not Connected language, risk controls, responsive shell, and safe OFF defaults exist. No unrestricted production authority was granted.

## Phase 1B - Production GitHub App Integration

Status: **Connected for the owner repository path; remaining acceptance gaps keep the phase incomplete.**

Candidate App `4582606`, installation `153479019`, connection `85591f43-dd4e-46d2-8a1b-0f036b32639f`, project `b1f23696-437e-4d89-b55f-d7a949980e8f`, signed webhook evidence, repository reads, and draft-only write acceptance pass for exactly `surgeservicesllc/SoftwareFactory`. Primary installation `153445938` remains rollback while Support `#4660724` tracks its webhook defect.

Remaining: live second-tenant/anonymous/RPC coverage, reverse handoff, disconnect/loss, and the remaining provider adverse/recovery/lifecycle matrix.

## Phase 1C - Codex execution

Status: **Local reconciled implementation candidate; OpenAI/Codex Not Connected.**

Implemented locally:

- authenticated connected-project command composer with type, acceptance criteria, deterministic risk, stable idempotency, exact base-SHA binding, and delayed-dispatch truth;
- fixed provider/model/role/budget/workflow planning with an independent SQL enforcement boundary;
- durable command/task/run/dependency, worker heartbeat, lease, retry, cancellation, event, artifact, validation, report, and activity persistence;
- an idempotent provider-neutral eleven-role roster for every organization, with provider/model retained only as run metadata;
- supported `@openai/codex-sdk` adapter with bounded turns/tokens, isolated configuration, workspace-write sandbox, network/web search disabled, and redacted events;
- exact-repository Git workspace, pinned-container validation, secret/protected-path policy scanning, isolated `factory/*` commit/push, draft-PR-only publication, exact-head CI observation, and one bounded repair;
- safe list/detail/status APIs and real-data dashboard, Bot Manager, Backlog, Agents, Runs, and Reports views; and
- reviewed GitHub Actions one-shot worker with opaque default-branch repository dispatch plus scheduled recovery and no branch-selectable manual trigger;
- coherent branch/commit/draft-PR recovery, stale-lease terminalization, structured success/failure/cancellation reports, owner-only command submission, and an exact required-CI-check allowlist; and
- final reconciled local gates green on bundled Node `24.19.0`: lint/typecheck, 97 files/959 tests, production build with 62/62 page-data entries, coverage 72.37/66.79/68.80/74.13, Playwright/axe 117/117, dependency audit 0, safe disabled-worker exit, clean high-confidence source/static secret-value scans, clean diff check apart from line-ending notices, and focused migration/API security audits with no remaining P0/P1 blocker.

Not yet complete:

1. Obtain exact owner RED approval for hosted migration `028` and migrations `130001` through `130008`, protected Actions secret configuration, disabled publication, bounded activation, and the live run.
2. Apply and verify `028` -> `130001` -> `130002` -> `130003` -> `130004` -> `130005` -> `130006` -> `130007` -> `130008` on exact Supabase project `qpuofpmagrmyamahqwxw`.
3. Configure the seven protected `SOFTWAREFACTORY_*` repository secrets without exposing values.
4. Verify the workflow's `SOFTWAREFACTORY_REQUIRED_CHECKS` exactly names both protected CI jobs and keep `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` absent/false.
5. Publish the reviewed tree to the repository default branch and verify CI/Vercel while worker triggers remain skipped.
6. Set the activation variable to `true` only for the exact approved window, submit one safe manual GREEN owner command so the approved default-branch repository dispatch starts the worker, and observe the active one-shot heartbeat through a validated draft PR and stable exact-head required checks.
7. Return activation to absent/false unless continuing authority is separately approved.
8. Record exact provider, run, branch, commit, PR, check, migration, deployment, activation/deactivation, and audit evidence.

Phase 1C ends at a human-reviewable draft PR. RED remains non-executable; no merge or deployment is authorized.

## Phase 1D - autonomous-loop controls

Status: **Decision layer complete and locally verified; every automatic action remains constrained OFF and no executor exists.**

Implemented in source and proven against the migrated schema:

- The complete nine-action control model — plan, code, test, repair, review, approve, merge, deploy, rollback — at both an organization and a project scope. Migration `010` shipped four actions at one scope; the unhosted Phase 1D control migration adds the rest without relaxing anything.
- Most-restrictive-wins resolution. An action survives only where both scopes enable it, the ceiling is the lower of the two, and the envelope (kill switch, emergency stop, release freeze, missing executor) forces every action off regardless of either scope. `resolved_autonomy_controls` holds the same rule in the database so no caller can resolve it more permissively.
- Risk classification of an actual diff, not of a hand-supplied factor list. Deciding your own risk is the judgement an autonomous loop must not be trusted with, so factors are derived from changed paths plus credential- and destructive-shaped content. A change is reclassified when finished and an escalation past its declaration blocks it.
- The GREEN gate set and the enhanced set that YELLOW and RED add on top of it. A missing result is a blocker, never a pass; `not_connected` stays distinct from `not_run`.
- Deterministic Review, QA and Security agents. Blocking findings stop progression; advisory findings are recorded and do not.
- The approval tri-state `APPROVED_AUTOMATICALLY` / `OWNER_APPROVAL_REQUIRED` / `NOT_APPROVED`, evaluated after the gates so nobody can approve past a failing check, and an unsound change is never escalated to a person. No-self-approval is absolute at every risk level.
- A twelve-stage orchestrator that halts at the first blocked stage and names its blocker.

Not implemented, and blocked rather than simulated:

- **Enabling any automatic action.** Both scopes are held by validated CHECK constraints and a trigger. Relaxing them is a RED action requiring an owner-approved migration.
- **Merge, deploy, and Codex execution.** Each is reached, evaluated, and blocked by name (`MERGE_EXECUTOR_NOT_CONNECTED`, `DEPLOY_EXECUTOR_NOT_CONNECTED`, `CODEX_WORKER_NOT_CONNECTED`). Tests assert the blockers, so connecting an executor fails them deliberately rather than silently granting authority.
- The Phase 1D control migration is **not applied** to hosted Supabase and must have a unique reviewed version in the final migration chain.

This is an execution-inert decision layer, not authorization to begin autonomous operation. The global kill switch remains ON, Autonomous Mode remains OFF, the maximum hypothetical autonomous risk remains GREEN, and every automatic action remains OFF. The local manual Phase 1C path does not change these interlocks.

## Phase 1E - production operations

Status: **Control-plane source published on `main` and locally verified; no production-mutating executor exists and hosted migration `028` is not applied.**

Implemented in source and proven against the migrated schema:

- Provider-neutral monitoring with exactly one connected adapter (a bounded HTTPS probe that refuses private, loopback, and metadata addresses and never reads a response body). Every other provider is listed with the reason it is Not Connected and the condition that would unblock it. A monitor cannot be enabled unless its adapter is connected.
- Project health `healthy/degraded/critical/unknown/paused` derived from real signals, with append-only history and a stored reason. No connected monitor resolves to UNKNOWN, never HEALTHY.
- SEV1–SEV4 incidents created automatically from breached failure thresholds, deduplicated by fingerprint into one open incident per project, with upward-only severity escalation.
- Automatic release freeze on SEV1/SEV2, owner-only resume and organization-wide stop, and an unconditional `EXECUTOR_NOT_CONNECTED` blocker on release authority.
- Last Known Good resolved only from a deployment whose own post-deploy validation passed; rollback eligibility evaluated fail-closed against `policies/AUTO_ROLLBACK.md`; a failed rollback cannot be recorded without escalating to SEV1 with owner attention.
- A deterministic Production Investigator returning cause, cited evidence, subsystem, confidence, recommended action, and risk, with no intermediate reasoning produced or stored.
- Bounded self-healing: three attempts maximum, escalation on the third failure, and refusal to route RED or above-ceiling work around the risk policy. Assignment is recorded as Not Connected.
- A durable, idempotent operations event queue covering all ten required event types.
- Gated incident resolution: restoration, a passing same-project validation, root cause, corrective action, and prevention for SEV1/SEV2.
- Daily operational reporting, portfolio and per-project operations views, and an immutable operations audit trail.

Not implemented, and blocked rather than simulated:

1. Deployment and rollback execution — no provider adapter exists, `policies/AUTO_ROLLBACK.md` disables automatic rollback, and migration `010` pins `auto_rollback` off.
2. Codex repair execution — Phase 1C is **Not Connected**.
3. Vercel deployment, error-rate, latency, job, and integration telemetry — no connected provider.
4. Continuous scheduled monitoring — checks are owner-triggered because no scheduler identity is authorized; adding one must not widen `service_role`.

Exit work: apply hosted migration `028`, configure a real monitored production target under owner authorization, and record live detection-to-resolution evidence. Until then no Phase 1E surface may claim observation.

## Phase 2A - advisory multi-provider layer

Status: **Implemented and published on `main`; hosted execution Not Connected.**

Main commit `b1060b83a0698a83e202aafdf9792886cf60a8b3` contains official Anthropic/OpenAI adapters, provider health and model discovery, deterministic routing, controlled fallback, independent-review enforcement, advisory run persistence, owner execution controls, and provider UI. Migration `130001` remains unhosted, provider credentials and a live call are unverified, and organization execution defaults OFF. Phase 2A can return analysis artifacts only; it cannot write a repository, approve or merge, deploy, roll back, or enable Phase 1C/1D. Browser automation of consumer accounts is not an approved integration model.

Remaining: apply/verify `130001` as part of the reviewed pending migration chain, configure a supported server-side provider credential, deliberately enable one organization under the applicable approval/cost controls, and record live health/routing/run evidence before calling either provider Connected.

## Later measured autonomy

Only after sustained non-production evidence may a separately approved phase consider narrow GREEN allowlists, independent validation, budgets, alerts, kill switches, branch protection, and observation. RED remains owner controlled. Automatic merge, production deployment, and rollback are not Phase 1C features.
