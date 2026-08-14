# Phase 2B — the demonstrations (stage 5)

Evidence lives in `tests/integration/graph-demonstrations.test.ts`. Nineteen
assertions pass; one is skipped and says why.

## The boundary, stated once

Every demonstration below runs the **real** compiler, scheduler, dependency
analysis and runner. What is **not** real is the provider: `runGraph` takes an
injected `executeNode`, and these scripts stand in for model calls.

That was a design decision made in stage 3, not a workaround adopted here. The
failures worth catching in a graph engine are decisions the engine makes on its
own — choosing a topology, removing an edge, refusing to call a run complete,
stopping on budget. A scripted executor exercises those exactly as a live one
would, because the engine cannot tell the difference.

**Proven without a credential**

Topology selection · dependency analysis and fake-edge removal · write-conflict
detection · read-after-write discovery · concurrent scheduling · retry and
attempt accounting · contract enforcement · fan-in accounting · budget
degradation and graceful stop · discovery termination · lock wave planning · and
every refusal the engine makes.

**Not proven without a credential**

That a real model returns output satisfying these contracts. That token and
latency accounting match a real provider. That a real Codex worker produces a
mergeable change. These need `ANTHROPIC_API_KEY` and a funded `OPENAI_API_KEY`.

Overclaiming here would be the same failure the engine exists to prevent, so
demonstration C's live half is `skipIf`-skipped rather than asserted around — it
starts running the day the credentials land instead of starting to fail.

---

## A. A simple task does not become a graph — **passing**

The engine's most valuable refusal, and the one an orchestration system is least
inclined to make.

- Two dependent steps → `SINGLE_AGENT`. A scheduler, a reduce step and a
  synthesis pass cost more than two steps of overlap can buy.
- One node → `SINGLE_AGENT`.
- Five nodes in a chain → `SEQUENTIAL` at width 1. A long plan that is really a
  queue does not become a graph just because it has many steps.

## B. A wide audit fans out, verifies and reduces — **passing**

- Twenty independent inspectors compile to `DIAMOND` at width 20.
- The runner dispatches all twenty in **one batch** — asserted by recording the
  widest in-flight count, not by trusting the plan.
- 22 nodes started (20 inspectors, reduce, report); run outcome `COMPLETED` with
  no incompleteness notice.
- Reduction collapses 20 duplicate findings to 1, and the observed retention
  ratio lands below 0.1.

## C. Code feature: plan → parallel build → integrate → fresh review — **shape passing, live run skipped**

The compiled shape is provable and asserted: three implementation branches run
in parallel, converge on integration, and the reviewer runs only after an
**anchor** observed the tests, so the review reads a checked result rather than
a claim.

The live half needs a provider credential and a registered Codex worker. It is
skipped, not faked.

## D. A silent failure is never reported as success — **passing**

The demonstration that matters most, because this is the failure mode that makes
a graph engine actively dangerous rather than merely wasteful.

- One node fails → outcome is not `COMPLETED`, `percentComplete` is below 100,
  and the incompleteness notice names the node.
- A failed node blocks its dependants and **nothing else** — an unrelated branch
  still completes, because killing unrelated work wastes finished output and
  hides which failure mattered.
- Prose where the contract demanded structure is rejected at the boundary rather
  than passed downstream.
- A node that never ran is counted as **missing**, not as failed and not as
  succeeded. Conflating those is precisely how a graph convinces itself it
  finished.

## E. A hidden conflict prevents unsafe parallelism — **passing**

- Two nodes writing one file **refuse to compile**. Inventing an ordering would
  be worse than failing, because it would look like it worked.
- Declaring the conflict resolved lets it compile, and the two writers land in
  **separate lock waves** — contention resolved by planning rather than by
  collision and retry.
- A read-after-write dependency nobody proposed is **discovered** from the
  declared resources.

The database half of this — one holder per resource, heartbeat, expiry, and
reclaiming an abandoned lock — is covered against real PostgreSQL in
`tests/integration/graph-engineering-rls.test.ts`.

## F. Discovery terminates on the no-new-findings condition — **passing**

- Two consecutive rounds that verify nothing new → stop, reason
  `NO_NEW_VERIFIED_ITEMS`.
- The round ceiling stops a search that is still finding things, reason
  `MAX_ROUNDS_REACHED`.
- Rounds that produce activity but verify nothing do not sustain the loop. Only
  *verified* items count as progress, which is what stops a discovery graph
  running forever on plausible candidates.

## G. Budget degrades and stops gracefully — **passing**

- Concurrency is reduced before the ceiling, then the run stops with outcome
  `BUDGET_STOPPED`; completed work is kept and the run does not claim to be
  finished.
- A **failed** call is charged against the budget: three attempts at 500 tokens
  bills 1500. A retry that spent nothing on paper is how a graph engine
  overspends invisibly.
- No cost is invented when a model has no declared pricing — `costMicros` stays
  absent rather than becoming 0.

---

## What would make these live

1. `ANTHROPIC_API_KEY` and a funded `OPENAI_API_KEY`, both server-only. Both are
   needed, not one: cross-provider verification degrades or fails closed with a
   single provider.
2. The provider execution switch enabled in Settings.
3. A live `executeNode` assembling `lib/graph/provider-bridge.ts` — written and
   unit-tested against stubs; its first real call needs the credential above.
4. For C specifically, a registered Codex worker with a heartbeat.

Nothing in the engine changes to make these live. That is the point of the
injection boundary.
