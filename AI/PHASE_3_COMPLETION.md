# Phase 3 completion scorecard

Scope: the 37-item Phase 3 self-improving factory goal.

Audited tree: `origin/main` after the Phase 2D merge. Audit date: 2026-08-15, cycle 1.

## The headline

Phase 3 asks the factory to measure and improve itself. The audit's finding is
that **the raw material already exists and the loop does not**.

Eighteen telemetry tables already record what Phase 3 wants to measure —
`graph_runs`, `node_runs`, `agent_runs`, `provider_run_events`,
`provider_routing_decisions`, `test_runs`, `deployments`,
`deployment_validations`, `incidents`, `repair_attempts`, `operations_events`,
`autonomy_decisions`, `resource_breaker_events`, and more. Nothing reads them
*as evidence about the factory itself*.

Two modules already do, in miniature, exactly what Phase 3 asks for at scale:

- **`lib/graph/optimizer.ts`** produces structured `Recommendation`s from real
  run history, refuses to recommend below `MIN_RUNS_FOR_STRUCTURAL_CHANGE = 3`,
  and exposes `abstentionReason` so "not enough evidence" is a stated answer
  rather than silence. That is the evidence-threshold discipline the Phase 3
  LEARNING section requires, already built — for graphs only.
- **`lib/graph/frozen.ts`** already declares nine frozen policies behind a
  single gate with no override parameter, with a comment that reads like the
  Phase 3 brief: *"a planner optimising for completion will, given the chance,
  route around the thing stopping it."* Again — for graph plans only.

So Phase 3 is not a greenfield build. It is: generalize both from *graphs* to
*the factory*, and add the one thing neither has — a **before/after
measurement loop** that can reject its own proposals.

The gap that matters most is that last one. Everything in this repository can
currently produce a recommendation. Nothing can prove a change helped, and
nothing can withdraw a change that did not.

## Evidence classes

| Class | Meaning |
| --- | --- |
| **LIVE** | Measured against real factory telemetry. |
| **TEST** | Proven by automated tests against real migrations or the real module. |
| **CODE** | Present and reviewed, not exercised. |
| **ABSENT** | Does not exist. |

## Scorecard

