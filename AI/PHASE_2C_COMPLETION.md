# Phase 2C completion — multi-project portfolio

Audit date: 2026-08-15
Audited tree: `8c983fb` (`origin/main`)

## A naming collision to resolve first

`AI/PHASE_2C_IMPLEMENTATION_PLAN.md` already exists and describes a **different** phase: "Intelligent Agent & Resource Manager", the routing layer that scores candidates and assigns workers. That document is not this objective and is not superseded by it.

This document scores the **multi-project portfolio** objective. Where the two need distinguishing, this one is the portfolio phase. The collision is recorded rather than resolved by renaming, because the resource-manager plan is referenced from `AI/CURRENT_STATE.md` and other agents are working against it.

## The headline

The **data model is largely ready and the portfolio layer does not exist.**

Goals 1–7 describe multi-project *structure*. Almost all of it is already built, because Phase 1B had to model GitHub properly to work at all. Goals 8–26 describe a portfolio *surface and orchestrator*. Essentially none of that exists: `find app components lib -iname "*portfolio*"` returns nothing.

So this phase is not a schema project. It is a surface, an orchestrator, and a capacity model built on a foundation that is already correct.

## Score

**32 PASS · 0 PARTIAL · 1 MISSING · 0 UNPROVEN · 2 BLOCKED — 35 total.**

Counting PASS only: **91%**.

Re-scored 2026-08-15 by the master loop, from evidence rather than intention:

- Loops 2–8 closed goals 9, 11, 13, 18, 26, 27, 28 and 29 — isolation and archive proven by negative tests against the migrated schema, deletion resolved by discovery (structurally impossible, now instructively refused), the report and portfolio reconciling against each other.
- Phase 2E had already closed 16 and 19–23; the original audit predated its landing, and those rows now cite the scheduling suite's real claims rather than the plan.
- Loop 10 closed 24, 25 and 31. The runs console groups runs under the owning project with per-project counts, and runs with no project in their bounded projection sit under "Project unavailable" rather than being attributed; the activity console derives per-project facet chips (with counts) from the loaded events and filters on selection, with organization-level events in their own bucket — both asserted by component tests. Goal 31 is proven at the only boundary that exists: `claim_phase1c_run`'s payload is the worker's entire context, its 41 columns are pinned, every identifier in a claim belongs to the claimed project and none to its sibling, and a valid lease on one project's run is refused for heartbeat and completion against the sibling's running run (`phase2e-portfolio-scheduling.behavior.test.ts`).
- The one remaining agent-actionable row is 17: an explicit cross-project dependency type. `graph_edges` are within a graph and a graph belongs to one project; nothing yet models "project B's work waits on project A's".
- 33 awaits the hosted-ledger verification and 34 awaits a second repository — both owner actions recorded in `todo.md`.

## Owner action required

**A second authorized repository or GitHub installation.** Goal 34 cannot be proven with one repository, and no code change substitutes for it.

- **Service/page:** GitHub → Settings → Applications → the SoftwareFactory App → Configure.
- **Action:** grant the installation a second repository, or install the App on a second account or organization.
- **Value/type:** a repository selection. Not a secret.
- **Verification:** the second repository appears in `github_repositories` after the next webhook or resync, a second project can be bound to it, and the multi-project canary can then prove that a command against project A touches only A's repository.

Everything else in this scorecard is engineering that does not need you.

## Zero-token position

Unchanged and preserved. Nothing in the portfolio objective requires a model call: aggregation, capacity, priorities, and isolation are deterministic. A portfolio orchestrator that needed an LLM to decide which project to work on would be the wrong design as well as a cost violation.
