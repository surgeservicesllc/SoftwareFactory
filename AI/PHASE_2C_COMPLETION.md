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

## Scorecard

Legend: **PASS** (built and evidenced) · **PARTIAL** · **MISSING** · **BLOCKED** (needs owner action).

### Structure — goals 1–7

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Multiple projects can exist simultaneously | **PASS** | `public.projects` is organization-scoped with `projects_id_organization_unique`; nothing limits cardinality. RLS and FORCE RLS verified across the whole chain by `schema-security-invariants` |
| 2 | Projects remain separate from installations/accounts/repos | **PASS** | Separate tables throughout. A project references a repository by id; it does not *own* an installation. Migration `20260812002100` deliberately moved projects off the `owner/repo` text field onto `github_repository_id` |
| 3 | Multiple GitHub App installations/accounts/orgs | **PASS** | `github_installations` keyed by external installation id with its own connection. `tests/integration/github-lifecycle-matrix.test.ts` exercises two independent installations in one tenant plus a third in a second tenant |
| 4 | One installation may expose many repos | **PASS** | `github_repositories.installation_id`; `reconcile_github_repository_grants` syncs the set |
| 5 | Repos add/remove without corrupting projects or history | **PASS** | Same lifecycle matrix covers repository remove/re-add, archive/unarchive, deletion with a stale resurrection attempt |
| 6 | Explicit project→connection→installation→repo mapping | **PASS** | `projects.github_repository_id` → `github_repositories.installation_id` → `github_installations.connection_id` → `connections`. Every hop is a foreign key, not a convention |
| 7 | Project may map Vercel/Supabase/provider connections independently | **PASS** as a model | `project_connections` with `is_primary` and a project/connection uniqueness constraint, composite-FK'd to the organization. No Vercel or Supabase connection has ever been established, so the model is unexercised for those providers |

### Portfolio surface — goals 8–11

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 8 | Portfolio dashboard lists every authorized project | **PASS** | `/solutions/portfolio` + `GET /api/portfolio`. Every row arrives through the caller's RLS-scoped client, so the route grants no visibility the caller lacks |
| 9 | Truthful health/status/active work/incidents | **PASS** for commands, runs, tasks, incidents, health and connections; **MISSING** for PRs and deployments | `lib/portfolio/aggregate.ts`. Counts are `number \| null`: null means the source could not be read and renders as **Unknown**, never 0. Failed sources are named once rather than leaving rows ambiguous. Pull-request and deployment columns are not yet aggregated |
| 10 | Search/filter/sort projects | **PASS** | Search matches name or repository, case-insensitively. Four sort orders; health sorts worst-first with unknown between degraded and healthy, and activity sorts unknown last because an unreadable run table is not evidence of being busy |
| 11 | Project detail links Files/Backlog/Runs/Agents/Reports/Activity | **PARTIAL** | Every one of those surfaces exists under `/solutions`, but as factory-wide views. There is no per-project detail page that scopes them |

### Commands and execution — goals 12–18

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 12 | Bot Manager supports project-scoped commands | **PASS** at the boundary | `submit_command(p_project_id uuid, p_prompt text, …)` — the project is a required first argument |
| 13 | Global Bot Manager supports portfolio goals | **MISSING** | No surface accepts a goal spanning projects |
| 14 | Commands never guess target project/repo | **PASS** | Structural: `p_project_id` is not optional and has no default. A command cannot be submitted without naming its project, and the repository is then resolved server-side through the FK chain rather than supplied |
| 15 | 2B Graph Engine executes independently per project | **PASS** as a model | `graphs.project_id` is `not null`; nodes inherit scope through `graph_id`. Concurrent *execution* is unproven — no graph has run |
| 16 | Multiple projects may run concurrently within limits | **MISSING** | No capacity model exists: no global run ceiling, per-project ceiling, or node budget enforced across projects |
| 17 | Cross-project work requires explicit graph dependencies | **MISSING** | `graph_edges` are within a graph, and a graph belongs to one project. No cross-project dependency type exists |
| 18 | Locks never incorrectly block unrelated projects | **UNPROVEN** | Phase 1C claims are project-scoped and `claim_phase1c_run` selects per worker, but no test demonstrates that a lock held for project A leaves project B claimable |

### Priorities and capacity — goals 19–22

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 19 | Factory-wide priorities P0–P3 | **PARTIAL** | `WORK_PRIORITIES = ["P0","P1","P2","P3"]` exists in `lib/autonomy/autopilot.ts` and orders backlog selection, but within one project's backlog — it is not a factory-wide ordering |
| 20 | Project priorities and pause/resume | **PARTIAL** | `project_status` includes `paused` and `archived`, so pause exists as state. No `project_priorities` table exists, and nothing consumes a project priority |
| 21 | Owner can focus capacity on a selected project | **MISSING** | Depends on 16 |
| 22 | Portfolio Orchestrator respects dependencies, risk and capacity | **MISSING** | Depends on 16, 17, 19 |

