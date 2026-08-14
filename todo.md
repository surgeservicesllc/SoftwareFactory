# SoftwareFactory — shared working status

Last updated: 2026-08-14 (Phase 1E→1C repair promotion, Phase 2C persistence/UI/routing, probe SSRF hardening)
Current `main`: `5364b66` — Supabase RPC contract verification merged
Owner of this file: **whichever agent is currently working. Update it before your session ends.**

Several agents work this repository concurrently. This file is the shared picture: what is
done, what is genuinely open, and which items only the owner can close. Keep workstream
sections separate so two agents editing at once conflict on one section rather than the file.

## Ground rules (from `AGENTS.md` — read it before editing)

- Truthful labels only. **Demo Data** for seeded values, **Not Connected** for absent providers.
- Row Level Security stays on for every exposed table, with FORCE RLS. Public-readable content
  is an explicit `anon` SELECT policy, never a disabled RLS.
- No credential, key, or secret in browser code, logs, fixtures, or database rows.
- Run `npm run lint && npm run typecheck && npm test && npm run build` before every commit.
- Playwright in this sandbox: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium-1194/chrome-linux/chrome`.
- Merging to `main` deploys production through Vercel. CI runs on `pull_request` and on push to `main`.

## Roadmap audit — 2026-08-14

Audited against `main`, with evidence, because the phase table and the repository
had drifted apart.

**Naming discrepancy, flagged rather than silently reconciled.** The roadmap labels
2B "Multi-agent teams" and 2C "Multi-project portfolio". The repository's own plans
use 2B = **Graph Engine** (`AI/PHASE_2B_IMPLEMENTATION_PLAN.md`) and 2C =
**Intelligent Agent & Resource Manager** (`AI/PHASE_2C_IMPLEMENTATION_PLAN.md`).
The "Phase 2C" that is built and merged is the Resource Manager — it is **not** the
roadmap's multi-project portfolio. Someone should decide which numbering is
canonical; until then both readings are in circulation and they disagree.

| Phase | Roadmap result | Actual state |
| --- | --- | --- |
| 1A Control plane | SoftwareFactory website | **Done.** Marketing site plus console under `/solutions`, merged. |
| 1B GitHub | Real repos/files/PRs | **Partial.** Owner path live; draft-PR-only writes work. Second tenant, reverse handoff, disconnect/loss and the adverse matrix are unproven. |
| 1C Codex + complete site | Bot Manager can command real engineering work | **Not achieved.** Worker is published; no successful live run has ever occurred. Provider credits exhausted, key removed as compromised, no factory branch or draft PR produced. |
| 1D Autonomous loop | GREEN work builds → tests → merges → deploys automatically | **Decision layer done; executor deliberately absent.** Kill switch is locked ON by CHECK constraint, all nine actions OFF, `MERGE_EXECUTOR_NOT_CONNECTED` / `DEPLOY_EXECUTOR_NOT_CONNECTED` asserted by test. `AGENTS.md` forbids introducing auto-merge in this line of phases, so the stated result is blocked by **policy**, not only by missing work. |
| 1E Production operations | Monitor → detect → fix → rollback | **~87% in-tree.** Monitor, detect, classify, protect, diagnose and repair-queueing are built and merged. "Fix" needs Codex execution; "rollback" has no executor by design. Migrations unhosted. |
| 2A Claude | Add Claude as another AI provider | **Built, Not Connected.** Adapter and schema exist; `ai_provider_execution_enabled` defaults OFF and no successful live call has been made. |
| 2B Multi-agent teams | Claude + Codex specialists work together | **0% implemented**, per the phase's own plan. No teams, orchestration, handoff persistence, parallel execution, or team UI exist. |
| 2C Multi-project portfolio | Factory manages all your repositories | **Not built as described.** The schema is multi-project and `operations_portfolio_summary` aggregates across projects, but exactly one repository is connected and there is no portfolio management surface. (The merged "Phase 2C" is the Resource Manager — a different thing.) |
| 3 Self-improving Factory | Factory audits and improves itself | **0%.** No plan document exists. |

### Not done, and therefore open

- [ ] **1B:** live second-tenant matrix, reverse/evidence-bound handoff, explicit
      disconnect and connection-loss states, and the remaining adverse cases
      (stale SHA, approval expiry, revoked permission). Needs a second real tenant.
- [ ] **1C:** one successful live Codex run producing a factory branch and draft PR.
      Blocked on a funded provider key and a registered worker. The previously
      pasted key is compromised and must not be used.
- [ ] **1D:** the merge and deploy executors. **Do not build these without an
      explicit owner decision** — `AGENTS.md` forbids introducing an auto-merge or
      production deployment workflow in this line of phases, and the tests that
      assert the blockers are supposed to fail when an executor is connected.
- [ ] **1E:** rollback execution (no deployment adapter; `AUTO_ROLLBACK.md`
      disables it), Codex-backed repair execution, continuous scheduled monitoring,
      and a first real observed production incident.
- [ ] **2A:** a successful live provider call, which needs a credential and the
      owner switch turned on.
- [x] **2B foundation started.** Migration `20260814001000` closes the graph's
      deadlock hole and adds the two tables that make a team a team:
      **cycle rejection** at write time (A→B→C→A satisfied every existing
      constraint and would have stalled the graph permanently and silently),
      readiness computed in the database, `task_dependencies_unsatisfiable` so a
      cancelled or failed prerequisite is distinguishable from ordinary waiting,
      `agent_handoffs` (append-only, bounded, secret-checked, and refusing a
      handoff to the same role because that would satisfy independent review with
      nobody independent), and `work_locks` conflicting on prefix **overlap in
      both directions** so `lib/` blocks `lib/operations/`.
- [ ] **2B remaining:** `teams` / `team_members` / `review_verdicts` tables, team
      composition as a pure function, the orchestrator loop, metrics over real
      runs, and the Team Detail UI. None of these need a credential; the live
      multi-agent demonstration does.
- [ ] **2C (roadmap: multi-project portfolio):** connecting more than one
      repository, and a portfolio surface that manages them. Distinct from the
      merged Resource Manager work.
- [ ] **3 (self-improving Factory):** no plan, no implementation. Should not begin
      before 1D's executor question is settled, because a Factory that improves
      itself is exactly the case the guardrails exist for.

## Repository status at a glance

| Workstream | State | Blocking item |
| --- | --- | --- |
| Phase 1B — GitHub App integration | Live for the owner repository path | Second-tenant and adverse lifecycle matrix |
| Phase 1D — autonomy controls | **Merged; decision layer complete, every action locked OFF** | Executors owned elsewhere |
| Phase 1E — production operations | **Merged; ~87% of objective in this tree** | Six unhosted migrations; no observed production target |
| Phase 2A — provider execution layer | Merged | Owner-enabled `ai_provider_execution_enabled` (defaults OFF) |
| Phase 2C — resource manager | **Merged; scoring, persistence, UI and routing built** | Unhosted migrations; no declared models; no provider run has ever executed |
| Bot fabric + marketing site | Merged | Hosted marketing migration |

Gates on current `main`: lint, typecheck, 149 files / 1674 tests, clean production build,
Playwright across desktop/tablet/mobile including axe.

**Owner actions are collected in `AI/HOSTED_APPLY_RUNBOOK.md`** — the exact unhosted migration
list, the order, and the real-PostgreSQL verification already done, so applying them is not blind.

---

## Phase 1D — autonomy controls

Merged to `main` as `62b5c5a` and `a00574e`. The **decision layer** of the loop: it decides what
is allowed, whether a change earned it, and who may say yes. It executes nothing.

`lib/autonomy/` — `controls` (nine actions, two scopes, most-restrictive-wins), `diff-risk`
(classifies the real diff, not a self-declaration), `gates` (GREEN set + enhanced set),
`agents` (deterministic Review/QA/Security), `approval` (tri-state, no self-approval),
`pipeline` (twelve stages), `autopilot` (selects, does not start), `retries` (bounded).
`lib/deploy/vercel.ts` — read-only deployment tracking, **Not Connected** without a token.

### If you are building the executor, read this first

`AI/PHASE_1D_IMPLEMENTATION_PLAN.md` §9 is the seam. In short: read the envelope from
`public.resolved_autonomy_controls(project_id)` rather than a project row, take the autopilot
queue in the order given, supply gate *results* rather than deciding whether they suffice, ask
`evaluateRetry` before retrying, and expect to be refused if you author and approve the same
change.

`CODEX_WORKER_NOT_CONNECTED`, `MERGE_EXECUTOR_NOT_CONNECTED` and
`DEPLOY_EXECUTOR_NOT_CONNECTED` are asserted by name in
`tests/integration/phase1d-loop-journey.behavior.test.ts`. Connecting an executor is **supposed**
to fail those assertions — update them deliberately rather than weakening them.

### Rules that must survive any change here

1. Approval is evaluated **after** the gates. Nothing may be approved past a failing check.
2. No self-approval, at any risk level, including for an owner.
3. A missing gate result is a blocker, never a pass.
4. Migration `20260813000500` relaxes nothing. Enabling any automatic action is a RED action
   needing a separate owner-approved migration — never a side effect of other work.

### Open, and owned by the owner

- Hosted migration `20260813000500` is unapplied. Every Supabase credential is unset in the
  agent environments checked, so an agent cannot apply it.
- `VERCEL_TOKEN` is unset, so deployment tracking reports **Not Connected**. The read adapter is
  built and will show live data the moment a token exists.
- Auto-merge stays absent while `AGENTS.md` forbids introducing the workflow.

## Phase 1E — production operations

Monitor → Detect → Classify → Protect → Diagnose → Rollback decision → Repair work →
Validate → Resolve. Full audit, per-section completion, integrations, security findings and
Phase 2A readiness live in `AI/PHASE_1E_IMPLEMENTATION_PLAN.md`.

### Done

- [x] Migration `028` — ten RLS + FORCE RLS tables, SEV1–SEV4 incident evidence, owner-scoped
      SECURITY DEFINER workflows, append-only evidence triggers, **zero new `service_role`
      table grants** so the verified migration-`026` ACL matrix is unchanged.
- [x] Migration `029` — per-project synthetic journeys whose step safety and profile coverage
      are CHECK constraints, so bypassing the route cannot bypass them.
- [x] Provider-neutral monitoring. One connected adapter: a bounded HTTPS probe that refuses
      loopback/private/CGNAT/link-local/metadata targets, does not follow redirects, and never
      reads a response body. Every other provider states its reason and unblocking condition.
- [x] Health `HEALTHY/DEGRADED/CRITICAL/UNKNOWN/PAUSED` with append-only history and a stored
      reason. No connected monitor resolves to **UNKNOWN**, never HEALTHY.
- [x] Incidents created automatically, deduplicated by fingerprint into one open incident per
      project, severity escalating upward only.
- [x] Automatic release freeze on SEV1/SEV2; owner-only resume, organization-wide stop, and
      reversal of that stop (which never silently lifts a per-project freeze).
- [x] Last Known Good resolved only from a deployment whose own validation passed; rollback
      eligibility fail-closed against `policies/AUTO_ROLLBACK.md`; a failed rollback cannot be
      recorded without escalating to SEV1 — a CHECK constraint, not application logic.
- [x] Deterministic Production Investigator returning cause, cited evidence, subsystem,
      confidence, recommended action and risk. No intermediate reasoning stored or returned.
- [x] Bounded self-healing: three attempts, escalation on the third, RED and above-ceiling work
      refused so the GREEN/YELLOW/RED policy is not bypassed.
- [x] Durable idempotent event queue covering all ten required event types.
- [x] Gated resolution: restoration, passing same-project validation, root cause, corrective
      action, and prevention for SEV1/SEV2. A green deployment closes nothing.
- [x] Operations console, per-project production detail, daily operations report, immutable audit.
- [x] End-to-end journey and failed-rollback escalation proven against the real migrated schema
      (`tests/integration/phase1e-incident-journey.behavior.test.ts`).

### Remaining

- [ ] **Owner-gated: apply the six unhosted migrations** to `qpuofpmagrmyamahqwxw`. The hosted
      ledger ends at `20260813001400`; everything after it is unhosted, and `20260813001500` needs
      its own fresh RED approval against a frozen SHA. Exact list, order and the real-PostgreSQL
      verification behind it: `AI/HOSTED_APPLY_RUNBOOK.md`. (Earlier entries here named `028`/`029`/
      `030`, which were stale — `028` has been hosted since the ledger reconciliation.)
      Reauthenticate the Supabase CLI as `surgeservicesllc@gmail.com` first — the currently
      selected profile is wrong/unauthorized. Until this runs, every Phase 1E surface reports
      **Not Connected** or **Unknown**, which is truthful.
- [x] First **real production observation** recorded — the shipped probe observed
      `https://www.theagoras.com` at 4/4 routes, 200, 190-933 ms. See
      `AI/PRODUCTION_OBSERVATION_EVIDENCE.md`. It surfaced two operational findings below.
