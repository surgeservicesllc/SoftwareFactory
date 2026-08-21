# Agentic SDLC and Graph Engineering — gap matrix

Measured against the repository at `4253da3`, not against memory. Every "have"
row names the file or migration that carries it, so a reader can check the claim
without trusting this document.

## What the audit found

The graph engine is **built and unwired**. Schema, compiler, scheduler, runner,
contracts, budgets, locks, fan-out, fan-in, verification, anchors and a
SECURITY DEFINER write boundary all exist and are tested. What does not exist is
anything that *runs* them: `app/api/graphs/route.ts` says so in its own words —

> `create_graph_from_plan` writes the graph and its nodes and edges.
> `start_graph_run` opens a run row. **Neither dispatches a node** [...] no
> executor is wired to the graph runner, so a run created here would sit at
> `PENDING`.

The second finding is that the engine is organised around *audits and builds*,
not around a lifecycle. There is no GOAL → PRD → ARCHITECTURE → IMPLEMENTATION →
REVIEW → TEST → DEPLOYMENT → MONITORING progression anywhere in the schema or the
templates, and therefore no gates between stages and no feedback edge from
monitoring back to goal.

## The matrix

| # | Target capability | State | Evidence / gap |
|---|---|---|---|
| 1 | Persistent graph: nodes, edges, dependencies | **Have** | `graphs`, `graph_nodes`, `graph_edges`, `node_contracts` in `20260814000100_graph_engineering.sql` |
| 2 | DAG execution, ready-node selection | **Have** | `lib/graph/scheduler.ts` — `tick`, `transition`, `applyDecision` |
| 3 | Fan-out to parallel agents | **Have** | `lib/graph/fan-out.ts`; `maxParallelism` from the compiler |
| 4 | Fan-in synthesis | **Have** | `lib/graph/fan-in.ts` — `collectFanIn`, `incompletenessNotice` |
| 5 | Planner → workers → reviewers → verifier | **Have** | capability set in `lib/graph/contracts.ts`; `feature_build` template |
| 6 | Conditional branches | **Gap** | edges carry a `reason`, never a condition; no branch is evaluated at run time |
| 7 | Retries with backoff | **Partial** | `RetryPolicy` and `shouldRetry` bound attempts; no delay between them |
| 8 | Checkpoints and resume | **Gap** | the runner holds its state in memory; nothing rebuilds a run from `node_runs` |
| 9 | Failure isolation | **Have** | the scheduler blocks only the dependents of a failed node |
| 10 | Shared artifacts between nodes | **Partial** | `graph_artifacts` + `record_graph_artifact` exist; no caller writes one |
| 11 | Handoffs between agents | **Partial** | `graph_handoffs` + `record_handoff` exist; no caller writes one |
| 12 | Ownership and status per node | **Have** | `node_runs.state` over the nine-value `graph_node_state` enum |
| 13 | Confidence and risk scores | **Partial** | risk is per node; confidence exists only in `lib/graph/optimizer.ts`, never persisted per node |
| 14 | Execution history | **Have** | `graph_events`, one row per transition, written by the boundary |
| 15 | Audit trail | **Have** | `activity_events`, append-only by trigger |
| 16 | Human and automatic gates | **Gap** | `graphs.requires_owner_approval` is one flag for a whole graph; there is no gate a node waits at |
| 17 | Feedback edges | **Gap** | the compiler rejects every cycle, so no stage can route back to an earlier one |
| 18 | Loop prevention and max iterations | **Gap** | discovery graphs bound their rounds; a lifecycle has no iteration counter or cap |
| 19 | **An executor** | **Gap** | nothing dispatches a node; every created graph sits at `PENDING` |
| 20 | Agentic SDLC stages | **Gap** | no stage concept in schema, templates, or UI |
| 21 | Orchestrator over the lifecycle | **Partial** | `lib/graph/launch-plan.ts` decomposes and compiles; nothing executes, validates, repairs, or advances |
| 22 | Completion requires verified evidence | **Partial** | `lib/graph/anchors.ts` and `complete_graph_run`'s `partial_input_cannot_complete` guard are the right primitives; no lifecycle enforces them |
| 23 | Live node status board | **Gap** | `components/graph-execution-summary.tsx` renders a design-time preview of a plan, not a run |
| 24 | Integration with Projects and Pipelines | **Partial** | a graph is created against a `project_id`; no project or pipeline view shows its run |

