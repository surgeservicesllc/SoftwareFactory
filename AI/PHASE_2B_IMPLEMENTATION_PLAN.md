# Phase 2B — Graph Engineering: audit and implementation plan

Audit date: 2026-08-14, against `main` at `5ad3142`.

Phase 2B turns multi-AI execution into a Graph Engineering engine:

```
Goal → Graph Planner → Dependency Analysis → DAG → Parallel Nodes → Reduce
     → Independent Verification → Synthesis → QA/Security → existing 1D/1E gates
```

The objective is **not** to use many agents. It is to execute the smallest,
fastest, safest, cheapest workflow that does the job — which for most work is a
single agent and no graph at all.

## Status legend

| Mark | Meaning |
| --- | --- |
| **COMPLETE** | Exists, tested, meets the Phase 2B requirement unchanged. |
| **PARTIAL** | Exists but does not yet meet the requirement. |
| **MISSING** | No implementation. |
| **BROKEN** | Exists and does not work as documented. |
| **BLOCKED** | Cannot be built or proven until a named dependency clears. |

---

## 1. What already exists (the foundation, not the gap)

Phase 2B is better supported than a blank-sheet reading suggests. These are
real and tested on `main`:

| Capability | Status | Where |
| --- | --- | --- |
| Provider adapter contract, routing precedence, structured reasons | **COMPLETE** | `lib/providers/` (Phase 2A) |
| Error taxonomy with declared fallback eligibility | **COMPLETE** | `lib/providers/errors.ts` |
| Reviewer independence — an implementer cannot review its own work | **PARTIAL** | `lib/providers/workflow.ts` |
| **Isolated per-run Git workspaces** | **COMPLETE** | `lib/worker/workspace.ts` — keyed by `runId`, so concurrent workers already get separate trees |
| **Real validation in a pinned container** (lint/typecheck/test/build) | **COMPLETE** | `lib/worker/validation.ts` — this is a genuine non-AI anchor today |
| Path containment, forbidden paths, secret and protected-resource scanning | **COMPLETE** | `lib/worker/policy-scan.ts` |
| Phase 1D decision layer: controls, gates, approval, retries, recovery | **COMPLETE** | `lib/autonomy/` |
| Risk classification from the actual diff | **COMPLETE** | `lib/autonomy/diff-risk.ts` |
| Deployment tracking, post-deploy validation, rollback interlocks | **COMPLETE** | `lib/autonomy/post-deploy.ts`, `lib/deploy/vercel.ts` |
| Incidents, production diagnoses, repair attempts, synthetic journeys | **COMPLETE** | Phase 1E schema |
| RLS + FORCE RLS on every public table, SECURITY DEFINER write boundary | **COMPLETE** | established pattern, 53/53 verified |
| Single command → risk → dispatch → worker | **COMPLETE** | `lib/orchestration/` |

**The gap is the graph layer itself**, not the machinery it would drive.

---

## 2. Requirement audit

### Planning and topology (spec §2, §17, §18, §26)

| # | Requirement | Status | Note |
| --- | --- | --- | --- |
| 2 | Topology selection (SINGLE_AGENT/LOOP/SEQUENTIAL/DAG/DIAMOND/DISCOVERY_GRAPH) | **MISSING** | `lib/orchestration/plan.ts` produces one linear Phase 1C plan. |
| 2 | Fake-edge test on proposed dependencies | **MISSING** | No dependency analysis of any kind. |
| 17 | Model economics per node | **PARTIAL** | 2A routing exists and records reasons; nothing selects per-node tiers. |
| 18 | Logical specialists | **PARTIAL** | Roles exist including architect/performance/production_investigator (added on main). No team assembly. |
| 26 | Graph compiler — orchestration as data, not conversation | **MISSING** | |

### Contracts and data (spec §3, §4, §19)

| # | Requirement | Status | Note |
| --- | --- | --- | --- |
| 3 | Machine-readable node contracts with typed I/O | **MISSING** | |
| 3 | Reject invalid output, retry per policy | **MISSING** | |
| 4 | graphs/graph_runs/graph_nodes/graph_edges/node_runs/node_contracts/handoffs/artifacts/verifications/work_locks/graph_templates/graph_budgets/graph_events | **MISSING** | None of the thirteen tables exist. |
| 19 | Structured handoffs validated against the receiving contract | **MISSING** | `buildHandoffContext` is in-memory, per-request, unvalidated. |

