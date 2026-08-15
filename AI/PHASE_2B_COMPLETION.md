# Phase 2B completion

Scored 2026-08-15. **PASS** proven by something that runs · **PARTIAL** built and
tested but one claim unproven · **BLOCKED** stopped on a named prerequisite.

The anchor for this phase is the demonstration suite, not the scorecard. Seven
demonstrations (A–G) run in `tests/integration/graph-demonstrations.test.ts`, and
the live half of C runs in `tests/integration/graph-live-team-canary.test.ts`.

## Scorecard

| # | Goal | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | Required hosted-schema migrations applied and verified | **BLOCKED** | `BLOCKED_BY_OWNER_HOSTED_APPLY`. Writing to hosted Supabase is refused by the Claude Code auto-mode classifier — the correct guard for a RED action against production. Measured position in `scripts/hosted-state-report.sql`. |
| 2 | Local migration state matches hosted | **FAIL** | Measured, not assumed. `20260814000210` is **half-applied**: `resource_breakers` exists, its siblings do not, and re-running it returns `42P07`. `20260814001200`, `20260814002200`, `20260814002300` are unapplied. `20260814000100` **is** applied. |
| 3 | Graph engine runs against hosted schema | **BLOCKED** | `BLOCKED_BY_HOSTED_SCHEMA`. The engine runs against the real migrated schema under PGlite; hosted has the graph tables but not the anchors or handoffs. |
| 4 | Graph/node/edge/run/handoff/lock/artifact data persists | **PARTIAL** | Proven against **real PostgreSQL** (PGlite) in `graph-engineering-rls.test.ts` and `graph-anchors-persistence.test.ts`. Not proven against hosted, per goals 1–3. |
| 5 | RLS isolates users/projects/teams/graphs | **PASS** | `graph-engineering-rls.test.ts`: RLS + FORCE RLS on all thirteen tables, no INSERT/UPDATE/DELETE to `anon`/`authenticated`, cross-tenant read returns zero rows, anonymous denied outright with `permission denied` rather than an empty set. |
| 6 | Planner chooses SINGLE/LOOP/SEQUENTIAL/DAG/DIAMOND/DISCOVERY | **PASS** | `selectTopology` in `lib/graph/topology.ts`; demonstration A and the topology unit tests. |
| 7 | Small tasks avoid graph overhead | **PASS** | Demonstration A. Two dependent steps stay one agent's job; a long plan that is really a queue does not become a graph. |
| 8 | Fake-edge detection removes false dependencies | **PASS** | Demonstration A/E. A planner that chained four independent workers yields `maxParallelism: 4, sequentialDepth: 2` once three fake edges are stripped. |
| 9 | Nodes enforce typed input/output contracts | **PASS** | `lib/graph/contracts.ts`; demonstration D rejects prose where structure was required. Now also proven against **real model output** in the live canary. |
| 10 | Invalid output fails/retries under bounded policy | **PASS** | `DEFAULT_RETRY_POLICY`, demonstration D. |
| 11 | Real dependencies control node readiness | **PASS** | Scheduler is a pure function of state; demonstration D blocks a failed node's dependants without killing unrelated work. |
| 12 | Independent nodes execute concurrently | **PASS** | Demonstration B observes the runner dispatching **20** inspectors in one batch. The live canary observes **3 real Claude executions** in one batch. |
| 13 | Claude/Codex routing uses the existing 2A provider layer | **PARTIAL** | The routing engine, adapters and fallback are built and unit-tested in `lib/providers/`. The live canary calls the Agent SDK directly rather than through the 2A transport — see "The 2A/2B turn-budget gap" below, which is a real architectural gap rather than a shortcut. |
| 14 | Dynamic team uses the smallest capable specialist set | **PASS** | Capability-gated selection; demonstration A's refusal to expand is the same rule. |
| 15 | Parallel coding uses isolated workspaces | **PASS** | `lib/graph/fan-out.ts`: writers always isolated, readers share, over-ceiling writers **deferred rather than run unisolated**. |
| 16 | Shared resource conflicts create a dependency or lock | **PASS** | Demonstration E refuses to compile two nodes writing one resource, and discovers a read-after-write dependency nobody proposed. |
| 17 | Locks expire and recover safely | **PASS** | Partial unique index on `state = 'HELD'`; `acquire_work_lock` retires expired leases in the same statement that contends, so two callers cannot both claim an abandoned lock. Covered in `graph-engineering-rls.test.ts`. |
| 18 | DIAMOND performs fan-out → reduce → fresh verify → synthesize | **PASS** | Demonstration B; the live canary runs the same shape with real models. |
| 19 | Deterministic code handles dedupe/filter/count/schema work | **PASS** | `lib/graph/reducers.ts` and the `DETERMINISTIC` executor. Demonstration B's reduce node buys no inference. |
| 20 | Verifier has fresh context and cannot be the implementer | **PASS** | Structural, not promised. In the live canary the verifier is a **separate `query()`** — a new session with no history — handed only the artifact and the criteria, with **no tools at all** so it cannot form its own view of the repository. The test asserts no inspector prompt appears in what the verifier received. |
| 21 | Fan-in verifies expected vs received node count | **PASS** | Demonstration D counts a node that never reported as **missing**, not as failed. |
| 22 | A missing node cannot produce a false COMPLETE | **PASS** | Demonstration D; `percentComplete` counts completions only. |
| 23 | Large fan-in uses layered reduction without silent truncation | **PASS** | `reducers.ts` reports `inputCount`/`outputCount`/`reductionRatio`; a dropped item is accounted for rather than vanishing. |
| 24 | Discovery terminates by convergence/max rounds/budget | **PASS** | Demonstration F: converges, stops at the ceiling, and refuses to sustain itself on unverified candidates. |
| 25 | Budgets enforce nodes/concurrency/duration/retries | **PASS** | Demonstration G degrades concurrency before overspending, charges failed calls, and **never invents a cost** when a model has no declared pricing. |
| 26 | Frozen RED/RLS/security/payment rules cannot be optimized away | **PASS** | `lib/graph/optimizer.ts` cannot propose removing verification, weakening a lock, or lowering a judgement-work tier, and abstains below `MIN_RUNS_FOR_STRUCTURAL_CHANGE`. |
| 27 | Real tests/CI/diffs are anchors; AI claims are not | **PASS** | `lib/graph/anchor-store.ts` + `20260814002200_graph_anchors.sql`. `record_claim_anchoring` receives anchor ids and **never a verdict**, computing `anchored` itself, so a caller cannot assert its own claim was grounded. |
| 28 | Structured handoffs validate receiving contracts | **PASS** | `graph_handoffs` + contract validation on receipt; the live canary's synthesis node consumes three artifacts as data and its own output is validated on the way out. |
| 29 | Parallel branches converge through explicit integration | **PASS** | Demonstration B and the live canary both converge on an explicit node rather than an implicit merge. |
| 30 | Failure supports bounded retry/reassignment/provider fallback | **PARTIAL** | Retry and one-attempt fallback are built and unit-tested (`lib/providers/runtime.ts`). Live provider **fallback** is unproven — it needs two live providers, and only Claude is reachable zero-token today. |
| 31 | Graph/Team UI truthfully shows topology, workers, status, evidence, failures | **PASS** | `components/workflows-console.tsx`, `components/graph-execution-summary.tsx`, `/solutions/workflows`. Empty states say which kind of empty they are; `computeCostMicros` renders absent rather than zero. |
| 32 | Reusable/versioned graph templates work | **PASS** | `lib/graph/templates.ts` — 13 templates, `cloneTemplate`/`reviseTemplate`, version always advances because "two node sets sharing a version would make a run's record a lie." |
| 33 | Bot Manager can launch a real graph goal | **BLOCKED** | `BLOCKED_BY_HOSTED_SCHEMA`. The surface exists and is tested; launching persists through `create_graph_from_plan`, whose tables are not hosted. |
| 34 | All 7 demonstrations pass with evidence | **PASS** | A–G, **20 tests, 0 skipped**. See the table below. |
| 35 | No paid AI-token dependency is required | **PASS** | The live canary runs on the subscription CLI. `lib/worker/auth.ts` and `lib/providers/claude-auth.ts` both refuse to reach a billed path by accident. **A defect was fixed here** — see below. |

