# Phase 1C implementation plan

Date: 2026-08-13

Overall status: **BLOCKED — the frozen routing/UI candidate passes its local final gates, but publication/CI/Vercel evidence is pending, local migration `130015` needs fresh exact RED approval and hosted verification, OpenAI/Codex is Not Connected, and the required live draft-PR journey has not succeeded.**

## Objective and authority ceiling

Connect one authenticated owner command to a supported server-side Codex worker and produce durable, reviewable evidence for:

`Owner command -> Bot Manager -> deterministic orchestrator -> Codex -> isolated workspace -> code/tests -> factory branch -> commit -> open draft PR -> exact-head CI -> SoftwareFactory result`

Phase 1C ends at an open, validated draft pull request. It does not authorize RED execution, a default-branch write, pull-request approval or merge, production deployment, rollback, workflow/provider administration, or Autonomous Mode. The global kill switch remains ON, the worker activation gate remains OFF except during an exact bounded acceptance action, and every automatic action remains OFF.

## Status vocabulary

- **COMPLETE** — the stated boundary is implemented and backed by current source, hosted, or live evidence.
- **PARTIAL** — useful implementation/evidence exists, but one or more required live or adverse-path proofs are absent.
- **MISSING** — a required configuration, artifact, or proof does not exist.
- **BROKEN** — an attempted path failed and cannot be represented as working.
- **BLOCKED** — progression is deliberately stopped until a named external prerequisite or safety gate is satisfied.

## Authoritative baseline

- The prior verified production baseline before this update was GitHub commit `0c662a24393f682073e6002c5aff9339292226d8`. CI run `31749352644` passed both required jobs and matching Vercel deployment `dpl_FJKMapsyLB4hQPDsaykUo1cVUQp7` was READY.
- Exact hosted Supabase project `qpuofpmagrmyamahqwxw` is reconciled and migrated forward through `20260813001400_resolve_emergency_stop.sql`. No reset, down-migration, or replay of schema-present migration DDL occurred.
- Local `20260813001500_expose_bounded_run_routing.sql` restores assignment/run model checks from 120 to the original 128-character provider catalogue/API contract, adds four no-secret constraints covering catalogue model/display-name, assignment model, and routing policy-version/selected-model text, adds a bounded run-detail routing projection, revokes authenticated raw routing-decision/event reads, and retains tenant-scoped model-catalogue reads. Provider runtime/API validation also rejects credential-shaped default-model/model/display-name scalars before serialization/RPC. It is unhosted and no existing approval authorizes it. Local final-candidate gates pass; publication CI/deployment and hosted `130015` proof are pending.
- `.github/workflows/codex-worker.yml` is published. Six non-OpenAI protected worker secrets remain configured. `SOFTWAREFACTORY_OPENAI_API_KEY` is absent. `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` is absent/OFF.
- First live command `0c4d0ca8-1867-4d00-80cf-476401491a17` created run `f4594556-6f72-4763-a480-6993939e3651`. Actions run `31746057998` claimed attempt 1, recorded a heartbeat and provider-thread identifier, then failed before repository mutation.
- Provider-only diagnostic run `31748582858` passed the pinned-CLI/exact-model boundary and returned `credit_balance_exhausted` from the bounded non-stored Responses probe. It skipped Docker preload and durable claim.
- The old command/run is now stale relative to the verified production baseline and **MUST NOT be retried**, even though its durable retry counter still shows an unused attempt. Acceptance requires a new command and run bound to a fresh base SHA after funded preflight passes.
- No Phase 1C `factory/*` branch, worker-created commit, open draft PR, live worker validation set, stable exact-head required-check result, or successful SoftwareFactory result exists.

## Audit matrix — foundation and integrations

