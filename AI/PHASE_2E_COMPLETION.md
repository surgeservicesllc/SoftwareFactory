# Phase 2E — Portfolio Resource Optimization: completion scorecard

Mission: allocate workers, graph capacity and engineering effort across the
**entire portfolio**, deterministically, at $0 funded per-token AI spend.

This file is the running record for the 2E loop. It is re-scored every
iteration. A row only reads PASS when a test in this repository fails if the
capability is removed — "the code exists" is not evidence, and neither is a
queue UI.

**Scoring vocabulary**

| Score | Meaning |
| --- | --- |
| PASS | Implemented, merged, and guarded by a test that fails without it. |
| PARTIAL | A real capability exists but does not yet meet the goal's wording. |
| FAIL | Not implemented. |
| BLOCKED | Implemented in the repository; final proof needs an owner action or an external service this environment cannot reach. |

---

## What already existed before 2E started

Recording this first, because the largest risk to 2E is building a second
scheduler beside the one that already works. The goal is explicit: *"Extend
existing architecture; never create duplicate execution/provider systems."*

`public.claim_phase1c_run(worker_id, provider, model, lease_seconds)` —
defined across `20260813000900`, `20260813001000`, `20260813001100` — is
already a durable, deterministic, lease-based scheduler. In one atomic
statement it:

- refuses a worker that is not registered, active, and heartbeating;
- reclaims expired leases and terminates runs past their attempt or duration
  budget, writing events, activity, and a report for each;
- selects one eligible run under `for update ... skip locked`, requiring an
  active project, a connected GitHub connection, an unsuspended installation,
  a selected repository, and a base branch that matches the repository default;
- refuses any run whose task has an incomplete dependency;
- refuses a second concurrent run for the same agent;
- orders by `task.priority desc, run.created_at asc`;
- writes the lease, the run/task/command/agent state, and a `claimed` event.

2E's job is therefore **not** a new scheduler. It is: portfolio state
(priority, focus, pause, limits) and portfolio arbitration (effective
priority, fairness, capacity, reservation, decision audit) applied to that
existing selection.

---

## 36-item scorecard

Iteration 1 — baseline audit before any 2E code was written.

