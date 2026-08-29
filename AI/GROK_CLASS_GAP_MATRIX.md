# Autonomous build platform — gap matrix

Measured against the tree at `7064e31`, not against memory. Every "Have" row
names the file or table that makes it true.

## The headline

The engine is largely built. What is missing is not execution machinery — it is
the step that turns a sentence into a plan, and the surface that lets a
non-technical person watch it happen.

## 1. Data model — almost entirely present

174 migrations, ~140 tables. The goal's list of what Supabase must hold, against
what it already holds:

| Goal asks for | Exists as | State |
| --- | --- | --- |
| users | `profiles`, `organization_members` | **Have** |
| projects | `projects` | **Have** |
| goals | `agentos_goals`, `graphs.goal` | **Have** |
| plans | `graph_templates`, `graphs`, `graph_nodes`, `graph_edges` | **Have** |
| tasks | `tasks`, `agentos_task_chains` | **Have** |
| dependencies | `task_dependencies`, `graph_edges` | **Have** |
| agents | `agents`, `bots`, `agentos_*` | **Have** |
| assignments | `bot_assignments`, `project_agents`, `provider_agent_assignments` | **Have** |
| runs | `graph_runs`, `node_runs`, `agent_runs` | **Have** |
| events | `graph_events`, `activity_events`, `provider_run_events` | **Have** |
| artifacts | `graph_artifacts` | **Have** |
| approvals | `approvals`, `graph_gates` | **Have** |
| tests | `test_runs` | **Have** |
| deployments | `deployments`, `deployment_validations` | **Have** |
| audit history | `operations_audit_events` | **Have** |
| checkpoints | `node_run_claims`, `work_locks` | **Partial** — a claim rebuilds a run, but there is no intra-node checkpoint |
| tool calls | `provider_run_events` | **Partial** — provider-level, not per tool invocation |
| requirements | `agentos_goal_dod_items` | **Partial** — definition-of-done items, not structured requirements with acceptance criteria |

**Conclusion: the schema is not the gap.** Three rows need widening; none needs
inventing.

## 2. Engine — built, and more capable than the goal assumes

| Capability | Evidence | State |
| --- | --- | --- |
| DAG execution, ready-node selection | `lib/graph/scheduler.ts` | **Have** |
| Parallel fan-out / fan-in | `lib/graph/fan-out.ts`, `fan-in.ts` | **Have** |
| Dependency-aware execution | `lib/graph/compiler.ts` | **Have** |
| Retries with backoff | `lib/graph/backoff.ts` | **Have** |
| Timeouts, budgets, concurrency caps | `lib/graph/budgets.ts`, `locks.ts` | **Have** |
| Resumability | every claim rebuilds from persisted rows; dead worker reclaimed after two hours | **Have** |
| Human gates / approvals | `graph_gates`, `decide_node_gate` | **Have** |
| Verifier loops, feedback edges | `lib/graph/verification.ts`, `is_feedback` | **Have** |
| Evidence rule — agent-says-done ≠ done | `anchorsFor` counts only what an ANCHOR observed | **Have** |
| Ten-stage lifecycle | `lib/sdlc/lifecycle.ts`, `full_lifecycle` template | **Have** |
| Conditional branches | `graph_edges` carries a reason, never a condition | **Gap** |

## 3. The real gaps

### 3.1 Intent → plan is the central one

`POST /api/graphs` requires a `templateKey`. `lib/graph/suggest.ts` maps a goal
to one of ~16 fixed templates **by regex keyword** — `/\bmigrat/i` →
`database_migration`, and so on — falling through to `feature_build` on the
stated reasoning that "anything else reads as building something new". Its own
comment calls the result "informational … a suggestion rather than a binding
choice".

Two concrete consequences, both verified against the file rather than assumed:

1. **`full_lifecycle` is unreachable by intent.** It is the richest template in
   the repository — ten phases, goal through deployment health — and no keyword
   routes to it. `grep -c full_lifecycle lib/graph/suggest.ts` returns 0. A
   person asking for a whole product gets `feature_build`, a narrower shape,
   and the ten-phase path can only be chosen by someone who already knows to
   ask for it by key.
2. **Nothing converts intent into requirements, acceptance criteria,
   architecture, tasks or a dependency graph.** Classification picks a
   pre-drawn shape; it does not author a plan.

**This is the Chief of Staff, and it does not exist.** Every other gap below is
smaller.

### 3.2 Agent roster is narrower than the goal's — CLOSED 2026-08-29

*Corrected: an earlier draft of this section said `NODE_CAPABILITIES` held
nine and listed only the originals. It held twelve — the discovery trio
(`discovery`, `evaluation`, `decision`) was added under ADR-136, and
`discovery` is what the goal's Research role maps to. The undercount made the
gap look wider than it was.*

The twelve at audit time: planning, architecture, implementation, extraction,
review, security_review, qa, synthesis, reporting, discovery, evaluation,
decision. Those covered seven of the eleven named roles. Frontend, Backend,
Database and Integration all collapsed into `implementation`, and Deployment
had no value at all — the DEPLOYMENT stage borrowed `implementation`, so a
release step was tiered and prompted as though it were writing a feature.

Closed by `lib/sdlc/agent-roster.ts` (ADR-150), which separates two ideas the
audit had itself conflated. A capability is the kind of thinking a node needs;
a role is a job with a bounded slice of context and a privilege posture. All
eleven roles are now named, each with explicit `reads`/`writes` resource
kinds, a default risk and an approval flag.

Only `database` and `deployment` became capabilities, because only they behave
differently — schema work runs STRONG, and a release asks for a verdict rather
than a proposal. Frontend, Backend and Integration deliberately share
`implementation`: same reasoning, same tier, same task kind, so a capability
each would have been a label. What separates them is reach, enforced as data —
no role but Database may write a migration, and no role but Deployment may
write a deployment environment.

### 3.3 No worktree isolation

Zero occurrences of `worktree` in `lib/` or `app/`. The goal asks for isolated
branches or worktrees so parallel agents cannot corrupt each other's work.
Today parallel nodes share whatever workspace the worker gives them.

### 3.4 Command centre is partial

Built: `/solutions/trail` (the run map), `/solutions/lifecycle/run`,
`/solutions/lifecycle/[stage]`, `/solutions/runs`.

Missing as one surface: conversation, live diffs, terminal/logs, preview,
and Pause/Resume/Stop/Retry/Rollback controls in one place. The pieces are
scattered across 25 `/solutions` routes, which is the opposite of the goal's
"a non-technical user understands what is happening".

### 3.5 Autonomy modes are not the goal's three

`/solutions/autonomy` and `autonomy_decisions` exist, and `policies/` defines
RED/AMBER/GREEN risk with owner approval. But there is no Ask Me / Balanced /
Autonomous selector bound to that policy.

## 4. The blocker that is not code

**No provider credential is configured, and outbound execution is off.**
`AI/CURRENT_STATE.md` records that no node has executed against a provider.

Everything above can be built, wired, persisted and tested against real
PostgreSQL without one. None of it will produce an agent that actually writes
code until a credential exists. That line is where "wired" stops and "working"
begins, and no amount of code moves it.

## 5. Order of work

1. **Chief of Staff: intent → plan.** The one gap that makes the headline
   promise false today.
2. ~~**Widen the agent roster** so routing can tell a frontend task from a
   backend one.~~ Done 2026-08-29 — ADR-150.
3. **Command centre** as one surface over the run that already exists.
4. **Autonomy modes** bound to the existing risk policy.
5. **Worktree isolation** for parallel agents.
6. **Conditional branches** — the last engine gap.