| Surface | Status | Current evidence and exact gap |
| --- | --- | --- |
| Repository/context/policy audit | **COMPLETE** | `AGENTS.md`, required `/AI` memory, active policies, published architecture, migration state, GitHub boundary, UI state, tests, and deployment evidence are reflected in this plan. Conflicting older “local/unhosted” claims are superseded here by the authoritative baseline above. |
| Published application release | **PARTIAL** | The prior verified production baseline before this update is `0c662a24393f682073e6002c5aff9339292226d8`, with exact CI and matching READY Vercel evidence. The frozen current candidate passes local gates but is not yet published; its commit, CI, and deployment evidence are pending. Publication alone is not worker connectivity. |
| Hosted migration ledger | **COMPLETE** | Exact project `qpuofpmagrmyamahqwxw` is current through `130014`; schema-present `028`/`130001`-`130005` were reconciled history-only and `130006`-`130014` were forward-applied. |
| Local migration `130015` | **BLOCKED** | It restores the two model checks from 120 to 128, adds four no-secret scalar constraints, adds bounded routing detail, revokes authenticated raw routing-decision/event reads, and retains model-catalogue reads. Fresh exact RED approval must name the complete migration. Apply only `130015`, then verify all six changed/added constraint definitions, 128-character assignment/run/project behavior, valid and negative credential-shaped catalogue/assignment/routing scalar behavior, ledger, exact table/function ACLs, function identity/security, bounded Phase 1C/2A/legacy routing behavior, raw-table/RLS denial, lint, and health. |
| Hosted RLS, ACL, function, and audit boundary | **COMPLETE** | Linked lint and focused catalog/runtime/ACL checks pass; exposed tables retain RLS/FORCE RLS, worker mutation stays behind narrow service-role RPCs, and important transitions append evidence. |
| Live owner/unrelated/anonymous authorization matrix | **PARTIAL** | Authenticated production owner reads pass across Bot Manager, Runs/detail, Backlog/detail, Agents/detail, Reports/detail, and Connections. Signed-out UI leaks no tenant records, and twelve hosted target/read RPCs deny anonymous callers with `401`/`42501`. Hosted membership currently has only the owner, so unrelated-authenticated and mutation-shaped live denial remain unrecorded; local database tests cover them but are not substituted for live evidence. Service role is not acceptable user evidence. |
| GitHub App owner repository binding | **COMPLETE** for the Phase 1C owner target | Candidate App/installation/project binding is live for exactly `surgeservicesllc/SoftwareFactory`; repository identity is resolved by immutable provider IDs and exact base SHA. Retained Phase 1B second-tenant/adverse gaps do not become Phase 1C authority. |
| Worker workflow publication | **COMPLETE** | Opaque repository dispatch, scheduled recovery, pinned actions, read-only workflow token, no branch-selectable manual dispatch, and the separate no-claim preflight event are on `main`. |
| Six non-OpenAI worker secrets | **COMPLETE** | Supabase and GitHub App secret names remain configured without exposing values. Configuration is not connectivity. |
| OpenAI credential | **MISSING** | The compromised key was removed from GitHub Actions. No fresh funded replacement is configured. The exposed key still requires provider-side revocation if that has not already occurred. |
| OpenAI provider execution | **BROKEN** | Diagnostic `31748582858` reached the supported API boundary but the project returned `credit_balance_exhausted`. No successful Codex response or execution exists. |
| Worker activation/autonomy posture | **COMPLETE** | Activation is absent/OFF, Autonomous Mode is OFF, all nine automatic actions are OFF, and the global kill switch is ON. This is the required safe resting state. |
| Live acceptance authority | **BLOCKED** | No further claim is permitted until a fresh funded key passes the no-claim preflight. The stale run must not be used. |

## Audit matrix — owner-to-result pipeline

