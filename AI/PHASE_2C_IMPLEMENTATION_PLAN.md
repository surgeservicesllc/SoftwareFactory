# Phase 2C — Intelligent Agent & Resource Manager: implementation plan

Audit date: 2026-08-13. Branch `claude/softwarefactory-phase-2c-resource-manager`, from `main` at `c6da661`.
Baseline verified before any Phase 2C edit: lint, typecheck, 127 files / 1451 tests, clean production build.

Target: `Graph Node → Resource Manager → Score Candidates → Assign Best Worker → Execute → Measure Result → Learn → Improve Future Routing`

## Status legend

**COMPLETE** (exists, tested, sufficient) · **PARTIAL** (exists, insufficient) · **MISSING** (no implementation) · **BROKEN** (exists, wrong) · **BLOCKED** (cannot be built or proven until a named dependency clears)

---

## 1. The premise this phase rests on, checked first

The objective routes **graph nodes**. So the first question is whether a graph exists.

| Assumed input | Real state | Consequence |
| --- | --- | --- |
| Phase 2B Graph Engine | **MISSING.** `AI/PHASE_2B_IMPLEMENTATION_PLAN.md` states plainly: "Phase 2B is **0% implemented** as of this audit… No part of this document should be read as a claim that teams, orchestration, task graphs, handoff persistence, parallel execution, or team UI exist today. They do not." No graph table, node type, or scheduler exists. | There is no graph node to route. The routable unit that *does* exist is the Phase 1C task with dependencies. |
| Phase 1C task dependencies | **COMPLETE.** `20260813001100_phase1c_task_dependencies.sql`. | This is the real dependency structure Phase 2C can schedule against — a task DAG, not a "graph node" in the 2B sense. |
| Phase 2A provider routing | **COMPLETE.** `routeProvider` scores candidates on reliability/latency/cost/affinity with precedence `OWNER_OVERRIDE → AGENT_ASSIGNMENT → PROJECT_DEFAULT → AUTO_SCORE`, plus two absolute rules: an undeclared capability is never selected, an unconnected provider is never selected. | Extend it. Do not rebuild it. |
| Historical performance to learn from | **BLOCKED — no history exists.** `agent_runs` carries the right columns (`provider`, `model`, `task_kind`, `usage`, `latency_ms`, `routing_decision_id`, `fallback_from_provider`), but **no provider run has ever executed**: `ANTHROPIC_API_KEY` and `OPENAI_API_KEY` are absent from this environment (verified), both providers report **Not Configured**, and `ai_provider_execution_enabled` defaults OFF. | The learning loop can be built and tested. It cannot be demonstrated on real outcomes, because there are none. It must therefore **abstain**, not guess. |

### Scope decision

The objective says "Never fabricate metrics." With zero recorded runs, that single sentence determines the shape of this phase:

- Every scoring input that comes from observed history is **optional and evidenced**. When a candidate has fewer than the minimum sample count, the manager reports `INSUFFICIENT_HISTORY` and falls back to declared capability and configured preference — it never invents a success rate, latency, or cost.
- Predicted-vs-actual and routing regret are recorded from the moment a run completes. Until one does, those surfaces read **No data yet**, not zero.
- Circuit breakers open on *observed* failures. With no observations, every breaker is closed and says so.

This is the same rule Phase 1E applied to monitoring: absence of evidence is **UNKNOWN**, never a reassuring number.

---

## 2. Component audit

### 2.1 Resource Manager (objective §2)

| Item | Status | Evidence |
| --- | --- | --- |
| Central scheduler/router across agent, provider, model, capacity | **MISSING** | `routeProvider` routes provider+model only. Nothing selects an agent or reserves capacity. |
| Agent ≠ provider ≠ model ≠ account ≠ connection | **COMPLETE** | ADR-021; `agents` carries `role` plus optional provider/model preference. The distinction is already correct and must be preserved. |
| Worker capacity / concurrency control | **MISSING** | No capacity model. Phase 1C leases a worker; nothing bounds how many run at once. |
| Worktrees | **PARTIAL** | `lib/worker/workspace.ts` isolates a workspace per run; it is not a managed pool. |
| API/rate limits | **MISSING** | No rate-limit accounting. |
| Budgets | **PARTIAL** | Phase 1C carries per-run budget concepts (`lib/worker/types.ts`, `20260813000900`); there is no graph/project budget enforcement across runs. |

### 2.2 Capability registry (objective §3)

**PARTIAL.** `PROVIDER_CAPABILITIES` declares eight provider capabilities and `TASK_KIND_REQUIRED_CAPABILITIES` maps task kinds onto them — the enforcement rule already exists and works. What is missing is the 2C breadth (planning, architecture, coding, frontend, backend, database, research, QA, security, review, synthesis, production investigation), per-**agent** and per-**model** capability declarations, availability, and project restrictions.

### 2.3 Candidate scoring (objective §4)

**PARTIAL.** `ScoredCandidate` already carries `reliability`, `latency`, `cost`, `affinity` and structured `ineligibleReasons`, and decisions are persisted to `provider_routing_decisions`. Missing: capability fit as a scored dimension, historical success, verification pass rate, review rejection rate, availability, context limits, and project preference — and the honest handling of each when no history exists.

### 2.4 Routing modes (objective §5)

**PARTIAL.** `AUTO | ANTHROPIC | OPENAI` exist with correct precedence. Missing: `SPECIFIC AGENT` and `SPECIFIC MODEL` modes. The rule that an override never defeats a security or risk restriction is **COMPLETE** and must not be weakened.