### Execution (spec §5, §6, §9, §10, §11, §20, §27)

| # | Requirement | Status | Note |
| --- | --- | --- | --- |
| 5 | Durable DAG scheduler, nine node states | **MISSING** | |
| 6 | Diamond pattern as a native topology | **MISSING** | |
| 9 | Fan-out with isolated workspaces | **PARTIAL** | Workspace isolation is **COMPLETE**; nothing fans out to use it. |
| 10 | Hidden dependency detection (files, migrations, APIs, rate limits, deployments) | **MISSING** | |
| 11 | Recoverable work locks with heartbeat/expiry | **MISSING** | Change reservations (`017`) are a narrower relative. |
| 20 | Integration nodes | **MISSING** | |
| 27 | Retry/fallback/reassign/pause/cancel/recover per node | **PARTIAL** | `lib/autonomy/retries.ts` bounds retries for pipeline stages, not nodes. |

### Verification and truth (spec §7, §8, §14, §21, §22)

| # | Requirement | Status | Note |
| --- | --- | --- | --- |
| 7 | Fresh verifier with no shared worker context | **PARTIAL** | Independence is enforced by *agent identity*; context isolation is not modelled. |
| 7 | Structured PASS/WARN/REJECT/BLOCK with evidence | **MISSING** | Reviews return prose artifacts. |
| 8 | Verification quorum strategies | **MISSING** | |
| 14 | Silent-failure guard on every fan-in | **MISSING** | |
| 21 | Non-AI anchors | **PARTIAL** | Real anchors exist (container validation, CI observation, deployment state, synthetic journeys); they are not modelled as evidence attached to graph decisions. |
| 22 | Frozen policies the planner cannot optimise away | **PARTIAL** | The policies exist and are enforced; nothing declares them immune to a planner. |

### Economy and scale (spec §12, §13, §15, §16, §28, §29)

| # | Requirement | Status | Note |
| --- | --- | --- | --- |
| 12 | Deterministic reducers | **MISSING** | |
| 13 | Layered fan-in, never silently truncate | **MISSING** | |
| 15 | Discovery graphs with stop conditions | **MISSING** | |
| 16 | Graph budgets | **PARTIAL** | Phase 1C has per-run turn/token budgets; no graph-level budget. |
| 28 | Graph observability (critical path, parallelism, reduction ratio…) | **MISSING** | Per-run usage/latency is captured and real. |
| 29 | Conservative graph optimizer | **MISSING** | |

### Surfaces and integration (spec §23, §24, §25, §30, §31, §32, §33)

| # | Requirement | Status | Note |
| --- | --- | --- | --- |
| 23 | Reusable graph templates | **MISSING** | |
| 24 | Workflow builder UI | **MISSING** | |
| 25 | Bot Manager proposes an execution summary | **MISSING** | Bot Manager exists; it does not plan. |
| 30 | Feed the **existing** 1D/1E release system, not a second pipeline | **COMPLETE as a target** | The pipeline to feed is real and tested. |
| 31 | Self-healing graphs from incidents | **PARTIAL** | Incident/diagnosis/repair/rollback schema exists; no graph generation. |
| 32 | RLS on all graph data | **MISSING** | No tables yet; the pattern to follow is established. |
| 33 | Tests across the whole list | **MISSING** | |

---

## 3. Build order

Sequenced so each step is independently useful, and so nothing depends on
provider credentials until the live demonstrations.

**Stage 1 — the engine core (pure, no I/O, fully testable today) — IMPLEMENTED**

Delivered in `lib/graph/`, 61 tests across `tests/unit/graph-planning.test.ts`
and `tests/unit/graph-execution.test.ts`. See `AI/GRAPH_ENGINEERING.md`.

