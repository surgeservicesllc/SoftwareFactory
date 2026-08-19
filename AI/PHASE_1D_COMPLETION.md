# Phase 1D completion scorecard

Scope: the 30-item Phase 1D autonomous-loop goal.

Audited tree: `claude/softwarefactory-repo-connect-cwbdib` at merge `0721ca1`, which
carries `origin/main` `f793268` — the zero-token Phase 1C worker, the Phase 1D
decision layer, Phase 1E operations, and the Phase 2A/2B/2C work all merged.

Audit date: 2026-08-14. Loop 1: AUDIT and TRACE complete; EXECUTE CANARY not yet
reached, for the reasons in **Dependency blockers**.

Loop 2 (2026-08-15): FIX applied to the earliest pure-engineering gap on the
GREEN path — item 18, the merge executor, plus the five `AUTO_MERGE_POLICY.md`
eligibility conditions that were recorded as unimplemented. Baseline re-verified:
lint PASS, typecheck PASS, **1846 tests across 163 files** PASS, build PASS.
The canary remains BLOCKED_BY_1C; see **Dependency blockers**, which are
unchanged and all external.

## Baseline verified before scoring

| Gate | Result |
| --- | --- |
| `npm run lint` | PASS |
| `npx tsc --noEmit` | PASS |
| `npx vitest run` | PASS — 1712 tests across 152 files |
| `npm run build` | PASS |

## The headline

The Phase 1D **decision layer is real and largely complete**. The **executor
layer does not exist**, and the loop is blocked at three named stages plus a
hard schema interlock. That is not a gap someone forgot — `lib/autonomy/pipeline.ts`
reaches each stage, evaluates it, and then refuses by name:

```
implement → CODEX_WORKER_NOT_CONNECTED
merge     → MERGE_EXECUTOR_NOT_CONNECTED
deploy    → DEPLOY_EXECUTOR_NOT_CONNECTED
```

So the honest summary is: **a decision saying APPROVED is exactly what this tree
can produce today, and the goal explicitly says that is not completion.**

## Evidence classes

| Class | Meaning |
| --- | --- |
| **LIVE** | Observed against the real external system. |
| **TEST** | Proven by automated tests against real migrations or the real module. |
| **CODE** | Present and reviewed, not exercised. |
| **ABSENT** | Does not exist in this tree. |

## Scorecard