**PASS 28 · PARTIAL 3 · FAIL 1 · BLOCKED 3 — 80%.**

Every FAIL and BLOCKED row is the same external prerequisite: the hosted apply.

## The 7 demonstrations

`tests/integration/graph-demonstrations.test.ts` — 20 tests, all passing.

| Demo | Claim | Result |
| --- | --- | --- |
| **A** | A simple task does not become a graph | PASS (3 tests) |
| **B** | A wide audit fans out, verifies, and reduces | PASS (2 tests) — 20 concurrent inspectors observed |
| **C** | The code-feature demonstration | PASS (2 tests) + **live canary**, below |
| **D** | A silent failure is never reported as success | PASS (4 tests) |
| **E** | A hidden conflict prevents unsafe parallelism | PASS (3 tests) |
| **F** | Discovery stops when it stops finding things | PASS (3 tests) |
| **G** | A budget degrades and then stops gracefully | PASS (3 tests) |

### Demonstration C, live

`tests/integration/graph-live-team-canary.test.ts`, run 2026-08-15 15:22Z with
`SOFTWAREFACTORY_GRAPH_LIVE_CANARY=1`.

| | |
| --- | --- |
| Topology | fan-out → synthesize → verify (3 → 1 → 1) |
| Nodes expected / completed / failed | 5 / 5 / 0 |
| Provider | Claude `claude-opus-5` via subscription CLI |
| Observed parallelism | **3** (asserted equal to the planned maximum) |
| Verifier | fresh session, no tools, artifact-only input; returned a judgement, not a refusal |
| Anchors | each inspector required to cite files it read; `blocked` asserted false |
| Duration | 275s |
| API tokens | **0** |
| Result | **PASS** |

