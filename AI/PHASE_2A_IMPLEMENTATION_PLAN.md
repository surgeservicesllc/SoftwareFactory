# Phase 2A implementation plan - Claude / multi-AI provider layer

Last reviewed: 2026-08-13

Objective: make SoftwareFactory provider-agnostic so a logical agent can be executed by
Anthropic/Claude or OpenAI/Codex based on task kind, capability, availability, policy,
risk, prior results, latency and cost, with structured routing evidence and controlled
fallback.

Non-negotiable separation this phase must preserve:

```text
Organization -> Project -> Task -> Logical agent -> Routing decision
                                              |
                                              v
                              Provider -> Model -> Connection -> Provider account
                                              |
                                              v
                                       Agent run (auditable)
```

A Claude account label (`Surge`, `Bubaly`, `NWW`, `BLCK`, `Daniel`, or any other login) is a
provider account attribute. It must never name a project, a logical agent, or a routing target.

## 1. Audit of the pre-Phase-2A tree

Method: read `AGENTS.md`, `AI/*`, `policies/*`, `docs/*`, every migration under
`supabase/migrations/`, `lib/**`, `app/**`, `components/**` and `tests/**` on branch
`claude/github-connection-confirm-qe3tqm` at commit `249c3a2`.

### 1.1 Foundation

| Item | Status | Evidence |
| --- | --- | --- |
| Next.js 16.3 App Router, React 19.2, TS strict, Tailwind 4 | COMPLETE | `package.json`, `tsconfig.json`, `app/layout.tsx` |
| Supabase Auth, onboarding, active organization, caller-session RLS | COMPLETE | `lib/supabase/*`, `app/api/auth/*`, `app/api/onboarding/route.ts` |
| Tenant model with RLS + FORCE RLS on all 22 public tables | COMPLETE (local); hosted only through migration `010` | `supabase/migrations/20260812000200_row_level_security.sql`, `AI/CURRENT_STATE.md` |
| GitHub App install/callback/token/sync/webhook/draft-PR flow | COMPLETE in source; **Not Connected** live | `lib/github/*`, `app/api/github/**` |
| Risk engine (GREEN/YELLOW/RED, factors, ceiling, authorization) | COMPLETE | `lib/risk.ts`, `tests/unit/risk.test.ts` |
| Phase 1D observation scaffold (kill switch, GREEN ceiling, all auto-* OFF) | COMPLETE and intentionally inert | `lib/autonomy.ts`, `supabase/migrations/20260812001000_phase1d_observation_controls.sql` |
| Audited write boundary (no direct authenticated table writes) | COMPLETE | `supabase/migrations/20260812001700_close_authenticated_control_plane_writes.sql` |
| Secret boundary (server-only env, no `NEXT_PUBLIC_` privileged values) | COMPLETE | `lib/server/sensitive-data.ts`, `tests/integration/secret-boundaries.contract.test.ts` |

### 1.2 AI execution layer - the actual Phase 2A starting point

