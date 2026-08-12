# Phase 1C implementation plan

Created: 2026-08-12
Scope: full SoftwareFactory production build-out plus the first real AI engineering execution loop.

Target loop: **Owner → Bot Manager → Orchestrator → Provider worker → GitHub → Validation → Draft PR → SoftwareFactory**

This plan follows a complete inspection of the repository at `f12814b`. Phase 1A and Phase 1B work is preserved. Nothing already working is rebuilt for its own sake.

## 1. Inspection result

### What already exists and works

| Area | Evidence |
| --- | --- |
| App Router, TS strict, Tailwind 4, Next 16.3, React 19.2 | `app/`, `tsconfig.json`, `next.config.ts` |
| Supabase Auth, callback, onboarding, membership, active organization | `lib/supabase/*`, `app/auth/**`, `app/api/auth/**` |
| Tenant boundary with RLS + FORCE RLS on 22 tables, 43 policies | `supabase/migrations/001`-`013` |
| Rich domain schema | `projects`, `connections`, `agents`, `commands`, `tasks`, `agent_runs`, `pull_requests`, `deployments`, `test_runs`, `incidents`, `reports`, `policies`, `approvals`, `activity_events` |
| GitHub App install/callback/token/sync/disconnect | `lib/github/*`, `app/api/github/**` |
| Repository reads: branches, commits, PRs, checks, tree, contents | `app/api/github/repositories/**` |
| Guarded file change → isolated branch → commit → draft PR | `app/api/github/repositories/[owner]/[repo]/changes/route.ts` |
| Signed, idempotent, redacted webhook ingestion | `app/api/github/webhooks/route.ts`, `lib/github/webhook.ts` |
| Risk policy engine and Phase 1D observation evaluator | `lib/risk.ts`, `lib/autonomy.ts` |
| Live Projects, Connections, Files, Activity consoles | `components/*-console.tsx`, `components/github-file-manager.tsx` |
| CI, Playwright, Vitest, 208 passing tests | `.github/workflows/ci.yml`, `tests/**` |

Baseline verified in this session: `npm run lint` clean, `npm run typecheck` clean, `npm test` 25 files / 208 tests passed.

### Classification of every Phase 1C area

