# Loops and graphs

Ingested reference material, plus an audit of where SoftwareFactory already
implements it and where it does not.

**Provenance.** Summarised from "Loops and Graphs: how to stop babysitting
agents and only approve the last step", supplied by the owner on 2026-08-29,
which promotes a course at <https://agent-layers.vercel.app/>. It is a
third-party argument recorded here because it is useful, not because it is
authoritative. Where it disagrees with `policies/` or `AI/ARCHITECTURE.md`,
the repository contract wins. Nothing here authorises autonomous execution;
see `policies/RISK_CLASSIFICATION.md` and `policies/AUTO_MERGE_POLICY.md`.

## The claim in one line

A **loop** makes a unit of work correct without supervision. A **graph**
decides which units exist at all. Building only one is why people still
review every step.

## Loops

Four parts: produce, check, correct, repeat until green. The check is the
whole thing — without a condition that can *fail* the work unattended, there
is no loop, only a scheduler.

A check must be evaluable by a program:

| Is a check | Is not a check |
| --- | --- |
| the test suite exits 0 | the output looks good |
| every claim carries a source line | the model says it is confident |
| the diff touches only files named in the plan | no errors were raised |

That last one is the trap. Absence of an error is not evidence of
correctness; a loop built on it repeats a mistake until the budget runs out
and leaves a clean log doing it.

**The ceiling.** A loop improves one unit. It cannot decide which units
exist, their order, or notice that two of five steps never needed to wait for
each other. A perfect loop running the wrong three steps in the wrong order
is still wrong, and tuning the loop cannot fix it — the fault is not inside
any unit.

## Graphs

A node is one bounded job, one input, one output. An edge is a dependency:
this node's output feeds that node's input.

**"And then" is not an edge.** Summarise the file *and then* check the
weather has no edge — the weather does not consume the summary. The chaining
came from the order someone typed the steps. Test every arrow: name the
variable that crosses. If you cannot, the wait is waste.

Four kinds of node:

- **Splitter** — cuts work into units, and decides more than anything
  downstream. Cut a repository by folder and four workers audit the same
  three files; cut by blast radius and each sees something the others cannot.
- **Worker** — one unit, one lens, **its own context**. Four auditors sharing
  a window converge on whatever the first one wrote: four payments, one
  opinion, three echoes.
- **Code node** — merging, ranking, deduplicating, diffing. One correct
  answer each, a few lines each. Routing these through a model adds cost,
  latency and variance to a step that had none. Test: if you can describe the
  transformation without *judge*, *decide*, *assess* or *summarise*, it is code.
- **Gate** — the thing that can fail the work.

**Where the loop lives:** inside a node. The graph lives between nodes. A
graph whose nodes contain no loops produces unverified work in parallel,
which is worse than serially because there is more of it.

## The two return paths

- **Correction edge (short).** A gate rejects one unit back to the step that
  produced it. Fixes the run you are in.
- **Learning edge (long).** An accepted result returns to the *splitter* as a
  constraint. Fixes every run after.

Most systems build the first and skip the second; the tell is a system that
is fast and never gets smarter. The learning edge carries a constraint, not
the output — `accepted: utils slice ported, green first pass` → `derived:
adapters preserve keyword args exactly` → lands in the splitter's brief, not
the worker's instructions.

**Return the unit, not the batch.** Four slices ported, one fails. Returning
all four rewrites three correct slices into versions that are different, not
better, then re-verifies all four — one failure converted into four uncertain
outcomes. From outside this reads as the model failing repeatedly; it is the
return path destroying correct work.

A return carries five things:

```text
UNIT      handlers slice
VERDICT   red
REASON    test_auth_redirect failed
EVIDENCE  expected 302, got 200, handlers/auth.py:88
SCOPE     fix this file only, do not touch other slices
```

`SCOPE` matters most: without it a returned unit grows, and a one-slice
correction becomes a four-file diff nobody reviewed. Cap corrections at three
attempts — a unit failing three times is a fault in the plan, and the loop
cannot see the plan.

