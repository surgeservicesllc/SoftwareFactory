# SoftwareFactory — shared working status

Last updated: 2026-08-14 (Phase 2B graph engineering, stages 1–5, open in PR #27)
Current `main`: `5c28f57` — AgentOS goals
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
| Phase 2B — graph engineering | **Open in PR #27**; stages 1–5, 6 of 7 demonstrations passing | Provider credentials for the live model calls only |
| Phase 2C — resource manager | Merged; scoring core, persistence and UI | Hosted migration `20260814000300`; wiring into the Phase 1C DAG |
| Bot fabric + marketing site | Merged | Hosted marketing migration |
| Sign-up and sign-in | Merged (PR #15) | Custom SMTP; the owner account is unconfirmed |

Gates on PR #27 (`c83c3d9`): lint, typecheck, 135 files / 1602 tests, clean production build,
Playwright green. CI run
[`31822563019`](https://github.com/surgeservicesllc/SoftwareFactory/actions/runs/31822563019).

---

## If you are picking this up cold

PR **#27** (draft, branch `claude/github-connection-confirm-qe3tqm`) carries all
of Phase 2B. `main` moved four commits during it and was merged in at `2a223b1`;
re-check mergeability before doing anything, because two workstreams are landing
concurrently.

**Start here, in this order:**

1. **Read `AI/PHASE_2B_DEMONSTRATIONS.md`.** It states exactly what is proven
   without a credential and what is not. Do not re-litigate that boundary; it is
   the honest one and it was got wrong once already (stage 5 was recorded as
   fully credential-blocked when six of seven demonstrations needed no
   credential at all).
2. **Everything still outstanding in Phase 2B needs a provider key.** Do not
   simulate it. `lib/graph/provider-bridge.ts` is written and unit-tested against
   stubs and is the seam a live `executeNode` plugs into; `lib/graph/anchor-store.ts`
   is the seam for recording what that run observed.
3. **Migration `20260814002200` is unhosted**, like every other migration added
   since the ledger repair. Applying it is an owner-gated action.

**Two traps that have already cost time:**

- **Migration versions collide across workstreams — now caught by a test.**
  `tests/integration/migration-versions.contract.test.ts` fails on any duplicate
  version prefix and its message carries the fix. If it fails for you, the rule
  is: **an applied filename cannot move, an unhosted one can** — check
  `AI/DECISIONS.md` for hosted status and renumber the unhosted one.
  This branch's unhosted migrations now sit at `20260814002000`+ deliberately.
  AgentOS was advancing one slot per merge (`000300` → `000700`) and taking
  whichever version this branch had just moved to, so stepping one ahead each
  time simply collided again. Leaving a gap is what stopped it. **If you add a
  migration to a long-running branch, leave room rather than taking the next
  slot** — the next slot is exactly what the other workstream will take.
- **Automatic CI is intermittent.** A missing run and a not-yet-started run look
  identical. Confirm an Actions run exists *for the head SHA* before believing a
  PR is gated, and dispatch `ci.yml` manually if none does.

Verify by exit code, not by reading output — an `&&`-chained gate command masked
a real typecheck failure earlier in this work.

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
- [ ] **Apply the ten unhosted migrations.** Verified against hosted on 2026-08-14: the ledger
      holds **45 rows** with a high-water mark of `20260814000200`, while the repository has
      **55** migrations. Nothing in the ledger is missing from the repository. The ten unapplied
      are `20260813001550`, `20260813001700`, the five AgentOS migrations
      (`20260814000300`–`000700`), `20260814002000_phase2c_resource_persistence`,
      `20260814002100_declare_model_strength_and_context`, and
      `20260814002200_graph_anchors`. Note the first two sort **below** the high-water mark, so
      they were skipped rather than deferred.
      **An agent cannot apply these**: writing to hosted Supabase is refused by the Claude Code
      auto-mode classifier, which is the correct guard for a RED action against production. This
      needs the owner, or an explicit permission rule.
- [x] **Migration ledger repaired** (2026-08-14). The earlier repair holds: no repository
      migration below the high-water mark is unrecorded except the two named above, and no
      ledger row lacks a repository file.
- [x] **Second and third duplicate migration versions resolved** (2026-08-14). Each `main` merge
      into PR #27 produced one. First `20260814000100`: `graph_engineering` (this branch, hosted)
      against `phase2c_resource_persistence` (main, unhosted) — the latter renamed to
      `20260814000300`. Then `20260814000200`: `graph_write_boundary` (this branch, hosted)
      against `declare_model_strength_and_context` (main, unhosted) — the latter renamed to
      `20260814000400`. Both follow the rule the earlier `20260813000500` collision set: the
      applied filename cannot move, the unhosted one can. Left unresolved, the ledger would
      treat the losing migration as already applied and it could never be hosted.
- [x] **Fourth and fifth collisions resolved, and the class is now closed by a test** (2026-08-14).
      Merging `main` at `6340c4f` brought AgentOS migrations claiming `20260814000300` and
      `20260814000400`, the two versions this branch had used for its earlier renames. Since the
      AgentOS files are on the trunk and both sides were unhosted, this branch's two moved on to
      `20260814000500` and `20260814000600`.
      `tests/integration/migration-versions.contract.test.ts` now fails on any duplicate version
      prefix, on a malformed filename, and on a version that sorts out of order. It was verified
      against a deliberately introduced duplicate rather than assumed to work. Five collisions in
      two days were each caught by hand; catching it by hand is what fails the time nobody looks.
- [ ] ~~**The collisions will recur.**~~ Superseded by the guard test above. Two workstreams pick
      timestamps independently with nothing to stop them agreeing. Worth a convention (per-phase
      version ranges, or a pre-commit check that fails on a duplicate version prefix) rather than
      catching it by hand each time.

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
- [x] **Fan-out onto isolated workspaces** (`lib/graph/fan-out.ts`). A node that writes always
      gets its own checkout, even alone — a writer in a shared checkout is a landmine for
      whatever runs next. Read-only nodes share one, since cloning per reader buys no safety.
      Allocation is bounded and a writer that does not fit is **deferred rather than run
      unisolated**: a bounded delay always beats the silent corruption of one agent's work
      vanishing from a branch that still builds and still passes. Acquisition is injected, so
      the coordination is proven without a token; the git clone behind it is not.
- [x] **Anchor persistence** (`20260814002200_graph_anchors.sql`, `lib/graph/anchor-store.ts`).
      Four RLS + FORCE RLS tables, no browser write grants, two SECURITY DEFINER functions.
      The load-bearing decision: **the database decides whether a claim is anchored.**
      `record_claim_anchoring` is handed anchor IDs, not a verdict — it looks each one up, checks
      the kind is acceptable for the claim and that the observation passed, and computes
      `anchored` itself. A caller can offer evidence and be told; it cannot assert support.
      Contradicting anchors are stored but not linked to the claim, because they are the reason
      it failed. Evidence borrowed from another run is ignored, a future-dated observation is
      refused, and a claim cannot be re-decided on the same node run — otherwise a refusal could
      be retried until something stuck.

### Stage 4 — surfaces — done

- [x] **Thirteen graph templates** (`lib/graph/templates.ts`) with clone and version. A template
      is a starting plan, not a guarantee: the compiler still strips imaginary dependencies and
      still picks the topology on evidence, so a template naming twelve nodes can legitimately
      compile down to `SINGLE_AGENT`. Every template is asserted to compile, because one that
      fails at the moment someone uses it is worse than no template. Cloning and revising never
      mutate in place — a completed run records the template version it used, and two node sets
      sharing a version would make that record a lie.
- [x] **Workflows UI** at `/solutions/workflows`. Everything shown is *compiled*, not drawn:
      topology, layering, node contracts, removed dependencies and lock waves all come from the
      same code that would schedule the work, so the page is exact without a credential. Run-time
      panels are empty and say which kind of empty — "no runs recorded" is not "all runs
      succeeded".
- [x] **Bot Manager execution summary** (`components/graph-execution-summary.tsx`): what a graph
      would do before it does it. It states shape, width and how many nodes call a paid model, and
      deliberately refuses to state a cost — token counts are not knowable in advance and a
      confident wrong number gets budgeted against.
- [x] **Graph observability** (`lib/graph/observability.ts`): critical path weighted by real node
      time, achieved against planned parallelism, retries, verifier rejection, reduction ratio,
      completion. Efficiency and trust are kept apart, and every rate is `null` rather than `0`
      over zero observations, because "nothing was rejected" and "nothing was checked" are
      opposite facts. A run with a node that never reported is not whole however much finished.
- [x] **Conservative optimizer** (`lib/graph/optimizer.ts`): recommends, never rewrites. Needs
      three observed runs before any structural suggestion, states a tradeoff and evidence on
      every one, and cannot propose removing verification, weakening a lock, or lowering the tier
      of judgement work. Its most valuable recommendation is the one an orchestration engine is
      least inclined to make: this did not need to be a graph.

### Stage 5 — demonstrations — six of seven done

Evidence: `tests/integration/graph-demonstrations.test.ts` (19 passing, 1
skipped). Written up in `AI/PHASE_2B_DEMONSTRATIONS.md`.

**These were previously recorded as "all blocked on provider credentials". That
was wrong**, and the correction is worth keeping: the runner takes an injected
`executeNode`, so every decision the *engine* makes — topology, edge removal,
scheduling, retry, contract enforcement, fan-in, budget, discovery, locks — is
provable with a scripted executor. Only the claim that a *real model* satisfies
these contracts needs a credential.

- [x] A. A simple task takes the single-agent path. Two dependent steps, one
      node, and a five-node chain all refuse to become a scheduled graph.
- [x] B. Wide audit: 20 independent nodes compile to `DIAMOND` at width 20 and
      the runner dispatches all 20 in one batch — asserted by recording the
      widest in-flight count rather than trusting the plan. Reduction collapses
      20 duplicates to 1.
- [ ] C. Code feature: **shape proven, live run skipped.** Three parallel
      branches converge on integration and the reviewer runs only after an
      anchor observed the tests. The live half needs a provider credential and a
      registered Codex worker; it is `skipIf`-skipped so it starts *running*
      when credentials land rather than starting to fail.
- [x] D. Silent failure: a failed node blocks its dependants and nothing else,
      prose where structure was required is rejected at the boundary, and a node
      that never ran counts as missing rather than as failed or succeeded.
- [x] E. Hidden conflict: two writers of one file refuse to compile; declaring
      the conflict resolved puts them in separate lock waves; a read-after-write
      edge nobody proposed is discovered from declared resources.
- [x] F. Discovery stops on two quiet rounds, stops at the round ceiling, and
      cannot be sustained by unverified candidates.
- [x] G. Budget reduces concurrency, then stops gracefully keeping finished work;
      a failed call is charged (3 × 500 = 1500 tokens); no cost is invented when
      pricing is undeclared.

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