1. ~~Topology selection with an explicit bias toward `SINGLE_AGENT`.~~ **DONE** — `topology.ts`.
2. ~~Dependency analysis and the fake-edge test.~~ **DONE** — `dependencies.ts`; every surviving edge records why.
3. ~~Typed node contracts and output validation.~~ **DONE** — `contracts.ts`; prose is rejected where structure is required.
4. ~~The DAG scheduler as a pure state machine.~~ **DONE** — `scheduler.ts`; pure, so a restart replays to the same decision.
5. ~~Deterministic reducers.~~ **DONE** — `reducers.ts`.
6. ~~Fan-in completeness guard and `PARTIAL_INPUT`.~~ **DONE** — `fan-in.ts`.
7. ~~Layered fan-in thresholds.~~ **DONE** — `fan-in.ts`; batches rather than truncates.
8. ~~Graph budgets and degradation policy.~~ **DONE** — `budgets.ts`; cost is real or absent.
9. ~~Verification quorum.~~ **DONE** — `verification.ts`; a security BLOCK is absolute.
10. ~~Frozen policies.~~ **DONE** — `frozen.ts`; catches a plan under-declaring its own risk.
11. ~~Discovery-round stop conditions.~~ **DONE** — `discovery.ts`; only verified items count as progress.

**Stage 2 — durability**
12. The thirteen tables, with RLS, FORCE RLS, foreign keys, indexes, audit events.
13. Work locks with heartbeat, expiry, and abandoned-lock recovery.
14. Graph compiler: plan → durable definition consumed by the scheduler.
15. Handoff persistence validated against the receiving contract.

**Stage 3 — execution**
16. Node runner over the 2A provider layer, per-node routing and model tiering.
17. Fan-out onto isolated workspaces (the workspace manager already supports this).
18. Integration nodes.
19. Anchors as structured evidence.
20. Hidden-dependency detection wired to locks.

**Stage 4 — surfaces**
21. Graph templates.
22. Workflows UI and graph visualisation.
23. Bot Manager execution summary.
24. Graph observability and the conservative optimizer.

**Stage 5 — demonstrations (§34 A–G)**

---

## 4. Blockers

| # | Blocker | Effect | Owner action |
| --- | --- | --- | --- |
| 1 | No provider credential in any verified environment | Demonstrations B, C, F and the live parts of A cannot run. Every engine-core behaviour above is testable without one. | Set server-only `ANTHROPIC_API_KEY` and `OPENAI_API_KEY`; enable the execution switch. |
| 2 | Cross-provider verification needs **both** providers | Fresh-verifier lenses that require a different provider degrade or fail closed. | Configure both. |
| 3 | OpenAI project credit exhausted (`credit_balance_exhausted`, recorded on main) | Codex implementation nodes cannot execute. | Fund the project, supply a fresh key. |
| 4 | Migration ledger records 26 of 31 versions | `supabase db push` would re-apply applied migrations and fail, so Stage 2 cannot be pushed with normal tooling. | Run the prepared ledger repair. |
| 5 | Account creation cannot complete (no SMTP) | No second account, so cross-user isolation of graph tables cannot be proven live. | Configure custom SMTP. |
| 6 | Automatic CI is not firing on pull requests | Graph work would merge without independent gating. Every run since 19:32Z on 2026-08-13 has been manually dispatched. | Investigate repository Actions settings. |

Blocker 4 gates Stage 2. Blockers 1–3 gate Stage 5. Stage 1 is unblocked.

---

## 5. Honest completion statement

At audit time Phase 2B was 0% implemented. **Stage 1 of five is now complete**,
which is roughly **20%** of Phase 2B by stage count and rather less by effort,
since stages 2–4 carry the schema, the execution loop, and the UI. No graph, node, edge, lock,
contract, verification, budget, or template exists in code or schema.

What now exists beyond the substrate is the reasoning core: topology selection,
fake-edge removal, typed contracts, the scheduler state machine, deterministic
reducers, fan-in guards, quorum, budgets, frozen policies, and discovery stop
conditions — all pure and tested. Nothing is persisted and nothing executes
against a provider yet.

The substrate it builds on: isolated workspaces, real container validation,
provider routing, the Phase 1D decision layer, and the Phase 1E production
surfaces. Phase 2B connects those into a graph engine; it does not replace
them, and §30 is explicit that it must not create a second release pipeline.

Progress against this plan is recorded in `AI/CURRENT_STATE.md`. Nothing in
this document should be read as a claim that the engine exists today.
