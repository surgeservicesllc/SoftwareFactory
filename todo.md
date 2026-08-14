# SoftwareFactory — shared working status

Last updated: 2026-08-14 (Phase 2B graph engineering, stages 1–3, open in PR #27)
Current `main`: `438a370` — Phase 2C Resource Manager UI
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

## Repository status at a glance

| Workstream | State | Blocking item |
| --- | --- | --- |
| Phase 1B — GitHub App integration | Live for the owner repository path | Second-tenant and adverse lifecycle matrix |
| Phase 1D — autonomy controls | **Merged; decision layer complete, every action locked OFF** | Hosted migration `20260813000500`; executors owned elsewhere |
| Phase 1E — production operations | **Merged; ~85% of objective** | Hosted migrations `028`/`029`; no observed production target |
| Phase 2A — provider execution layer | Merged | Owner-enabled `ai_provider_execution_enabled` (defaults OFF) |
| Phase 2B — graph engineering | **Open in PR #27**; stages 1–3 built, hosted schema applied | Provider credentials for every live demonstration |
| Phase 2C — resource manager | Merged; scoring core, persistence and UI | Hosted migration `20260814000300`; wiring into the Phase 1C DAG |
| Bot fabric + marketing site | Merged | Hosted marketing migration |
| Sign-up and sign-in | Merged (PR #15) | Custom SMTP; the owner account is unconfirmed |

Gates on PR #27 (`c83c3d9`): lint, typecheck, 135 files / 1602 tests, clean production build,
Playwright green. CI run
[`31822563019`](https://github.com/surgeservicesllc/SoftwareFactory/actions/runs/31822563019).

---

## Blocking the product, and only the owner can close them

- [ ] **Confirm `Daniel.Hughen@gmail.com` by hand.** Supabase → Authentication → Users → row
      menu → Confirm email. No confirmation mail will arrive until SMTP exists, and the
      super-administrator role requires a confirmed address, so this also switches on admin
      access.
- [ ] **Configure custom SMTP** (Supabase → Authentication → Emails). Required, not optional:
      `enable_confirmations` is on and the built-in mail service allows a couple of messages an
      hour and is not meant to reach end users. Until this lands nobody new can create a usable
      account. `scripts/configure-auth-email.sh` and `supabase/config.toml` already carry the
      `SUPABASE_AUTH_SMTP_*` contract.
- [ ] **Delete the diagnostic account `sf-probe-a91c@gmail.com`.** Created while reproducing the
      sign-up defect using an invented address that does not exist; its confirmation email
      hard-bounced and Supabase warned that sending privileges are at risk.

### Security — rotate these

- [ ] **Rotate the `sb_secret_` Supabase key** exposed in a screenshot, and update the Vercel
      environment variable.
- [ ] **Rotate the `sbp_` Supabase personal access token** pasted into a session transcript.

### AI providers — blocks every live Phase 2B demonstration

- [ ] Set server-only `ANTHROPIC_API_KEY`.
- [ ] Set server-only `OPENAI_API_KEY` and `OPENAI_DEFAULT_MODEL`. The current OpenAI project
      reported `credit_balance_exhausted`, so it also needs funding.
- [ ] Enable the outbound provider execution switch in Settings.
- [ ] Both providers are needed, not one: cross-provider verification degrades or fails closed
      with a single provider.

### Infrastructure

- [ ] **Automatic CI is intermittent, not fixed.** It stopped firing on `pull_request` from
      2026-08-13 19:32Z, fired automatically for two pushes on 2026-08-14, then stopped again.
      Every run on PR #27 has been manually dispatched. Until the cause is found, treat a green
      PR as green only when an Actions run actually exists for its head commit — the absence of
      a run looks identical to a run that has not started yet.
- [x] **Migration ledger repaired** (2026-08-14). The ledger now holds 45 rows through
      `20260814000200`, and no repository migration is unrecorded.
- [x] **Second duplicate migration version resolved** (2026-08-14). Merging `main` into PR #27
      put two files on version `20260814000100`: `graph_engineering` (this branch) and
      `phase2c_resource_persistence` (main). `graph_engineering` is already applied to hosted
      and recorded in the ledger, so its filename cannot move; `phase2c_resource_persistence`
      is unhosted, so it was renamed to `20260814000300` — the same resolution the earlier
      `20260813000500` collision took. Left unresolved, the ledger would have treated the
      Phase 2C migration as already applied and it could never have been hosted.

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

- [ ] **Owner-gated: apply hosted migrations `028`, `029` and `030`** to `qpuofpmagrmyamahqwxw`.
      Reauthenticate the Supabase CLI as `surgeservicesllc@gmail.com` first — the currently
      selected profile is wrong/unauthorized. Until this runs, every Phase 1E surface reports
      **Not Connected** or **Unknown**, which is truthful.
- [x] First **real production observation** recorded — the shipped probe observed
      `https://www.theagoras.com` at 4/4 routes, 200, 190-933 ms. See
      `AI/PRODUCTION_OBSERVATION_EVIDENCE.md`. It surfaced two operational findings below.
- [ ] **Owner decision: Vercel Deployment Protection.** Both `*.vercel.app` hosts return `302`
      to Vercel SSO for every route, so no external monitor can observe the URLs recorded as
      production. Monitoring must target the custom domain, or protection must change.
- [ ] **Owner decision: the `theagoras.com` aliases.** The open "remove or retain" review item now
      has evidence: with protection on, `www.theagoras.com` is the *only* public path to the
      application. Removing it takes the public site — including the marketing pages — offline.
- [ ] **Owner-gated: store** what the probe observes. Needs hosted `028`/`029`/`030` plus a monitor
      row; until then the adapter can be exercised but the pipeline behind it cannot run.
- [ ] Authorize a scheduler identity for continuous monitoring. Checks are owner-triggered
      today. **Constraint: this must not widen `service_role`** — use a narrow SECURITY DEFINER
      ingest path, not table grants.
- [ ] Connect Vercel deployment status, and error-rate/latency telemetry. Both are Not Connected
      with no provider; error rate in particular cannot be derived from a single probe.
- [ ] Probe hardening: a public hostname that resolves to a private address at DNS time is not
      detected. Needs resolve-then-connect-by-IP handling.
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

## Phase 2B — graph engineering

Open in **PR #27** (draft). `Goal → Graph Planner → Dependency Analysis → DAG → Parallel Nodes →
Reduce → Independent Verification → Synthesis → QA/Security → existing 1D/1E gates`. Plan in
`AI/PHASE_2B_IMPLEMENTATION_PLAN.md`, design in `AI/GRAPH_ENGINEERING.md`, ADR-056.

The governing bias is a refusal: **most work is not a graph.** `selectTopology` defaults to
`SINGLE_AGENT` and makes every richer topology earn its place. This adds no second release
pipeline — it terminates in the existing Phase 1D/1E gates.

### Stage 1 — engine core — done

Eleven pure modules in `lib/graph/`, 61 tests. Topology selection, fake-edge removal, typed
contracts, DAG scheduler, deterministic reducers, fan-in guards, verification quorum, budgets,
frozen policies, discovery stop conditions.

### Stage 2 — durability — done, and applied to hosted

- [x] Thirteen tenant-scoped tables in `20260814000100_graph_engineering.sql`, all RLS + FORCE
      RLS, member-read-only, with no browser write grants.
- [x] Work locks with heartbeat, expiry and abandoned-lock recovery, enforced by a partial
      unique index on `state = 'HELD'` rather than by the scheduler remembering.
- [x] Write boundary (`20260814000200_graph_write_boundary.sql`): seven SECURITY DEFINER
      functions are the only way anything is written, and self-verification is refused.
- [x] **Applied to hosted and verified**: 73 public tables at the time, all with RLS and FORCE
      RLS, seven write-boundary functions present, zero EXECUTE grants to `anon`.
- [x] Graph compiler and handoff preparation, rejecting cycles, dangling dependencies, duplicate
      keys, entry-less graphs and unresolved write conflicts before anything is spent.

### Stage 3 — execution — at its credential boundary

- [x] Node runner: drives the scheduler, owns attempts and retries, rejects contract-violating
      output, degrades and stops on budget, and refuses to call a run complete when a node never
      reported. Execution, time and locking are injected, so retry, fallback, degradation and
      partial completion are all tested without a credential.
- [x] Provider bridge: capability → task kind, per-tier output-token ceilings, node risk into
      routing, excluded providers for fallback. Deterministic nodes are refused a provider call.
- [x] Integration nodes: wait for declared branches, refuse to integrate when two wrote the same
      resource, refuse partial integration unless the plan opted in, and carry the incompleteness
      caveat even when it did.
- [x] Anchors: a claim that gets acted on must be backed by an observation rather than an
      assertion. Contradicting evidence refutes rather than supports, wrong-kind and state-only
      evidence do not count, stale evidence is discarded, and only an explicit CI `success` reads
      as a pass.
- [x] Lock coordination: a global acquisition order that makes deadlock impossible rather than
      unlikely, all-or-nothing acquisition, contention distinguished from real failure, and wave
      planning so contention is resolved by scheduling rather than by collision and retry.
- [ ] **Blocked on credentials:** assemble the bridge into a live `executeNode`. Written and
      unit-tested against stub responses; its first real call needs a provider key.
- [ ] Fan-out onto isolated workspaces. `lib/worker/workspace.ts` already supports concurrent
      isolation; nothing fans out to it until nodes execute.
- [ ] Persist anchors against node runs and verifications. The evidence model exists; the
      persistence for it does not, and it is only meaningful once real runs produce anchors.

### Stage 4 — surfaces — not started, and buildable without credentials

- [ ] Graph templates (production readiness, security audit, RLS audit, bug sweep, test coverage,
      refactor sweep, dependency audit, performance audit, mobile audit, code review, feature
      build, incident investigation, SEO/AEO audit), with clone/save/version.
- [ ] Workflows UI: visual nodes and edges, node detail, status, budget, concurrency, locks,
      verification, artifacts, anchors, timeline.
- [ ] Bot Manager proposes an execution summary before running.
- [ ] Graph observability: critical path, parallelism, latency, retries, verifier rejection,
      reduction ratio, completion, missing inputs.
- [ ] Conservative graph optimizer recommendations.

### Stage 5 — demonstrations — all blocked on provider credentials

- [ ] A. A simple task takes the single-agent path with no graph overhead.
- [ ] B. Wide audit: 20+ independent nodes, fan-out, verification, reduction.
- [ ] C. Code feature: plan → parallel Codex → integration → fresh review → gates.
- [ ] D. Silent failure: one node fails and the graph refuses to claim completion.
- [ ] E. Hidden conflict: two nodes contend and the lock prevents unsafe parallelism.
- [ ] F. Discovery terminates on the no-new-findings condition.
- [ ] G. Budget degrades and stops gracefully at the limit.

---

## Phase 2C — intelligent agent & resource manager

Audit in `AI/PHASE_2C_IMPLEMENTATION_PLAN.md`. Started; the scoring core is built and tested.

### Done

- [x] Audit. Its headline finding — that Phase 2B's graph engine did not exist, so there was no
      "graph node" to route — **was true when written and is now stale**: the engine, its durable
      schema and its runner are built in PR #27. The Phase 1C task DAG remains the routable unit
      that is wired up today; graph nodes become routable once the manager is wired into either.
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
- [ ] Capability profiles are still code constants, not per-organization rows. Declaring them in
      the database needs a decision about whether they extend `provider_model_configurations` or
      sit beside it; not worth guessing.
- [x] **Resource Manager UI** at `/solutions/resources`, reading `GET /api/resources/overview`.
      Shows breakers with fault explanation and cooldown, transitions, and per-decision candidate
      evidence with eligibility and named rejection codes. Almost every panel is legitimately
      empty, so each says *which kind* of empty it is: "nothing has failed here" is not "proven
      healthy", and an unevidenced prediction shows "No recorded history" rather than 0%. The
      Execution card shows `—` while loading rather than defaulting to "Not Connected", because
      that is a state read from the server, not a fallback.
- [ ] Wire the manager into the Phase 1C task DAG so real nodes route through it, and record each
      decision with `recordAssignment`.
- [ ] Wire the manager into the Phase 1C task DAG so real nodes route through it.
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
- [ ] Remaining adverse cases: stale SHA, approval expiry, revoked/insufficient permission,
      rate limit, provider ordering, terminal deletion/restore, idempotent recovery.
- [ ] Verify explicit disconnect/loss state and history preservation.
- [ ] Configure and verify isolated Preview Supabase values.

---

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