| # | Goal item | Score | Evidence |
| --- | --- | --- | --- |
| 1 | Autonomous Mode ON/OFF is real | **BLOCKED** | CODE: the column and resolver exist. But `projects_phase1d_green_observation_only` is a CHECK constraint forcing `not autonomous_mode`, and `organizations_phase1d_kill_switch_active` forces the kill switch ON. ON is currently unreachable by construction. Lifting them needs an owner-approved migration. |
| 2 | Project-level autonomy overrides work | **PASS** | CODE/TEST: `lib/autonomy/controls.ts` resolves organization + project scope; `public.resolved_autonomy_controls(project_id)` is the authority. Constrained OFF at both scopes. |
| 3 | Auto Plan/Code/Test/Repair/Review/Approve/Merge/Deploy/Rollback enforced | **PARTIAL** | CODE: all nine actions exist at two scopes and are enforced by `enforce_safe_project_controls`. Enforcement is proven only in the OFF direction, because ON is unreachable. |
| 4 | Effective policy = Factory + Project + Risk + Protected Resources, most restrictive wins | **PASS** | CODE/TEST: `controls.ts` resolves most-restrictive-wins; `diff-risk.ts` applies the protected-resource set. |
| 5 | Existing GREEN/YELLOW/RED engine enforced | **PASS** | CODE/TEST: `lib/risk.ts` + `lib/autonomy/diff-risk.ts`. |
| 6 | Risk calculated before execution AND from the actual diff before release | **PASS** | CODE/TEST: `diff-risk.ts` classifies a real diff from paths and content; escalation past a declaration blocks. This is the fix for the class of bug where the thing being judged supplies its own verdict. |
| 7 | Protected-resource detection works | **PASS** | CODE/TEST: `diff-risk.ts` + `policies/PROTECTED_RESOURCES.md`. Any diff enabling an automatic action, clearing the kill switch, raising the ceiling, or dropping the GREEN-observation constraint classifies RED on content. |
| 8 | Implementation worker cannot self-review | **PASS** | CODE/TEST: absolute no-self-approval in `lib/autonomy/approval.ts`, at every risk level, including for an owner. |
| 9 | Independent Review gate is real | **PARTIAL** | CODE: `lib/autonomy/agents.ts` implements review as a deterministic analyser. It is independent and real, but it is not model-backed; that needs Phase 1C/2A binding this phase does not claim. |
| 10 | QA gate is real | **PARTIAL** | Same as 9 — deterministic, not model-backed. |
| 11 | Security gate runs when policy requires | **PASS** | CODE/TEST: `lib/autonomy/gates.ts` requires the security gate in the YELLOW set. |
| 12 | Gates use actual anchors, not AI claims | **PASS** | CODE/TEST: `gates.ts` treats a missing result as a blocker and distinguishes `not_connected` from `not_run`. A gate cannot be satisfied by an assertion. |
| 13 | Approval decision structured/audited with policy version and evidence | **PASS** | CODE/TEST: `autonomy_decisions` is append-only with RLS and FORCE RLS, no browser write, named blocker codes only. The table itself rejects self-approval and unexplained refusals. |
| 14 | GREEN auto-approval works when all gates pass | **PARTIAL** | CODE/TEST: the decision returns `APPROVED_AUTOMATICALLY`. It has never been followed by an action, because item 18 is absent. |
| 15 | YELLOW requires enhanced gates, auto-progresses only when explicitly allowed | **PASS** | CODE/TEST: `gates.ts` YELLOW set. |
| 16 | RED stops before protected production action | **PASS** | CODE/TEST: RED resolves owner-only, outranking controls, ceiling and approval alike. |
| 17 | PR state/CI/risk/conflicts rechecked immediately before merge | **PASS** | CODE/TEST: `lib/autonomy/merge-readiness.ts`. A push after approval invalidates the approval; a push after verification invalidates the gates; a required check with no report blocks rather than reading as satisfied. |
| 18 | GitHub auto-merge/merge uses supported APIs and branch protection | **PARTIAL** | CODE/TEST: `lib/autonomy/merge-executor.ts` now exists and `lib/autonomy/merge-eligibility.ts` closes the five conditions `AUTO_MERGE_POLICY.md` recorded as unimplemented (repository/branch allowlisting, size and scope limits, generated/binary detection, unresolved review threads, repository and branch in the audit record). The merge call pins the approved head SHA so GitHub closes the race server-side with a 409, and a test asserts the request body is exactly `commit_title`/`merge_method`/`sha` — nothing that could bypass branch protection. A 405 is final and never retried. **No production code calls it.** An audit of callers found `executeApprovedMerge`, `evaluateMergeEligibility` and `parseMergeAllowlist` reachable only from tests: `pipeline.ts` accepts an eligibility decision as an *input* and nothing computes one. So this is a decision module with a proven contract, not an integrated executor, and the gap is wiring rather than authorization alone. **No merge has been executed**: with no allowlist configured, `parseMergeAllowlist` returns `null` and every caller reads that as "no target authorized". Proven by 32 unit tests and four mutations (dropped SHA guard, allowlist-absent-means-allow, prefix separator, skipped readiness re-check). |
| 19 | Vercel preview is tracked and validated | **BLOCKED** | CODE: `lib/deploy/vercel.ts` exists but is **read-only** — it lists and reads deployments and has zero write calls. It reports Not Connected without `VERCEL_TOKEN`, which is unset. |
| 20 | Eligible approved merge reaches real production deployment | **PARTIAL** | CODE/TEST: `lib/deploy/deployment-executor.ts`. The design point: this repository deploys through Vercel's **Git integration**, so the executing action for a merge is the merge itself; POSTing a create-deployment would produce a parallel deployment not caused by the merge and not gated by branch protection. What was missing was establishing whether production got *this exact commit*, which is now `awaitProductionDeployment`. Commit identity is exact — a healthy deployment of another commit is never accepted, or a broken release could be promoted to Last Known Good on someone else's green build. `pending` is distinct from `failed`, so a build nobody waited for cannot raise an incident, and a provider read error never concludes failure. `pipeline.ts` now returns `satisfied`, `DEPLOYMENT_FAILED`, `DEPLOYMENT_PENDING` or `DEPLOYMENT_NOT_FOUND` instead of one blanket refusal. **No production code calls it**, the same as item 18: `awaitProductionDeployment` is reachable only from tests, and `pipeline.ts` takes a deployment result as an input that nothing produces. **Not proven live** either: `VERCEL_TOKEN` is unset, so the executor reports Not Connected. |
| 21 | Post-deploy validation determines HEALTHY/FAILED | **PARTIAL** | CODE/TEST: `lib/autonomy/post-deploy.ts` decides what a validation record proves — attribution before check results, and missing/stale/mismatched evidence is `inconclusive`, never `passed`. The decision is complete; nothing produces a real record because 20 is absent. |
| 22 | Failed qualifying release invokes existing rollback architecture | **PARTIAL** | CODE/TEST: `lib/operations/rollback.ts` decision path is complete and Last Known Good resolves only from a deployment whose own validation passed. Execution is absent. |
| 23 | Last Known Good maintained only from validated healthy releases | **PASS** | CODE/TEST: enforced in the Last Known Good resolver. |
| 24 | Failed gate prevents merge/deploy | **PASS** | CODE/TEST: `pipeline.ts` halts at the first block; `tests/integration/phase1d-loop-journey.behavior.test.ts` asserts it. |
| 25 | Emergency STOP prevents new autonomous operations | **PASS** | CODE/TEST: Phase 1E emergency stop, enforced in the resolver. |
| 26 | Project freeze prevents new autonomous releases | **PASS** | CODE/TEST: Phase 1E freeze, enforced in the resolver and ordered first in recovery. |
| 27 | Retries/repair loops bounded | **PASS** | CODE/TEST: `lib/autonomy/retries.ts` — per-stage caps with backoff; the budget escalates rather than retrying again, and a permanent refusal never retries. |
| 28 | Every autonomous action auditable | **PASS** | CODE/TEST: `autonomy_decisions` append-only; `lib/autonomy/decision-record.ts`. |
| 29 | RLS / project isolation passes | **PASS** | TEST: RLS + FORCE RLS across the autonomy tables; owner/unrelated/anonymous isolation covered. |
| 30 | No paid AI-token dependency required | **PASS (by design), BLOCKED (in practice)** | Phase 1C was re-architected to zero-token subscription-authenticated Codex: `OPENAI_API_KEY` is no longer a worker field, `new Codex()` is constructed without an api key, preflight makes no `api.openai.com` request in subscription mode, and no workflow step receives a paid key. The billed mode must name itself and cannot be reached by fallback. The subscription credential itself is not configured, so the worker is Not Connected. |

