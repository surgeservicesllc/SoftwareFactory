# Running one request through all ten phases: the `full_lifecycle` guide

This is the step-by-step guide for taking a single request through the whole
board — REQUIREMENT to MONITOR — using the `full_lifecycle` workflow, and for
understanding exactly what you are looking at during each step. Every claim in
this guide names the page or record where you can verify it yourself.

The current template is version 2: fourteen nodes covering all eleven
lifecycle stages (the ten phases of the board, with REQUIREMENT split into
GOAL + PRD). It is not an autonomous production-change workflow. It stops at
three explicit human decisions: approve the **ARCHITECTURE**, decide whether
to merge the exact tested pull request at **TEST**, and accept the observed
production deployment at **DEPLOYMENT**. The graph worker observes the
separately authorized Phase 1C change; it does not write, merge, or deploy it.

## Before you start (one-time prerequisites)

1. **A project with a verified GitHub repository and public production URL.**
   Projects page → your project → GitHub repository assignment, then
   **Configure production URL** on the project detail page. The URL is the
   stable public alias that MONITOR probes; the immutable Vercel deployment
   URL remains separate release evidence. Credentials, query strings,
   fragments, localhost/private targets, and non-standard ports are refused;
   DNS is connection-bound and rechecked when the probe runs.
2. **Manager or owner role** in the organization. Launching a graph commits a
   budget, so plain membership is not enough.
3. **A separately authorized execution window.** Worker workflows are OFF by
   default. A manual repository dispatch must name the exact graph/project
   target; scheduled global drain remains disabled unless its own explicit
   gate is enabled. Credentials stay in GitHub Actions secrets and never enter
   a graph, project row, browser response, or log.

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
2. The route may request a target-bound worker wake through the project's
   GitHub binding. That request does not enable a disabled worker or autonomy.
3. The result card shows **Recorded**, the graph id, and the server's own
   sentence about the wake — either *“the executor worker has been woken to
   claim it”* or that the executor is **Not Connected** and the graph remains
   planned behind its global gate. Believe that sentence; it is not decorative.

A launch is never lost: if the wake fails, the graph is still recorded and
claimable.

## Step 4 — Watch the run on the Pipelines page

Navigation → **Pipelines** (/solutions/pipelines). The graph runs panel shows
the run the worker created when it claimed your graph: every node, its state
(PENDING → RUNNING → SUCCEEDED/FAILED), its lifecycle stage, and its recorded
artifacts. The **Lifecycle** pages (/solutions/lifecycle and one page per
stage) show the same run rolled up by stage across the portfolio — and they
are actionable, not just a report: the index carries its own **Launch Full
Lifecycle** card, and when a stage holds an open gate, that stage's card (and
the node's row on the stage page) offers the same **Approve / Reject** control
as the runs panel. You can run the entire process from /solutions/lifecycle
without visiting another page.

What you will see stage by stage:

| Phase | Node(s) | Who does the work |
|---|---|---|
| REQUIREMENT | goal, requirements | Model, through the subscription transport |
| DISCOVER | three parallel scans + consolidate | Model (repository, dependency and knowledge scans) |
| EVALUATE | evaluate | Model, against the fixed weighted rubric |
| DECIDE | decide | Model; the decision package is contract-enforced |
| ARCHITECT | architecture | Model — then **stops for you** (human gate) |
| BUILD | implement | **Anchor**: requires the exact Phase 1C run, base commit, produced commit, and draft pull request |
| REVIEW | review | **Anchor**: requires deterministic validation for that same run, commit, and pull request |
| TEST | test | **Anchor + human gate**: requires all exact-head CI checks green, then waits for the owner's merge decision |
| DEPLOY | deploy | **Anchor + human gate**: observes an exact-commit Vercel Production deployment, then waits for owner acceptance |
| MONITOR | monitor | **Anchor**: validates the stable public alias against the exact accepted release |

Gates appear only where they can be decided. All three version-2 gates are
**human** gates. ARCHITECTURE cannot open without the design artifact; TEST
cannot open without the exact pull-request and green exact-head CI artifact;
DEPLOYMENT cannot open without the exact successful Vercel Production
deployment artifact. Approval without that stage-specific evidence fails
closed.

Timing expectations: each model node runs inside an eight-minute envelope;
the whole graph declares a 220-minute worst-case budget. A typical run is far
shorter, but this is thirteen sequential levels — it is a lifecycle, not a
chat reply.

## Step 5 — Decide the ARCHITECTURE gate

When the architecture node finishes, its row in the runs panel grows an
**Approve / Reject** control marked *Human gate* — and the ARCHITECT card on
/solutions/lifecycle shows the same control under *Awaiting a decision*. Read
the architecture package the node recorded, then decide:

- **Approve** — the decision is recorded and the executor worker is woken to
  continue the run only when the global worker gate is enabled. If it is OFF,
  the decision persists and the response truthfully says the executor is Not
  Connected; manual or scheduled events cannot bypass the same global gate.
- **Reject** — the stage stays blocked and its dependents stay skipped; for a
  lifecycle graph the rework returns to the stage the lifecycle definitions
  name for that rejection.

Nothing below the gate runs until you decide. That is the design working,
not the run being stuck.