- [ ] **Owner decision: Vercel Deployment Protection.** Both `*.vercel.app` hosts return `302` to
      `vercel.com/sso-api`, re-verified 2026-08-14. **Corrected framing:** this does *not* block
      monitoring. `https://www.theagoras.com` answers `200` and is a valid monitor target, so
      Protection can stay on — which is the better posture. What it genuinely blocks is observing a
      *specific deployment* by its `*.vercel.app` URL, which matters for per-deploy validation
      rather than uptime.
- [ ] **Owner decision: the `theagoras.com` aliases.** The open "remove or retain" review item now
      has evidence: with protection on, `www.theagoras.com` is the *only* public path to the
      application. Removing it takes the public site — including the marketing pages — offline.
- [ ] **Owner-gated: store** what the probe observes. Needs the unhosted chain applied plus a monitor
      row; until then the adapter can be exercised but the pipeline behind it cannot run.
- [ ] Authorize a scheduler identity for continuous monitoring. Checks are owner-triggered
      today. **Constraint: this must not widen `service_role`** — use a narrow SECURITY DEFINER
      ingest path, not table grants.
- [ ] Connect Vercel deployment status, and error-rate/latency telemetry. Both are Not Connected
      with no provider; error rate in particular cannot be derived from a single probe.
- [x] **Probe SSRF hardening closed.** A public hostname resolving to a private address is now
      refused at *connect* time via undici's `connect.lookup` (`lib/operations/guarded-lookup.ts`),
      not by resolving separately and checking the result — a separate resolve leaves the rebinding
      window open, because the second resolution is free to disagree with the first. Any blocked
      answer fails the whole lookup even when a public address was offered alongside it; filtering
      to the public one would be luck, not a control. `lib/operations/address.ts` covers both
      families including the IPv4-mapped forms — the hex spelling `::ffff:7f00:1` was a live bypass
      in the first implementation and is now a test.
