# Roadmap

Roadmap order follows safety dependencies. A later phase never inherits authority implicitly.

## Current release increment — Claude bot identity and Role assignment

Status: **Application commit published and deployed; exact-head CI failed, the
cross-platform database repair is local, and no hosted database apply has
occurred.**

- Preserve exact `main` commit
  `30d7e824691bdd4f8fa72481b21c91d3da6e3a31` and READY Vercel production
  deployment `dpl_FrvCToHvFhkzfwnkmEeeTyfuE3v2` as application evidence.
  GitHub deployment `6036292508` and status `17160408639` bind that commit to
  `https://softwarefactory-116001qbk-surgeservices-projects.vercel.app` and its
  stable aliases.
- Treat CI run `32570540183` as a failed release gate. Browser shards 1/3, 2/3,
  and 3/3 passed; quality job `97025270055` failed before build because the LF
  migration chain rejected seven non-canonical function-source hashes.
- Keep the current protected repository file identities exact: 00150
  `6b24b6ebb57e59b9c4398c3e439221c27c300663a7b6932ff192996ffe6bcd93`,
  00200
  `658e615580cc5b413f81fd45f5b884917c27f44b66395aa462f9640ac27c48bf`,
  and 00300
  `79914bc97660eef908b6a0fa0c90abfdd15da1683b383ad568e34bf3bd32c5f7`.
- Preserve the line-ending-independent repair: canonicalize CRLF and lone CR
  to LF before every `md5(prosrc)` comparison. Native PostgreSQL 17.10 and
  18.4 full migration chains pass; the forward release must preserve this
  repair and still needs green exact-head CI after publication.

- Keep one full-application modal/focus boundary in AI Factory. Embedded roster,
  assignment, configuration, and role onboarding replace content inside it;
  no nested dialog is opened.
- Preserve the owner-screenshot containment: `ProjectBots` must never infer an
  exact AI-account link from `credentialRef` similarity or hide its repair
  control. An unbound Ready legacy bot may be assigned while AI Factory
  correctly keeps steps 5-7 incomplete. Expose the existing exact
  `/api/bots/connect/provision` Link-or-repair/adoption path, await the parent
  refresh, and provide an accessible **Return to AI Factory** action.
- Keep the affected completion predicate exact: connected account + exact
  `aiAccountId` + current Ready + project assignment. The current unpublished
  UI fix passes focused UI 75/75, focused ESLint, full typecheck, and
  lint/typecheck/build. The root full suite passes 337 files / 4,054 tests with
  3 files / 7 tests skipped; its first contention-only `supabase-wiring`
  timeout cleared isolated 2/2 and on the full rerun.
- Keep role and permission defaults explicit: a new posting starts from the
  Developer permission preset and preserves any existing posting role/config;
  a zero-role organization is offered the reviewed Backend engineer starter by
  default, saved through `/api/bot-roles`, and the exact returned UUID fills
  only blank selected drafts.
- Bind each subscription bot to its exact tenant AI account through
  `20260822000200_register_bot_for_ai_account.sql` (SHA-256
  `658e615580cc5b413f81fd45f5b884917c27f44b66395aa462f9640ac27c48bf`),
  preserving one unambiguous legacy bot UUID and enforcing the exact
  account/provider/credential-slot identity.
- Add monotonic bot and assignment revisions. Lock and compare exact posting
  id/project/revision for assign, move, configuration, lifecycle, and execution
  edits; refuse released-history edits; retain exact response plus committed
  readback verification.
- Record readiness only through a service-role RPC that carries the owner/admin
  actor and compares exact bot revision/account/provider/model/credential
  reference/base URL. Keep a management-authored Disabled state durable.
- Ship `20260822000200` as the EXPAND half of a rolling cutover: preserve exact
  legacy definitions/signatures/security/search paths and authenticated-only
  execute ACLs while adding authenticated checked wrappers plus the
  service-only readiness recorder. Revoke the legacy grants only in a
  separately approved forward CONTRACT migration after the exact replacement
  application is deployed and accepted.