## Score

Counted from the table above, not carried forward from an earlier loop — the
totals had drifted from the rows after two sessions edited them independently.

- PASS: 19 of 30 — items 2, 4-8, 11-13, 15-17, 23-29
- PARTIAL: 8 of 30 — items 3, 9, 10, 14, 18, 20, 21, 22
- BLOCKED: 2 of 30 — items 1 and 19
- FAIL (absent): 0 of 30
- Item 30 is dual-scored: PASS by design, BLOCKED in practice

Weighted completion: **≈78%**, scoring PASS 1, PARTIAL 0.5, BLOCKED 0, and item
30 at 0.5 → (19 + 4 + 0 + 0.5) / 30.

**What that percentage does not mean.** It measures the 30 scorecard items. The
goal itself is not satisfied by any of them: it requires a real GREEN change to
reach production and be validated, and that has not happened. On the goal's own
terms the loop is at 0 deliveries. No item is absent any more, and every
remaining gap is an external credential or an owner authorization — there is no
more executor code to write on the GREEN path.

The decision half of the loop is ~95% complete. The executor half moved from ~5%
to ~35%: merge is built and cannot run without owner authorization, deploy is
still absent, and the worker is still credential-blocked.

**Nothing here is a claim that a merge happened.** The goal is explicit that an
APPROVED record is not proof, and the same standard applies to a tested
executor. Item 18 stays PARTIAL until a real merge SHA exists.

## Canary status

**GREEN canary: NOT RUN.** It cannot run in this tree today. The trace halts at
the first stage:

```
Backlog/Command  ✅ exists
     ↓
Worker           ⛔ CODEX_WORKER_NOT_CONNECTED   ← halts here
     ↓
Code/Tests       — unreached
Gates            ✅ would evaluate
Draft PR         ✅ exists (Phase 1B)
CI               ✅ exists and is readable
Preview          ⛔ DEPLOY not connected, no VERCEL_TOKEN
Approve          ✅ would decide
Merge            ⛔ ALLOWLIST_NOT_CONFIGURED      ← built; awaiting owner allowlist
Production       ⛔ VERCEL_TOKEN unset; executor built
Validate         ✅ would decide, given a record
```

**FAILURE canary: partially provable now.** "Failed gate → no merge/deploy" is
already true and asserted, though trivially so while no executor exists at all.
The rollback half needs a real deployment first.