| Pipeline stage | Status | Current evidence and exact gap |
| --- | --- | --- |
| Owner command capture | **PARTIAL** | Authenticated same-origin command persistence, stable idempotency, bounded prompt/criteria, secret rejection, and GREEN/YELLOW/RED truth are published and hosted. The only live Phase 1C command is stale; a new GREEN command is required. |
| Bot Manager command experience | **PARTIAL** | The real command composer, project selection, worker truth, durable status, and result links are implemented. It has not displayed a successful live Codex-to-PR result. |
| Repository resolution | **COMPLETE** | Command -> project -> GitHub connection -> installation -> immutable repository -> default branch/base SHA is server-derived and independently revalidated; AI cannot choose the repository. |
| Deterministic orchestration | **COMPLETE** | Risk floor, acceptance criteria, logical role, provider/model, dependencies, budgets, validation, and draft-PR workflow are fixed server-side and enforced again in hosted SQL. RED is unclaimable. |
| Logical agent roster | **COMPLETE** | Hosted provider-neutral Orchestrator, Product, Architect, Frontend, Backend, Database, QA, Security, Performance, Release, and CEO Reporter roles keep agent/provider/account/project identities separate. |
| Durable commands/tasks/runs | **PARTIAL** | Hosted leases, heartbeat, attempts, cumulative budgets, dependencies, cancellation, append-only events/artifacts/validations, retry rules, and bounded reports recorded the first failure truthfully. A successful run/recovery path is unproven live. |
| Cancellation, retry, and adverse recovery | **PARTIAL** | Bounded cancellation/retry, stale lease/base, dispatch recovery, provider failure, validation/CI failure, and idempotent PR recovery are implemented/tested. The complete live adverse matrix is not recorded, and the known stale run is intentionally ineligible for acceptance. |
| Codex worker implementation | **COMPLETE** as source | Pinned `@openai/codex-sdk`/CLI `0.147.0`, isolated `CODEX_HOME`, workspace-write sandbox, approval `never`, disabled workspace network/web search, bounded time/turns/tokens, redaction, and fail-closed provider preflight are published. |
| Codex worker live runtime | **BROKEN** | The first claim failed at provider startup; the later diagnostic identified exhausted credits. A transient heartbeat/provider thread is not end-to-end connectivity. |
| Fresh acceptance run | **BLOCKED** | It may be created only after a funded no-claim preflight passes. Run `f4594556-6f72-4763-a480-6993939e3651` is stale and must not be retried. |
| Isolated workspace and `factory/*` branch | **MISSING** live evidence | Implementation and tests exist, but no Phase 1C branch was created by the failed run. |
| Code change and tests | **MISSING** live evidence | The failed run produced no changed file or worker validation. |
| Deterministic validation/repair | **PARTIAL** | Pinned restricted bootstrap, network-none diff/lint/typecheck/test/build, policy scan, and one bounded repair are implemented/tested. No live worker run has exercised them to completion. |
| Secret/protected-resource/diff review | **COMPLETE** as an enforcement boundary | Path containment, forbidden/symlink/binary/secret/protected/file-count/size controls are published and tested; protected work still requires exact approval and RED remains non-executable. |
| Commit and branch push | **MISSING** | No worker-created commit or remote `factory/*` branch exists. |
| Open draft pull request | **MISSING** | No Phase 1C PR exists. The worker is draft-only and has no merge authority. |
| Exact-head required-check observation | **MISSING** live evidence | Stable two-pass observation of `Lint, typecheck, test, and build` plus `Browser and accessibility tests` has not occurred for a Phase 1C PR head. |
| SoftwareFactory result/report/audit | **MISSING** successful evidence | Failure evidence exists, but no successful structured result links command, plan, agent, run, files, validations, branch, commit, PR, checks, usage, and final activity. |
| Default-branch/merge/deploy/rollback exclusion | **COMPLETE** | The worker has no authority for these actions; the failed attempt mutated none of them and all autonomous controls remain OFF. |

## Audit matrix — primary product surfaces

| Primary page | Status | Current evidence and exact gap |
| --- | --- | --- |
| Dashboard | **PARTIAL** | Published real-data summaries, signed-out safety, and heartbeat-derived worker truth exist; no successful live Phase 1C result is available to render. |
| Projects | **COMPLETE** for the owner Phase 1C target | Live repository selection and provider detail use immutable repository identity, current branch/SHA, commits, PRs, and checks for the connected owner project. |
| Bot Manager | **PARTIAL** | Real command submission and durable run state exist, but the required successful Codex/branch/PR journey is absent. |
| Files | **COMPLETE** for the existing owner draft-only path | GitHub-backed reads and SHA-protected branch -> commit -> open draft PR saving have live Phase 1B evidence. The Phase 1C worker publisher remains separately unproven. |
| Agents | **PARTIAL** | Provider-neutral roster and bounded reads are published/hosted. The locally gated current update adds owner/admin assignment controls while treating configuration as distinct from live provider health; publication and live Phase 1C assignment/result evidence are pending. |
| Backlog | **PARTIAL** | Real task priority/risk/dependency and command/run/PR link fields exist; no successful live Phase 1C task-to-PR chain exists. |
| Runs | **PARTIAL** | Durable refresh-safe failure state, timeline, heartbeat, artifacts/validations schema, cancellation, and eligibility logic exist. The locally gated current update adds recorded provider/model plus bounded "Why this provider?" evidence with legacy absence truth; publication and hosted `130015` proof are pending. No successful live run exists and the old run is stale. |
| Reports | **PARTIAL** | Structured bounded failure/report paths exist; no completed-work report with live files/tests/PR/CI evidence exists. |
| Connections | **PARTIAL** | GitHub owner connection is live and truthful; OpenAI/Codex is Not Connected because the key is absent and the tested project had exhausted credits. |
| Activity | **PARTIAL** | Bounded immutable GitHub and run-transition evidence exists; the final Phase 1C success sequence has no events to display. |
| Settings | **PARTIAL** | Safety and autonomy controls truthfully remain OFF; provider execution cannot be presented as configured/connected until funded credential and run evidence exist. |
| Loading, empty, error, responsive, and accessibility states | **PARTIAL** | Published/local test evidence includes desktop/tablet/mobile and axe coverage, plus explicit empty/error truth. Final authenticated acceptance across every primary page and the fresh run/result states is still required. |
| Demo/connection truthfulness | **COMPLETE** | Missing live evidence is labeled **Not Connected** or **Demo Data**; configuration, a heartbeat, or a queued/failed run is not represented as a successful integration. |

