# Testing

Phase 1C requires four independent evidence layers: local code/behavior, migration/catalog/RLS, protected runner configuration, and a real end-to-end provider run. None substitutes for another.

## Commands

```bash
npm run lint
npm run typecheck
npm run test:unit
npm run test:integration
npm test
npm run test:coverage
npm run build
npm run test:e2e
npm audit --omit=dev
npm run worker:once
```

The last command must exit safely without executing when the worker is disabled or configuration is incomplete.

## Prior verified Phase 1C baseline

| Gate | Prior verified result |
| --- | --- |
| Runtime | Supported bundled Node `24.19.0` |
| `npm run check` | Pass on Node `24.19.0`: lint/typecheck, 117 test files/1,282 tests, production build with 74 page/route entries |
| Coverage | Pass: 75.06% statements, 69.97% branches, 72.60% functions, 76.66% lines |
| Focused migration suites | Pass: 8 files/104 tests |
| Playwright responsive/accessibility | Pass: 117/117 across desktop/tablet/mobile against the production build |
| Production dependency audit | Pass: `npm audit --omit=dev` reports 0 vulnerabilities |
| Changed-tree secret scan | Pass: 96 files, 0 high-confidence secret candidates |
| Production static scan | Pass: `.next/static` 27 files, 0 privileged markers |
| Disabled worker smoke | Pass: exits safely without executing |
| Diff/independent audit | Pass: `git diff --check` clean except line-ending notices; final independent P0/P1 audit PASS |

These are historical baseline results. Separately, the frozen current-update candidate passes local Node `24.19.0` lint/typecheck, 118 Vitest files/1,311 tests, coverage 76.70% statements / 71.47% branches / 74.04% functions / 78.11% lines, a 74/74-route production build, Playwright/axe 117/117, `npm audit --omit=dev` with 0 vulnerabilities, and clean diff-check. That is local final-candidate evidence only: publication commit, CI, matching Vercel deployment, and hosted `130015` verification remain pending. Hosted reconciliation through `130014`, workflow publication, and one transient live claim/heartbeat/provider thread are independently verified. None of this proves funded provider execution, a successful Codex turn, a Phase 1C factory branch/draft PR, or exact-head required-CI completion.

## Phase 1C unit/integration coverage

The suites cover:

- command type/criteria/idempotency, same-origin, owner-only submission, secret/key/size rejection, project binding, deterministic prompt-plus-criteria risk escalation, exact base SHA, fixed plan, opaque dispatch, delayed evidence, and RED blocking;
- catalog/history reconciliation for schema-present `028`/`130001`-`130005`, followed by hosted forward `130006` through `130014`; provider compatibility, Phase 1D interlocks, tables/constraints/indexes, RLS/FORCE RLS, dependencies, cumulative retry budgets, policies/grants, safe detail/status, lease/result functions, append-only evidence, RED claim exclusion, and terminal report/activity behavior;
- local `130015` restoration of the two model checks from 120 to 128 characters, exact preserved constraint semantics, all four new immutable-function no-secret constraints, 128-character assignment/run/project-default behavior, valid and negative credential-shaped catalogue/assignment/routing scalar cases through catalogue/RPC/direct paths, provider runtime/API scalar rejection, dirty pre-migration catalogue fail-closed reads, preserved run-detail signature/security/search path/ACL, capped/allowlisted Phase 1C/Phase 2A routing evidence, absent/null rolling compatibility, authenticated raw routing-decision/event denial, and retained tenant-scoped model-catalogue reads;
- provider-neutral eleven-role roster for existing/future organizations, preservation of user-created agents, general-to-Orchestrator mapping, provider/model run metadata, and per-agent claim serialization;
- worker configuration, safe work root, controlled environment, disabled behavior, lease lifecycle, heartbeat/cancellation/retry, redaction, and bounded process output;
- Codex SDK thread options, turns/tokens, structured summary, event projection, and terminal errors;
- exact repository/base-SHA workspace preparation, safe branch generation, coherent branch/commit/draft-PR recovery and conflict rejection, Git authentication redaction, owner author/committer, and stale/mismatch failures;
- pinned Docker arguments, install-script suppression, network-none validation, resource/security caps, and deterministic gates;
- path containment, protected paths, forbidden files, symlinks, binary files, likely secrets, changed-file/size limits, and exact approval paths;
- draft PR creation/recovery, authoritative pull-request projection, repository-ID-scoped token permissions, exact required-check presence/success, complete stable check fingerprint, final PR base/head recheck, CI failure/timeout, and bounded repair;
- workflow trigger, schedule, permission, secret-name mapping, no checkout credentials, and no secrets in pre-worker steps;
- member-safe agent/task/run/report details, timelines/artifacts/validations/dependencies, worker status, cancellation/retry, loading/empty/error/authorization states, and responsive consoles; and
- retained Phase 1B Auth/GitHub callback/webhook/project/file/draft-PR/RLS boundaries.

Static SQL/workflow contract tests are necessary but do not prove hosted catalog or runner/provider behavior.

## Hosted Supabase acceptance record and remaining cases

Hosted verification completed after exact owner approval: catalog-prove and ledger-repair only schema-present `028`/`130001`-`130005`, then apply forward-only migrations `130006` through `130014` to exact project `qpuofpmagrmyamahqwxw` and verify:

- linked migration history and lint;
- all public tables RLS/FORCE RLS and intended policies;
- exact table/function ACLs and no unintended service-role table grants;
- function search paths, constraints, indexes, triggers, secret checks, and append-only guards;
- direct browser denials plus bounded member detail/status;
- owner-only submission; owner/admin cancel/retry; and service-worker lease/result paths;
- direct command SQL prompt/criteria risk and fixed configuration normalization, payload/secret limits, and RED exclusion;
- provider-neutral roster, one active lease per logical agent, coherent artifact/PR replay and rejection, stale-lease/cancellation terminalization, structured report content, and bounded reconstructed PR links; and
- real owner and anonymous read behavior using caller sessions.

Hosted migration history is reconciled and current through `130014`; linked lint and focused catalog/runtime/ACL checks pass. The temporary release token used for that protected work was revoked and its temporary file deleted. Any future schema correction remains forward-only and requires its own exact approval.

Authenticated production owner reads pass across Bot Manager, Runs/detail, Backlog/detail, all-eleven-role Agents/detail, Reports/detail, and Connections. Signed-out UI exposes no tenant records, and twelve hosted target/read RPCs deny anonymous callers with `401`/`42501`. An unrelated authenticated tenant does not exist in hosted membership, so its live isolation case and mutation-shaped/direct-table denial probes remain pending; local integration tests are not represented as live proof.

Migration `130015` remains local. A fresh exact RED approval must precede applying only that migration, followed by exact definitions for both widened and all four new no-secret constraints; 128-character assignment/run/project regression; valid and negative credential-shaped catalogue/assignment/routing scalar checks through reviewed paths; the two raw-SELECT revokes and retained model-catalogue SELECT; run-detail identity/security/ACL; bounded routing; raw-table/tenant denial; linked lint; and health verification. Until then hosted run detail may omit `routing`, and the rolling-compatible application must render that as missing historical evidence rather than infer a reason; credential-shaped pre-migration catalogue rows fail closed.

## Protected GitHub Actions acceptance still required

Verify the presence, never values, of the six retained non-OpenAI `SOFTWAREFACTORY_*` secrets documented in [Environment variables](ENVIRONMENT_VARIABLES.md). Keep `SOFTWAREFACTORY_OPENAI_API_KEY` absent until a fresh funded replacement is configured through the protected path. Confirm untrusted PR workflows cannot receive secrets, checkout does not persist credentials, the normal workflow token is read-only, and worker secrets enter only their reviewed steps.

Verify `SOFTWAREFACTORY_REQUIRED_CHECKS` is exactly `Lint, typecheck, test, and build|Browser and accessibility tests` and still exactly matches the two CI job display names. Test missing/renamed/incomplete/non-success/unstable checks, truncated check enumeration, changed PR base/head, and the required identical passing fingerprint twice; every unsafe state must fail or time out.

Then verify the approved default-branch repository dispatch (or scheduled durable recovery) registers/heartbeats one worker, claims at most one run and one run per logical agent, uses the pinned validation digest, honors cancellation/timeout, redacts failures, and leaves no credential/workspace artifact. The secret-bearing workflow intentionally has no branch-selectable manual dispatch.

Before that run, verify repository Actions variable `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` is missing/false and both repository-dispatch and schedule triggers safely skip. Set it to literal `true` only under the exact protected activation approval after migrations, secrets, publication, CI, and deployment pass. Submit the real GREEN owner command through the authenticated UI/API and observe a fresh active heartbeat during its repository-dispatch run; do not add or use a manual workflow trigger. Restore activation to absent/false after the acceptance window unless continued operation is separately approved.

## Real end-to-end acceptance still required

Use one narrowly scoped manual GREEN owner command. Record:

1. owner/organization/project/command/task/run/agent IDs;
2. repository, installation/App/repository IDs, default branch, and exact base SHA;
3. dispatch outcome, worker ID, lease/attempt, heartbeat, and Codex thread ID;
4. timeline, validation rounds, changed paths, usage, and policy scan;
5. isolated `factory/*` branch, exact commit, author/committer, open draft PR, and exact head SHA;
6. the complete stable check set, both exact required names/conclusions, two identical passing fingerprints, and final draft PR base/head recheck;
7. coherent artifact/pull-request projection plus bounded structured report/activity and terminal state; and
8. proof the default branch, PR approval/merge, production deployment, rollback, workflow/provider settings, secrets, and RED authority were untouched.

Exercise adverse cases separately: dispatch failure with schedule recovery, stale base SHA, cancellation, lease expiry, provider rate limit/unavailable, validation failure, CI failure/timeout, retry bounds, existing-draft recovery, protected path denial, secret denial, and oversized/binary/symlink changes.

## Evidence discipline

- A skipped, stale, flaky, narrower, or mocked test is not proof for omitted scope.
- A queued command or workflow event is not a worker claim.
- A fresh active heartbeat proves an executing worker. A clean idle one-shot heartbeat is briefly Available/Connected but is not end-to-end execution proof; stale, disabled, or missing heartbeat state is Not Connected.
- A Vercel READY build is not a Codex run.
- A draft PR is not a merge/deployment.
- Record exact commit/tree, runtime versions, commands/counts, hosted migration state, workflow run, deployment, and provider artifact IDs in `AI/CURRENT_STATE.md` and `AI/QUALITY_SCORECARD.md`.