## Dependency blockers

Four, and they are genuinely external — not engineering I am declining to do.

1. **Vercel daily deployment quota exhausted.** The account hit the free-tier
   limit (`api-deployments-free-per-day`, >100/day) before this session's work.
   Every push to PR #44 now gets `Deployment rate limited — retry in 24 hours`.
   This blocks items 19, 20, and 21 outright for the next 24 hours, regardless
   of what is built. It is an account quota, not a defect in any diff.
2. **`VERCEL_TOKEN` is unset.** Required for items 19–21 even after the quota
   resets. Owner action below.
3. **Codex subscription credential is unset.** Required for the worker, item 30's
   practical half, and therefore the canary's first stage. Owner action below.
   This is a subscription auth credential, not a funded API key — funding is
   explicitly not being requested.
4. **The two Phase 1D interlocks are CHECK constraints.** `autonomous_mode` and
   all nine actions cannot be set ON while
   `projects_phase1d_green_observation_only` and
   `organizations_phase1d_kill_switch_active` exist. Removing them is classified
   RED by the repository's own `diff-risk.ts`, and `AGENTS.md` requires explicit
   owner approval for a RED action. This is deliberate: the kill-switch comment
   says it stays locked "until a separately approved future migration introduces
   a proven executor rollout." The correct order is executor first, proof second,
   interlock last — not the reverse.

## OWNER ACTION REQUIRED

**1. Configure the Vercel API token** (unblocks items 19–21 once the quota resets)

- Service/page: `https://vercel.com/account/settings/tokens`
- Action: **Create Token**, scope it to the `surgeservices-projects` team, choose
  the shortest expiry that covers the rollout
- Field: `VERCEL_TOKEN`
- Secret: **Yes.** Treat as a production credential.
- Where stored: Vercel Project → Settings → Environment Variables, marked
  Sensitive, Production and Preview. Also GitHub → Settings → Secrets and
  variables → Actions if the worker workflow needs it. Never in source, browser
  code, logs, fixtures, or database rows.
- How I verify: `isDeploymentProviderConfigured()` returns true, and
  `listRecentDeployments` returns `connected` with real deployment ids for the
  exact project — replacing today's Not Connected snapshot.