- [x] Two concurrent-write races found and fixed by testing against a **real PostgreSQL**
      server rather than PGlite (migration `030`): simultaneous first signals dropped one
      occurrence on the incident fingerprint index, and concurrent rollback decisions
      collided on the attempt index. Both failed closed but surfaced raw `23505` errors.
      `tests/integration/phase1e-operations.concurrency.test.ts` guards both; it starts a real
      cluster and skips cleanly where no server binary exists.

### Deliberately not built (do not "fix" these)

- Rollback **execution** — no deployment adapter, `AUTO_ROLLBACK.md` disables it, migration
  `010` pins `auto_rollback` off. Every rollback records `EXECUTOR_NOT_CONNECTED`.
- Codex repair **execution** — Phase 1C is Not Connected. Repair work can now be *promoted* into
  the ordinary command queue, where it sits `queued`; nothing claims it without a registered
  worker and a provider credential.
- Synthetic **write** steps — declared and validated, recorded as `skipped`, never issued.
- Autonomous deployment or merge. `autonomous_release_allowed` returns false unconditionally.

### Invariants a future change must not break

`service_role` gains no new table privileges · the four append-only evidence tables stay
append-only · `production_monitors_enabled_requires_connection` (an unconnected monitor cannot
be enabled) · `rollback_operations_failure_escalates` (a failed rollback cannot be silent) ·
`incidents_resolution_requires_cause` · `synthetic_journeys_steps_are_safe` ·
`EXECUTOR_NOT_CONNECTED` stays unconditional in `autonomous_release_allowed`.