| # | Goal | Score | Evidence |
| --- | --- | --- | --- |
| 1 | Factory can audit its own repository/system | **FAIL — ABSENT** | No self-audit module. Nothing reads the telemetry tables as evidence about the factory. |
| 2 | Self-health score uses real evidence | **FAIL — ABSENT** | No health score exists. |
| 3 | Measures run success/failure | **PARTIAL** | `agent_runs`, `graph_runs`, `node_runs` and `provider_run_events` record it. Nothing aggregates it. |
| 4 | Measures graph/node performance | **PARTIAL** | `node_runs` carries timings; `lib/graph/optimizer.ts` reads them for one graph. No cross-graph view. |
| 5 | Measures verifier rejection | **PARTIAL** | `autonomy_decisions` is append-only with named blocker codes — the right substrate. Never aggregated. |
| 6 | Measures retries/repair loops | **PARTIAL** | `repair_attempts` and bounded retry budgets in `lib/autonomy/retries.ts`. Not measured over time. |
| 7 | Measures CI/build/test failures | **PARTIAL** | `test_runs` exists. CI results are readable from GitHub but not ingested. |
| 8 | Measures deployment/rollback/incidents | **PARTIAL** | `deployments`, `deployment_validations`, `incidents` all exist (Phase 1E). Unaggregated, and no monitor has observed a real production target. |
| 9 | Measures worker/provider availability | **PARTIAL** | `resource_breaker_events` plus the Phase 2D `connections.health` added this session. Not trended. |
| 10 | Measures queue/bottleneck/latency | **PARTIAL** | `node_run_claims` and `operations_events` carry the data; nothing derives queue depth or wait time. |
| 11 | Measures real usage/cost where available | **PARTIAL** | `lib/providers/usage.ts` accounts usage. Cost is deliberately absent — the zero-token paths have no per-token cost, and the brief says not to optimize cost without real data. |
| 12 | Detects recurring failure patterns | **FAIL — ABSENT** | `lib/operations/fingerprint.ts` deduplicates incidents by fingerprint, which is the right primitive, but nothing mines it for recurrence. |
| 13 | Detects flaky workflows/tests | **FAIL — ABSENT** | Requires same-input different-outcome analysis over `test_runs`. Not built. |
| 14 | Detects inefficient graph topology | **PARTIAL** | `lib/graph/optimizer.ts` does exactly this, for a single graph, on demand. Not run as a standing audit. |
| 15 | Detects fake/unnecessary edges | **PARTIAL** | Same module, same limitation. |
| 16 | Detects excessive sequential depth | **PARTIAL** | Same module, same limitation. |
| 17 | Detects unnecessary AI nodes where deterministic code works | **FAIL — ABSENT** | Arguably the highest-value detector in the list and the one most aligned with the zero-token constraint. Nothing attempts it. |
| 18 | Detects poor routing/model selection | **PARTIAL** | `provider_routing_decisions` is immutable and records the decision. Outcomes are never joined back to it. |
| 19 | Detects repeated provider/agent underperformance | **FAIL — ABSENT** | Needs the join in row 18 plus a threshold. |
| 20 | Detects stale/dead code/configuration | **PARTIAL** | Two real instances were found *by hand* this session: an unused `fail_github_change_request` overload, and an unset SMTP port that silently disabled migration apply. Both prove the category is real; neither was found by a detector. |
| 21 | Identifies technical debt | **FAIL — ABSENT** | No inventory. |
| 22 | Creates evidence-backed improvement proposals | **PARTIAL (improved loop 19)** | The persistence half now exists: `improvement_ledger` (migration `20260815001200`) records proposals durably, and the boundary refuses one without a non-empty baseline by name ("a recommendation, not an improvement"). What still does not exist is anything that *creates* proposals from telemetry — the detectors (goals 12-21) remain unbuilt, so today every proposal is owner-authored. |
| 23 | Proposals include benefit, risk, evidence, acceptance criteria | **PASS (loop 19)** | The proposal entry type requires all of it at the schema boundary: title, what changes, a falsifiable prediction, a non-empty baseline, acceptance criteria, and the constitution version that judged the intent. A row missing any of them cannot exist (`improvement_ledger_entry_shape`), proven in `improvement-ledger.behavior.test.ts`. |
| 24 | Improvements become normal backlog/tasks/graphs | **PARTIAL (loop 19)** | The implementation entry type binds a proposal to a real `commands` row by composite foreign key, and it is refused until a decision row says `accepted` — so the only implementation path the ledger can record is the ordinary `submit_command` door. Nothing yet *automates* that routing; today an owner submits the command and links it. |
| 25 | Uses existing 1C/2B execution, not a special self-edit path | **PASS (by construction)** | No self-edit path exists, so none can be special. This must stay true. |
| 26 | Self-change uses an isolated branch | **PASS** | The only write path creates `softwarefactory/<timestamp>-<id>`; there is no default-branch writer anywhere in the API surface. |
| 27 | Self-change receives independent fresh review | **PASS** | `lib/autonomy/approval.ts` enforces absolute no-self-approval at every risk level, including for an owner. |
| 28 | Tests/CI/security are mandatory anchors | **PASS** | `lib/autonomy/gates.ts` treats a missing gate result as a blocker and distinguishes `not_connected` from `not_run`. |
| 29 | Cannot self-approve protected RED changes | **PASS** | RED resolves owner-only, outranking controls, ceiling and approval. |
| 30 | Cannot modify frozen policies to improve its own score | **PASS (loop 18)** | `lib/factory/constitution.ts`: the frozen policies, versioned (`factory-constitution-v1`), extended with the three factory-level rules (zero-token, append-only evidence, constitution-immutable-to-subjects), judging every subject including `self_improvement_proposal`. Every check names the version that judged it, so a future improvement ledger records *under which constitution* a proposal was allowed. A subject modifying the constitution is refused by name for every subject in the vocabulary; `lib/autonomy/diff-risk.ts` continues to classify authority-widening diffs RED on content. Pinned in `factory-constitution.test.ts`. |
| 31 | Self-improvement can be disabled / emergency-stopped | **PARTIAL (improved loop 18)** | The subject now exists and the constitution refuses it under an active emergency stop (proven by test). What still does not exist is a running self-improvement loop for the stop to halt — that arrives with the improvement ledger and detectors, and this gate is already waiting for it. |
| 32 | Before/after metrics determine whether improvement helped | **PARTIAL (loop 19)** | The structure is now enforced: a proposal cannot exist without a baseline, an evaluation cannot exist without a measured after-state and an outcome against the prediction, a second evaluation is refused as score shopping, and both live in one append-only lifecycle. What remains absent is the *capture and comparison machinery* — nothing yet reads the telemetry tables into a baseline or computes the outcome; today a human measures and records. That is the next ordered step. |
| 33 | Failed improvement is rejected/rolled back | **PARTIAL (loop 19)** | `regressed` is a first-class recorded outcome with a mandatory lesson, and rejection is a first-class decision with a mandatory reason. Rollback execution remains absent by design (Phase 1D/1E posture). |
| 34 | Successful improvement records measurable evidence | **PARTIAL (loop 19)** | The evaluation entry records the measured after-state against the proposal's baseline and prediction, append-only. Awaits the capture machinery (32) for the numbers to come from telemetry rather than hands. |
| 35 | Improvement history is durable/auditable | **PARTIAL** | `autonomy_decisions` is append-only with RLS and rejects unexplained refusals — the right precedent. No improvement-history table. |
| 36 | RLS / security / project isolation passes | **PASS** | 0 of 103 public tables missing RLS/FORCE RLS, verified on a real PostgreSQL 16.13 cluster; `service_role` on exactly four ingress tables. |
| 37 | No paid AI-token dependency | **PASS** | `lib/providers/claude-cli-transport.ts` reaches Claude on the owner's subscription with a verified live canary; Phase 1C is zero-token subscription Codex. No paid key is a configuration field on either path. |

