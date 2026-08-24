# Running one request through all ten phases: the `full_lifecycle` guide

This is the step-by-step guide for taking a single request through the whole
board — REQUIREMENT to MONITOR — using the `full_lifecycle` workflow, and for
understanding exactly what you are looking at during each step. Every claim in
this guide names the page or record where you can verify it yourself.

The template is fourteen nodes covering all eleven lifecycle stages (the ten
phases of the board, with REQUIREMENT split into GOAL + PRD). It is autonomous
by default and stops for you at exactly two points: **ARCHITECTURE** and
**DEPLOYMENT** — the two places a wrong step is expensive or externally
visible.

## Before you start (one-time prerequisites)

1. **A project with a verified GitHub repository.** Projects page → your
   project → GitHub repository assignment. The launch wakes the executor
   worker through this binding; without it the graph is still recorded but
   waits for a scheduled or manual dispatch, and the launch result says so.
2. **Manager or owner role** in the organization. Launching a graph commits a
   budget, so plain membership is not enough.
3. **The worker's credentials** (already configured for this repository): the
   GitHub Actions workflow `Graph executor worker` holds the Supabase service
   key and the Claude subscription credential as repository secrets. No
   per-token API billing is involved anywhere in this flow.

## Step 1 — Sign in and enter Software Factory

Sign in at the product. On your first visit you land on the **/decision**
chooser; pick **Software Factory**. After that, the global navigation takes
you straight to /solutions.

## Step 2 — Open Workflows and find “Full Lifecycle”

Navigation → **Workflows** (/solutions/workflows). Every template on this page
is shown as a compiled preview: the topology, the node contracts, the lock
waves, and which dependencies the compiler removed. The preview is produced by
the same code that schedules the work, so what you see is what will run —
but nothing on this page has run yet.

Select **Full Lifecycle**. The preview shows its fourteen nodes: goal →
requirements → three parallel discovery scans → consolidate → evaluate →
decide → architecture → implement → review → test → deploy → monitor, with
feedback edges (monitor back to goal, test and review back to implement).

## Step 3 — Launch it against a project

In the **Launch this graph** card, choose your project and press
**Launch Full Lifecycle**. What happens, in order:

1. The compiled plan — nodes, edges, budget — is written to the database as a
   **PLANNED** graph through `create_graph_from_plan`, under your identity.
2. The executor worker is woken through the project's GitHub binding.
3. The result card shows **Recorded**, the graph id, and the server's own
   sentence about the wake — either *“the executor worker has been woken to
   claim it”* or *“it stays planned until the scheduled or manual dispatch
   picks it up.”* Believe that sentence; it is not decorative.

A launch is never lost: if the wake fails, the graph is still recorded and
claimable.

## Step 4 — Watch the run on the Pipelines page

Navigation → **Pipelines** (/solutions/pipelines). The graph runs panel shows
the run the worker created when it claimed your graph: every node, its state
(PENDING → RUNNING → SUCCEEDED/FAILED), its lifecycle stage, and its recorded
artifacts. The **Lifecycle** pages (/solutions/lifecycle and one page per
stage) show the same run rolled up by stage across the portfolio.

What you will see stage by stage:

| Phase | Node(s) | Who does the work |
|---|---|---|
| REQUIREMENT | goal, requirements | Model, through the subscription transport |
| DISCOVER | three parallel scans + consolidate | Model (repository, dependency and knowledge scans) |
| EVALUATE | evaluate | Model, against the fixed weighted rubric |
| DECIDE | decide | Model; **automatic gate** checks the decision package |
| ARCHITECT | architecture | Model — then **stops for you** (human gate) |
| BUILD | implement | Model |
| REVIEW | review | Model, fresh-eyes; automatic gate |
| TEST | test | **Anchor**: reads the CI verdict recorded for the worker's own commit |
| DEPLOY | deploy | **Anchor + human gate** — see Step 6 |
| MONITOR | monitor | **Anchor**: probes the production URL and records the reading |

Timing expectations: each model node runs inside an eight-minute envelope;
the whole graph declares a 220-minute worst-case budget. A typical run is far
shorter, but this is thirteen sequential levels — it is a lifecycle, not a
chat reply.