## Step 6 — The TEST anchor, the DEPLOY gate, and what Phase 1 honestly does

- The **test** node does not ask a model whether tests pass. It reads the
  repository's required GitHub check runs for the exact Phase 1C produced
  commit and records names, conclusions, URLs, and commit identity. Green
  evidence opens a HUMAN gate. Approving that gate means the owner has chosen
  to merge; the continuation then requires GitHub to prove the pull request is
  actually merged and binds the exact merge commit. The graph never merges it.
- The **deploy** node polls GitHub's Vercel-created Production deployment for
  the exact merge commit. It records both the immutable provider deployment
  URL and provider ref. It neither invokes Vercel nor creates a deployment.
  Only after that exact artifact exists can the owner accept the deployment.
- The **monitor** node probes the project's separately configured public
  production URL over a bounded consecutive-observation window. Every pass
  requires HTTP health, the exact public host, Vercel project/deployment
  ID and immutable URL, Supabase reachability bound to the independently
  configured exact project ref, and the exact release SHA/ref,
  expected security headers, an unauthenticated 401 from the tenant graph API,
  and all exact-release CI checks green. Completion is one atomic database
  transition: monitor observation, deployment-validation evidence, and the
  Phase 1C release bridge all close together, or none do. The immutable
  Vercel deployment URL is never confused with the public alias.

## Troubleshooting

| Symptom | Meaning | Fix |
|---|---|---|
| Launch note says the worker could not be woken | The global worker gate is OFF, the project has no verified GitHub binding, or dispatch failed | Keep the run planned while containment is intended; otherwise verify the binding and use a separately approved exact-target activation window. |
| Graph stays PLANNED | No worker has claimed it; the global worker gate is OFF by default and blocks manual, repository, and scheduled events alike | Keep it planned under containment. A bounded operator-approved execution window must enable the exact global gate in both application and GitHub configuration before an exact-target dispatch; turn it OFF again after admission. |
| The page says automatic checks paused | The bounded live-refresh window ended without a new immutable attempt | Use the explicit refresh control for one exact read; do not infer that a worker is still running. |
| A worker ran but reported "nothing ran" | The claim's filters excluded every graph | Read the run's log: the **queue diagnosis** names each graph and the exact filter excluding it |
| You pressed Launch but no graph appears anywhere | The click may have landed on a build deployed before the launch wiring | Reload the Workflows page and launch again; the result card now reports the graph id and whether the worker was woken |
| A node failed with “Not Connected” | Its exact external evidence or project production URL is absent | Read the node's refusal; use **Configure production URL** on the project detail page or complete the named Phase 1C/GitHub/Vercel prerequisite, then continue the same graph |
| The runs panel shows an open gate and nothing moving | A human gate is waiting for you | Approve or reject it — that is the run asking |
| A RED-classified plan never gets claimed | RED plans require explicit owner approval before any worker may claim them | This is `requires_owner_approval` holding; approve the plan or leave it |

## Where each step's wiring is proven

Every step above is pinned by tests that run on every pull request:

- Launch route records + wakes + reports truthfully: `tests/unit/graphs-launch-route.test.ts`
- The launch control renders the server's sentence verbatim: `tests/unit/graph-launch-control.test.tsx`
- All eleven stages present, the three version-2 human gates, and feedback edges recorded (real PostgreSQL through `create_graph_from_plan`): `tests/integration/full-lifecycle.behavior.test.ts`
- A worker claims only the exact requested graph/project and receives the public production URL separately from deployment identity: `tests/integration/target-bound-worker-claims.behavior.test.ts` and `tests/integration/graph-worker-execution.behavior.test.ts`
- Anchor honesty (Phase 1C lineage, exact CI/merge/deploy identity, security/health/auth checks, and the bounded observation window): `tests/unit/anchor-node-executor.test.ts`
- Gate decisions from the runs panel: `tests/unit/graph-runs-panel-gates.test.tsx`
- An approval wakes the worker to continue the graph: `tests/unit/graph-gate-decision-route.test.ts`
- Budget chain (node envelope → template budget → worker timeout): `tests/unit/graph-budget-fit.test.ts`
- Atomic release closure refuses partial or mismatched observation evidence and is idempotent only for the exact accepted release: `tests/integration/graph-postdeploy-validation.behavior.test.ts`
- The whole flow, consecutively: one request drained window by window to a COMPLETED run — every stage closed with its artifact, each node paid for exactly once across gate-halted windows, all three human gates approved by the owner, the projection identical on refresh, and an outsider refused outright: `tests/integration/ten-step-consecutive-flow.behavior.test.ts`

## Seeding a development stack

`npm run seed:dev` (scripts/seed-dev-lifecycle.mts) plants the whole flow on
a development stack: a seed owner, organization, and project, plus one
`full_lifecycle` graph driven through its first worker window so every
factory page shows real recorded stages and the open ARCHITECTURE gate.
`--drain` approves the gates and completes all ten steps. It needs
`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, and
`SEED_OWNER_PASSWORD`; it is idempotent, labels everything it writes
`dev_seed`, refuses to claim any graph it did not plant, and refuses the
production project outright — there is no override.