### Aggregation — goals 23–26

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 23 | Global backlog aggregates project backlogs without losing ownership | **MISSING** | — |
| 24 | Portfolio Runs aggregates real runs with project identity | **MISSING** | `/solutions/runs` exists but is not aggregated by project |
| 25 | Portfolio Activity aggregates real events | **MISSING** | `activity_events` carries `project_id`, so the data supports it; no portfolio view consumes it |
| 26 | Reports provide project + portfolio views | **PARTIAL** | `generate_operations_report` exists per project; no portfolio roll-up |

### Resilience and safety — goals 27–33

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 27 | Connection loss degrades only affected projects | **LIKELY PASS, UNPROVEN for portfolio** | Loss is recorded per connection and Phase 1B proves per-installation isolation, but no test asserts that project B stays healthy while project A's connection is lost |
| 28 | Project archive preserves history | **PARTIAL** | `project_status = 'archived'` exists. No archive operation, and no test that history survives it |
| 29 | Project deletion is protected and destroys no external resource | **UNPROVEN** | `on delete cascade` from organizations exists, but no guarded project-deletion path was found. This is the highest-risk unknown in the audit |
| 30 | RLS prevents cross-user/org/project access | **PASS** for user and organization; **UNPROVEN** for project | Organization isolation is enforced and tested throughout. Project-level isolation *within* one organization is not separately asserted |
| 31 | Agents receive only target-project context/credentials | **PARTIAL** | AgentOS grants are per-agent and default-deny; the worker job carries exactly one repository. No test proves an agent cannot read a sibling project |
| 32 | GitHub/Vercel/Supabase secrets remain server-side | **PASS** | Verified this session: the client bundle carries no credential-shaped strings, and the two provider names present are `defaultCredentialRef` labels, not values |
| 33 | Hosted schema supports portfolio entities/RLS/indexes | **BLOCKED** | Two reasons. The portfolio tables do not exist yet, and 23 migrations are already unhosted — the ledger ends at `20260813001400` |

### Proof — goals 34–35

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 34 | Two real authorized repositories proven | **BLOCKED — owner action** | Exactly one repository is connected. A second real installation or repository is owner-provisioned |
| 35 | No paid AI-token dependency | **PASS** | Phase 1C runs on subscription-authenticated Codex. `resolveCodexAuth` refuses to reach the billed path implicitly, and the worker workflow supplies no API key at all — asserted by `phase1c-worker-workflow.contract` |

## Score

**15 PASS · 7 PARTIAL · 8 MISSING · 3 UNPROVEN · 2 BLOCKED — 35 total.**

Counting PASS only: **43%**. Counting PASS plus the structural half of PARTIAL: roughly **53%**.

Goals 8–10 moved from MISSING to PASS: the portfolio surface now exists and reads real aggregates. Goal 9 is a qualified pass — pull requests and deployments are not yet columns, and that is stated in its row rather than rounded up.

The distribution is the useful part. Structure is 7/7. Surface and orchestration are close to 0/19. That is a phase with a sound foundation and no product on top of it, which is a much better position than the reverse.

## The earliest missing capability

Goal 16 — **capacity**. It is the dependency under goals 21 and 22, and the portfolio orchestrator cannot be built honestly without it: an orchestrator that dispatches across projects with no ceiling is not respecting capacity, it is ignoring it.

But capacity is only meaningful once something can run, and nothing runs today: Phase 1C has no credential and the graph engine has never executed. So the *buildable* earliest gap is goal 8–10, the portfolio surface, which can read real aggregates from tables that already carry `project_id` and tell the truth about a factory where every project is idle.

## Owner action required

**A second authorized repository or GitHub installation.** Goal 34 cannot be proven with one repository, and no code change substitutes for it.

- **Service/page:** GitHub → Settings → Applications → the SoftwareFactory App → Configure.
- **Action:** grant the installation a second repository, or install the App on a second account or organization.
- **Value/type:** a repository selection. Not a secret.
- **Verification:** the second repository appears in `github_repositories` after the next webhook or resync, a second project can be bound to it, and the multi-project canary can then prove that a command against project A touches only A's repository.

Everything else in this scorecard is engineering that does not need you.

## Zero-token position

Unchanged and preserved. Nothing in the portfolio objective requires a model call: aggregation, capacity, priorities, and isolation are deterministic. A portfolio orchestrator that needed an LLM to decide which project to work on would be the wrong design as well as a cost violation.