## Step 5 — Decide the ARCHITECTURE gate

When the architecture node finishes, its row in the runs panel grows an
**Approve / Reject** control marked *Human gate*. Read the architecture
package the node recorded, then decide:

- **Approve** — the decision is recorded and the executor worker is woken to
  continue the run. If the wake cannot happen, the run continues on the next
  scheduled or manual dispatch instead — the response tells you which.
- **Reject** — the stage stays blocked and its dependents stay skipped; for a
  lifecycle graph the rework returns to the stage the lifecycle definitions
  name for that rejection.

Nothing below the gate runs until you decide. That is the design working,
not the run being stuck.

## Step 6 — The TEST anchor, the DEPLOY gate, and what Phase 1 honestly does

- The **test** node does not ask a model whether the tests pass. It reads the
  CI check-run verdict GitHub recorded for the exact commit the worker is
  running — specifically the repository's own **required checks**
  (`SOFTWAREFACTORY_REQUIRED_CHECKS`), so an unrelated red integration check
  cannot veto a commit the repository itself considers verified — and stores
  that observation, sha, conclusions and links, as evidence. Green succeeds
  the node; red fails it (and the feedback edge sends the work back to
  implement).
- The **deploy** node sits behind the second human gate. In Phase 1 this
  repository keeps deployment owner-approved and wires the worker **no
  deployment instrument** — so even an approved deploy node records a policy
  refusal as its result, stating that the rule held. The real deployment path
  is unchanged: you merge the reviewed pull request, and Vercel deploys main.
  The graph documents this rather than pretending otherwise.
- The **monitor** node probes the production URL and records status and
  latency. An unreachable product is recorded as exactly that — the anchor
  never invents a healthy reading. It carries the feedback edge back to the
  goal: the board's continuous loop.

## Troubleshooting

| Symptom | Meaning | Fix |
|---|---|---|
| Launch note says the worker could not be woken | The project has no verified GitHub binding, or the dispatch failed | Assign/verify the repository on the Projects page; or run the worker manually (below) |
| Graph stays PLANNED | No worker has claimed it — the scheduled drain is off by default | GitHub → Actions → **Graph executor worker** → Run workflow |
| A worker ran but reported "nothing ran" | The claim's filters excluded every graph | Read the run's log: the **queue diagnosis** names each graph and the exact filter excluding it |
| You pressed Launch but no graph appears anywhere | The click may have landed on a build deployed before the launch wiring | Reload the Workflows page and launch again; the result card now reports the graph id and whether the worker was woken |
| A node failed with “Not Connected” | That anchor's instrument (CI token, commit, or production URL) is absent in the worker's environment | Check the workflow's env block; the node's error names the missing instrument |
| The runs panel shows an open gate and nothing moving | A human gate is waiting for you | Approve or reject it — that is the run asking |
| A RED-classified plan never gets claimed | RED plans require explicit owner approval before any worker may claim them | This is `requires_owner_approval` holding; approve the plan or leave it |

## Where each step's wiring is proven

Every step above is pinned by tests that run on every pull request:

- Launch route records + wakes + reports truthfully: `tests/unit/graphs-launch-route.test.ts`
- The launch control renders the server's sentence verbatim: `tests/unit/graph-launch-control.test.tsx`
- All eleven stages present, gates exactly at ARCHITECTURE + DEPLOYMENT, feedback edges recorded (real PostgreSQL through `create_graph_from_plan`): `tests/integration/full-lifecycle.behavior.test.ts`
- A worker only ever claims graphs it can finish: `tests/integration/graph-worker-execution.behavior.test.ts`
- Anchor honesty (CI verdicts, probe readings, Not Connected, the deploy refusal): `tests/unit/anchor-node-executor.test.ts`
- Gate decisions from the runs panel: `tests/unit/graph-runs-panel-gates.test.tsx`
- An approval wakes the worker to continue the graph: `tests/unit/graph-gate-decision-route.test.ts`
- Budget chain (node envelope → template budget → worker timeout): `tests/unit/graph-budget-fit.test.ts`
