# Projects as the operating center — audit before building

> **Correction, 2026-08-17.** This audit was written against a branch that had
> fallen behind `main`, and its headline finding was wrong by the time it was
> committed. `app/(portal)/solutions/portfolio/[projectId]/page.tsx` **does**
> exist and is live in production; other sessions shipped it, the All Projects
> and My Projects dashboards, portfolio controls, and project edit details
> (`20260817000100`) while this branch was mid-flight. The `find` that returned
> nothing was accurate about this branch and useless as a statement about the
> repository.
>
> What survives the correction: the ordering argument in "The order the gaps
> have to be closed in", and the two rules at the end. What does not: every
> MISSING score below should be re-read against `main` before it is trusted.
> Left in place rather than deleted, because a wrong audit that is silently
> revised teaches nothing about how it went wrong — the failure here was
> auditing a stale checkout.

Step 1 of the goal is "audit first, preserve working code, fix gaps". This is
that audit, written before any Projects code was changed.

The headline: **the systems exist; the Project does not tie them together.**
Nearly every capability the goal asks for is already built and working —
GitHub connections, the graph engine, backlog, runs, operations, reports,
activity, autonomy policy, provider routing, the portfolio scheduler. What is
missing is almost entirely the *container*: there is no page for a single
project, so every one of those systems is reached organization-wide and
filtered by eye.

Concretely: `find app/(portal) -name "*.tsx" -path "*[*"` returns nothing.
There is no `/solutions/projects/[projectId]` route at all.

---

## What exists today

| Piece | Where | State |
| --- | --- | --- |
| Project list + create form | `components/projects-console.tsx` (663 lines), `/solutions/projects` | COMPLETE for what it does |
| Create project | `POST /api/projects` → `connect_github_project(org, connection, external_repo_id, name, description, default_branch)` | PARTIAL — one form, four fields, no detection, no resume |
| Autonomy controls | `PATCH /api/projects/[projectId]/controls` → `update_project_controls` | COMPLETE, and correctly locked OFF by Phase 1D |
| Project scheduling state | `projects.engineering_priority / strategic_focus / engineering_paused / maximum_concurrent_runs` (Phase 2E) | COMPLETE |
| Health | `projects.health_status`, `evaluate_project_health` | PARTIAL — computed, not explained |
| Portfolio view | `/solutions/portfolio`, `lib/portfolio/aggregate.ts` | COMPLETE — but it is the *portfolio*, not one project |
| Graph engine | `lib/graph/` (23 modules) | COMPLETE, and is the audit engine the goal asks to reuse |
| Backlog, Runs, Reports, Activity, Operations, Agents, Workflows | `/solutions/*` | COMPLETE, organization-scoped |
| Connections | `/solutions/connections`, `github_installations`, `connections` | COMPLETE for GitHub; Vercel/Supabase are not modelled as project connections |

---

## Scored against the goal's own sections

| § | Requirement | State | Evidence / gap |
| --- | --- | --- | --- |
| 2 | Frictionless creation wizard with save/resume | **MISSING** | One form: connection, repository, name, branch. No steps, no persisted draft. |
| 2 | Auto-detect branch, framework, package manager, build/test/lint commands, CI, Vercel, Supabase, production URL, `AGENTS.md`, `/AI`, migrations | **MISSING** | No detection code exists (`grep -rl "detectStack\|packageManager"` → nothing under `lib/`). `projects.production_url` exists but is only ever set by hand. |
| 3 | Project Home with health, goal, pipeline, agents, PRs, incidents, backlog, next action | **MISSING** | No per-project route exists. |
| 4 | Project workspace tabs (Overview…Settings) | **MISSING** | Every tab's *content* exists organization-wide; none is project-scoped. |
| 5 | Durable project context | **PARTIAL** | Identity, repository, branch, autonomy, priority and health are columns. Stack, environments, services, constraints and project memory are not stored anywhere. |
| 6 | Connections map GitHub / Vercel / Supabase / Claude / Codex with CONNECTED–NOT CONFIGURED | **PARTIAL** | `project_connections` maps GitHub only. Vercel and Supabase are environment configuration, not project-linked records. Worker health is factory-wide (`phase1c_workers`), not per project. |
| 7 | Readiness checks producing READY / NEEDS ATTENTION / BLOCKED with one-click next actions | **MISSING** | `lib/bots/readiness.ts` is bot readiness, not project readiness. Nothing aggregates repository/workers/CI/tests/deployment/database/security/monitoring/rollback. |
| 8 | "Audit This Project" via the existing graph engine → prioritized backlog | **MISSING** | The graph engine and the backlog both exist; nothing joins them for a project audit. |
| 9 | Plain-English goal that supplies project context automatically | **PARTIAL** | `submit_command` takes a prompt and derives risk, role, provider and model. The owner still supplies the project and the command carries no project context beyond the repository binding. |
| 10 | Autonomy settings, most-restrictive-policy-wins, RED protected | **COMPLETE** | `update_project_controls` refuses to enable anything in Phase 1D; RED cannot be enabled through any UI. |
| 11 | Health computed only from real anchors, with a stated reason | **PARTIAL** | `evaluate_project_health` sets a status; nothing records or shows *why*, so the console cannot answer "why degraded". |
| 12 | Simple mode by default, Advanced hides IDs/models/nodes; mobile goals/approve/pause/stop | **PARTIAL** | Pages are responsive and pass axe at three viewports. There is no simple/advanced distinction, and IDs and model names are shown throughout. |
| 13 | `todo.md` maintained; full test/lint/typecheck/build loop | **COMPLETE** | Already the working practice in this repository. |

**Nothing scored BROKEN.** No existing Projects behaviour is defective — the
gap is coverage, not correctness. That matters for the instruction to preserve
working architecture: this is additive work, not a rewrite.

---

## The order the gaps have to be closed in

Each of these depends on the one above it, which is why this is the order
rather than a preference.

1. **Project context columns and a detection record.** Everything else reads
   this. Without somewhere to put a detected framework, a Vercel project or a
   test command, the wizard has nothing to save and Project Home has nothing
   to show.
2. **Stack detection**, reading the connected repository through the existing
   GitHub client — `package.json`, lockfiles, `next.config.*`, `AGENTS.md`,
   `supabase/migrations`, workflow files. Detection must record *what it
   found and where*, so a wrong guess is visible rather than silently wrong.
3. **Project Home** at `/solutions/projects/[projectId]`, assembling what
   already exists rather than recomputing it.
4. **Readiness**, which is a pure function over facts 1–3 plus connections,
   workers and CI — the same shape as `lib/portfolio/aggregate.ts`, and
   testable without a database.
5. **The wizard**, once every step it would run has something real behind it.
   Built earlier it would be a sequence of forms that collect what nothing
   consumes.
6. **Project-scoped tabs**, which are the existing consoles filtered by
   project once Project Home gives them a home.
7. **Audit → backlog**, using `lib/graph/` unchanged.
8. **Simple/Advanced mode**, last because it is a presentation rule over
   finished surfaces.

---

## Two things to hold onto while building

**Never fabricate a metric.** `lib/portfolio/aggregate.ts` already models this
correctly: every count is `number | null`, null renders as **Unknown**, and
zero is never used to mean "not established". Detection and readiness must do
the same — an undetected test command is Unknown, not "none".

**Detection is a claim, not a fact.** Anything auto-detected should record how
it was found and stay correctable by the owner. The goal's instruction is
"never ask for information SoftwareFactory can safely discover" — *safely* is
the operative word, and a wrong guess presented as certainty is worse than a
question.