---

## Phase 2C — intelligent agent & resource manager

Audit in `AI/PHASE_2C_IMPLEMENTATION_PLAN.md`. Started; the scoring core is built and tested.

### Done

- [x] Audit. The headline finding: **Phase 2B's Graph Engine does not exist** (its own plan says
      0% implemented), so there is no "graph node" to route. The routable unit that does exist is
      the Phase 1C task DAG.
- [x] Fixed a duplicate migration version — `20260813000500` was claimed by both the marketing
      migration and the Phase 1E concurrency fix, which would have collided in the Supabase
      ledger. The latter is now `20260813001550`.
- [x] Capability registry (`lib/resources/capabilities.ts`): twelve work capabilities declared per
      agent **and** per model, with availability, context limits, and a project **allowlist**.
      Every rejection reason is collected, not short-circuited.
- [x] Observed history (`lib/resources/history.ts`): summaries refuse to compute below a minimum
      sample count, sub-population rates are `null` rather than `0`, predictions are marked
      evidenced or not, regret is not scored against a guess, and a standing preference needs both
      a larger sample and a real margin before it moves.
- [x] Circuit breakers (`lib/resources/breakers.ts`): per-fault thresholds and cooldowns, a
      changed fault class restarts counting, open breakers say when they will retry, and cooldown
      half-opens automatically.