- Read every open assignment via terminal-proven keyset pagination and fail the
  entire roster plus assignment-derived Assign/Configure progress closed on
  invalid or bounded-out pagination.
- Serialize broker start/retry/close/unmount cleanup and fence async results by
  exact session plus generation so superseded polls cannot change UI state.
- Derive Factory progress from the coherent connected-account, Ready linked
  bot, active project assignment, and configured-posting chain; persist the
  selected factory per organization across reload.
- Freeze the repaired commit, obtain exact RED approval, push it directly to
  `main`, and require green exact-head CI before any hosted DDL. Apply only
  00150 and then 00200 through their dedicated hash-checked scopes. Complete
  signed-in create/assign/Role/configure/readiness/audit/reload acceptance,
  linked-database lint, health, and containment before separately authorizing
  00300. Keep kill switch ON, autonomy/actions OFF, and worker/executor
  disconnected throughout.

## Current release increment — Factory command routing (ADR-106)

Status: **Implemented and locally gated; not hosted or deployed.**

- `20260821000400_command_factory_routing.sql` is frozen at 34,999 bytes,
  SHA-256
  `e45149db3ca7c66a27934b0b49ac160e1b5ef597fc8f34ad8547de4759086598`.
- Owner-only submit/replay durably selects one pipeline and configured bot,
  model, and work effort; the database rechecks stored effective risk and
  stores immutable routing/configuration evidence.
- Exact replay resolves before mutable state. Missing hosted schema fails
  closed. No worker dispatch, autonomous action, merge, deploy, or rollback is
  introduced.
- Lint, typecheck, and build pass. Default unbounded-run Supabase-wiring and
  pipeline contention failures both clear in isolation. The bounded
  current-head non-frozen Windows suite passes 317 files / 3,729 tests with 7
  skipped in 140.74s under `maxWorkers=4`; only the owner-frozen 19-test
  auth-broker file is excluded because Windows lacks Unix `script`. Linux CI
  must run the complete suite before release.
- Production remains on hosted `20260821000300` and the old copy. Before
  hosting `20260821000400`, contain and remeasure five linked lint errors/ten
  findings, one raw organization with `autonomous_mode = true`, one with
  `autonomy_kill_switch_active = false`, two
  projects with effective kill off, and the absence of a connected/fresh
  worker. Do not infer a healthy/all-off hosted control plane.

## Phase 1A - trustworthy control-plane foundation

Status: **Complete baseline; deployed evidence retained.**

Tenant/auth foundations, RLS/audit, truthful Demo Data/Not Connected language, risk controls, responsive shell, and safe OFF defaults exist. No unrestricted production authority was granted.

## Phase 1B - Production GitHub App Integration

Status: **Connected for the owner repository path; remaining acceptance gaps keep the phase incomplete.**

Candidate App `4582606`, installation `153479019`, connection `85591f43-dd4e-46d2-8a1b-0f036b32639f`, project `b1f23696-437e-4d89-b55f-d7a949980e8f`, signed webhook evidence, repository reads, and draft-only write acceptance pass for exactly `surgeservicesllc/SoftwareFactory`. Primary installation `153445938` remains rollback while Support `#4660724` tracks its webhook defect.

Remaining: live second-tenant/anonymous/RPC coverage, reverse handoff, disconnect/loss, and the remaining provider adverse/recovery/lifecycle matrix.

## Phase 1C - Codex execution

Status: **Published and hosted, but OpenAI/Codex remains Not Connected because the provider project has exhausted credits and no successful draft-PR journey exists.**

Implemented and published:

- authenticated connected-project command composer with type, acceptance criteria, deterministic risk, stable idempotency, exact base-SHA binding, and delayed-dispatch truth;
- fixed provider/model/role/budget/workflow planning with an independent SQL enforcement boundary;
- durable command/task/run/dependency, worker heartbeat, lease, cumulative retry-budget, cancellation, event, artifact, validation, report, and activity persistence;
- an idempotent provider-neutral eleven-role roster for every organization, with provider/model retained only as run metadata;
- supported `@openai/codex-sdk` adapter with bounded turns/tokens, isolated configuration, workspace-write sandbox, network/web search disabled, and redacted events;
- exact-repository Git workspace, pinned-container validation, secret/protected-path policy scanning, isolated `factory/*` commit/push, draft-PR-only publication, exact-head CI observation, and one bounded repair;
- safe list/detail/status APIs and real-data dashboard, Bot Manager, Backlog, Agents, Runs, and Reports views; and
- reviewed GitHub Actions one-shot worker with opaque default-branch repository dispatch plus scheduled recovery and no branch-selectable manual trigger;
- coherent branch/commit/draft-PR recovery, stale-lease terminalization, structured success/failure/cancellation reports, owner-only command submission, and an exact required-CI-check allowlist; and
- prior verified production baseline before this update green on bundled Node `24.19.0`: lint/typecheck, 117 files/1,282 tests, build with 74 page/route entries, Playwright/axe 117/117, focused migration/security suites, production dependency audit 0, and safe disabled-worker exit. Baseline commit `0c662a24393f682073e6002c5aff9339292226d8` passed both required jobs in CI run `31749352644`, and Vercel deployment `dpl_FJKMapsyLB4hQPDsaykUo1cVUQp7` was READY.

Implemented locally in the current update, but not yet published or hosted:

- rolling-compatible Runs/Agents provider surfaces and a bounded "Why this provider?" projection; and
- forward migration `20260813001500_expose_bounded_run_routing.sql`, which restores the original 128-character provider catalogue/API bound for the assignment/run model checks, preserves their other semantics, adds four no-secret constraints covering catalogue model/display-name, assignment model, and routing policy-version/selected-model text, preserves the run-detail function identity/ACL boundary, caps and allowlists durable routing evidence, revokes raw authenticated routing-decision/event reads while retaining model-catalogue reads, and remains unapplied pending its own exact RED approval.

Not yet complete:

1. Preserve the frozen current-update candidate's passing local final gates and publish it with a new exact commit, CI run, and matching deployment evidence; do not reuse the prior baseline release identity.
2. Obtain fresh exact RED approval for the complete `130015`, apply only that migration forward to `qpuofpmagrmyamahqwxw`, and verify the exact two widened constraint definitions plus 128-character assignment/run/project regression, all four no-secret constraints plus valid and negative credential-shaped scalar regressions, the two raw-SELECT revokes and retained model-catalogue SELECT, ledger, function signature/security/search path/ACL, bounded runtime behavior, RLS/direct-denial, lint, and health. Hosted state remains `130014` until that succeeds.
3. Sign in to the OpenAI Platform, revoke the key exposed in chat, and fund the intended project or create a fresh key in a funded replacement project. Keep the GitHub OpenAI secret absent and activation OFF until this is complete.
4. Configure only the fresh funded key through the protected repository-secret path, briefly admit the distinct `softwarefactory_phase1c_preflight` event, immediately return activation to absent/OFF, and require both the exact-model lookup and bounded non-stored response to pass without Docker preload or durable claim.
5. Leave failed run `f4594556-6f72-4763-a480-6993939e3651` as historical evidence. Its immutable planned base predates the verified production baseline; retry would correctly fail `stale_base_sha` and waste its second attempt.
6. Obtain/confirm exact authorization for a new safe GREEN acceptance command, bind it to the then-current `main`, briefly activate only for job admission, and observe the active one-shot worker through a validated draft PR and stable exact-head required checks.
7. Return activation to absent/OFF immediately after claim and remove/revoke the temporary OpenAI secret/key after acceptance.
8. Record exact provider, command, task, run, agent, routing reasons, branch, commit, PR, check, report, deployment, activation/deactivation, and audit evidence; complete the remaining unrelated-authenticated and mutation-denial acceptance before claiming 100%.

Phase 1C ends at a human-reviewable draft PR. RED remains non-executable; no merge or deployment is authorized.

## Phase 1D - autonomous-loop controls

