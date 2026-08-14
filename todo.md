# Open work

Last updated: 2026-08-14 (Stage 3 in progress).

Everything currently open, ordered by whether it needs you or needs me.
Detail lives in `AI/BACKLOG.md` and `AI/PHASE_2B_IMPLEMENTATION_PLAN.md`; this
is the single page that says what is actually outstanding.

---

## Needs the owner — nothing proceeds without these

### Blocking people from using the product

- [ ] **Confirm `Daniel.Hughen@gmail.com` by hand.** Supabase → Authentication →
      Users → row menu → Confirm email. No confirmation email will arrive until
      SMTP exists, and the super-administrator role requires a confirmed
      address, so this also switches on admin access.
- [ ] **Configure custom SMTP** (Supabase → Authentication → Emails). Required,
      not optional: `enable_confirmations` is on and the built-in mail service
      allows a couple of messages per hour and is not meant to reach end users.
      Until this lands, nobody new can create a usable account.
      `scripts/configure-auth-email.sh` and `supabase/config.toml` already carry
      the `SUPABASE_AUTH_SMTP_*` contract.
- [ ] **Delete the diagnostic account `sf-probe-a91c@gmail.com`.** Created while
      reproducing the sign-up defect using an invented address that does not
      exist; its confirmation email hard-bounced and Supabase warned that
      sending privileges are at risk.

### Security

- [ ] **Rotate the `sb_secret_` Supabase key** exposed in a screenshot, and
      update the Vercel environment variable.
- [ ] **Rotate the `sbp_` Supabase personal access token** pasted into the
      conversation.

### Infrastructure

- [x] **Migration ledger repaired.** Resolved 2026-08-14. The ledger had already
      been extended to 41 rows before I looked; three applied migrations
      (`20260813001500`, `20260813001600`, `20260814000100`) were still
      unrecorded, and `20260814000200` had not been applied at all. Both are now
      fixed: the ledger holds 45 rows through `20260814000200`, and no
      repository migration is unrecorded.
- [ ] **Decide on the duplicate migration version `20260813000200`.** Two files
      share it (`bot_fabric_activity_types`, `phase1e_synthetic_journeys`) and
      the ledger cannot represent both. Renaming is the obvious fix but
      `AI/ARCHITECTURE.md` records applied filenames as immutable, so it is an
      owner call.
- [ ] **Confirm automatic CI is healthy again.** It stopped firing on
      `pull_request` between 2026-08-13 19:32Z and 2026-08-14 12:05Z — roughly
      sixteen hours during which every run was manually dispatched and pull
      requests were ungated by default. A run appeared automatically one minute
      after the 12:05Z push, so it looks self-healed, but the cause is unknown
      and it may recur. Worth a glance at repository Actions settings.

### AI providers — blocks every live Phase 2B demonstration

- [ ] Set server-only `ANTHROPIC_API_KEY`.
- [ ] Set server-only `OPENAI_API_KEY` and `OPENAI_DEFAULT_MODEL`. The current
      OpenAI project reported `credit_balance_exhausted`, so it also needs
      funding.
- [ ] Enable the outbound provider execution switch in Settings.
- [ ] Both providers are needed, not one: cross-provider verification degrades
      or fails closed with a single provider.

### Optional configuration

- [ ] Set `SUPER_ADMIN_EMAILS` in Vercel Production and Preview if the
      super-administrator role should not use the repository default list.

---

## Phase 2B — Graph Engineering

### Stage 1 — engine core — **DONE**

Delivered in `lib/graph/`, 61 tests. Topology selection, fake-edge removal,
typed contracts, DAG scheduler, deterministic reducers, fan-in guards,
verification quorum, budgets, frozen policies, discovery stop conditions.
Documented in `AI/GRAPH_ENGINEERING.md`.

### Stage 2 — durability — **DONE** (applied to hosted)

- [x] Thirteen tables in `20260814000100_graph_engineering.sql`: `graphs`,
      `graph_runs`, `graph_nodes`, `graph_edges`, `node_runs`, `node_contracts`,
      `graph_handoffs`, `graph_artifacts`, `graph_verifications`, `work_locks`,
      `graph_templates`, `graph_budgets`, `graph_events`.
- [x] RLS + FORCE RLS on all thirteen, member-only select, zero browser write
      grants, foreign keys, indexes, check constraints.
- [x] Work locks with heartbeat, expiry, and abandoned-lock recovery, enforced
      by a partial unique index rather than by the scheduler remembering.