- [x] Resource manager (`lib/resources/manager.ts`): deterministic-first gate, eligibility before
      scoring, QUALITY/SPEED/COST/BALANCED objectives, and the frozen rule that RED, judgement,
      security, architecture and synthesis work can never be pushed onto an economical model to
      save cost — an eligibility gate, not a weight, so no objective can outvote it. An owner
      override selects among eligible workers and can never make an ineligible one eligible.
- [x] 36 unit tests covering all of the above, plus 12 behavior tests driving the durable breaker
      through **separate calls** — a single-call test would pass against the in-memory version
      and prove nothing about the defect being fixed.

### Remaining

- [x] **Persist breaker state and routing decisions** (migration `20260814000100`, RLS + FORCE RLS,
      no `service_role` grants). This fixed a real defect rather than adding storage: a breaker
      folded in one request's memory starts closed every request, so three consecutive outages
      spread across three requests never reached a threshold of three and the breaker could
      never fire. `resource_breakers` is mutable state; `resource_breaker_events` and
      `resource_assignments` are append-only evidence. Thresholds are passed in from
      `lib/resources/breakers.ts` rather than copied into SQL, so the two cannot disagree.
      `lib/resources/store.ts` reads before a decision and writes after one, failing soft on a
      read (an unreadable breaker must not block work it never saw fail) and hard on a write (a
      lost fault observation looks like health).