| # | Area | Status | Notes |
| --- | --- | --- | --- |
| 3 | Site-wide functional navigation | **PARTIAL** | Dashboard, Agents, Backlog, Runs, Reports render seeded arrays only. Backlog Search/Filter buttons are inert — a dead control. |
| 4 | Global application shell | **PARTIAL** | Responsive sidebar, mobile drawer, skip link exist. Missing: project selector, profile menu, connection indicators, system status, notification center, command shortcut, breadcrumbs. Header says "Demo workspace" and sidebar says "Phase 1A" — both stale. |
| 5 | Dashboard | **PARTIAL** | `LiveDashboardMetrics` is live; 10 of 11 metric cards and the whole owner-attention/report block are Demo Data. |
| 6 | Projects registry | **PARTIAL** | Create + list are live. Missing: edit, archive, search, filter, sort, tags, production URL, Vercel/Supabase metadata, provider assignment, risk ceiling, per-project detail route. |
| 7 | Project overview | **MISSING** | No `/projects/[projectId]` route exists. |
| 8 | Bot Manager | **PARTIAL** | `CommandComposer` persists a real command. "Recent commands" is a hard-coded empty state that never loads data. |
| 9 | Command lifecycle | **PARTIAL** | Enum lacks `planning`, `validating`, `awaiting_review`, `owner_action_required`. No live status view. |
| 10 | Orchestrator | **MISSING** | No intent/acceptance/risk/agent/validation planner. |
| 11 | Task decomposition | **MISSING** | `tasks` exists but has no dependency edge, acceptance criteria, or source. |
| 12 | Agents | **PARTIAL** | `agents` table is complete; the page renders a static array and never reads it. No seeding, no CRUD, no enable/disable. |
| 13 | Provider abstraction | **MISSING** | `agents.provider`/`model` are free text with no adapter layer. |
| 14 | Codex execution | **MISSING** | No provider adapter of any kind. |
| 15 | Codex connection | **MISSING** | `connection_provider` enum already allows `openai`; no UI or route. |
| 16 | GitHub execution resolution | **PARTIAL** | Command → project → installation → repository resolution exists inside the changes route; not reusable by a worker. |
| 17 | Isolated workspace | **PARTIAL** | The changes route creates `softwarefactory/*` branches. No run-scoped `factory/<run-id>-<slug>` workspace record. |
| 18 | Repository memory | **PARTIAL** | `lib/repository-memory.ts` reads SoftwareFactory's own files from local disk. It cannot read a managed project's repository. |
| 19 | Worker execution contract | **MISSING** | — |
| 20 | Structured results | **MISSING** | `agent_runs.output` is untyped jsonb. |
| 21/22 | Runs list and detail | **MISSING** | Page renders `demoRuns`. No detail route. |
| 23 | Execution events | **MISSING** | `activity_events` is coarse-grained; no append-only per-run event stream. |
| 24 | Background execution | **MISSING** | See the architecture decision in §2. |
| 25 | Cancellation | **MISSING** | — |
| 26 | Retry | **MISSING** | — |
| 27 | Test repair loop | **MISSING** | — |
| 28 | Diff review | **PARTIAL** | The changes route checks protected paths and secrets for a single file; no run-level multi-file scope/risk recalculation. |
| 29 | Secret scanning | **PARTIAL** | `lib/server/sensitive-data.ts` plus DB constraints cover control-plane payloads; no diff-level scanner. |
| 30 | PR automation | **PARTIAL** | Draft PR creation exists for a manual single-file edit only. |
| 31 | CI observation | **PARTIAL** | The checks route reads real check runs; nothing correlates them to a run. |
| 32 | CI repair | **MISSING** | — |
| 33 | Files workspace | **PARTIAL** | Tree, open, edit, save, SHA, conflict handling exist. Missing: search, history, Markdown preview, priority-folder shortcuts. |
| 34 | File save | **COMPLETE** | Branch + commit + draft PR, stale-SHA rejection, no default-branch write. |
| 35 | Backlog | **MISSING** | Static table only. |
| 36 | Connections | **PARTIAL** | GitHub only. No OpenAI/Vercel/Supabase/Anthropic connection types. |
| 37 | Vercel connection | **NEEDS OWNER CONFIGURATION** | Requires an owner-supplied `VERCEL_TOKEN`. Build everything up to that boundary. |
| 38 | Supabase managed connection | **NEEDS OWNER CONFIGURATION** | Managed-project connections are modeled but hold no service-role grant. |
| 39 | Reports | **MISSING** | `reports` table exists; page is fully static. |
| 40 | CEO Reporter | **MISSING** | — |
| 41 | Activity | **PARTIAL** | Live tenant stream exists. No search or filters; a Demo Data block sits underneath. |
| 42 | Settings | **PARTIAL** | Only the Phase 1D safety surface. No factory, execution, notification, security, or data sections. |
| 43 | Autonomy master switch | **COMPLETE (locked OFF)** | Hosted migration `010` locks the kill switch ON and Autonomous Mode OFF. Phase 1C keeps it OFF. |
| 44 | Risk controls | **COMPLETE** | `lib/risk.ts` + `policies/RISK_CLASSIFICATION.md`. Wire into the orchestrator. |

### Security gaps and architectural debt found

1. Backlog "Search" and "Filter" are rendered buttons with no handler — a dead control that section 3 forbids.
2. `AppShell` claims "Demo workspace" and "Phase 1A" regardless of real tenant or phase.
3. `app/api/commands/route.ts` does not call `assertSameOriginRequest`, unlike every other cookie-authenticated mutation.
4. `lib/repository-memory.ts` reads from the deployment's own working directory. That is SoftwareFactory's memory, not a managed project's.
5. Hosted migrations `011`-`013` are still unapplied, so `013`'s webhook repository-grant RPC is inert in production.
6. Reports, Runs, Agents, and Backlog pages import `lib/demo-data.ts` while equivalent real tables sit unused.