| Item | Status | Evidence / meaning |
| --- | --- | --- |
| Any provider abstraction (`createRun`/`getRun`/`cancelRun`/events/result/models/health) | MISSING | No `lib/providers/`, no adapter interface anywhere in the tree |
| OpenAI/Codex adapter | MISSING | `AI/CURRENT_STATE.md`: "OpenAI/Codex worker - **Not Connected** - Phase 1C was not started." Nothing to regress; "do not break the Codex path" is vacuous because no Codex path exists. Phase 2A therefore *creates* the OpenAI adapter alongside the Anthropic one. |
| Anthropic/Claude adapter | MISSING | Same source; Phase 2 never started |
| Orchestrator routing | MISSING | `Orchestrator` exists only as a static string in `lib/demo-data.ts` |
| Logical agent records with provider/model | PARTIAL | `public.agents` already has `provider text`, `model text`, `capabilities jsonb`, `role public.agent_role`. No rows are ever created, no assignment API, no UI control. |
| Agent runs | PARTIAL | `public.agent_runs` exists with `provider_run_reference`, `input`, `output`, `error_message`, timings. No `provider`, `model`, `usage`, `latency`, `routing_decision` columns; no writer. |
| Provider connections | PARTIAL | `public.connections` already has `provider` enum containing `openai` and `anthropic`, `status` enum (`not_connected`/`pending`/`connected`/`error`/`disabled`), `secret_reference` with an enforced `env://`-style pattern, and a sensitive-key constraint. Only GitHub uses it. No AI-provider read/write path. |
| Routing decisions / model catalog / usage persistence | MISSING | No tables |
| Multi-agent handoff and independent review | MISSING | No structured artifact exchange, no reviewer-independence rule |
| Fallback | MISSING | - |
| Connections UI for AI providers | BROKEN (hard-coded) | `components/connections-console.tsx` renders a static array with `connected: false` for OpenAI/Anthropic/Vercel and `connected: true` for Supabase. It is not derived from any live check. |
| Agents UI | BROKEN (hard-coded) | `app/agents/page.tsx` maps `lib/demo-data.ts` and prints literal `Not configured` / `Not selected` / `Unassigned` / `Never` strings. |
| Runs UI | BROKEN (demo) | `app/runs/page.tsx` renders `demoRuns` with invented durations. Labeled **Demo Data**, so it is truthful, but it is not a real surface. |
| Bot Manager | PARTIAL | `POST /api/commands` really persists a command + task through `submit_command` and truthfully reports `execution.started: false`. There is no routing, no agent assignment, no run. |
| Reports / Dashboard provider view | MISSING | `lib/demo-data.ts` only |

### 1.3 Blocked items (cannot be closed inside this repository)

| Item | Why blocked | Owner action required |
| --- | --- | --- |
| Live Anthropic connection state `Connected` | No `ANTHROPIC_API_KEY` is present in this environment | Set the server-only key in Vercel/`.env.local` |
| Live OpenAI connection state `Connected` | No `OPENAI_API_KEY` is present | Same |
| Hosted behavior of any new table/RPC | Hosted Supabase ledger ends at migration `010`; `011`-`019` are already awaiting owner approval | Approve and apply `011`-`020` to `qpuofpmagrmyamahqwxw`, then run the post-apply checks |
| Provider execution actually spending money | Organization control defaults OFF | Owner enables `ai_provider_execution_enabled` |
| Repository-mutating agent work (Codex writing code and pushing) | Out of Phase 2A scope and gated by Phase 1D interlocks | Separate owner-approved phase |

## 2. What Phase 2A implements

Scope boundary, stated once and enforced everywhere: **provider runs in Phase 2A are
advisory.** A run sends a bounded, structured instruction to Claude or OpenAI and stores a
structured text result (plan, review, QA assessment, security assessment, report). A run
never writes to a repository, never merges, never deploys, and never approves anything. The
existing owner-driven branch + commit + draft-PR editor remains the only repository write
path. This keeps the Phase 1D interlocks intact while still making the provider layer real.

### 2.1 Provider abstraction (`lib/providers/`)

- `types.ts` - `ProviderId`, `ProviderCapability`, `ProviderRunRequest`, `ProviderRunHandle`,
  `ProviderRunResult`, `ProviderRunEvent`, `ProviderHealth`, `ProviderModel`, and the
  `ProviderAdapter` interface with `createRun`, `getRun`, `cancelRun`, `listEvents`,
  `getResult`, `listModels`, `checkHealth`.
- `errors.ts` - `ProviderError` with a closed code taxonomy and explicit `retryable` /
  `fallbackEligible` flags. Fallback eligibility is a property of the error, not a guess.
- `config.ts` - server-only environment resolution. Absence is `not_configured`, never a
  throw; malformed configuration is a typed error. No secret value is returned, logged, or
  serialized.