Status: **Decision layer published and hosted; no executor is connected, but hosted raw/effective controls have drift and must not be described as universally OFF.**

Implemented in source and proven against the migrated schema:

- The complete nine-action control model — plan, code, test, repair, review, approve, merge, deploy, rollback — at both an organization and a project scope. Migration `010` shipped four actions at one scope; hosted migration `130006` adds the rest without relaxing anything.
- Most-restrictive-wins resolution. An action survives only where both scopes enable it, the ceiling is the lower of the two, and the envelope (kill switch, emergency stop, release freeze, missing executor) forces every action off regardless of either scope. `resolved_autonomy_controls` holds the same rule in the database so no caller can resolve it more permissively.
- Risk classification of an actual diff, not of a hand-supplied factor list. Deciding your own risk is the judgement an autonomous loop must not be trusted with, so factors are derived from changed paths plus credential- and destructive-shaped content. A change is reclassified when finished and an escalation past its declaration blocks it.
- The GREEN gate set and the enhanced set that YELLOW and RED add on top of it. A missing result is a blocker, never a pass; `not_connected` stays distinct from `not_run`.
- Deterministic Review, QA and Security agents. Blocking findings stop progression; advisory findings are recorded and do not.
- The approval tri-state `APPROVED_AUTOMATICALLY` / `OWNER_APPROVAL_REQUIRED` / `NOT_APPROVED`, evaluated after the gates so nobody can approve past a failing check, and an unsound change is never escalated to a person. No-self-approval is absolute at every risk level.
- A twelve-stage orchestrator that halts at the first blocked stage and names its blocker.

Not implemented, and blocked rather than simulated:

- **Enabling any automatic action.** Both scopes are held by validated CHECK constraints and a trigger. Relaxing them is a RED action requiring an owner-approved migration.
- **Merge, deploy, and Codex execution.** Each is reached, evaluated, and blocked by name (`MERGE_EXECUTOR_NOT_CONNECTED`, `DEPLOY_EXECUTOR_NOT_CONNECTED`, `CODEX_WORKER_NOT_CONNECTED`). Tests assert the blockers, so connecting an executor fails them deliberately rather than silently granting authority.
- No Phase 1D executor is connected. The intended migration policy is all actions OFF/kill ON, but current evidence finds one raw organization with `autonomous_mode = true`, one with `autonomy_kill_switch_active = false`, and two projects effective-kill-off; containment and remeasurement are release blockers.

This remains execution-inert because no worker/executor is connected, not because the current hosted rows are clean. It is not authorization to begin autonomous operation. Restore and verify the intended kill-ON/autonomy-OFF/action-OFF policy before any hosted routing apply or production promotion.

## Phase 1E - production operations

Status: **Control-plane source published and migration `028` hosted; no production target has been observed and no production-mutating executor exists.**

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

Exit work: configure a real monitored production target under owner authorization and record live detection-to-resolution evidence. Until then no Phase 1E surface may claim observation.

## Phase 2A - advisory multi-provider layer

Status: **Implemented and published on `main`; hosted schema and ledger reconciled; execution Not Connected.**

`main` contains official Anthropic/OpenAI adapters, provider health and model discovery, deterministic routing, controlled fallback, independent-review enforcement, advisory run persistence, owner execution controls, and provider UI. Hosted Supabase has the reconciled `130001` schema and `130007` Phase 1C compatibility layer; provider credentials and a live advisory call are unverified, and organization execution defaults OFF. Phase 2A can return analysis artifacts only; it cannot write a repository, approve or merge, deploy, roll back, or enable Phase 1C/1D. Browser automation of consumer accounts is not an approved integration model.

Remaining: configure a supported server-side provider credential, deliberately enable one organization under the applicable approval/cost controls, and record live health/routing/run evidence before calling either provider Connected.

## Later measured autonomy

Only after sustained non-production evidence may a separately approved phase consider narrow GREEN allowlists, independent validation, budgets, alerts, kill switches, branch protection, and observation. RED remains owner controlled. Automatic merge, production deployment, and rollback are not Phase 1C features.