## Fixed execution envelope

- Provider: `openai`.
- Model: `gpt-5.3-codex`.
- Maximum duration: 45 minutes.
- Maximum Codex turns: 4.
- Maximum input/output tokens: 200,000 / 50,000 cumulative across retries.
- Maximum repair attempts: 1.
- CI observation timeout: 15 minutes.
- Maximum changed files: 200.
- Maximum individual changed file: 2 MiB.
- Maximum aggregate changed content: 10 MiB.
- Outcome: one open draft pull request only.

## Remaining acceptance and evidence plan

1. **Finish and publish the current update.** Run the complete lint/typecheck/tests/build/coverage/E2E/accessibility/security/migration/audit/disabled-worker gate set without reusing prior counts. Review and publish the exact tree with new CI and Vercel evidence while activation stays absent/OFF.
2. **Promote only the complete `130015` under fresh RED approval.** Bind the exact project, file, final source hash, two 120-to-128 constraint restorations, all four no-secret constraints, two raw-SELECT revokes, retained model-catalogue SELECT, routing projection, time window, validation, and forward-only containment. Apply only `130015`; verify ledger, all six changed/added constraint definitions, 128-character assignment/run/project behavior, valid and negative credential-shaped catalogue/assignment/routing scalar behavior through reviewed paths, exact table/function ACLs, function definition/signature/security/search path, bounded Phase 1C/2A/legacy routing runtime, raw-table/RLS/tenant denials, linked lint, and health. Stop on any mismatch.
3. **Restore provider eligibility without widening authority.** Keep activation OFF. Revoke the exposed key at OpenAI if still active, add credits to the intended OpenAI project or create a fresh funded project/key, never paste or render the replacement value, and configure only that fresh key through protected GitHub secret storage. Stop if provider/project identity or funding is ambiguous.
4. **Pass a no-claim provider preflight.** Within a separately approved window, enable the worker gate only long enough to admit `softwarefactory_phase1c_preflight`, then return it to absent/OFF. Require pinned CLI `0.147.0`, exact `gpt-5.3-codex` lookup, and one bounded non-stored Responses result. Verify Docker preload and durable claim did not run. Any failure, ambiguity, or secret exposure stops the sequence.
5. **Prepare, create, and claim one fresh command; never retry the stale run.** After preflight passes, define one narrowly scoped manual GREEN owner command for exact project `b1f23696-437e-4d89-b55f-d7a949980e8f`. Confirm repository/default branch and current `main`, enable the gate, submit through the authenticated UI/API, record fresh base SHA and command/task/run IDs, verify one opaque dispatch/lease claim, and immediately return activation to absent/OFF. Stop on any identity, base, agent, lease, budget, or risk mismatch.
6. **Require the full worker journey.** Record routing reasons, Codex thread, isolated workspace, exact `factory/<new-run-id>-<slug>` branch, changed paths, tests, restricted validation, policy/secret scan, owner-identity commit, branch push, open draft PR, unchanged base/head, and two stable observations of both exact required CI checks at `success`. One bounded repair may address only agent-caused validation/CI failure.
7. **Prove product, tenant, and security behavior.** Inspect all primary pages against the new durable evidence and verify Files/Projects links resolve the exact repository/branch/PR. Complete owner, unrelated-authenticated, anonymous/RPC, mutation-shaped/direct-table denial plus loading/empty/error and mobile/tablet/desktop accessibility cases. Confirm no secret or raw provider/audit payload reached browser, logs, artifacts, reports, or source.
8. **Close out fail-closed.** Prove `main` was not written, the PR remains open/draft/unapproved/unmerged, no deployment or rollback occurred, RED/protected/workflow/provider-administration actions did not execute, activation is OFF, all nine automatic actions remain OFF, and the global kill switch remains ON. Record exact migration, publication, preflight, command, task, agent, routing, run, branch, commit, PR, checks, validation, usage, report, audit, activation/deactivation, and cleanup evidence in `/AI`; only then change OpenAI/Codex from **Not Connected** and report completion percentage, limitations, owner actions, and Phase 1D readiness.

## Completion rule

Phase 1C is not complete until every **MISSING**, **BROKEN**, and **BLOCKED** row above is replaced by direct evidence and every **PARTIAL** row has the live proof required by its stated gap. A configured key, successful model lookup, fresh heartbeat, queued command, provider thread, local test, CI on `main`, or Vercel READY deployment is necessary context but cannot substitute for the single fresh owner-command-to-draft-PR journey.
