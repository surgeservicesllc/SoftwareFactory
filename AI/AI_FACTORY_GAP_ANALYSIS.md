# AI Factory → autonomous build platform: audit and gap analysis

Written 2026-08-30 against main `a7083a8`, at the start of the owner's
"Build me [what I want]" directive (task #61; a trimmed /goal later
registered, so the Stop-hook evaluator is armed — this document and
`AI/BACKLOG.md` remain the plan of record).

The directive's benchmark is a Grok-Build-class experience: one
conversational command drives plan → agents → build → test → review →
fix → deploy → monitor, with the technical machinery hidden by default.
The directive's first two orders are to inspect everything that exists
and to reuse it. This file is that inspection.

## What already exists (verified in code, tests, or production this session)

| Capability | Where it lives | State |
| --- | --- | --- |
| Command intake ("Build me X" as data) | `POST /api/commands` — prompt (≤4000 chars), project, acceptance criteria, risk, idempotency key; routed via `factory_command_routes` into a project pipeline + task | **Live.** The conversational surface only needs to call it. |
| Intent analysis (Chief-of-Staff, first half) | `POST /api/commands/[id]/analysis` launches the DISCOVER→EVALUATE→DECIDE analysis graph (ADR-era tasks #41); typed stage packages, scout reports, artifacts | **Live**, including worker wake through the project's GitHub binding. |
| Planning → execution engine | `lib/graph/*`: compiler, scheduler, runner, fan-out/fan-in, dependency-aware topology, claims/work locks, budgets, verification, handoffs, stage packages; `full_lifecycle` 10-phase template (#42–#53) | **Live** with real parallelism (#27) and a ten-step E2E incl. failure cases (#53). |
| Live activity view | `GET /api/graphs/runs` — per run: state, nodes with states, verifications, artifact counts, tokens/cost, closure note, iteration; Agent Trail polls it (#59) | **Live.** The command center's backbone already answers. |
| Run surfaces | `/solutions/runs`, `/solutions/lifecycle/run/[graphRunId]/[stage]`, `/solutions/trail`, factory step pages 1–10 (#44–#52) | **Live** but scattered — each panel exists somewhere; no single workspace. |
| Approvals and gates | `graph_gates` + `POST /api/graph-gates/[gateId]/decide`; command-level `requires_owner_approval`; RED policy gating per `policies/RISK_CLASSIFICATION.md` | **Live.** |
| Run controls | `/api/runs/[runId]/cancel`, `/retry`, review PATCH, archive | **Live** for command runs; graph runs close via the engine. |
| Agents & providers | Agent catalogue (#26), `project_agents` (#31), bots + roles + assignments + readiness (#24–#25), AI accounts (Claude/Codex connect), provider routing/capacity/rate limits | **Live** as configuration + routing; specialty-agent *personas* are not first-class. |
| Reliability | Retries incl. 529 backoff (ADR-146), idempotent submission, work locks, lifecycle resume scope, immutable activity/audit events, budget stops | **Live**, with one known gap: `node_runs.attempt` never written (task #56). |
| QA independence | `graph_verifications`, gate bridge, journey/E2E lanes, "agent says done ≠ done" enforced by verifier nodes and CI | **Live** in the engine; per-run acceptance-criteria checklists not surfaced. |
| Supabase as system of record | 180 migrations, forced RLS everywhere (phase1e pins the count), audit events, storage, tenant isolation | **Live.** |
| Autonomy | `/solutions/autonomy` decisions + controls; destructive actions default OFF; Phase 1A forbids auto-merge/auto-deploy | **Live** as policy; not yet expressed as named modes. |

## The genuine gaps (what the directive adds)

1. **The conversational front door.** Nothing lets a person type one
   sentence and watch everything else happen in one place. The intake,
   analysis, planning, execution and evidence all exist behind ~20
   console pages. → Build `/solutions/build`: one prompt, one live
   workspace composed from the real endpoints above. *(Increment 1.)*
2. **One command center.** Conversation + plan + task graph + live agent
   activity + progress + artifacts + approvals in a single view, linking
   out to the deep pages instead of replacing them. *(Increment 1 starts
   this; later increments add diffs/logs/preview panels from the same
   real sources.)*
3. **Chief-of-Staff completion.** The analysis graph derives type,
   plan and stages, but structured *requirements + acceptance criteria*
   from free text are only as good as what the person typed; command
   intake accepts acceptanceCriteria but the front door never composes
   them. → Later increment: derive draft criteria in DISCOVER output and
   show them for approval before launch.
4. **Named specialty agents.** Roles exist (bot roles, presets); the
   directive's eleven named specialties should map onto lifecycle stages
   visibly (which agent persona handles which node). *(Later increment;
   configuration exists, presentation and bounded-context contracts are
   the work.)*
5. **Autonomy modes.** Ask-Me / Balanced / Autonomous as a first-class,
   per-project setting that parameterizes existing gates — never
   bypassing RED/destructive approvals, per `policies/`. *(Later
   increment; must not touch guardrails without owner approval per
   AGENTS.md.)*
6. **node_runs.attempt** (task #56) — the one recorded reliability gap.
7. **Deploy/monitor stages beyond evidence links** remain bounded by
   Phase 1A: no auto-deploy workflow may be introduced; deployment
   remains owner-directed. Stated here so no increment pretends
   otherwise.

## Benchmark: Grok Build (researched 2026-08-30)

Grok Build is xAI's terminal-native agentic coding CLI (beta 2026-05-14;
SuperGrok subscription): a **plan → search → build** staged flow with a
plan mode, up to **8 parallel sub-agents each in an isolated git
worktree**, MCP support, IDE integrations, a **/goal mode that plans,
executes and self-verifies**, and 70.8% on SWE-bench Verified. Its
strongest concepts for this platform, translated to our architecture:

- *One-prompt staged flow* → our full_lifecycle launch from `/solutions/build`
  (shipped, increment 1) already stages requirement → … → monitoring.
- *Parallel isolated sub-agents* → the graph engine's fan-out with
  claims/work-locks is our parallelism; per-node branch isolation on the
  bound repository is the worktree analogue to deepen in a later
  increment (the engine already binds one verified repo per project).
- *Plan mode + approval* → HUMAN gates; increment 2 put the decision
  inline in the workspace.
- *Self-verifying /goal loops* → graph_verifications + verifier nodes +
  iteration/maxIterations already exist; surfacing them in Build is
  planned.

Cautionary half of the benchmark: Grok Build's July 2026 incident —
uploading users' repositories to cloud storage without authorization —
is exactly what this repository's consent, audit-event, and
default-OFF rules exist to prevent. The benchmark is the UX, never the
permission posture. (Our design is our own; no xAI code, branding, or
trademarks are used.)

## Increment plan

1. `/solutions/build` conversational workspace v1 (this PR): prompt →
   real command → analysis launch → live lifecycle view via
   `/api/graphs/runs` polling; progress computed only from real node
   states; links to run/stage/trail pages; honest empty and
   Not-Connected states. No new tables.
2. Draft acceptance criteria + plan approval in the same workspace.
3. Gate decisions inline (approve/reject via existing endpoint) +
   run controls where endpoints exist.
4. Specialty-agent presentation over stages; bounded IO contracts.
5. Autonomy modes as parameterization of existing gates (policy review
   first).
6. Task #56 attempt persistence; checkpoint audit.

Each increment ships through the standard cadence: tests → lint →
build → typecheck → PR → ≥4 real green checks → merge → deploy verify →
production probe, with `AI/*` docs updated.
