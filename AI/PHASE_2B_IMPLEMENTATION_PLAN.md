# Phase 2B — Multi-Agent Teams: implementation plan

Audit date: 2026-08-13. Branch `claude/github-connection-confirm-qe3tqm`.

Phase 2B turns individual AI workers into coordinated teams:

```
Goal → Orchestrator → Team Plan → Specialist Agents → Handoffs
     → Independent Review → QA/Security → existing 1D/1E release gates
```

This document is the audit required before any Phase 2B code is written. It
records what already exists, what is partial, and what is missing, so the work
extends the Phase 2A provider layer rather than rebuilding it.

## Status legend

| Mark | Meaning |
| --- | --- |
| **COMPLETE** | Exists, tested, and does what Phase 2B needs without change. |
| **PARTIAL** | Exists but does not yet meet the Phase 2B requirement. |
| **MISSING** | No implementation. |
| **BROKEN** | Exists and does not work as documented. |
| **BLOCKED** | Cannot be built or proven until a named dependency clears. |

---

## 1. Audit of the existing foundation

### Provider layer (Phase 2A)

| Item | Status | Evidence |
| --- | --- | --- |
| Adapter contract (`createRun`/`getRun`/`cancelRun`/events/result/models/health) | **COMPLETE** | `lib/providers/contract.ts`, `base-adapter.ts`, real Anthropic and OpenAI adapters. |
| Routing precedence and structured reasons | **COMPLETE** | `lib/providers/routing.ts` — `OWNER_OVERRIDE → AGENT_ASSIGNMENT → PROJECT_DEFAULT → AUTO_SCORE`, plus the two absolute rules (capability declared, provider connected). |
| Error taxonomy with declared fallback eligibility | **COMPLETE** | `lib/providers/errors.ts`. Credential and content-policy failures are not fallback-eligible. |
| Single-task execution with fallback | **COMPLETE** | `lib/providers/runtime.ts`, `app/api/runs/route.ts`. |
| Run persistence (provider, model, usage, latency, routing decision) | **COMPLETE** | `agent_runs` extended by `20260813000100`; `record_provider_run` RPC. |
| Owner execution switch, default OFF | **COMPLETE** | `organizations.ai_provider_execution_enabled`, `set_provider_execution_enabled`. |
| Live provider execution | **BLOCKED** | No `ANTHROPIC_API_KEY` or `OPENAI_API_KEY` in any verified environment; both providers report **Not Configured** and the switch is OFF. |

### Workflow and review

| Item | Status | Evidence |
| --- | --- | --- |
| Reviewer independence rule | **COMPLETE** | `evaluateReviewIndependence` / `assertIndependentReview` in `lib/providers/workflow.ts`. An implementation agent cannot review its own work; `requiresDistinctProvider` adds cross-provider separation where declared. |
| Handoff context assembly | **PARTIAL** | `buildHandoffContext` composes prior artifacts in memory for one request. Artifacts are not persisted, so a handoff cannot be inspected after the fact or resumed. |
| Multi-step workflow | **PARTIAL** | `DEFAULT_DELIVERY_WORKFLOW` is a single hard-coded four-step chain (plan → implement → review → qa). It is linear, fixed, and not selected per goal. |
| Reviewer verdicts (`PASS`/`WARN`/`REQUEST_CHANGES`/`BLOCK`) | **MISSING** | Review steps return an advisory artifact with no verdict, so nothing can gate on the outcome. |
| Bounded repair loops | **MISSING** | No mechanism returns requested changes to the responsible agent. |

### Agents and roles

| Item | Status | Evidence |
| --- | --- | --- |
| Agent is distinct from provider, model, connection, project | **COMPLETE** | ADR-021; `agents` table carries `role`, optional `provider`/`model` preference. |
| Role enum | **PARTIAL** | `public.agent_role` has `orchestrator, product, frontend, backend, database, qa, security, release, ceo_reporter, custom`. Phase 2B additionally requires **architect**, **performance**, and **production_investigator**. `custom` exists, so future roles are supported. |
| Per-agent and per-project provider assignment | **COMPLETE** | `set_agent_provider_assignment`. |
| Agent availability / current work / performance data | **PARTIAL** | `agent_status` enum exists; there is no aggregate of tasks, success rate, duration, or retries per agent. |

### Task model

| Item | Status | Evidence |
| --- | --- | --- |
| Tasks with owner command, project, agent, priority, risk, status, input, result | **COMPLETE** | `public.tasks`. |
| Parent goal | **MISSING** | No `parent_task_id` or goal reference. |
| Dependencies | **MISSING** | No dependency edges, so no task graph and no automatic blocking. |
| Acceptance criteria | **MISSING** | Not represented; `description` is free text. |
| Run / PR links | **PARTIAL** | `agent_runs` references a task; `pull_requests` exists but is not linked to a task. |

### Teams, concurrency, and metrics

| Item | Status | Evidence |
| --- | --- | --- |
| Teams | **MISSING** | No `teams` table and no team concept anywhere in `lib/` or the schema's 53 tables. |
| Orchestrator that composes a team from a goal | **MISSING** | `orchestrator` exists only as a role value. There is no planning loop. |
| Parallel execution / isolated workspaces | **MISSING** | Execution is one task per HTTP request. |
| Work locks (project / path / subsystem) | **MISSING** | Change reservations exist for repository file changes (`017`), which is a related but narrower control. |
| Metrics | **PARTIAL** | `provider_routing_decisions`, `provider_run_events`, and `agent_runs` capture per-run truth including usage and latency. No aggregation, no bottleneck analysis. |
| Team UI (task graph, handoffs, blockers, progress) | **MISSING** | Agents/Runs/Bot Manager show individual records only. |

