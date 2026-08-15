# Graph Engineering

How SoftwareFactory decides whether work needs a graph, and what happens when
it does.

The governing idea is a refusal: **most work is not a graph.** A graph costs a
planner call, a scheduler, verification, and a synthesis step, and it buys
nothing unless there is genuinely independent work to overlap. The engine
therefore defaults to a single agent and makes every richer topology earn its
place with evidence from the node set.

Stage 1 — the engine core — is implemented and tested. Stages 2–5 (durability,
execution, surfaces, demonstrations) are not. `AI/PHASE_2B_IMPLEMENTATION_PLAN.md`
tracks the rest.

## The modules

All of `lib/graph/` is pure: no I/O, no clock, no network. That is what lets the
interesting failures — a fake edge, a lost input, a runaway discovery loop — be
caught by a unit test rather than only in production.

| Module | Responsibility |
| --- | --- |
| `types.ts` | Topologies, the nine node states, edge reasons, resource kinds. |
| `contracts.ts` | Typed node contracts, output validation, model tiering. |
| `dependencies.ts` | The fake-edge test, hidden-dependency discovery, cycles, critical path. |
| `topology.ts` | Topology selection, biased against graphing. |
| `scheduler.ts` | The DAG state machine. |
| `reducers.ts` | Deterministic dedupe, filter, sort, group, count, batch. |
| `fan-in.ts` | Completeness guard, `PARTIAL_INPUT`, layered fan-in. |
| `verification.ts` | Independence checks and quorum resolution. |
| `budgets.ts` | Ceilings, graceful degradation, real-cost-or-nothing. |
| `frozen.ts` | Policies the planner cannot optimise away. |
| `discovery.ts` | Round-based search with stop conditions. |

## Fake edges

An edge A→B survives only if B actually consumes something A produces: B's
input comes from A's output, B reads a resource A writes, B verifies A, or a
policy demands the order. Everything else is removed and the nodes run in
parallel.

This matters more than it sounds. Plans are usually described in sentences, and
sentences are sequential, so a planner will chain steps that have nothing to do
with each other. Removing those edges is frequently the entire difference
between a graph that runs four ways wide and one that runs as a queue.

Every surviving edge records **why** it survived, so the choice is auditable
rather than implicit.

## Hidden dependencies

The opposite failure is an edge nobody proposed. Two nodes are not independent
because a planner listed them side by side — they are independent because
neither touches what the other touches.

`analyzeDependencies` reads declared resources and finds:

- **read-after-write** — an ordering, added as a discovered edge;
- **write/write** — a *conflict*, not an ordering. Neither node needs the
  other's output; they simply cannot both proceed. These are reported for
  serialization or locking rather than turned into an arbitrary edge.

Resources are typed (`file`, `migration`, `api`, `rate_limit`,
`deployment_environment`, …) because contention differs by kind.

## Contracts

A node declares typed input and output schemas, the resources it reads and
writes, its risk, timeout, and retry policy.

The rule that does the work: **prose is not acceptable output when a downstream
node needs structure.** `validateNodeOutput` rejects a string handed to a node
whose contract wants an object, which is the specific way an agent fails — by
narrating instead of answering. Whether a contract accepts prose is decided by
asking the schema, not by reading Zod's internals.

Handoffs validate against the **receiving** node's input contract, so a
producer's idea of "done" cannot silently differ from the consumer's idea of
"usable".

## Model economics

Capabilities carry a declared model tier. Extraction and dedupe are `ECONOMY`;
planning, architecture, review, and synthesis are `STRONG`; deterministic nodes
are `NONE` and never call a model at all. This is configuration — what the
system is willing to spend where — not a benchmark claim, and Phase 2A routing
may still override it for availability or policy.

## The scheduler

`tick` is a pure function from graph state to a decision. No I/O, no clock. The
same state always produces the same decision, which is what makes durability
possible: a run that survives a restart replays its persisted states and
arrives exactly where it left off.

Two behaviours worth stating:

- **A failed node blocks its dependents and nothing else.** Unrelated branches
  keep running, because stopping them would waste completed work and obscure
  which failure mattered.
- **Writes are claimed during a tick**, so two independent nodes writing the
  same file cannot both start on the first pass and race.

`percentComplete` counts completions only. A graph that failed half its nodes is
not "100% done" because nothing is still moving.

## Fan-in and the silent failure

Twenty nodes dispatched, nineteen returned, synthesis writes up nineteen as
though they were all of them. Nothing errors. The report looks complete.

Every fan-in therefore states what it expected and compares it against what
arrived. Anything missing yields `PARTIAL_INPUT` and an
`incompletenessNotice` — returned as text on purpose, so the caveat travels
with the finding into the report rather than sitting in a field somebody
forgets to render.

A node that completed and returned nothing is **not** missing; it ran and had
nothing to say. Conflating that with a node that never reported is how a graph
convinces itself it is finished.

Large result sets are batched into layers, never truncated.

## Verification

Two rules:

- **A worker never verifies itself** — checked on agent identity, so it cannot
  be satisfied by rewording a prompt to the same worker.
- **A verifier never sees the worker's context.** It gets the claim, the
  evidence, the acceptance criteria, and the source. A verifier shown the
  worker's reasoning tends to check whether the reasoning is coherent rather
  than whether the claim is true.

Verdicts are `PASS` / `WARN` / `REJECT` / `BLOCK` with evidence. Quorum
strategies are single, majority, unanimous, and specialized-lenses.

**A security BLOCK is absolute.** No majority overrides it; the point of a
blocking security finding is that it is not a vote. No verification at all
resolves to `REJECT`, because silence is not a pass.

## Budgets

A graph engine's characteristic failure is not crashing — it is quietly
spending. Fan-out multiplies, discovery generates rounds, retries stack, and
each decision looks reasonable alone.

Budgets cover nodes, concurrency, duration, retries, discovery rounds, and —
where the provider reports them — tokens and cost. At 80% of a limit the engine
degrades: token and cost pressure prefers cheaper models, node and time pressure
narrows concurrency. At 100% it stops gracefully and keeps completed work.

`computeCostMicros` returns `null` if **any** model involved lacks declared
pricing. A partial total presented as a total is a fabrication, and a fabricated
number is worse than an absent one because it gets believed.

## Frozen policies

A planner optimising for completion will route around whatever is stopping it.
That is not misbehaviour — it is what optimisation is.

So the constraints that exist precisely to stop completion are declared in
`frozen.ts` and made unreachable. The planner may choose topology, concurrency,
models, and ordering. It may not choose to need less approval, less isolation,
or a larger budget than the owner set.

`assertPlanRespectsFrozenPolicies` is the only door and has no override
parameter. It specifically catches a plan declaring lower risk than the
classifier found — the move that would otherwise slip work past its approval.

## Discovery

Round-based search: discover, dedupe, verify, generate the next round. Stop
conditions are checked **before** each round, so a budget is never overshot by
exactly one expensive round.

Only *verified* items count as progress. Without that, a discovery loop
sustains itself indefinitely on plausible candidates that never survive
checking — mistaking activity for progress.

## What is not built yet

No graph, node, edge, lock, verification, budget, or template is **persisted**.
There is no scheduler loop driving real provider calls, no isolated-workspace
fan-out, no integration nodes, no anchors modelled as evidence, no templates,
and no UI. Stage 1 is the reasoning core those stages will use.
