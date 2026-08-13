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

## Pre-reconciliation Phase 1C baseline

| Gate | Current status |
| --- | --- |
| Runtime | Supported bundled Node `24.19.0` |
| `npm run check` | Pass on Node `24.19.0`: lint/typecheck, 109 test files/1,169 tests, production build with 74 page/route entries |
| Coverage | Pass: 75.06% statements, 69.97% branches, 72.60% functions, 76.66% lines |
| Focused migration suites | Pass: 8 files/104 tests |
| Playwright responsive/accessibility | Pass: 117/117 across desktop/tablet/mobile against the production build |
| Production dependency audit | Pass: `npm audit --omit=dev` reports 0 vulnerabilities |
| Changed-tree secret scan | Pass: 96 files, 0 high-confidence secret candidates |
| Production static scan | Pass: `.next/static` 27 files, 0 privileged markers |
| Disabled worker smoke | Pass: exits safely without executing |
| Diff/independent audit | Pass: `git diff --check` clean except line-ending notices; final independent P0/P1 audit PASS |

These results apply to the frozen local candidate. They do not prove hosted reconciliation/migrations, provider credentials, enabled execution, Actions configuration, workflow publication, an active worker heartbeat, a live provider call, a Codex thread, or a Phase 1C draft PR/required-CI result.

## Phase 1C unit/integration coverage

The suites cover:

- command type/criteria/idempotency, same-origin, owner-only submission, secret/key/size rejection, project binding, deterministic prompt-plus-criteria risk escalation, exact base SHA, fixed plan, opaque dispatch, delayed evidence, and RED blocking;
- catalog/history reconciliation for schema-present `028`/`130001`-`130005`, followed by forward `130006` -> `130007` -> `130008` -> `130009` -> `130010` -> `130011`; provider compatibility, Phase 1D interlocks, tables/constraints/indexes, RLS/FORCE RLS, dependencies, cumulative retry budgets, policies/grants, safe detail/status, lease/result functions, append-only evidence, RED claim exclusion, and terminal report/activity behavior;
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

## Hosted Supabase acceptance still required

After exact owner approval, catalog-prove and ledger-repair only schema-present `028`/`130001`-`130005`, re-list/dry-run, then apply absent `130006` -> `130007` -> `130008` -> `130009` -> `130010` -> `130011` to exact project `qpuofpmagrmyamahqwxw` and verify:

- linked migration history and lint;
- all public tables RLS/FORCE RLS and intended policies;
- exact table/function ACLs and no unintended service-role table grants;
- function search paths, constraints, indexes, triggers, secret checks, and append-only guards;
- direct browser denials plus bounded member detail/status;
- owner-only submission; owner/admin cancel/retry; and service-worker lease/result paths;
- direct command SQL prompt/criteria risk and fixed configuration normalization, payload/secret limits, and RED exclusion;
- provider-neutral roster, one active lease per logical agent, coherent artifact/PR replay and rejection, stale-lease/cancellation terminalization, structured report content, and bounded reconstructed PR links; and
- real owner, second-tenant, and anonymous behavior using caller sessions.

Hosted schema evidence exists for `028`/`130001`-`130005`, but the owner dashboard shows exactly 26 ledger rows through `027`. Phase 1D `130006` and Phase 1C `130007`-`130011` remain unhosted. The current CLI profile returns `403`. A normal push is prohibited until owner-approved ledger reconciliation completes.

## Protected GitHub Actions acceptance still required

Verify the presence, not values, of the seven `SOFTWAREFACTORY_*` secrets documented in [Environment variables](ENVIRONMENT_VARIABLES.md). Confirm untrusted PR workflows cannot receive them, checkout does not persist credentials, the normal workflow token is read-only, and secrets enter only the worker step.

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