- [x] **Candidates come from real tenant rows**, not code constants
      (`lib/resources/candidates.ts`): `agents` → agent profiles, `provider_model_configurations`
      → model profiles. Migration `20260814000200` adds owner-declared `strength_tier` and
      `context_limit_tokens` to the Phase 2A catalogue — additively, touching nothing
      `20260813001500` redefines. Both are **nullable, and null means undeclared, never a
      default**: undeclared strength resolves to the weakest tier so it cannot pass the
      strong-model gate, and undeclared context resolves to zero so nothing can be shown to fit.
      Only the six unambiguous Phase 2A capability names are mapped — `reporting` is deliberately
      not mapped to `synthesis`, because `synthesis` gates work onto strong models.
- [x] **Resource Manager UI** at `/solutions/resources`, reading `GET /api/resources/overview`.
      Shows breakers with fault explanation and cooldown, transitions, and per-decision candidate
      evidence with eligibility and named rejection codes. Almost every panel is legitimately
      empty, so each says *which kind* of empty it is: "nothing has failed here" is not "proven
      healthy", and an unevidenced prediction shows "No recorded history" rather than 0%. The
      Execution card shows `—` while loading rather than defaulting to "Not Connected", because
      that is a state read from the server, not a fallback.
- [x] **`POST /api/resources/route`** routes one unit of work against the organization's real
      agents, models and stored breaker state, and records the decision with `recordAssignment`.
      It selects; it starts nothing — no claim, no token, no provider call, asserted by
      `tests/integration/phase2c-routing.contract.test.ts`. An unconfigured organization returns
      `NO_CANDIDATES_CONFIGURED` rather than a routing failure, because "no eligible worker" and
      "nobody declared any models" have different fixes. A decision that cannot be stored is still
      returned, marked unrecorded, so a persistence problem does not masquerade as a routing one.
- [ ] Call it from the Phase 1C task DAG so tasks route automatically rather than on request. Left
      undone deliberately: the claim path is hosted and live, and nothing executes anyway, so
      changing it now buys no behavior and risks conflicting with concurrent agents.
- [x] **Phase 1E → Phase 1C gap closed in code.** `lib/operations/promotion.ts` assembles a valid
      Phase 1C command from a diagnosis, proven against the *real* `submit_command`: keys match the
      allowlist exactly, a command and task are created, promotion is idempotent per repair attempt,
      and a security-shaped repair is forced to RED and `awaiting_approval` — no privileged lane.
      `POST /api/operations/incidents/[incidentId]/promote` (owner-only) submits it with a **live**
      `baseSha` from an installation-token branch read, and `link_repair_promotion` (migration
      `20260813001700`) records the link under re-validated preconditions, because a route can be
      bypassed and a SECURITY DEFINER function cannot. A release freeze does not block promotion;
      the emergency stop does. See `AI/PHASE_1E_TO_1C_INTEGRATION_GAP.md`.
- [ ] **Blocked on credentials:** queues, dynamic concurrency, and the budget ladder need a worker
      pool that executes. Specified in the plan, deliberately not simulated.
- [ ] **Blocked on credentials:** objective §16's "historical-performance routing improvement"
      cannot be shown on real data. No provider run has ever executed — `ANTHROPIC_API_KEY` and
      `OPENAI_API_KEY` are absent (verified), so there is no history. The machinery is built and
      tested against recorded fixtures and **abstains** rather than inventing numbers.

---

## Bot fabric + marketing site

Merged into `main`. Route groups: `app/(marketing)/` public and indexable, and
`app/(portal)/` authenticated, which serves the whole control plane under `/solutions` with the
global navigation above the sidebar shell (ADR-041). Every marketing page is a Server Component reading through
`lib/marketing/queries.ts`, which never throws — it falls back to seeded content and marks the
response `source: "seed"` so the UI labels it honestly.

### Remaining

- [ ] **Owner-gated: host the marketing migration.** Until then pages render the seeded
      fallback and say **Demo Data**. The schema, policies, grants and `subscribe_to_newsletter`
      already pass a 21-assertion behavioral matrix against real PostgreSQL as the real `anon`
      and `authenticated` roles — keep `tests/integration/marketing-rls-behavior.test.ts`
      passing; it is the guard on the public-read boundary.