- [x] **Applied to hosted and verified 2026-08-14**: 73 public tables, all 73
      with RLS and FORCE RLS, all 13 graph tables present, 7 write-boundary
      functions present, and zero EXECUTE grants to `anon` on any of them.
- [x] Graph compiler (`lib/graph/compiler.ts`): plan → durable definition,
      rejecting cycles, dangling dependencies, duplicate keys, entry-less
      graphs, and unresolved write conflicts before anything is spent.
- [x] Handoff preparation validated against the receiving node's input
      contract (`lib/graph/handoffs.ts`); invalid handoffs are stored as
      evidence rather than dropped, and verifier context is built separately so
      worker reasoning cannot leak into it.
- [x] RLS behavioural tests: member read, cross-tenant denial, outright
      anonymous denial, absent write grants, constraint enforcement, full lock
      lifecycle.
- [x] Write boundary (`20260814000200_graph_write_boundary.sql`): seven
      SECURITY DEFINER functions are the only way anything is written. A whole
      graph is created in one statement, a terminal node cannot be reopened, and
      a run with incomplete input cannot be recorded COMPLETED.

### Stage 3 — execution — **IN PROGRESS**

- [x] Node runner (`lib/graph/runner.ts`): drives the scheduler, owns attempts
      and retries, rejects contract-violating output, degrades and stops on
      budget, and refuses to call a run complete when a node never reported.
      Execution, time, and locking are injected, so the whole of retry,
      fallback, degradation and partial completion is tested without a
      credential.
- [x] Provider bridge (`lib/graph/provider-bridge.ts`): capability → task kind,
      per-tier output-token ceilings, node risk into routing, excluded
      providers for fallback, and provider outcome → node result. Deterministic
      nodes are refused a provider call outright.
- [ ] Assemble the bridge into a live `executeNode`. Written and unit-tested
      against stub responses; its first real call needs a credential.
- [ ] Fan-out onto isolated workspaces (`lib/worker/workspace.ts` already
      supports concurrent isolation; nothing fans out to it yet).
- [ ] Integration nodes: wait, check completeness, detect conflicts, reconcile.
- [ ] Anchors modelled as structured evidence attached to graph decisions.
      Real anchors already exist — container validation, CI results, deployment
      state, synthetic journeys — but are not attached to nodes.
- [ ] Hidden-dependency detection wired to work locks.

### Stage 4 — surfaces

- [ ] Graph templates (Production Readiness, Security Audit, RLS Audit, Bug
      Sweep, Test Coverage, Refactor Sweep, Dependency Audit, Performance Audit,
      Mobile Audit, Code Review, Feature Build, Incident Investigation,
      SEO/AEO Audit), clone/save/version.
- [ ] Workflows UI: visual nodes and edges, node detail, status, budget,
      concurrency, locks, verification, artifacts, anchors, timeline.
- [ ] Bot Manager proposes an execution summary before running.
- [ ] Graph observability: critical path, parallelism, latency, retries,
      verifier rejection, reduction ratio, completion, missing inputs.
- [ ] Conservative graph optimizer recommendations.

### Stage 5 — demonstrations (all blocked on provider credentials)

- [ ] A. Simple task takes the single-agent path with no graph overhead.
- [ ] B. Wide audit: 20+ independent nodes, fan-out, verification, reduction.
- [ ] C. Code feature: plan → parallel Codex → integration → fresh review → gates.
- [ ] D. Silent failure: one node fails, the graph refuses to claim completion.
- [ ] E. Hidden conflict: two nodes contend, the lock prevents unsafe parallelism.
- [ ] F. Discovery terminates on the no-new-findings condition.
- [ ] G. Budget degrades and stops gracefully at the limit.

---

## Carried over from earlier phases

- [ ] Phase 1B: live second-tenant, reverse handoff, disconnect/loss, and the
      remaining adverse lifecycle matrix.
- [ ] Phase 1C: no successful live result, factory branch, or draft PR yet —
      blocked on provider credit.
- [ ] Phase 1E: no owner-authorized production target, so production
      observation remains unproven.
- [ ] Expand authenticated E2E once a safe disposable live fixture exists.
- [ ] Run final verification on the repository-supported Node version.

---

## Standing constraints

Not tasks — these stay true regardless of what else lands.

- Autonomous Mode OFF, global kill switch ON, auto approve/merge/deploy/rollback OFF.
- The only repository write path is an isolated branch, commit, and **draft** PR.
- RED actions require explicit owner approval.
- RLS and FORCE RLS stay on for every exposed table.
- No credential in browser code, prompts, logs, fixtures, database rows, or source control.