## After the remediation

Rows the work closed, with what closed them.

| # | Was | Now | Closed by |
|---|---|---|---|
| 7 | Retries with no backoff | Unchanged, and deliberately: a pass returns a retryable node to `READY` and the next pass picks it up, so the interval is the caller's cadence rather than a `sleep` holding a request open | `lib/graph/executor.ts` |
| 8 | No checkpoints or resume | **Have** — `stateFromPersisted` rebuilds the scheduler's view from `node_runs` alone | `lib/graph/executor.ts` |
| 10 | Artifacts written by nobody | **Have** — every successful node records one through `record_graph_artifact`, and the next pass reads them as its inputs | `lib/graph/executor.ts`, `lib/graph/node-executor.ts` |
| 13 | Confidence never persisted | **Have** — `node_runs.confidence`, written through `record_node_confidence` | `20260819000200` |
| 16 | One approval flag per graph | **Have** — `graph_gates`, one per gated node run, human or automatic | `20260819000200` |
| 17 | Every cycle rejected | **Have** — `is_feedback` edges, validated against stage order and excluded from compilation | `lib/graph/launch-plan.ts` |
| 18 | No iteration cap | **Have** — `iteration`/`max_iterations` and `advance_graph_iteration` | `20260819000200` |
| 19 | **No executor** | **Have** — `advanceGraphRun` dispatches, persists, and settles | `lib/graph/executor.ts` |
| 20 | No lifecycle stages | **Have** — eight stages on nodes, with the `agentic_sdlc` template | `lib/sdlc/lifecycle.ts` |
| 21 | Orchestrator planned only | **Have** — `decideNextAction` over gates, repairs, iteration and acceptance | `lib/sdlc/orchestrator.ts` |
| 22 | Evidence primitives unused | **Have** — enforced in three places: the executor blocks a stage with no anchor, `decide_node_gate` refuses an automatic approval with none, and `acceptanceReport` refuses to call the lifecycle complete | executor, `20260819000200`, orchestrator |
| 23 | Design-time preview only | **Have** — `components/lifecycle-board.tsx` reads the run rows | board + `GET /api/graph-runs/{id}` |
| 24 | No project or pipeline view of a run | **Have** — recorded graphs and their latest run, on Workflows | `components/lifecycle-runs.tsx` |

Row 6, conditional branches, is the one target capability still open. Nothing
in this change evaluates a condition on an edge at run time, and no part of the
lifecycle needed one: a stage advances on its dependencies and its gate, and a
gate's decision is recorded rather than computed from an expression. It stays on
the matrix rather than being quietly dropped.

## Order of work

The order is forced by the dependencies, not chosen for convenience.

1. **Lifecycle schema** (#20, #16, #17, #18, #13) — stages, gates, iterations and
   per-node confidence are columns and tables other work reads.
2. **Executor** (#19, #8, #10, #11) — the single change that turns the whole
   engine from a design-time preview into a running system. Resume falls out of
   it, because an executor that can start from persisted `node_runs` is by
   definition resumable.
3. **Gates and feedback** (#16, #17, #18, #6) — a stage that can hold, and an
   edge that can route backwards without looping forever.
4. **Orchestrator** (#21, #22) — the loop that advances the lifecycle and
   refuses to call a node complete without an anchor.
5. **Console** (#23, #24) — the board that shows it.

## What this repository will not claim

Anything a credential blocks stays labelled. A node that would call a provider
without one reports **Not Connected** rather than a fabricated result, and no
stage advances on a claim that no anchor supports.