- [ ] After hosting, re-run those assertions against the hosted project with a real anon key and
      record the evidence in `AI/QUALITY_SCORECARD.md`.
- [ ] Replace placeholder leadership headshots and third-party wordmarks with licensed assets.
- [ ] Per-page OG images (`opengraph-image.tsx` per route).
- [ ] Optional: an authenticated owner/admin editor UI for marketing content, audited, so copy
      can change without SQL.

### Design notes

- Marketing palette: near-black `#080b10` ground, `#0d1118` panels, violet→blue gradient
  (`#7c5cff` → `#4d8dff`) for accents and headline spans, one accent per card row.
- The console palette (lime `#c6f135`) is deliberately **not** reused on marketing pages. Keep
  the two visual systems separate; only shared primitives cross over.

---

## Phase 1B — GitHub App integration

Live for the owner repository path through candidate App `4582606`, installation `153479019`.
Primary installation `153445938` stays active as the rollback boundary.

### Remaining

- [ ] Observe the rollback window and exercise the evidence-bound reverse handoff before
      retiring any primary access. Support ticket `#4660724` stays open for the primary webhook.
- [ ] Live two-tenant, anonymous and privileged-RPC matrix with real caller sessions. Only one
      real user/email is authorized, so this cannot be faked locally.
- [x] **Adverse lifecycle now covered against the real migrated schema**
      (`tests/integration/github-adverse-lifecycle.behavior.test.ts`, 9 tests). These had
      **zero** coverage and are the states the integration enters once something has already
      gone wrong — where a control that silently does nothing costs most and is noticed least.
      Approval expiry (an expired row still reads `approved`; only the expiry distinguishes it),
      owner-only decision, connection loss with history preserved, repeated loss converging on
      one end state, disconnect refused against a mismatched installation id, rows retained
      through disconnect, cross-tenant refusal of every privileged function, anonymous denial,
      and member read-without-mutate.
      Three assumptions the schema corrected: approvals cannot be created already-approved;
      loss reasons are an allowlist; and `decide_approval` refuses a non-owner **outright**
      rather than recording a decision that later fails validation — the stronger guarantee,
      because no approved-looking row ever exists to be misread.
- [ ] Still open: stale-SHA rejection, rate-limit handling that must not falsely revoke a
      connection, and webhook provider ordering. Each needs a mocked GitHub response rather
      than schema alone.
- [ ] Configure and verify isolated Preview Supabase values.

---

## AgentOS — least-privilege agent operating system

Source: the AgentOS blueprint gist (reconstructed from a Danny Postma talk). Full spec kept at
`docs/AGENTOS_SPEC.md`. **The spec is a single-operator product; this repository is a
multi-tenant control plane.** Where they disagree, `AGENTS.md` wins:

- Every new table is tenant-scoped with RLS **and** FORCE RLS. The spec's single-operator model
  is not a licence to drop tenancy.
- The spec's local runner ("`--dangerously-skip-permissions`", "Grok in yolo mode") is a
  **routing target, not an authority grant**. Execution stays behind the existing interlocks;
  connecting a runner does not enable an automatic action.
- Goals that "run 5–6 hours and open a PR" are built as decision + queue machinery. The
  execution half stays gated exactly like Phase 1C/1D, and surfaces say **Not Connected** until
  an owner connects one.
- Reconstructed prompts carry the spec's required header comment and are labelled as such.

### What already exists and maps directly

| Spec entity | Here |
|---|---|
| Project, Agent, Task, Session, Activity | `projects`, `agents`, `tasks`, `agent_runs`, `activity_events` |
| Approval gate | `approvals` + the RED owner-approval path, which is stricter than the spec |
| Secret (reference, never a value) | bot fabric credential **references** (`bots.credential_env_var`) |
| Runner routing | Phase 2A provider routing (`lib/providers/routing.ts`) |
| Ephemeral session lifecycle | Phase 1C worker: clone → work → draft PR → destroy |
| Least-privilege default-deny | RLS + FORCE RLS + service-role confinement |