- `anthropic.ts` - real Anthropic Messages API adapter (`POST /v1/messages`,
  `GET /v1/models`).
- `openai.ts` - real OpenAI Responses API adapter (`POST /v1/responses`, `GET /v1/models`).
- `registry.ts` - builds the configured adapters and reports a health snapshot.
- `routing.ts` - the pure routing engine.
- `workflow.ts` - structured multi-agent handoff and the independent-review rule.
- `usage.ts` - token/cost accounting from a declared, clearly labeled model price table.
- `runtime.ts` - server-side orchestration: route -> execute -> fall back if permitted ->
  persist run, events, usage and routing evidence.

### 2.2 Routing rules

Precedence, highest wins: **owner request override -> agent assignment -> project policy
default -> automatic score.** Two rules are absolute and sit above precedence:

1. A provider that does not declare the required capability is never selected.
2. A provider that is not `connected` is never selected. If an explicit override names an
   unavailable provider the decision is `NO_PROVIDER_AVAILABLE` with reason
   `OVERRIDE_TARGET_UNAVAILABLE`. It does not silently degrade to another provider.

Automatic scoring uses capability fit, health, recent success rate, observed latency and
declared cost, and returns every candidate's score so the decision is explainable.

### 2.3 Fallback

Fallback runs only when all of: the project policy allows it, the primary error is flagged
`fallbackEligible`, the fallback provider satisfies the same capability and availability
rules, and the fallback provider is inside the project's allowed set. The attempt, the
originating error code and the reason are persisted on the run and the routing record.
Fallback never changes the risk tier, never substitutes for an independent reviewer, and
never re-routes a RED action.

### 2.4 Independent review

`assertIndependentReview` rejects a review artifact whose producing agent is the same
logical agent that produced the implementation, and (when the workflow step demands it)
whose producing provider is the same. Artifacts are exchanged as typed records persisted by
SoftwareFactory, not as shared chat history.

### 2.5 Persistence (migration `020`)

- `provider_model_configurations` - per-organization model catalog, capabilities, enabled
  flag, default flag, declared cost.
- `provider_routing_decisions` - immutable routing evidence.
- `provider_run_events` - append-only run event log.
- `agent_runs` gains `provider`, `model`, `task_kind`, `usage`, `latency_ms`,
  `routing_decision_id`, `fallback_from_provider`, `cancelled_at`.
- `organizations` gains `ai_provider_execution_enabled boolean not null default false`.
- Writes go through owner/admin SECURITY DEFINER RPCs, matching ADR-019. Authenticated roles
  keep select-only table grants.
- RLS + FORCE RLS on every new table with member-select / no-direct-write policies.

### 2.6 Surfaces

Connections, Agents, Runs, Bot Manager, Dashboard, Reports and Settings all read real
provider state. Where a provider is unconfigured they show **Not Configured**; where a run
has not happened they show an empty state, not invented data.

## 3. Execution order

1. Plan document (this file).
2. Core provider library + unit tests.
3. Migration `020` + RLS behavioral tests.
4. API routes + route tests.
5. UI surfaces + component tests.
6. `/AI` and `/docs` updates, full gate run, commit, push, draft PR.

## 4. Definition of done for Phase 2A

- Provider interface implemented by two real adapters with no live-state claims beyond what
  a health check proves.
- Routing decisions are structured, explainable, override-respecting and never silently
  route to an unavailable provider.
- Fallback is policy-bounded and recorded.
- Independent review cannot be satisfied by the implementing agent.
- New tables carry RLS, FORCE RLS, owner/admin RPC-only writes and audit evidence.
- lint, typecheck, unit + integration tests and a production build pass.
- `AI/CURRENT_STATE.md`, `AI/ROADMAP.md`, `AI/DECISIONS.md`, `AI/HANDOFF.md`,
  `AI/QUALITY_SCORECARD.md` and `AI/BACKLOG.md` state exactly what is and is not live.