## Gate on blast radius, not confidence

Confidence is the weakest input available, for one reason: it is the only one
the model can influence. Sort by how expensive the mistake is to undo.

| Lane | Example | Gate |
| --- | --- | --- |
| Reversible, contained | copy, a test, an isolated covered function | may open first |
| Reversible, wide | shared utility, additive schema, many callers | deterministic checks + clean trajectory |
| Hard to reverse | migrations, deletions, production data, money | does not open |

The third row is not a very high threshold — it is a lane that does not open.
Thresholds get adjusted; closed lanes do not.

Inside an open lane, read evidence in this order: deterministic results, the
trajectory of this run, how often this node's work has been rolled back
before, and the model's own assessment **last**.

## Where the human goes

One step, at the point of highest consequence and lowest reversibility:
approve the merge, choose what ships. Not reviewing intermediate output. A
human in the middle of a graph is the slowest node in it.

## Audit against this repository

`lib/graph/` is pure and unit-tested; the run state is persisted and read
through `list_graph_runs`. Against the material above:

**Already implemented, and named the same way**

| Idea | Where |
| --- | --- |
| Fake-edge removal ("and then" is not an edge) | `lib/graph/dependencies.ts`; each surviving edge records why |
| Hidden dependencies the planner never proposed | `analyzeDependencies` (read-after-write, write/write) |
| Worker isolation and no self-verification | `lib/graph/verification.ts` — checked on agent identity |
| Verifier never sees the worker's context | `verification.ts` — claim, evidence, criteria, source only |
| Code nodes over model calls | `lib/graph/reducers.ts` — dedupe, filter, sort, group, count, batch |
| Silence is not a pass | no verification resolves to `REJECT` |
| Missing units are not empty units | `lib/graph/fan-in.ts` — `PARTIAL_INPUT` + `incompletenessNotice` |
| Attempt caps | `contracts.ts` `shouldRetry` / `maxAttempts` |
| Budget ceilings and graceful degradation | `lib/graph/budgets.ts`; `computeCostMicros` returns `null` rather than a partial total |
| Discovery counts only *verified* progress | `lib/graph/discovery.ts` |
| Blast-radius lanes rather than a confidence score | `policies/RISK_CLASSIFICATION.md` GREEN/YELLOW/RED |
| A lane that does not open | `lib/graph/frozen.ts` `RED_REQUIRES_OWNER_APPROVAL`, with no override parameter |
| Human on the last step | merge, deploy and rollback are owner-gated (`OWNER_REQUIRED_ACTIONS`) |

The repository is, in places, stricter than the source material — a security
`BLOCK` is absolute and no quorum overrides it, and a plan that declares lower
risk than the classifier found is rejected outright.

**Not implemented: the learning edge**

There is no module deriving a constraint from an accepted result and feeding
it back into the splitter's brief. Correction edges exist; the long return
path does not. This is the genuine gap the material identifies, and it is the
one that separates a fast system from one that gets smarter. Tracked in
`AI/BACKLOG.md`.

**Partially implemented: return the unit, not the batch**

Gates are keyed to graph nodes, so an approval outlives the run that earned
it, and a rejection carries a verdict and evidence. But two things fall short
of the rule:

- `AI/BACKLOG.md` "Resumable lifecycle runs" records that a reclaim re-queues
  *every* node PENDING and re-executes work that already completed. That is
  the batch return the material warns about, and it is already costing roughly
  three times the model-node count per lifecycle pass.
- `replant_exhausted_graph` copies a whole graph — goal, nodes, contracts,
  edges, budget — rather than returning a unit. That is deliberate and
  correctly bounded (exactly one graph, ever, behind a constant id), but it is
  a batch operation, not a counter-example to the gap above.

Nothing carries an explicit `SCOPE` constraint with a returned node either, so
a corrected node is bounded by its own restraint rather than by its contract.