### The gap — build in this order

**A. Isolation model (spec §5, its own "first-class" requirement).** Nothing else is safe to
attach until grants exist.

- [ ] `environments` — `networking: open | limited`, `allowed_hosts[]`. The second wall: a
      `limited` environment blocks every host not listed, independent of which MCPs are attached.
- [ ] `mcp_connections` — transport config plus a `credential_secret_ref`, never a token.
- [ ] `skills` — `prompt` | `file`, attached per agent (plan-mode is a skill).
- [ ] `agent_grants` — the default-deny join: MCP ids, repo access with `git-read`/`git-write`,
      filesystem grants with **separate** `can_read`/`can_write`/`can_delete`, collaboration
      list, environment, inbox access.
- [ ] Enforcement is server-side, not honour-system: a verb an agent lacks is refused by the
      API, and a path outside a granted prefix is refused before any storage call.

**B. Filesystem MCP (spec §7).** Blob store behind an MCP with per-folder ACLs. Agents never get
a raw bucket SDK or a mount. `fs.list/read/write/delete/mkdir`, each authorized separately.

**C. Inbox (spec §12).** `inbox_messages` with `text` | `multiple-choice`, and the resume
semantics: answering an open message continues the waiting session with the answer in context.
This is the only human channel — no second chat product.

**D. Templates, gates, chains (spec §9–10).** `task_templates` + instantiation into a blocked
chain, and the built-in `compound-engineer-workflow` (9 steps, spec approval and human PR review
gated). Step N+1 stays `todo` until step N is `done`, and an agent token can never set `done` on
a gated step.

**E. Goals / gauntlet loop (spec §11).** `goals` with a human-approved definition of done, an
append-only progress log, and the three rails: spend cap, max duration, stuck-at-19. A goal
without an approved DoD does not start; a goal without a spend cap requires explicit confirmation.

**F. Triggers + automations (spec §14–15).** Signed inbound webhooks that spawn a scoped job, and
named cron automations. Payloads are sanitized before they reach a prompt.

**G. CLI + YAML (spec §17).** `agentos.yml` per project, `push`/`pull` round-trip.

**H. PWA, live session viewer, activity feed (spec §13, §12).** Installable, push on
"needs help" and "done"; tool calls streamed live and replayable afterwards.

### Acceptance tests the spec requires (§22)

Ship these as real tests, not aspirations: session destroy leaves no reusable workspace;
write/delete/path-escape all refused without the matching grant; an agent cannot invoke an MCP
the project has but it was not granted; a `limited` environment cannot reach an unlisted host;
an agent token gets 403 on a gated `done`; a 9-card chain respects order and interpolates
variables; inbox reply resumes a session; each goal rail sets its own `stopped-*` state; a bad
webhook secret is 401; YAML push/pull is identity.

### Deliberately not built

Multi-user teams and billing (not described), Slack/email channels (inbox is the channel),
persistent containers, raw cloud credentials for agents, and the spec's own out-of-scope list.

## Open questions for the owner

1. **Hosted migration queue.** Migrations `011`–`029` plus the marketing migration are unhosted.
   Confirm the order, and whether content-only migrations may be promoted ahead of the tenant
   chain since they touch no tenant data.
2. **Production monitoring target.** Which deployed URL should the first real monitor observe,
   and at what failure threshold? Nothing is monitored until this is answered.
3. **Scheduler identity.** Continuous monitoring needs one. Confirm the approach before an agent
   builds it, because the obvious implementation (granting `service_role`) is the wrong one.
4. **Vercel connection.** A server-only token would connect deployment status, failed-deploy
   signals, and eventually rollback execution. Currently Not Connected by absence, not design.
5. **`main` is unprotected** and release commits are unsigned. Enabling branch protection,
   required checks, or signature requirements is an owner-approved protected action.
6. **`theagoras.com` Vercel aliases** are unexplained. Verify ownership and routing intent
   before retaining or removing them.