## Score

Re-scored 2026-08-15 (master loop iteration 18) after the versioned
constitution landed as the plan's step 1:

- PASS: 10 of 37
- PARTIAL: 20 of 37
- FAIL (absent): 7 of 37
- Weighted completion: **≈47%**

Loop 19 landed the improvement ledger (plan step 2): the
proposal/decision/implementation/evaluation lifecycle is durable,
append-only, and boundary-enforced. The remaining absents are the
measurement machinery (baseline capture, comparison, detectors 12-21) and
the self-audit engine (1, 2) — plan steps 3 and 4.

The safety half scores well and is largely inherited. The measurement half —
which is what makes this Phase 3 rather than a recommendation engine — is
unbuilt.

## Earliest missing capability

Not the self-audit engine. **The baseline.**

Every detector in goals 12–21 produces a proposal, and every proposal is
worthless under goal 32 unless a baseline was captured *before* the change.
Building detectors first would produce a system that can recommend and cannot
evaluate — which is precisely the failure the brief names: *"An AI
recommendation is NOT improvement."*

Order of work:

1. **Versioned frozen constitution.** Generalize `lib/graph/frozen.ts` from
   graph plans to any actor, add a version, and make a self-improvement
   proposal a subject of it. This must exist *before* anything can propose a
   change to the factory, not after.
2. **Improvement ledger** — proposal, prediction, baseline, acceptance
   criteria, actual, outcome, lesson. Append-only, RLS, modelled on
   `autonomy_decisions`.
3. **Baseline capture and comparison** against the eighteen existing telemetry
   tables.
4. **Detectors**, generalizing `lib/graph/optimizer.ts` and reusing its
   evidence-threshold and abstention discipline.
5. **Intake through `submit_command`**, so an improvement is an ordinary
   backlog item and goal 25 stays true by construction.

## Blockers

- **Live telemetry is thin.** Most tables exist but hold little real history:
  Phase 1C has never completed a run, Phase 1E has never observed a real
  production target, and provider execution is OFF. Detectors will be
  correct-by-test and abstaining-in-practice until the factory has actually
  done work. This is honest rather than fatal — `abstentionReason` is the right
  answer to an empty sample, and the repository already models it.
- **Hosted apply is blocked on ledger drift.** The Supabase integration now
  parses config (fixed this session) and fails at the next step with *"Remote
  migration versions not found in local migrations directory."* Resolving it
  needs the remote ledger, which needs credentials this environment does not
  have.

## Owner action

1. **Resolve the migration ledger drift.** Run `supabase migration list`
   against project `qpuofpmagrmyamahqwxw` and compare to
   `supabase/migrations/`. Versions present remotely but absent locally need
   `supabase migration repair --status reverted <version>`, or the file
   restoring. Until this clears, no migration reaches hosted by any path.
2. **A second real account** remains outstanding for Phase 1B item 2, Phase 2D
   goal 35.