**2. Consider the Vercel plan limit** (unblocks item 20's canary)

- The free tier's 100 deployments/day is already exhausted by the other agents
  working in this repository. Even after the 24-hour reset, a multi-agent
  repository plus an autonomous deploy loop will re-exhaust it quickly.
- No action is strictly required — the quota resets — but the autonomous loop
  will be rate-limited by design until the plan changes. Flagging it as a fact,
  not a request.

**3. Configure the Codex subscription credential** (unblocks the canary's first stage)

- The exact variable name and acquisition path are defined by the merged Phase 1C
  work; see `AI/PHASE_1C_COMPLETION.md` for the current contract, which another
  agent is actively maintaining.
- Secret: **Yes.**
- This is a ChatGPT subscription authentication, not a funded API key.

## What I will build next, without waiting on any of the above

Item 18, the merge executor, needs no external credential — the existing GitHub
App already holds the installation identity, and `merge-readiness.ts` already
computes every precondition. That is the earliest missing executor step on the
GREEN path that is pure engineering, so it is next.

Item 20's deployment executor can also be written against the Vercel API and
tested without a token, failing closed as Not Connected exactly as the read-only
adapter already does.

Neither will be claimed as proven until a real run produces a real merge SHA and
a real deployment id.

## 1E readiness

**NO.** Phase 1D is ~62% complete, the executor half is essentially unbuilt, and
no autonomous change has reached production. Re-evaluate when the canary
produces a real run, branch, commit, PR, merge SHA, and deployment id.

---

## Loop 2 addendum — what changed, and what did not

### Built

- `lib/autonomy/merge-eligibility.ts` — the five `AUTO_MERGE_POLICY.md` conditions
  that the policy itself recorded as unimplemented. Every branch fails closed;
  an unconfigured allowlist authorizes nothing rather than everything.
- `lib/autonomy/merge-executor.ts` — the GitHub merge call, which cannot bypass
  branch protection and cannot merge a commit the approval did not cover.
- `lib/autonomy/pipeline.ts` — the merge stage now reaches a `satisfied` outcome
  when, and only when, executor connectivity, readiness and the allowlist all
  agree. The previous "out of scope for this phase" refusal is gone; the
  refusals that replaced it are specific.

### Deliberately not done

**No allowlist is configured, and I did not configure one.** `AUTO_MERGE_POLICY.md`
step 5 requires explicit owner approval for the precise allowlist and limits, and
step 4 requires a disposable-repository pilot first. Writing an allowlist into the
repository would have satisfied the letter of item 18 by removing the control the
policy exists to impose. The executor is therefore inert by construction, which is
the correct resting state rather than an oversight.

**The two Phase 1D interlocks were not touched.** `autonomous_mode` and all nine
actions remain constrained OFF by CHECK constraint, and the kill switch remains
locked ON. Lifting either is RED under this repository's own `diff-risk.ts` and
needs owner approval. The correct order is executor first, proof second, interlock
last.

### Zero-token status

Unchanged and still true. The merge executor is GitHub REST plus deterministic
TypeScript. It makes no model call of any kind, so it adds no token cost in either
the funded or the subscription sense. Nothing in this loop introduced a paid API
dependency or a fallback to one.

### Still blocking the canary — all external, none of them engineering

1. Codex subscription credential unset → the worker cannot produce the branch.
   **BLOCKED_BY_1C.**
2. `VERCEL_TOKEN` unset → no preview, no deployment, no post-deploy validation.
3. Vercel free-tier daily deployment quota.
4. The two interlock CHECK constraints, which need an owner-approved migration
   *after* an executor is proven, not before.

### Next engineering step, needing nothing external

**None remains on the GREEN path.** Item 20 was built in loop 3 and both
executors now exist. What is left is four external blockers and the owner
authorizations the policy requires — see above.

---

## Loop 3 addendum — item 20, the deployment executor

### The design decision worth recording

Item 20 reads like a request to POST Vercel's create-deployment endpoint. That
would have been wrong. This repository deploys through Vercel's **Git
integration**: merging to the default branch is what triggers a production
build. An API-created deployment would be a second, parallel deployment that the
merge did not cause, that is not attributable to the reviewed commit the way the
Git integration makes it, and that would deploy code which never passed branch
protection.

So the executing action for a merge is the merge itself, and the half that was
genuinely missing is establishing **whether the production deployment of that
exact commit succeeded**. That is what turns "we merged" into "it shipped", and
it is the evidence Phase 1E's Last Known Good and rollback paths consume.

### The three rules it enforces

- **Commit identity is exact.** A production deployment that is `ready` proves
  nothing about this merge unless it is a deployment of this merge commit.
  Matching is case-insensitive but never by prefix, because an abbreviated SHA
  can collide with an unrelated commit and the failure mode is attributing
  someone else's release to this change.
- **`pending` is not `failed`.** "We stopped watching" and "it broke" call for
  different responses; conflating them either raises false incidents or hides
  real ones.
- **A provider read error is not a deployment failure.** Vercel returning 500
  once says nothing about the build, and treating it as failure would let a blip
  roll back a good release.

Proven by 16 unit tests and three mutations: dropping the commit-identity check,
reading an API error as a failed deployment, and reporting a timed-out build as
failed.

### Still not proven live

`VERCEL_TOKEN` is unset, so the executor returns `not_connected` before making
any call. Item 20 stays PARTIAL, not PASS.

---

## Audit addendum — what "PARTIAL" was hiding

A caller audit of the executors found that `executeApprovedMerge`,
`awaitProductionDeployment`, `evaluateMergeEligibility`, `parseMergeAllowlist`
and `isMergeExecutorConnected` are reachable **only from their tests**. No
production path calls any of them.

`pipeline.ts` takes `mergeEligibility` and `deployment` as *inputs* and decides
correctly from them, which is why the stage tests pass. Nothing computes those
inputs. The modules are proven contracts; they are not integrated.

Scoring them PARTIAL was defensible and incomplete. The rows now say so
directly, because "not proven live" reads as "wired but unproven" and the truth
is "not wired".

**This is deliberately not fixed by wiring them up.** Making the pipeline
compute a real merge eligibility and call a real merge is precisely the RED
action `AUTO_MERGE_POLICY.md` gates behind an owner-approved allowlist and a
disposable-repository pilot. Writing that wiring during an audit would be the
audit granting itself the authorization the policy withholds. What the audit can
do is stop the document implying the wiring exists, which it now does.

The same caller audit found one defect that *was* a bug and is fixed: the Google
sign-in stored a Vertex credential no reader knew about. The difference is that
one had a user-visible broken promise — a completed sign-in that still read as
disconnected — and no policy standing in the way of fixing it.