### The defect this closed

C's live half was `it.skipIf(!ANTHROPIC_API_KEY && !OPENAI_API_KEY)` around a body
that threw "Not implemented".

The stub was ordinary debt. **The gate was the real defect.** This project's
standing constraint is that normal operation costs zero funded per-token API
usage — so the demonstration was gated on precisely the thing the project
forbids. It could never run. Not "not yet": never. And because a permanently
skipped test reports as a skip rather than a failure, nothing ever said so. The
suite read 6/7 with the seventh quietly unreachable.

It now runs on the zero-token subscription path, which is the path the rest of
the system already uses.

## The 2A/2B turn-budget gap

Found while re-auditing goal 13, and worth stating precisely because the first
version of this scorecard got the reason wrong.

The live canary calls `@anthropic-ai/claude-agent-sdk` directly instead of going
through `executeClaudeThroughCli`. That reads like a shortcut. It is not: for
three of the five nodes it is not currently possible.

`lib/providers/claude-cli-transport.ts` hard-codes `const MAX_TURNS = 1` and
passes it as `maxTurns`. That is the right shape for what 2A was built for — an
advisory task is one prompt and one structured answer, and a single turn makes
cost and latency bounded and predictable.

2B's graph nodes are a different shape. An inspector node that must locate a file,
grep it, read the relevant part and then answer needs several turns; the canary's
inspectors run with `maxTurns: 6` and use them. Routed through the transport as it
stands, those nodes would get one turn and answer from whatever a single tool call
returned — which is exactly the "narrating instead of answering" failure the node
contracts exist to catch.

So this is an integration gap between two phases that were each internally
consistent:

- **2A** correctly treats a provider call as one bounded advisory round trip.
- **2B** correctly treats a node as a unit of work that may need to look things up.

Neither is wrong on its own terms. What is missing is a per-request turn budget on
the transport, so a graph node can declare how many turns its job needs and the
provider layer can bound it, rather than the bound being a module constant. That
is a small change to `ClaudeCliTransportOptions` and a policy decision about who
sets the ceiling — deliberately **not** made here, because widening a cost bound
in the provider layer to make a demonstration pass is the wrong direction, and it
belongs to 2A's owner rather than to this phase.

Until then, goal 13's live proof is limited to the two nodes that genuinely are
single-turn advisory work (synthesis and verification). The routing engine itself
remains proven by unit tests only.

## What is still not proven

- **A Codex worker turning a plan into a diff and a draft pull request.**
  `BLOCKED_BY_1C_HOSTED_SCHEMA`. The 1C worker is live and claiming (verified
  2026-08-15 11:39Z), so the executor half is no longer the blocker; the graph
  tables it would persist through are not hosted.
- **Live provider routing and fallback** (goals 13, 30). Both need two providers
  reachable live. Only Claude is reachable zero-token today.

## Owner action

| What | Where | Action | Risk | Verification |
| --- | --- | --- | --- | --- |
| Report hosted state | Supabase SQL editor | run `scripts/hosted-state-report.sql` | None — read-only | Output names every present/missing table, its grants and RLS |
| Repair `20260814000210` | Supabase SQL editor | apply corrective SQL written against that report | **AMBER** — half-applied migration | `resource_breaker_events` and `resource_assignments` present with RLS |
| Apply the rest | `supabase db push` | `001200`, `001300`, `001400`, `002100`, `002200`, `002300` — **skip `20260814000100`**, it is applied | AMBER | Re-run the **Hosted schema audit** workflow |

Nothing here asks for a funded AI API, and nothing in Phase 2B requires one.

## 2C ready

**No.** 2B's own persistence is unproven against hosted, and 2C is the
multi-project layer above it. Re-evaluate when goals 1–4 and 33 clear.
