# SoftwareFactory — shared working status

Last updated: 2026-08-13 (Phase 1E synthetic journeys merged; all gates green on `main`)
Current `main`: `79084ed` — CI run [`31733955307`](https://github.com/surgeservicesllc/SoftwareFactory/actions/runs/31733955307)
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
| Phase 1D — autonomy controls | Observation-only scaffold, locked OFF | Deliberate; no executor exists |
| Phase 1E — production operations | **Merged; ~85% of objective** | Hosted migrations `028`/`029`; no observed production target |
| Phase 2A — provider execution layer | Merged | Owner-enabled `ai_provider_execution_enabled` (defaults OFF) |
| Bot fabric + marketing site | Merged | Hosted marketing migration |

Gates on current `main`: lint, typecheck, 82 files / 819 tests, clean production build,
Playwright 117/117 across desktop/tablet/mobile including axe.

---

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
- [ ] **Owner-gated: authorize a production target** to monitor, then record the first real
      observation → detection → incident → resolution and put the evidence in
      `AI/QUALITY_SCORECARD.md`. Nothing in Phase 1E has yet run against real production.
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
- Codex repair **execution** — Phase 1C is Not Connected. Repair work is created, unassigned.
- Synthetic **write** steps — declared and validated, recorded as `skipped`, never issued.
- Autonomous deployment or merge. `autonomous_release_allowed` returns false unconditionally.

### Invariants a future change must not break

`service_role` gains no new table privileges · the four append-only evidence tables stay
append-only · `production_monitors_enabled_requires_connection` (an unconnected monitor cannot
be enabled) · `rollback_operations_failure_escalates` (a failed rollback cannot be silent) ·
`incidents_resolution_requires_cause` · `synthetic_journeys_steps_are_safe` ·
`EXECUTOR_NOT_CONNECTED` stays unconditional in `autonomous_release_allowed`.

---

## Bot fabric + marketing site

Merged into `main`. Route groups: `app/(marketing)/` public and indexable,
`app/(console)/` authenticated with the sidebar shell. `/solutions` carries the former console
homepage. Every marketing page is a Server Component reading through
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
