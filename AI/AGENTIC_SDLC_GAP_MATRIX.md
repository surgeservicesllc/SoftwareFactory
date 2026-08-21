# Agentic SDLC and Graph Engineering — gap matrix

Measured against the repository, not against memory. Every "have" names the file
or migration that carries it, so a reader can check the claim without trusting
this document.

## What the audit found, and what changed under it

The first audit found the graph engine **built and unwired**: compiler,
scheduler, runner, contracts, budgets, locks, fan-out, fan-in, verification,
anchors and a SECURITY DEFINER write boundary all existed, and nothing
dispatched a node. That is no longer true, and not because of this work — while
it was in progress `main` shipped its own executor: a background worker
(`scripts/graph-worker.mts`, `.github/workflows/graph-worker.yml`) that claims a
graph through `claim_planned_graph`, drives it with `runClaimedGraph`, and
persists every transition through worker-scoped definer functions.

So this branch stopped building an executor and deleted the one it had. What
remained missing was never execution: it was the **lifecycle** — stages, gates,
feedback, iteration bounds, and a definition of "done" that evidence has to
satisfy.

## The matrix

| # | Target capability | State | Evidence |
|---|---|---|---|
| 1 | Persistent graph: nodes, edges, dependencies | **Have** | `20260814000100_graph_engineering.sql` |
| 2 | DAG execution, ready-node selection | **Have** | `lib/graph/scheduler.ts` |
| 3 | Fan-out to parallel agents | **Have** | `lib/graph/fan-out.ts`; measured in `graph-worker-execution.behavior` |
| 4 | Fan-in synthesis | **Have** | `lib/graph/fan-in.ts`, with partial-input tolerance |
| 5 | Planner → workers → reviewers → verifier | **Have** | capabilities in `lib/graph/contracts.ts`; `graph_verifications` |
| 6 | Conditional branches | **Gap** | edges carry a reason, never a condition; nothing evaluates one at run time |
| 7 | Retries with backoff | **Partial** | attempts bounded per node; no delay between them |
| 8 | Checkpoints and resume | **Have** | every claim rebuilds from persisted rows; a dead worker's run is reclaimed after two hours |
| 9 | Failure isolation | **Have** | a failed node blocks only its dependents |
| 10 | Shared artifacts between nodes | **Have** | `record_graph_artifact_as_worker`; edges deliver upstream outputs |
| 11 | Handoffs between agents | **Partial** | `graph_handoffs` exists; the worker passes outputs along edges instead |
| 12 | Ownership and status per node | **Have** | `node_runs.state` |
| 13 | Confidence and risk scores | **Partial** | risk per node; `node_runs.confidence` exists and the worker does not yet report one |
| 14 | Execution history | **Have** | `graph_events`, one row per transition |
| 15 | Audit trail | **Have** | `activity_events`, append-only |
| 16 | **Human and automatic gates** | **Have** | `graph_gates`, `open_node_gate_as_worker`, `decide_node_gate` (`20260821000200`) |
| 17 | **Feedback edges** | **Have** | `graph_edges.is_feedback`, validated against stage order in `lib/graph/launch-plan.ts` |
| 18 | **Loop prevention and max iterations** | **Have** | `graphs.iteration`/`max_iterations`, `advance_graph_iteration` |
| 19 | An executor | **Have** | `lib/worker/graph-run.ts` — main's, not this branch's |
| 20 | **Agentic SDLC stages** | **Have** | `lib/sdlc/lifecycle.ts`; `graph_nodes.lifecycle_stage`; the `agentic_sdlc` template |
| 21 | Orchestrator over the lifecycle | **Partial** | `lib/sdlc/orchestrator.ts` decides the next move and reports acceptance; nothing calls it from the worker yet |
| 22 | **Completion requires verified evidence** | **Have** | three independent refusals, below |
| 23 | Live node status | **Have** | `components/graph-runs-panel.tsx` with stage and gate |
| 24 | Integration with Projects and Pipelines | **Partial** | runs are listed and decidable; no project view links to them |

## Where "completion requires verified evidence" actually lives

Three refusals, in three layers, because a rule asserted once is a comment:

1. `decide_node_gate` refuses to approve an automatic gate with zero anchors.
2. `anchorsFor` counts only what an ANCHOR node observed — a model's output is a
   claim however confident, and counting it would make the rule self-satisfying.
3. `acceptanceReport` refuses to call a lifecycle complete unless every node is
   terminal, every anchor-requiring stage has one, and every gate was decided
   affirmatively.

## The one design decision worth arguing with

**A gate is keyed to the graph node, not the node run.** The worker re-runs a
claimed graph from the beginning — every claim inserts fresh `node_runs` at
PENDING — so a run-keyed gate would be new and undecided on every claim, and a
lifecycle could never pass its first human decision however many times it was
approved. Keyed to the node, an approval is a fact about the work rather than
about one attempt at it.

The cost is honest and worth stating: re-running a lifecycle after each approval
re-executes the stages before the gate. With no provider connected that costs
nothing today, and it is the behaviour `main`'s worker already has for every
other graph. If it becomes expensive, the fix is resumable claims, not
run-keyed gates.

Asserted by `agentic-sdlc-lifecycle.behavior`, mutation-checked by scoping the
claim's gate join to the current run, which reproduces the bug exactly.

## What this repository still will not claim

**No node has executed against a provider.** Outbound execution is off and no
credential is configured. No lifecycle has met its acceptance criteria, and
nothing in the console, the API or this document says otherwise. The machinery
is tested; that is a different sentence from the factory having built anything.