### 2.5 Model economics (objective §6)

**MISSING.** No objective selector (QUALITY/SPEED/COST/BALANCED), no economical-vs-strong model tiering, and no "use deterministic code when no model is needed" gate. The last one is the highest-value item in the section and needs no credential to build.

### 2.6 Capacity, queues, dynamic concurrency (objective §7–8)

**MISSING** for workers. A durable, idempotent queue pattern already exists and is proven — `operations_events` with `for update skip locked`, unique dedupe keys, bounded attempts and dead-lettering (Phase 1E, now also proven under real parallel connections). Phase 2C should reuse that pattern rather than invent a second one.

### 2.7 Fallback and reassignment (objective §9)

**PARTIAL.** `planFallback` exists with a declared error taxonomy where credential and content-policy failures are correctly **not** fallback-eligible. Missing: alternate *agent* reassignment and recorded fallback reasons per attempt.

### 2.8 Performance learning and routing feedback (objective §10–11)

**BLOCKED for demonstration; buildable.** The columns exist; the runs do not. Minimum sample thresholds are the correct mechanism and are fully testable with recorded fixtures.

### 2.9 Circuit breakers (objective §12)

**MISSING.** No breaker of any kind exists anywhere in the repository.

### 2.10 UI (objective §13)

**MISSING.** No Resource Manager view.

### 2.11 Budget enforcement (objective §14)

**PARTIAL.** Per-run budgets exist in Phase 1C; graph/project ceilings and the degrade-then-pause-then-stop ladder do not.

### 2.12 Security and RLS (objective §15)

**COMPLETE and must stay so.** 60/60 public tables carry RLS + FORCE RLS; `service_role` holds table privileges on exactly the four GitHub ingress tables. Any Phase 2C table must join under the same rules and grant `service_role` nothing new.

---

## 3. Blockers, with unblocking conditions

| # | Blocker | Effect | Unblocking condition |
| --- | --- | --- | --- |
| 1 | No `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` in any verified environment | No provider run has ever executed, so there is no real performance, latency, or cost data. Objective §16's "historical-performance routing improvement" cannot be demonstrated on real outcomes. | Owner sets both server-only keys and enables `ai_provider_execution_enabled`. |
| 2 | Phase 2B Graph Engine does not exist | "Graph node" scheduling has no graph. Phase 2C schedules the Phase 1C task DAG instead, which is the real structure. | Build Phase 2B, or accept task-DAG scheduling as the unit. |
| 3 | Migration ledger records fewer versions than the repository holds | `supabase db push` cannot apply new migrations through normal tooling. | Owner runs the prepared ledger repair. |
| 4 | No hosted migrations for Phase 1E and later | Nothing in this chain runs against the hosted database. | Owner applies the pending chain. |

Blocker 1 is the one that makes §10–11 unprovable on real data. It does not prevent building the machinery, and it does not license inventing numbers.

---

## 4. Execution order

1. **Fix the duplicate migration version** found during this audit — `20260813000500` was claimed by two migrations, which would collide in the Supabase ledger. *(Done: renamed to `20260813001550`.)*
2. Capability registry: broaden capabilities, declare them per agent role and per model, with availability and project restrictions.
3. Deterministic-first gate: decide whether a node needs a model at all before scoring any provider.
4. Candidate scoring v2: capability fit, configured preference, and evidenced history — abstaining with `INSUFFICIENT_HISTORY` rather than guessing.
5. Circuit breakers with cooldown and automatic re-evaluation.
6. Objective selection: QUALITY / SPEED / COST / BALANCED, with frozen security and risk requirements excluded from every trade-off.
7. Routing feedback: predicted vs actual, regret, minimum sample thresholds before preferences move.
8. Durable memory for the above. *(Done: migration `20260814000100` plus `lib/resources/store.ts`.)*
9. Resource Manager UI showing availability, decisions, breakers, and **why this worker was selected** — reading **No data yet** wherever no run has happened.

Sections 7, 8, and 14 of the objective (queues, dynamic concurrency, budget ladder) depend on a worker pool that executes; they are specified here and deferred behind blocker 1 rather than simulated.

## 5. What storing state actually fixed

Step 8 was not bookkeeping. Steps 5 and 7 built pure folds over records nobody kept, and a pure
fold is only half a circuit breaker:

> A breaker held in one request's memory begins closed on every request. Three consecutive outages
> spread across three requests each read a count of zero, so a threshold of three is never reached.
> The breaker that exists to stop a failing provider absorbing work could not fire.

The same applied to routing feedback. `measureRegret` compares an outcome against a prediction; with
no stored prediction there was nothing to compare against, so §11 could not have worked even with a
funded provider.

`resource_breakers` is mutable state and `resource_breaker_events` / `resource_assignments` are
append-only evidence — deliberately not one table, because they have opposite requirements. The
read-modify-write happens in SQL under a row lock, since two concurrent requests folding the same
breaker in application memory would each read the old count and lose an increment. The *threshold*
stays in `lib/resources/breakers.ts` and is passed in, because two copies of the rule that decides
when a provider is cut off would eventually be two different rules.

One caveat worth recording plainly: the first version of the `closed` constraint required a zero
fault count, which reset the counter on every write and reintroduced the exact defect the table
exists to fix. The behavior test caught it only because it drives faults through **separate calls**.
A single-call test would have passed against the in-memory version too, and proved nothing.

Migration `20260814000100` is **not hosted**, and no routing decision has been recorded against real
work, because no provider run has ever executed.