### Security and isolation

| Item | Status | Evidence |
| --- | --- | --- |
| RLS + FORCE RLS on every public table | **COMPLETE** | 53/53 verified on hosted, 61 policies, 2026-08-13. |
| Server-only secrets | **COMPLETE** | Provider keys read server-side; `secret-boundaries.contract.test.ts` guards it. |
| Least-privilege context per agent | **MISSING** | No per-agent scoping of what context or credential a task may receive. |
| Cross-user / cross-project isolation tests | **PARTIAL** | RLS behavioral tests exist for GitHub, marketing, and provider tables; none cover team or handoff tables, which do not exist yet. |

### Release gates (Phase 1D/1E)

| Item | Status | Evidence |
| --- | --- | --- |
| Risk classification, approvals, protected paths, kill switch | **COMPLETE** | Phase 1D interlocks; Autonomous Mode OFF. |
| Production operations, synthetic journeys, rollback interlocks | **COMPLETE** for schema; **BLOCKED** for observation — no owner-authorized production target. |
| Draft-PR-only write boundary | **COMPLETE** | Verified live in PR `#8`. |

---

## 2. What Phase 2B must add

Ordered so each step is useful on its own and nothing depends on live provider
credentials until the final demonstration.

1. **Schema.** `teams`, `team_members`, `task_dependencies`, `agent_handoffs`, `review_verdicts`, `work_locks`; extend `agent_role` with `architect`, `performance`, `production_investigator`; add `parent_task_id` and `acceptance_criteria` to `tasks`. RLS + FORCE RLS, ownership checks, foreign keys, indexes, and audit events on every one.
2. **Handoff persistence.** Promote `WorkflowArtifact` from an in-memory value to a durable, tenant-scoped row carrying task, context, decisions, files, output, assumptions, evidence, blockers, and next required action.
3. **Task graph.** Dependency edges with cycle rejection at write time, automatic `blocked` status while unmet, and readiness computed in the database rather than by a caller.
4. **Team composition.** A pure function from goal + risk to the smallest sufficient team, mirroring how `routing.ts` is pure and testable without a provider.
5. **Reviewer verdicts and bounded repair.** Verdict enum, a repair counter with a hard ceiling, and a rule that a repair loop can never widen risk or bypass an interlock.
6. **Orchestrator.** A loop that reads ready tasks, routes each through the existing 2A engine, records handoffs, and stops on failure rather than retrying without bound.
7. **Work locks.** Advisory locks keyed by project and path prefix so parallel specialists cannot touch the same subsystem or produce overlapping migrations.
8. **Metrics.** Aggregate views over real `agent_runs` and routing decisions only. No fabricated figures.
9. **UI.** Team list and Team Detail showing goal, specialists, task graph, dependencies, progress, handoffs, blockers, PRs, and validation.

---

## 3. Constraints carried forward

These are not negotiable within Phase 2B and each is already enforced:

- Autonomous Mode stays OFF and the global kill switch stays ON. Phase 2B coordinates advisory work; it does not acquire authority to merge, deploy, or run anything.
- The only repository write path remains an isolated branch, commit, and **draft** pull request, with protected paths requiring the exact owner RED approval phrase.
- An implementation agent can never satisfy an independent-review requirement for its own work, and fallback can never be used to escape a credential or content-policy failure.
- Agents exchange durable typed artifacts through SoftwareFactory. They never share a provider chat history.
- No provider secret reaches the browser, a database row, a prompt, or a log.

---

## 4. Blockers

| # | Blocker | Effect | Owner action |
| --- | --- | --- | --- |
| 1 | No provider credential in any verified environment | Every live multi-agent demonstration is unprovable. Team composition, the task graph, locks, and verdicts can all be built and tested with stubs, but section 14's end-to-end run cannot be executed. | Set server-only `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`, then enable the execution switch in Settings. |
| 2 | Cross-provider review needs **both** providers configured | `requiresDistinctProvider` steps degrade to same-provider review or fail closed. | Configure both, not one. |
| 3 | Account creation cannot complete | No second account can be created to test cross-user isolation of team and handoff rows. | Configure Supabase SMTP, or disable "Confirm email" — see release blocker 5 in `AI/CURRENT_STATE.md`. |
| 4 | Migration ledger records 26 of 31 versions | `supabase db push` would try to re-apply applied migrations and fail, so Phase 2B migrations cannot be pushed with the normal tooling until repaired. | Run the prepared ledger repair. |
| 5 | No owner-authorized production target | Production Investigator work cannot be demonstrated against a real system. | Authorize a target, or accept that this role stays unproven. |

Blocker 4 is the one that gates *starting* Phase 2B schema work through normal
tooling, and it is the cheapest to clear.

---

## 5. Honest completion statement

Phase 2B is **0% implemented** as of this audit. What exists is the foundation
it builds on: the Phase 2A provider layer is complete and tested, the
reviewer-independence rule is real and enforced, and the Phase 1D/1E release
gates it must feed into are in place.

No part of this document should be read as a claim that teams, orchestration,
task graphs, handoff persistence, parallel execution, or team UI exist today.
They do not.