## 2. Architecture decision — durable background execution

Section 24 forbids depending on the browser or one long HTTP request. Vercel's runtime has no long-lived process, so the execution engine is a **Postgres-backed state machine advanced by short, idempotent, leased ticks**:

- Every run's authoritative state lives in `agent_runs` plus an append-only `run_events` table. Nothing is held in memory.
- `/api/worker/tick` is a server-only endpoint authenticated by a dedicated `WORKER_TICK_SECRET` using timing-safe comparison. It leases runs with `for update skip locked`, advances each by **one bounded step**, writes events, then releases the lease.
- Leases expire (`lease_expires_at`), so a crashed or timed-out tick self-heals on the next tick instead of stranding a run.
- Ticks are driven by Vercel Cron and can also be invoked by an external scheduler. Closing the browser, signing out, or restarting the server changes nothing.

**Validation runs in GitHub Actions, not inside the worker.** A Vercel function cannot check out a repository and run a project's test suite within its limits. The worker therefore:

1. asks the provider for a structured set of file edits,
2. validates them server-side (scope, protected paths, secrets, risk),
3. commits them to an isolated `factory/<run-id>-<slug>` branch and opens a **draft** PR,
4. observes the repository's **real** CI check runs, and
5. feeds real failures back to the provider for a bounded repair attempt.

This is honest about what is actually verified: the tests that gate a run are the ones the target repository really runs in CI. Runs are never marked validated from model narrative.

## 3. Work packages

| WP | Content | Sections |
| --- | --- | --- |
| WP1 | Migration `014`: command lifecycle states, `run_events`, run workspace/lease/result columns, backlog fields, `organization_settings`, agent enable/provider, worker RPCs, RLS | 9, 11, 17, 20, 23, 24, 35, 42 |
| WP2 | Provider abstraction + Codex adapter + registry | 13, 14, 15 |
| WP3 | Orchestrator, run state machine, diff review, secret scanning, PR automation, CI correlation, repair loops | 10, 16, 18, 19, 25-32 |
| WP4 | API surface for every page and the worker tick | 6-9, 12, 21, 22, 33, 35, 36, 39, 41, 42 |
| WP5 | Every page and the global shell | 3-8, 12, 21, 22, 33, 35, 36, 39, 41, 42, 43 |
| WP6 | Tests, docs, memory, scorecard | all |

## 4. Non-negotiable boundaries carried forward

- Autonomous Mode stays OFF; the global kill switch stays ON; auto approve/merge/deploy/rollback stay OFF.
- No merge, no production deploy, no rollback executor.
- Every AI-authored change lands on an isolated branch as a **draft** PR. There is no default-branch write path.
- Provider credentials stay in server-side environment settings. A connection row is metadata plus a secret reference.
- RED risk and protected-resource contact require exact owner approval.
- Anything without live evidence keeps the exact **Demo Data** or **Not Connected** label.
- A persisted command, task, or run record is intent and evidence — never proof that work succeeded.

## 5. Owner configuration required

These are implemented up to the credential boundary and reported truthfully as **Not Connected** until the owner supplies the value.

| Capability | Owner action |
| --- | --- |
| Codex/OpenAI worker | Set server-only `OPENAI_API_KEY` in Vercel; connect it on Connections. |
| Worker scheduling | Set server-only `WORKER_TICK_SECRET`; the `vercel.json` cron drives ticks. |
| Vercel deployment visibility | Set server-only `VERCEL_TOKEN` (read scope). |
| Hosted migrations `011`-`014` | Explicit owner approval, then apply and verify on `qpuofpmagrmyamahqwxw`. |
| GitHub webhook endpoint | Configure the currently blank/inactive provider hook and observe one signed delivery. |