| # | Goal | Score | Evidence |
| --- | --- | --- | --- |
| 1 | One portfolio-wide Resource Manager | PARTIAL | `lib/resources/` decides *which worker* for one unit of work; `claim_phase1c_run` decides *which work* for one worker. Neither arbitrates across projects. |
| 2 | Projects have explicit priority P0/P1/P2/P3 | FAIL | `public.projects` has no priority column. `tasks.priority` (0–100) is per-task only. |
| 3 | Tasks inherit/derive project + task priority | FAIL | Ordering uses `task.priority` alone; project priority does not exist to inherit. |
| 4 | Incidents/security may preempt lower-priority work by policy | FAIL | `repair_attempts`/`incidents` linkage exists (1E→1C promotion) but confers no scheduling precedence. |
| 5 | Owner can set strategic focus | FAIL | No such column, route, or control. |
| 6 | Owner can pause/resume project engineering | PARTIAL | `project.status = 'active'` is required to claim, so archiving/pausing the whole project stops work. There is no engineering-only pause that leaves the project otherwise live. |
| 7 | Global and per-project concurrency limits | FAIL | No limit columns anywhere. Concurrency is bounded only by the number of registered workers. |
| 8 | Claude/Codex worker capacity tracked | PARTIAL | `phase1c_workers` tracks `status`, `last_heartbeat_at`, `current_run_id` — one implicit slot per worker, no declared capacity. |
| 9 | 2D Identity Router supplies eligible connections | PARTIAL | No `lib/identity/` module exists in this repository. The *capability* is present: the claim path joins `project_connections → connections → github_installations → github_repositories` and rejects anything not connected/active/selected. |
| 10 | 2A routing supplies eligible provider/model | PARTIAL | `lib/providers/routing.ts` and `lib/resources/candidates.ts` choose a provider/model; the claim path filters on `run.provider`/`run.model` already decided upstream. |
| 11 | 2B Graph Engine requests capacity rather than assuming it | FAIL | `lib/graph/scheduler.ts` returns ready nodes as a pure function of graph state; nothing asks the portfolio whether capacity exists. |
| 12 | Scheduler selects only authorized/healthy/available workers | PARTIAL | Worker liveness and connection authorization are enforced. Circuit-breaker state (2C) is not consulted. |
| 13 | Queued work persists durably | PASS | `agent_runs` rows in `queued` survive restarts; `tests/integration/phase1c-*.test.ts` exercise the queue. |
| 14 | Scheduler deterministic, no paid LLM | PASS | `claim_phase1c_run` is pure SQL. No model call participates in selection. |
| 15 | Dependencies block tasks correctly | PASS | `task_dependencies` clause in the claim query; `20260813001100` migration tests. |
| 16 | Independent work may execute concurrently | PARTIAL | `skip locked` allows concurrent claims, but no test proves two projects progressing at once. |
| 17 | Work locks prevent conflicting assignments | PARTIAL | Agent-level exclusion in the claim query, plus `work_locks`/`task_work_locks` for graphs. The two mechanisms are unrelated. |
| 18 | Capacity released after completion/failure/cancel | PARTIAL | `complete_phase1c_run` clears the lease and frees the agent. There is no capacity accounting to release. |
| 19 | Stale worker leases recover safely | PASS | The reclaim loop at the top of `claim_phase1c_run`; expired-lease runs are re-claimable without duplicate execution because the lease token changes. |
| 20 | Provider/account concurrency limits enforced | FAIL | Nothing bounds concurrent runs per provider or per connection. |
| 21 | Project capacity limits enforced | FAIL | Nothing bounds concurrent runs per project. |
| 22 | Portfolio global limits enforced | FAIL | Nothing bounds concurrent runs per organization. |
| 23 | Fairness prevents permanent starvation | FAIL | Strict `priority desc` ordering. A continuous supply of higher-priority work starves lower-priority work indefinitely. |
| 24 | P0 emergency work can reserve/preempt capacity safely | FAIL | No priority tiers, no reservation. |
| 25 | Running work is not destructively killed to reprioritize | PASS (by construction) | No code path cancels a running run for priority reasons; the only terminations are lease/deadline exhaustion and explicit owner cancellation. To be re-proved once reprioritization exists. |
| 26 | 2B budget limits remain enforced | PASS | `claim_phase1c_run` budget wrapper refuses an exhausted run and returns only remaining turns/tokens. |
| 27 | Queue ordering/reason visible and auditable | FAIL | Ordering is implicit in a SQL `order by`. Nothing records why work was chosen or deferred. |
| 28 | Every assignment records project/task/agent/provider/connection/reason | PARTIAL | `resource_assignments` (2C) records project/node/provider/model/reason, but the claim path does not write to it, and it carries no connection or worker. |
| 29 | Failed worker can retry/reassign through eligible resources | PARTIAL | `retry_phase1c_run` exists and expired leases return work to the queue; there is no reassignment away from a failing resource. |
| 30 | Circuit breaker suppresses repeatedly failing resources | PARTIAL | `lib/resources/breakers.ts` + `resource_breakers` persist and open correctly (`phase2c-resource-persistence.behavior.test.ts`), but nothing in the claim path reads them. |
| 31 | Cooldown/recovery restores eligible resources | PARTIAL | `evaluateBreaker` implements cooldown and half-open; same gap as 30. |
| 32 | Portfolio dashboard shows capacity/queues/bottlenecks | PARTIAL | `/solutions/portfolio` shows per-project health and open counts (`lib/portfolio/aggregate.ts`). No capacity, queue, or bottleneck view. |
| 33 | Owner command can reprioritize portfolio safely | FAIL | No route or control. |
| 34 | RLS/user/org/project isolation passes | PASS | 63/63 public tables have RLS + FORCE RLS; `service_role` holds table privileges on exactly the four GitHub ingress tables. Re-proved every migration by `hosted-service-role-table-grants.test.ts`. |
| 35 | Hosted schema/RLS/indexes support scheduler state | BLOCKED | Twelve migrations are already applied locally and verified on real PostgreSQL 16 but not yet applied to hosted Supabase. See `AI/HOSTED_APPLY_RUNBOOK.md`. |
| 36 | No paid AI-token dependency exists | PASS | Scheduling is pure SQL. Execution uses subscription-authenticated workers (`SOFTWAREFACTORY_CODEX_AUTH_JSON`); no `OPENAI_API_KEY`/`ANTHROPIC_API_KEY` is read anywhere. |

**Iteration 1 baseline: 8 PASS · 15 PARTIAL · 12 FAIL · 1 BLOCKED — 22%.**

---

## Canaries

| Canary | Requirement | Status |
| --- | --- | --- |
| A — competing projects | Real safe work from projects A+B under constrained capacity, scheduled by priority/mapping/capability/availability | Not run |
| B — P0 | Injected safe P0 takes new capacity without corrupting running work | Not run |
| C — capacity | Low limits force queueing; work starts only as capacity releases | Not run |
| D — failure | Breaker → reassignment → unrelated work continues → cooldown recovery | Not run |
| E — reprioritize | "Focus on Project A" changes queue order with history and running work intact | Not run |

---

## Owner action required

Carried forward from earlier phases; none of it blocks 2E implementation work.

1. **Apply pending migrations to hosted Supabase** — `AI/HOSTED_APPLY_RUNBOOK.md`.
   The Supabase CLI in this environment cannot link the project
   (`LegacyProjectNotLinkedError`), so this is an owner action by necessity.
2. **GitHub Actions runners** — every workflow job fails in ~3s with
   `runner_id: 0`. CI cannot be green until the account has runner minutes.

Neither item asks the owner to fund an AI API account, and 2E adds no such
requirement.
