# SoftwareFactory — shared working status

Last updated: 2026-08-15 (Phase 2C resource gates). **Start at the HANDOFF section below.**
Session landed: Phase 1E→1C repair promotion · Phase 2C persistence, UI, routing and model
declaration · probe DNS-rebinding fix · Supabase RPC contract verification · roadmap audit ·
Phase 2B graph engineering (PR #27) · Phase 1B adverse lifecycle · concurrently, another agent
landed the AgentOS blocks **A through G** (G is `agentos.yml` push/pull plus the CLI), the
Phase 1D decision trail, the Phase 1B lifecycle matrix, and the **zero-token Phase 1C
re-architecture**.
Current `main`: check `git log` — several agents landed work on 2026-08-14 and 2026-08-15.
Owner of this file: **whichever agent is currently working. Update it before your session ends.**

Several agents work this repository concurrently. This file is the shared picture: what is
done, what is genuinely open, and which items only the owner can close. Keep workstream
sections separate so two agents editing at once conflict on one section rather than the file.

## MASTER COMPLETION LEDGER (2026-08-15, master certification loop)

This section is the authoritative completion ledger required by the master
certification loop. Phase detail lives in the per-phase sections below and in
`AI/PHASE_*_COMPLETION.md`; this section holds the cross-phase picture, the
priority queue, and evidence for items closed by the loop.

### Current Certification

- Overall: **~76% by phase scorecards** (1B 90% · 1C code-complete/worker LIVE · 1D decision layer 100%, execution blocked by design · 1E ~87% · 2B landed · 2C 94% agent-complete · 2D ~81% · 2E 92% · 2A partial · 3 ~77% ordered-plan complete) **+ frictionless owner-experience goal at ~87%** (its own report below)
- Last audit: **2026-08-16, master iteration 24 — clean-room, see "Master clean-room audit" below**
- Current loop: master iteration 24 (final gate)
- Current blocker: every unblocked agent-actionable item is exhausted; remainder is owner-only (see External Blockers) plus the Vercel deploy-quota wait
- Next action: owner live proofs (canary first — it unlocks the most)

### P0 Critical

- [x] Determine whether the zero-token worker credential is configured | 1C | **PROVEN LIVE**: Actions run `31894356952` (2026-08-15 16:01Z) logs "Codex authenticates with the owner's ChatGPT subscription. No per-token API billing is possible." then "worker … is ready"; schedule runs every ~5 min, all green | loop | —
- [x] Determine real hosted migration ledger position | DB | **MEASURED 2026-08-16** (owner SQL, screenshot): **65 rows, max `20260814002300`**. Count arithmetic (64 local files ≤ that mark) confirms the runbook's `20260814002000_graph_engineering` rename derivation — one remote-only ledger row blocks every apply path until the two-line `supabase migration repair` in the rebased runbook. 19 migrations outstanding. | owner ran the query; remaining apply steps in `AI/HOSTED_APPLY_RUNBOOK.md` | —
- [ ] Live 1C canary: command → claim → factory branch → commit → draft PR → CI | 1C | Worker polls every 5 min and exits idle: nothing is queued. `submit_command` requires an authenticated session (not executable by service_role — verified ACL) | owner (browser: `/solutions/bot-manager`, GREEN command) | worker LIVE ✔
- [x] Correct AI memory claiming worker "Not Connected pending credential" | docs | This commit — `AI/CURRENT_STATE.md` and `AI/QUALITY_SCORECARD.md` headlines contradicted the Actions evidence | loop | —

### P1 Required

- [x] Hosted-vs-local schema diff once ledger position is known | DB | Done 2026-08-16 from the measured position: 64 shared versions + 1 remote-only (`20260814002000`, renamed) + 19 outstanding (`20260814002400`–`20260815001600`); nothing hosted is missing from the repository beyond the rename artifact | loop | —
- [x] Runbook `AI/HOSTED_APPLY_RUNBOOK.md` rebased on the real hosted position | DB | Rebased 2026-08-16: measured section supersedes, exact repair-then-push order, 19-item apply list, capacity-defaults warning; `hosted-runbook-counts` guard moved to the measured mark and passes 4/4 | loop | —
- [ ] 2C portfolio: ~~PR/deployment columns~~ (closed loop 3: `draftPullRequests` from completed change requests — the schema forces a PR number on completion, so the count is truthful; `activeDeployments` incl. rolling_back; null still renders Unknown), ~~per-project detail page~~ (closed loop 4: `/solutions/portfolio/[projectId]` reads the same RLS-scoped aggregate as the list so the two can never disagree; missing and invisible render identically so the surface reveals nothing; links to the six factory surfaces say plainly they are factory-wide views), ~~global bot-manager goals~~ (closed loop 5: `POST /api/portfolio/controls` + owner panel — priority, pause/resume with required reason, focus-here/clear-focus, capacity; explicit actions per goal 14, never parsed prose; authorization stays in the owner-only SECURITY DEFINER functions which write activity events) | 2C | `AI/PHASE_2C_COMPLETION.md` scorecard | loop | —
- [x] Cross-project isolation negative tests | 2C/2E | goal 18: two live leases across projects already proven (2E "runs two projects at once"). Goal 27 closed this loop: `mark_github_connection_lost` on project A withholds A's queued run (claim filters `connection.status='connected'` + active unsuspended installation), leaves B claimable, keeps A's run `queued` for recovery; restoring connection+installation+repository selection makes the same run claimable with no resubmission. `phase2e-portfolio-scheduling.behavior.test.ts`, 21/21 | loop | —
- [ ] Second real repository/installation for multi-project live proof | 2C | goal 34 | owner | —

### P2 Improvement

- [ ] Per-project detail page scoping Files/Backlog/Runs/Agents/Reports/Activity (goal 11 PARTIAL)
- [x] Portfolio roll-up report | 2C | Closed loop 7 — and the audit line was wrong: the daily report was already organization-wide with a portfolio health histogram and attributed risks. The real gap was the healthy majority having no row anywhere. Migration `20260815000800` adds a bounded per-project array (worst-health first, archived included so week-over-week reconciles) with the same open-work counts the portfolio console shows; policy version → phase1e-operations-v2 | loop | —
- [x] Supabase databases and graph nodes bind to the registry | 2D | Closed loop 16 (rows 4 and 29, the last ABSENT rows). `resolveConnectionCredential` generalizes the three-step binding (route capability -> read secret_reference -> dereference server-side); `resolveDatabaseCredential` proves two projects -> two database credentials with read/migrate as separate authorizations; `lib/graph/connection-bridge.ts` routes a MODEL node's `inference.advisory` identity while DETERMINISTIC/ANCHOR nodes provably never touch the registry. 2D now has zero absent rows | loop | —
- [x] Vercel binds to the connection registry | 2D | Closed loop 15 as structure (row 3 FAIL-ABSENT -> PARTIAL). `lib/connections/secret-reference.ts` dereferences `env://` references server-side (vault schemes refuse by name — no client exists, and pretending otherwise would misreport a missing integration as a missing secret); `resolveDeploymentCredential` routes deploy.preview/deploy.production and returns the routed connection's token; the Vercel adapter authenticates each read with the supplied credential over the ambient token. Two projects -> two connections -> two accounts in one process, proven by test. Live half owner-blocked: no real Vercel connection exists | loop | —
- [x] Connection capacity is enforced and truthfully counted | 2D | Closed loop 14 (row 31). Discovery: the 2E scheduler already enforces connection-specific ceilings at claim time, counted live (`status='running' and lease_expires_at > now()`) — the 2D audit predated it. Built: the untested connection-level verdict branch now has an end-to-end claim proof (withheld at ceiling with audited reason, neighbour unaffected, freed slot goes to the capped work); the router's capacity input switched from the stored `active_leases` counter (structurally unable to decay on lease expiry — proven ignored by test) to the same live count the scheduler enforces; the two declared ceilings reconcile strictest-wins | loop | —
- [x] Identity-routing decisions persisted as evidence | 2D | Closed loop 13 (row 27). Append-only `connection_routing_decisions` mirrors `scheduling_decisions`: RLS member-read, definer-only write via `record_connection_routing_decision` (owner-only, generic not-found, shape check so no row can lie about itself, secret-hygiene bounds on `rejected`). The commands route records every routed decision — selection or refusal — before acting on it, and a recording failure fails the submission. Proven in `connection-registry.test.ts` incl. append-only under the most privileged role | loop | —
- [x] Identity Router wired into command submission | 2D | Closed loop 12 (2D row 28's named absence: "the seam where a connection would be chosen does not exist"). `lib/connections/routable-candidates.ts` loads capability-labelled mappings and runs the pure router; `POST /api/commands` consults it with `repository.write` before any GitHub call or persistence. Labelled project: router refusal → 409 named reason; selection disagreeing with the resolved primary binding → 409 contradiction, never a tiebreak; registry read failure → 503 fail-closed. Legacy project: proceeds as before, response says `connectionRouting.mode: "legacy"`. Five route tests; existing 12 unaffected | loop | —
- [x] Explicit cross-project dependency type | 2C | Closed loop 11 (goal 17, the last agent-actionable portfolio row). Migration `20260815001000`: `declare_cross_project_dependency` / `release_cross_project_dependency` — owner-only, reason required, events in both projects, cycle/duplicate/terminal/self refusals by name, generic not-found outside the caller's org. Edges land in `task_dependencies`, which the claim gate already joins by organization (not project) — the scheduler needed no change. `submit_command` carried forward with one surgical replay-check amendment so declared cross-project edges (declaration evidence) never fail an honest idempotent replay. Four behavior tests: withhold-until-honest-completion, refusal battery, release-without-touching-submission-evidence, replay survival | loop | —
- [x] Portfolio lens on runs + activity, and the agent-context isolation proof | 2C | Closed loop 10. Runs console groups under the owning project with honest counts (no-project runs get "Project unavailable", never attributed); activity console derives per-project facet chips with counts from the loaded events (org-level events get their own bucket) and filters on selection — both asserted by component tests. Goal 31 proven negatively in `phase2e-portfolio-scheduling.behavior.test.ts`: the claim payload's 41 columns are pinned as the worker's entire context, every identifier in it belongs to the claimed project and none to the sibling, and a valid lease on project A's run is refused for heartbeat and completion against project B's running run while B's rightful worker still completes it | loop | —
- [x] Project archive operation + history-preservation test | 2C | Closed loop 6: `archive_project`/`unarchive_project` (migration `20260815000700`) — owner-only, reason required to archive, immutable activity events, deletes nothing. Behavior test archives a project with real queued work: work stops (claim filter), history rows survive, unarchive makes the same run claimable with no resubmission. API actions + panel buttons added | loop | —

### P3 Optimization

- [x] Guarded project-deletion path | 2C | Closed loop 8 by discovery: every project is born with a `project.created` activity event, `activity_events` references projects ON DELETE RESTRICT, and the trail is append-only — so **projects cannot be deleted, from their first moment, structurally**. Migration `20260815000900` adds the trigger that names that rule (instructive refusal instead of a cryptic FK error), with no escape hatch because none could work. Tests prove the refusal, the birth-record lock even with the trigger dropped, and the trail's immutability | loop | —

### Phase Certification

- [x] 1A Control Plane — **certified this loop**: all 21 routes fetched live on the production origin, 21/21 return 200 (incl. the dynamic project-detail route added today, proving the deployment carries the current route table); per-page truthful-state evidence in `AI/PHASE_1A_CERTIFICATION.md`; e2e suite re-proves headings/viewport/axe at three widths every CI run
- [ ] 1B GitHub — 90% (18 PASS/2 PARTIAL); remaining items owner-only (second installation + live adverse pass)
- [ ] 1C Worker Execution — code complete, worker **LIVE and polling**; canary blocked on one owner command
- [ ] 1D Autonomous Release — decision layer 100%; execution blocked **by design** (AGENTS.md forbids auto-merge in this line)
- [ ] 1E Production Operations — ~87%; execution authority absent by design
- [ ] 2A Multi-AI — provider layer built, switch OFF, no live call; zero-token conflict recorded in `AI/PHASE_1C_COMPLETION.md` §5a awaiting owner decision
- [ ] 2B Graph Engineering — landed (PR #27, then 2E capacity integration); no live graph run yet
- [ ] 2C Portfolio — **94%** (33 PASS/2 BLOCKED); loop 11 closed the last agent-actionable row (17, explicit cross-project dependencies via `declare_cross_project_dependency`); everything left is owner-only: hosted verify (33), second repo (34)
- [ ] 2E Resource Optimization — 92% (33 PASS/2 PARTIAL/1 BLOCKED)
- [ ] 2D Multi-Account Identity — **~81%** (23 PASS/12 PARTIAL/0 ABSENT/1 BLOCKED of 36); loops 12-16 closed every absent row: router into `POST /api/commands` (28), durable decisions (27), capacity truth (31), Vercel binding (3), Supabase database credentials (4), graph-node identity (29). **No agent-actionable structural row remains** — every gap is a live half (second account, real Vercel/Supabase rows, first graph run, 2A switch) or the ambient-worker-session rows, all owner decisions | owner: second real account (35)
- [ ] 3 Self-Improvement — **~77%** (24 PASS/13 PARTIAL/0 ABSENT of 37 — nothing absent; every gap is a live half, `AI/PHASE_3_COMPLETION.md`, audited 2026-08-15 — the earlier "not started" here was stale memory). Safety half largely inherited and scoring; measurement half unbuilt. Ordered plan: ~~versioned frozen constitution~~ (loop 18: `lib/factory/constitution.ts`, factory-constitution-v1, self-improvement proposal a first-class refused-by-name subject; row 30 PASS) -> ~~improvement ledger~~ (loop 19: migration `20260815001200`, append-only proposal/decision/implementation/evaluation lifecycle; no proposal without a baseline, no implementation before acceptance, no second evaluation — "score shopping" refused by name; rows 23 PASS, 24/32/33/34 ABSENT->PARTIAL, ~47%) -> ~~baseline capture + comparison~~ (loop 20: migration `20260815001300` — telemetry-derived baselines with named unavailability, fixed direction table, derived outcomes, refusal to guess; rows 32/34 PASS, ~53%) -> ~~self-audit engine~~ (loop 21: `audit_factory_health`, migration `20260815001400` — eight domains as evidence, score over measured only with confidence and abstention; rows 1/2/3/5/6/8/10 PASS) -> ~~detectors~~ (loop 22: `detect_factory_improvements`, migration `20260815001500` — five detectors with stated evidence floors, abstaining by name; 12/13/21 PASS proven positively, 17/19 PARTIAL awaiting real history) -> ~~automated intake~~ (loop 23: `propose_improvements_from_detections`, migration `20260815001600` — findings become owner-decidable proposals; rows 22/24 PASS). **The Phase 3 ordered plan is complete**; every remaining PARTIAL is a live half. Honest blocker: telemetry tables hold little real history until the factory has actually done live work

### Owner goal — BotBuild: AI Accounts + automatic auth broker (opened 2026-08-16)

Full spec: uploads/cda1f8a5-BotBuild.txt. Mission: no terminal in normal
onboarding — Add AI Account → pick Claude/Codex → Connect → provider's real
sign-in → automatic detection → Connected → create/assign bots. AI Account
becomes a first-class entity distinct from bots; multiple isolated accounts;
real worker status; everything wired end-to-end.

**Inspection findings (loop step 1-2, 2026-08-16):**
- `provider_connect_sessions` + sealed `provider_credentials` (migration
  `20260814002500`) already model the claim half: digest-coded sessions,
  purpose-bound seals, one-credential-per-purpose. `ai_auth_sessions` extends
  this with the broker state machine rather than replacing it.
- The worker is an ephemeral Actions job (cron */5 + repository_dispatch,
  70-minute ceiling) — long enough to host a full auth relay session; a
  dispatched `ai-account-auth` job is the broker's execution vehicle.
- `bots` has no account linkage — needs nullable `ai_account_id` (legacy-safe;
  old bots show "AI account required" per the spec's migration rule).
- Worker status exists as heartbeat evidence (`get_phase1c_worker_status`);
  "Worker Stale" reflects GitHub cron throttling (~hourly effective), so the
  spec's worker-status work is presentation + registration, not new telemetry.
- **Technical risk (must live-probe before promising)**: Claude's
  `setup-token` is a paste-back device flow — relayable through the web UI
  (user pastes the provider code into Software Factory, never a terminal).
  Codex's ChatGPT login opens a **localhost callback** the user's browser
  cannot reach on a headless worker; unless Codex exposes a headless/device
  mode, Codex account-connect keeps the operator-machine path under Advanced
  while Claude gets the full broker flow. Record outcome of the probe here.

**Task breakdown (loop step 3):**
- [x] P0 | BotBuild | `ai_accounts` + `ai_auth_sessions` migration: account
  entity (org, provider, auth_method, display_name, status, credential
  purpose linkage, verification timestamps, last_error, metadata, revoked_at),
  broker sessions (pending→initializing→awaiting_user→authenticated→
  verifying→connected/failed/expired/revoked, login_url, sealed relay code,
  worker claim + heartbeat, TTL ceiling 30 min), `bots.ai_account_id`
  nullable composite-FK; RLS+FORCE with zero direct table access, 13 definer
  functions (owner-side: create/open/attach-relay/disconnect + 2 read
  projections; worker-side: claim/report-url/read-relay/verifying/complete/
  fail/expire/needs-reauth), activity events on every transition. Delivered
  `20260816000100_ai_accounts_auth_broker.sql` + 10-test behavior suite
  (happy path, relay-code secrecy, manager auth, supersession, slot
  uniqueness, expiry, secret-shaped failure sanitizing, credential-deleting
  disconnect, cross-org bot FK refusal, needs_reauth). Guard updates: RLS
  count 109→111, tail pins ×11, publicTables +2, runbook 83→84/19→20 |
  PASS — broker suite 10/10; runbook+grants+pin guards green | 2026-08-16
- [ ] P0 | BotBuild | Broker API: POST /api/ai-accounts/connect, GET
  /api/ai-accounts, session status read, relay-code POST (web-UI paste, not
  terminal), cancel; owner-auth + same-origin + rate limit + audit events |
  route tests | migration
- [ ] P0 | BotBuild | Worker auth runner: dispatched job claims session
  (service-role RPC), runs provider CLI login with per-account isolated
  config dir (CLAUDE_CONFIG_DIR per account uuid), captures login URL →
  awaiting_user, consumes relayed code, seals credential under the account's
  purpose, session → connected; failure/timeout states | workflow + runner
  tests; live probe of headless `claude setup-token` | broker API
- [ ] P0 | BotBuild | Auto-completing UI: connect wizard (provider cards →
  confirmation → progress modal with real states → Connected card), session
  status via bounded polling of the session endpoint (no 1s polling; no
  check-now button — the state flips itself), popup-blocked fallback link |
  console tests | broker API
- [ ] P1 | BotBuild | Bot Manager redesign: header counts (Worker/Accounts/
  Bots/Roles), empty state per spec (Claude + Codex cards primary, Advanced
  below, OpenRouter demoted), AI Accounts management section (Manage/
  Reauthenticate/Disconnect), Create Bot with AI Account selector
  (ai_account_id), worker-required state | e2e + component tests | P0 rows
- [ ] P1 | BotBuild | Disconnect/reauth lifecycle: confirm intent, stop new
  work, revoke stored credential, update affected bots (never delete),
  status transitions incl. Needs Reauthentication | tests | P0
- [ ] P1 | BotBuild | Verification loop: real usability check per account,
  expiry detection, honest statuses | tests | P0
- [ ] P2 | BotBuild | Multi-account worker isolation live proof (two Claude
  accounts, no auth collision, per-account config dirs) | live evidence | P0
- [ ] P2 | BotBuild | Docs: architecture, auth lifecycles, worker setup,
  troubleshooting | — | P1
- [ ] P3 | BotBuild | Full test matrix (26 categories) + final acceptance
  journey (30 steps) with real worker execution using a selected account |
  live evidence | all

### Owner goal — the Claude button (opened 2026-08-16, iteration 1 shipped)

Owner directive: a Claude button in Bot Manager; click → Claude sign-in; once
logged in the Claude bot is Ready for assignments; many Claude bots
simultaneously; linked to everything already built.

**Honest design constraint (documented in code since the connect flow was
built):** Anthropic offers no third-party OAuth. A browser-redirect "Sign in
with Claude" would require impersonating Claude Code's private OAuth client.
The supported sign-in IS Claude's own: one pre-filled command runs
`claude setup-token`, which opens claude.ai's real login in the operator's
browser (the exact screen in the owner's mock); the credential travels once,
sealed, through `/api/bots/connect/claim`. The button drives that flow and
finishes it automatically.

**Iteration 1 — shipped (PR #133, squash `ce66247`, CI green, production
deploy completed 13:09Z, /solutions/bot-manager 200):**
- The gap that made "connected" ≠ "ready" for subscriptions: providers
  status keyed readiness off the API-key ref only, and provisioning wired
  bots to `ANTHROPIC_API_KEY` — a claimed subscription credential
  (`SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN`) flipped nothing. Closed
  end-to-end: catalog gains `subscriptionCredentialRef` (anthropic + openai;
  literals because the catalog is browser-safe, pinned to the server
  constants by test); `/api/bots/providers` reports `subscriptionReady`
  (counted toward readiness, never probed — the model-list probe
  authenticates keys, and a guaranteed 401 would misread as a bad sign-in);
  `/api/bots/connect/provision` accepts `credential: "subscription"`
  resolved server-side from the catalog (arbitrary refs can never arrive
  from the browser) plus `additional: true`; `ensureProviderBot` takes the
  ref override and numbers additional bots ("Claude 2", "Claude 3" — the
  many-bots case) while keeping add-only and never-fails-the-connection.
- **The Claude button** (`ClaudeQuickConnect`, in the empty-fleet front
  door): branded tile → one pre-filled command with copy button → live
  polling flips to "Claude is connected — your Claude bot is Ready for
  assignments" the moment the claim lands, provisioning against the
  subscription ref as the signed-in owner; "I have signed in — check now"
  for the impatient; already-signed-in short-circuit makes the button
  literally one click with no terminal; "Add another Claude bot" repeats
  the finish for many bots. Readiness itself needed no change — the vault
  overlay bridge (PR #121) already makes any bot referencing the claude key
  read Ready.
- Tests: bot-provisioning 8/8, provision-route 8/8, new bot-providers-route
  4/4 (incl. the catalog↔server-constant pin and the never-probe rule),
  console 10/10 incl. a full button→command→check→Ready walk. tsc clean,
  eslint 0 errors, adjacent suites 37/37.
- **Iteration 2 — Codex parity (PR #134, squash `5ff8d45`, CI green,
production deploy completed 13:22Z):** the owner asked for "the same
  for codex", and the plumbing was already symmetric (`codex` purpose,
  `codex login` plan in connect.mts, `SOFTWAREFACTORY_CODEX_AUTH_JSON`
  overlay, catalog subscription ref on openai). `ClaudeQuickConnect`
  generalized to `SubscriptionQuickConnect(providerId, purpose)` — accent
  and copy derived from the catalog, per-accent text color for contrast —
  and the front door now shows BOTH branded buttons (Claude terracotta,
  Codex mint) side by side, each ending in "<label> is connected — your
  <label> bot is Ready for assignments" with "Add another" for many bots.
  Console suite 11/11 incl. a full Codex walk (button → `connect.mts codex`
  command → check → provision {provider:"openai",credential:"subscription"}
  → Ready). tsc + lint clean.
- **Iteration 3 — multi-account slots (PR #135, merged 2ef50e4):** the vault audit settled
  it — `purpose` is pattern-checked (`^[a-z][a-z0-9_]{1,62}$`), not
  enum-constrained, so account slots need NO migration. Purposes
  `claude_2/claude_3/codex_2/codex_3` (bounded) added to the connect route
  and the connect script (same login plan as the base, sealed under its own
  purpose); overlay maps each slot to a suffixed variable
  (`…_OAUTH_TOKEN_2` etc.); provider status reports per-slot readiness
  (`subscriptionSlots`); provision accepts `subscription_2/_3` resolved
  server-side; the ready state gains "Connect another <label> account"
  (up to 3 accounts signed in simultaneously) alongside "Add another bot".
  Honest limitation recorded: the live worker consumes slot 1's credential
  today — further slots store, read Ready, and are assignable; wiring slot
  selection into worker execution is worker-side follow-up work.
- **Open next:** live round-trips with the owner (Claude and Codex sign-ins,
  bots appear Ready in production; second-account slot proof); subscription
  tiles on non-empty fleets; worker-side slot selection.

### Owner goal — production Magic Link sign-in fix (2026-08-16)

**Symptom:** magic-link emails arrive and the link reaches the app, but the
browser lands on `/auth/sign-in?error=callback_failed` ("That sign-in link
could not be verified").

**Root cause (measured, not guessed):** `@supabase/ssr` 0.12.4 defaults both
clients to `flowType: "pkce"`. The magic-link request stores a PKCE code
-verifier **cookie in the browser that requested the link**; GoTrue's
`{{ .ConfirmationURL }}` link redirects back to `/auth/callback?code=…`, and
`exchangeCodeForSession(code)` requires that verifier cookie. Mail apps
(Gmail/Outlook in-app browsers) open links in a **different browser context**
that never had the cookie — and Safari ITP can drop it even same-device,
since it is set on a fetch response. The old callback supported ONLY the
PKCE lane, so every cross-context click failed. Not an expiry problem.

**Fix (code, merged with this entry):** `app/auth/callback/route.ts` now has
two lanes: a new **`?token_hash=&type=` lane** verified server-side with
`supabase.auth.verifyOtp({ type, token_hash })` — browser-context-free, the
documented SSR emailed-link pattern — plus the existing `?code=` PKCE lane,
preserved unchanged for OAuth returns, signup confirmations, and same
-browser clicks. Type allowlist (`email/magiclink/signup/invite/recovery/
email_change`), token-hash length bounds, `next` still normalized through
`normalizeReturnPath`, and bounded server-side failure logging (lane +
error name/message/code/status — never a token, hash, or code value).
Password login, sign-up, sessions, sign-out: untouched.

**Supabase dashboard change REQUIRED (owner, ~1 minute):**
Dashboard → Authentication → Email Templates → **Magic Link** — replace the
`{{ .ConfirmationURL }}` link with:
`<p><a href="{{ .RedirectTo }}?token_hash={{ .TokenHash }}&type=email">Sign in to The Agoras</a></p>`
(`{{ .RedirectTo }}` resolves to the app's allowlisted
`https://www.theagoras.com/auth/callback`; if that variable is unavailable,
use `{{ .SiteURL }}/auth/callback?token_hash={{ .TokenHash }}&type=email`.)
Optionally add `<p>Or use this one-time code: {{ .Token }}</p>` as a
scanner-proof fallback. Until the template changes, behavior is exactly the
status quo (PKCE lane, same-browser only) — the code change cannot regress
it.

**Tests performed:** new `auth-callback-route.test.ts` 7/7 (token-hash lane
verifies and redirects clean of secret material; off-site `next` refused;
unsupported type refused before any provider call; expired/used token lands
on the retryable notice with shape-only logging; PKCE lane preserved;
neither-param failure; no-user-after-verify refusal). Full gate rerun:
eslint 0 errors, tsc clean, **full vitest 2748/0**, production build
compiled. The local-stack e2e (`auth-lifecycle`, `journey`) still exercises
the preserved `?code=` lane.

**Production verification steps (after the template change):**
1. theagoras.com/auth/sign-in → "Email me a sign-in link instead".
2. Open the email **in the Gmail app** and tap the link there (the exact
   context that used to fail) → should land signed in.
3. Tap the same link again → the retryable "could not be verified" notice
   (used token), not a dead end.
4. Password sign-in and sign-out unchanged.

**Remaining blockers:** the template edit is dashboard-only (owner); mail
-scanner link prefetch remains a theoretical consumer of one-time links —
the optional `{{ .Token }}` line in the template is the mitigation, and a
code-entry box is a possible future enhancement.

### Master clean-room audit (2026-08-16, iteration 24 — FINAL GATE)

Fresh audit on merged `main` (`69a0156`), assuming prior claims may be wrong;
every number below re-measured this iteration, not carried forward.

- **Local gate: PASS** — eslint 0 errors (14 warnings), `tsc --noEmit` clean,
  **full vitest 2741 passed / 0 failed** (234 files, 2 skipped by design),
  production build compiled successfully.
- **Migrations: PASS** — 83 local migrations, tail `20260815001600_detector_
  intake.sql`, exactly as documented. Hosted position remains the owner-only
  SQL check (External Blocker 2); no ledger row was ever inserted manually.
- **Live production: PASS** — 22/22 routes return 200 on the production
  origin (re-run this iteration). Deployment caveat, honestly: Vercel's
  free-tier daily quota exhausted mid-day; production currently serves main
  **through `0126825` (#126)** — frictionless iterations 4–9 are merged and
  CI-green but reach production on the next deploy after the quota resets
  (~24 h), an owner Redeploy, or a plan upgrade. Nothing is lost; main is
  the source of truth.
- **Zero-token: PASS** — subscription-authenticated worker (Actions evidence
  run `31894356952`, logs quote subscription mode; freshness limited to that
  run — no newer run exists because no command has been queued);
  `SOFTWAREFACTORY_OPENAI_API_KEY` permanently absent; constitution pins
  `NO_PAID_TOKEN_DEPENDENCY`; no funded key in any workflow.
- **Security/RLS: PASS at gate level** — schema-security-invariants, RLS
  count, service-role grant pins, RPC contract, and migration-chain suites
  all green in the full run above; no security control weakened anywhere in
  this session's 16 merged PRs (#114–#129 master + frictionless).
- **Regressions: none found** — the full suite passed with zero reopened
  failures; the frictionless iterations changed presentation/tests only.
- **P0/P1 unblocked: NONE** — every remaining P0/P1 row is owner-only
  (canary, hosted-ledger position, second repository, 2A decision) or
  blocked by one of those.
- **Honest completion statement:** agent-actionable work is exhausted
  (master loops 1–24, PRs #98–#129). "100%" strictly requires the four
  owner actions plus the live execution history only real factory operation
  produces. The certification percentages above are measured, not inflated.

### Owner goal — frictionless bot connection (closed 2026-08-16)

Owner directive: "Make the bot connection MUCH EASIER … similar to logging into
Claude or Codex, super easy and frictionless." Closed by PR #121 (squash
`eec1d4c`, CI run `31917860824` green: lint/typecheck/test/build + browser/a11y).
Four coupled changes, each with tests (bot suite 116/116):

1. A signed-in or pasted credential now makes its bot read **Ready** — bot
   readiness consults the same vault overlay the providers tab uses
   (`serializeBot` presence predicate; env-only default preserved for existing
   callers), so "connected" and "ready" can no longer disagree.
2. Connecting a provider leaves a ready default bot (`ensureProviderBot`):
   add-only (never duplicates, never edits a person's own bots), best-effort
   (a provisioning failure can never fail the already-succeeded connection).
3. The empty fleet leads with one primary action — "Sign in and add my first
   bot" (OpenRouter OAuth, the only genuine one-click among the providers,
   fronting Claude/GPT/Gemini) — with "Add one manually" kept one step down.
4. `POST /api/bots/connect/provision` finishes the one-click return as the
   authenticated owner. The service-role OAuth callback still cannot create a
   bot; owner-authorized work stays owner-authenticated.

Status: code merged and shipping with `main`. Live half **NOT TESTED** — no
owner has run the production OAuth round-trip since the merge; the first real
"sign in → ready bot waiting" pass will prove it (no agent can, it needs the
owner's provider account in a browser).

### Owner goal — frictionless END-TO-END experience (in progress, opened 2026-08-16)

Owner directive: make the ENTIRE owner journey frictionless — "Sign In →
Connect → Add Project → Give Goal → Factory Plans → AI Team Works →
Tests/Reviews → PR → Release → Validate → Report" — so a non-technical owner
mainly answers "What do you want accomplished?" Preserve all RLS / GREEN-YELLOW
-RED / zero-token safety. Run as a loop: walk journey → find friction →
simplify/automate → test → record → repeat.

**Journey audit — friction found (this loop):**
- Dashboard was the signed-in landing page but gave a first-time owner **no
  path**: metrics + safety facts, no "what to do next." (criteria 1, 27)
- The only guide (inside `LiveDashboardMetrics`) was a 3-step "Connect → Add
  project → **Open your files**" list whose last step was `done:false`
  permanently, so it **never completed**, and it steered to file-browsing, not
  to the actual goal (Bot Manager / a plain-English goal). It ignored worker
  readiness. (criteria 1, 9, 10)

**Iteration 1 — shipped (PR #124, squash `14f96a6`, CI green):** dedicated
`GettingStarted` dashboard guide.
- Four-step, completable journey that matches the real path: **Connect GitHub →
  Add a project → Check your AI worker → Give your Factory a goal**, each step's
  `done` read from live sources (`/api/projects`, `/api/github/connections`,
  `/api/worker/status`, `/api/commands`) so it can never overclaim. (criteria 1,
  3, 20)
- Every incomplete step deep-links to the screen that finishes it — missing
  config is one click from fixed. (criterion 19)
- Once all four are done the checklist **collapses into a single CTA — "Give
  your Factory a goal" → Bot Manager**, making Bot Manager the centerpiece.
  (criteria 9, 10, 27)
- Reads are independent/best-effort: a worker-status failure leaves that step
  unchecked instead of erroring the guide. Removed the stale 3-step guide from
  `LiveDashboardMetrics` (consolidation, criterion 28).
- Tests: `getting-started.test.tsx` (7 cases — signed-out no-fetch, per-step
  deep links, project→2-done, github-only→1-done, all-done ready CTA, worker
  -failure isolation, refresh-to-ready); `SetupSteps` grid adapts to 4 steps;
  `live-dashboard-metrics` suite still green. tsc + lint clean.

**Iteration 2 — shipped (PR #125, squash `fecd824`, CI green):** Bot Manager
goal box opens simple.
- Journey walk confirmed the goal box exists and is genuinely plain-English
  ("What do you want done?", example chips, project auto-selected to the first
  connected one) — the Dashboard CTA is not a dead end. The friction: it
  confronted every owner with Work type, Acceptance criteria, Depends-on, and
  the GREEN/YELLOW/RED risk picker on every visit. (criteria 8, 21, 29)
- `CommandComposer` now defaults to goal + project + Queue; the four technical
  controls live behind an "Advanced options" disclosure (aria-expanded,
  conditionally rendered so axe and tests see the true surface). Safe defaults
  unchanged: work type "other", GREEN, no deps, server-derived acceptance
  criteria — the server still re-checks risk/policy on every submission, so
  nothing here widens autonomy.
- Non-default advanced choices stay visible when the fold is closed (a summary
  line, e.g. "Security work · YELLOW risk requested") — hidden-but-active
  settings are how owners get surprised. RED warning still renders whenever
  RED is selected (it lives in the always-visible status area).
- Tests: 6/6 in `command-composer.test.tsx` — the three existing behavior cases
  (connected-projects-only, idempotency-key reuse, sorted dependencies) now
  open the disclosure first, plus three new: simple-view hides advanced fields,
  simple-view submission carries the safe defaults, closed-fold summary keeps
  non-default choices visible. tsc + lint clean.

**Iteration 3 — shipped (PR #126, squash `0126825`, CI green):** unified
"Needs Your Attention" area.
- `NeedsYourAttention` on the Dashboard (above the setup guide) lists ONLY
  decisions the owner alone can make, each as what happened → why it matters →
  one recommended-action button to the exact screen. (criteria 4, 17, 18, 22)
- Four decision sources, read independently and best-effort: owner-flagged
  unresolved production incidents (`/api/operations/overview`), commands
  awaiting owner approval (`/api/commands`, the RED path), GitHub connections
  in error (`/api/github/connections`), and queued work with no connected
  worker (`/api/worker/status` + commands). A failed source stays silent —
  it can hide its own items but never suppress another source or invent an
  item. Bounded to 6 items, incidents first.
- Empty state renders NOTHING — no shell, no zero-count banner — so the area
  never cries wolf and notifications surface only meaningful exceptions.
- Tests: 7/7 in `needs-your-attention.test.tsx` (all-clear renders nothing,
  signed-out fetches nothing, RED-awaiting-approval card → bot-manager,
  suspended-connection card with reason → connections, queued-work-no-worker
  card, unresolved-owner-flagged incident (resolved and auto-recovering ones
  excluded) → operations, one failed source doesn't suppress the others).
  tsc + lint clean.

**Iteration 4 — shipped (PR #127, squash `bfee914`, CI green):** honest
plain-language run progress.
- `run_status` records exactly five states (`queued/running/succeeded/failed/
  cancelled`, migration `20260812000100`), so the mapping is complete and
  one-to-one with what is stored: "Waiting for a worker" / "A worker is on it"
  / "Finished" / "Failed — needs a look" / "Stopped". `runStatusLabel` NEVER
  invents a phase ("planning", "reviewing") the run does not record; an
  unknown status falls back to the raw word. (criterion 20, truthfully)
- The draft-PR link — the run's actual deliverable — is promoted from the
  bottom of the evidence drawer to a primary "Review draft PR #N" action in
  the run-detail header. (criteria 20, 27)
- The recorded enum stays one glance away: a "Recorded status" fact row in the
  detail keeps the technical vocabulary available. (criterion 21)
- Tests: 4/4 in `runs-console.test.tsx` (five-state mapping one-to-one,
  unknown-status verbatim fallback, list shows "Finished" and never the raw
  enum, detail promotes the PR link and keeps the recorded enum). tsc + lint
  clean.

**Iteration 5 — shipped (PR #128, squash `eb32f28`, CI green):** Add-Project
measured, then trimmed.
- Honest audit against criterion 5 ("wizard-based"): the existing one-screen
  form already BEATS a wizard — repository auto-picked from the connection's
  selected repos, project name pre-filled from the repository, default branch
  taken from GitHub metadata and never asked, description optional, and new
  projects start with all automation off. Splitting that into wizard steps
  would add clicks, not remove them. Criterion 5's intent (guided, minimal,
  inferred) is satisfied by the form; recorded here rather than rebuilt as
  ceremony. (criteria 5, 6, 7 — nothing asked twice)
- The one real dead control: a "GitHub account" picker rendered even with
  exactly one connected account (the common case — a select with one option).
  It now appears only when there are two or more accounts to choose between;
  the repository list already names the owner (`owner/repo`), so nothing is
  lost. (criteria 8, 29)
- Tests: projects-console 4/4 — the two existing GitHub-evidence cases, plus
  single-account-hides-picker (and asserts the pre-filled name) and
  two-accounts-show-picker. tsc + lint clean.

**Iteration 6 — shipped (PR #129):** error-UX audit; the one real dead end fixed.
- Honest audit of every inline error site (19 `setMessage(error…)` call sites
  swept): most already carry their next action — the activity console has a
  full error card with Retry, commands/runs/backlog ride `TenantListShell`'s
  built-in reload, the file-manager and run-launcher render errors adjacent to
  the very button that retries, and the projects/connections load failures
  land on `BlockedState` deep links. Criterion 18 was largely already met;
  recorded rather than re-plumbed. (criteria 18, 19)
- The one genuine dead end was the highest-stakes moment: a failed one-click
  sign-in return (`?connect=expired/invalid/refused/failed`) rendered "Start
  it again" **with no way to do so** — in both the console-level banner and
  the providers-tab notice. Both now pair the failure text with a "Try
  signing in again" action (the same `/api/bots/connect/oauth/start` the
  front door uses). The retry condition is derived from the message itself,
  so no separate state can go stale. (criteria 18, 19, 29)
- Tests: bot-fabric-console 9/9 — new case lands on `?connect=failed` and
  asserts the notice carries the retry link. tsc + lint clean.

**Iteration 7 — shipped (PR #129, with iteration 6):** functional mobile pass.
- Audit scope: the five core owner surfaces (Dashboard guide + attention area,
  goal box, Connections, Add-Project, Runs list/detail), looking for touch
  targets, hover-only controls, overflow risks, and drawer usability at phone
  widths — beyond the e2e suite's existing three-width heading/viewport/axe
  proof. (criterion 26)
- Sound as found: buttons sit on `min-h-10`/`min-h-9` from the design system;
  no hover-only controls (hover styles only decorate tappable elements); the
  run detail is an inline card, not a fixed drawer, so it flows at 375px; repo
  names truncate; SHAs are shortened; the runs branch line truncates; the
  composer's chips/risk grid wrap and stack.
- Three real overflow risks fixed — all owner-authored text rendered without
  `break-words` inside `min-w-0` containers, where one pasted URL or long
  token would horizontally scroll a phone: attention-item what/why lines
  (`needs-your-attention.tsx`), the goal prompt in the commands list
  (`commands-console.tsx`), and the task title in the runs list
  (`runs-console.tsx`). Class-level fixes; behavior unchanged; 20/20 across
  the three affected suites, tsc + lint clean.

**Iteration 8 — shipped (PR #129, with iterations 6-7):** screens audited;
navigation re-led.
- Consolidation audit (criterion 28): the five "Work" consoles suspected of
  overlap have genuinely distinct purposes — Workflows (graph preview),
  Agents (role definitions), AgentOS (grants + decision inbox), Autonomy
  (permitted-actions + decision trail), Resources (routing evidence). No two
  do the same job; merging any pair would remove function, not friction.
  Recorded, not consolidated.
- The real criterion-28/8 gap was the sidebar: 16 destinations grouped by
  which phase built them, with the owner path buried (Bot Manager mid-list
  under "Work"). Regrouped by how an owner moves: the ungrouped top block is
  the daily path in journey order (Dashboard → Bot Manager → Projects → Runs
  → Reports), "Watch" holds Operations + Activity, "Advanced" holds the
  seven technical consoles (full function kept — nothing removed), "Setup"
  holds Connections + Settings. Labels and routes unchanged, so the e2e
  accessible-navigation proof still passes by name. (criteria 8, 21, 27, 28)
- Tests: new `app-shell.test.tsx` pins the daily-path order and every
  console's continued reachability. tsc + lint clean.

**Iteration 9 — shipped (PR #129, with iterations 6-8):** the critical
journey is E2E tested.
- `tests/e2e/journey.spec.ts`, two honest lanes. Lane 1 (every CI run, all
  three viewports): the signed-out journey scaffolding — Dashboard guide with
  all four steps and no attention-area noise, sign-in page offering the
  passwordless link, connections gate naming itself with a way forward
  (sign-in gate or truthful local-unavailability, console.spec precedent),
  the goal box present with Queue honestly disabled, runs naming its
  sign-in gate. Proven green locally on desktop/tablet/mobile projects.
- Lane 2 (local Supabase stack, skip-gated like auth-lifecycle.spec.ts): a
  real browser walks sign-up → confirmation email (Mailpit) → onboarding →
  Dashboard guide reads "0 of 4 done" with Connect GitHub as the current
  step → attention area absent for a fresh workspace → goal box renders,
  says "No connected projects yet", and keeps Queue disabled with text
  entered. Stops at the external-GitHub boundary by design: connecting a
  real GitHub App and a live command need the owner's accounts — exactly
  what the production canary proves. (criterion 30, to the honest limit)

### FRICTIONLESS COMPLETION REPORT (2026-08-16, loop iterations 1–9)

**FRICTIONLESS COMPLETION: ~87%** — 26 of the goal's 30 completion criteria
MET at the code-and-test level; 4 PARTIAL, each for an honest, named reason;
everything beyond ~87% requires either the owner's real accounts (live
proofs) or is a frozen-policy boundary this goal forbids weakening.

**E2E JOURNEY RESULT:** PASS to the external-account boundary.
`tests/e2e/journey.spec.ts` proves the signed-out scaffolding every CI run at
three viewports (each step exists, names its gate, offers the next action),
and the signed-in walk (sign-up → confirmation email → onboarding → live
4-step guide → honestly gated goal box) against a real local Supabase stack.
Beyond that boundary — real GitHub App connect and a live command — is
exactly what the production canary proves, and is owner-blocked.

**STEPS BEFORE → AFTER** (measured from the merged diffs):
- Bot connect (#121): ~6 owner steps (pick provider, obtain key, paste or
  name an env var, then hand-build a bot: name/model/credential ref) → **1
  click + provider approval**, ready bot auto-provisioned on return.
- First-run orientation (#124): no path (metrics + 16 nav items) → **4-step
  live checklist** that completes and collapses to one CTA.
- Goal submission (#125): 6 decisions (sentence, project, work type,
  acceptance criteria, dependencies, risk) → **2** (sentence, project) with
  safe defaults behind an Advanced fold.
- Add project (#128): 4 fields + an account picker → **repo pick + confirm**
  (name and branch inferred; picker only when ≥2 accounts).
- Finding owner decisions (#126): hunt across consoles/logs → **one
  attention area** listing only genuine decisions, each with one button.
- Understanding a run (#127): raw enums + PR link buried in evidence →
  **plain language** + "Review draft PR #N" leading the detail.
- Recovering from a failed sign-in (#129): dead-end text → **retry button
  in place**.
- GitHub connect on iPhone/iPad (#123): broken (fetch-set cookie dropped by
  ITP) → **works** via top-level navigation.

**OWNER INTERVENTIONS REMOVED:** naming credential env vars; hand-building
the first bot; re-typing repo name/branch GitHub already knows; choosing a
risk tier for routine work; scanning logs for RED approvals; re-starting
failed sign-ins from scratch.

**AUTOMATIONS ADDED:** auto-provisioned default bot on provider connect;
live setup-status detection on the dashboard; inferred project defaults;
attention aggregation across four decision sources; automatic idempotency
-key reuse on ambiguous submission failures (pre-existing, now surfaced);
connect-outcome auto-clear from URLs so refreshes never repeat actions.

**FRICTION REMOVED:** 9 iterations, PRs #121, #123–#129 — all merged with
green CI (lint/typecheck/test/build + browser/a11y at three widths).

**MOBILE RESULT:** iOS/iPadOS GitHub connect fixed (#123); three
owner-authored-text overflow risks fixed (attention items, goal prompts,
task titles); touch targets ≥36px from the design system; no hover-only
controls; journey e2e green on desktop/tablet/mobile projects. Live iPhone
round-trip: owner-pending.

**SECURITY/RLS:** zero safety-surface changes across all nine iterations.
No schema change, no new privileged path, no RLS/FORCE-RLS touch, no
GREEN/YELLOW/RED widening, zero-token design intact; every server-side
validation (risk, policy, binding, same-origin, owner-auth) unchanged. The
two new API routes this session (`/api/github/install/launch`, from #123's
predecessor line, and `/api/bots/connect/provision`, #121) both REQUIRE
owner/admin authentication and only reach screens/actions that already
existed.

**PARTIAL (4), honestly:** guided connect flows for Vercel/Supabase (their
adapters truthfully read Not Connected — future phase); goal-text → graph
-vs-single-worker auto-decision (orchestrator plans per command type; the
graph engine remains an explicit console); live worker auto-selection proof
(code+tests done, needs the canary and a second worker); production
protect/rollback/repair execution (control plane complete, execution
deliberately blocked pending owner enablement — a safety boundary, not a
gap).

**REMAINING OWNER ACTIONS (path to 100%):** run the production canary (app
sign-in page → "Email me a sign-in link instead" → click promptly on the
same device → Bot Manager → queue the canary sentence); one live GitHub
connect from an iPhone; hosted-ledger position check; second
repository/account; the Phase 2A paid-adapter decision.

### External Blockers (owner-only)

1. **1C canary**: browser → `/solutions/bot-manager` → GREEN command ("Create a Phase 1C canary documentation file and produce a draft PR"). Worker claims within ~5 min. Verify: `factory/*` branch + draft PR appear.
2. **Hosted migration apply** (position now measured — 65/`20260814002300`): follow the rebased `AI/HOSTED_APPLY_RUNBOOK.md` top section — `supabase link` → `migration list` (confirm `20260814002000` remote-only) → the two `migration repair` lines → `db push` (19 outstanding). Raise 2E capacity ceilings first if the factory should run wider than the conservative defaults.
3. **Second repository/installation** for 2C goal 34 (GitHub → SoftwareFactory App → Configure).
4. **Phase 2A paid-adapter decision**: exempt / remove / re-base (latent, switch OFF).

### Completed Evidence (this loop)

- Worker LIVE: Actions `31894356952`, job `95035227290`, steps all green, log lines quoted above; secret `SOFTWAREFACTORY_CODEX_AUTH_JSON` present (masked) in step env.
- Hosted ledger ahead of docs: owner screenshot, SQL Editor error `23505` on version `20260813001500`.
- Zero-token certification: `phase1c-worker-workflow.contract` asserts no step receives a paid key; worker log confirms subscription mode in production.

### Regression Findings

- `AI/CURRENT_STATE.md` + `AI/QUALITY_SCORECARD.md` claimed 1C "Not Connected pending the owner-supplied subscription credential" after the credential was configured and the worker live — stale-memory regression, corrected this commit.
- `AI/HOSTED_APPLY_RUNBOOK.md` baseline ("hosted ledger ends at `20260813001400`") disproven by the duplicate-key error; runbook needs rebasing once the real position is known (P1).

## HANDOFF — Phase 2C resource gates (2026-08-15, latest session)

**Branch:** `claude/github-connection-confirm-qe3tqm` · **PR #95 open**, CI green on the
first three commits, fourth in flight at handoff. If it is green, merge it.

Closes every agent-actionable row left in `AI/PHASE_2C_IMPLEMENTATION_PLAN.md` §2.1.

- **Capacity** (`lib/resources/capacity.ts`) is now *called*. It had shipped with tests
  and no caller, which is the same defect as Phase 2B goal 33 — a surface that exists,
  is tested, and no code path reaches. Wired into `assignWorker` as an eligibility gate
  beside capability, risk and breakers, never as a score weight: a weight can be
  outvoted, and "we exceeded the concurrency limit because the model was cheap" is not
  a trade anyone chose.
- **Dispatch** (`lib/resources/dispatch.ts`) joins `lib/graph/scheduler.ts` to
  `assignWorker`. It is deliberately not a loop over the single-node decision —
  `assignWorker` is told the reservations live *now*, so two nodes released in one tick
  both see the same free slot. Reservations thread forward through the batch instead.
- **Rate accounting** (`lib/resources/rate-limits.ts`) is a third gate, not more
  capacity. Short calls separate them: six concurrent slots filled by two-second calls
  is 180 requests a minute while never showing more than six in flight. A rate refusal
  carries `retryAfterMs`; a capacity refusal deliberately does not, because a window
  clears at a computable time and a concurrency refusal does not.

### Genuinely open, and why

- **Nothing here is persisted.** All three are pure functions; the caller owns the
  reservation set and the rate window, so a process restart forgets both. The plan rows
  say **COMPLETE (in-process; not yet persisted)** rather than COMPLETE, deliberately.
  Making them durable is the next real unit of work in this workstream, and the pattern
  to reuse is the `operations_events` one (`for update skip locked`, unique dedupe keys,
  bounded attempts) rather than a second invention.
- **Nothing calls `dispatch` yet.** It is reachable and tested but not on the 1C claim
  path, for the reason recorded in `CURRENT_STATE.md`: that path is hosted and live,
  nothing executes regardless, and changing it now buys no behaviour while risking
  conflicts with concurrent agents. Whoever wires it should do so with a worker pool
  that actually executes, or the same "built but unreachable" trap repeats one level up.

### Two corrections landed with it

1. `AI/CURRENT_STATE.md` still called migration `20260814000210` **unhosted**. It is
   hosted. It had been applied only partially — far enough to create `resource_breakers`,
   which is why re-running it raised `42P07` instead of doing nothing — and
   `scripts/repair-20260814000210.sql` completed it before the ledger was reconciled.
2. **The hosted number below is stale.** The previous section says 29 migrations are
   unapplied. The ledger now carries 65 rows covering all 64 files up to
   `20260814002300`, with `scripts/hosted-schema-audit.mts` reporting 0 outstanding and
   0 indeterminate. **8** migrations are unapplied to hosted: `20260814002400`,
   `20260814002500`, and the six Phase 2E files. Owner action, runbook unchanged.

### Owner-only, not agent-actionable

These are the whole reason this workstream is not at 100%, and no amount of building
closes them:

- **Codex quota** — exhausted until **2026-08-20**. Blocks 2A goals 18/19, the live half
  of 2B goal 30, and 1E rows 14/16. Recorded as `BLOCKED_BY_CODEX_QUOTA`. Buying credits
  is explicitly *not* the recommendation; the constraint is zero funded per-token usage.
- **GitHub App install** on `bubalysupport-prog`, selecting `TestMeBubaly` (1B items 2
  and 20).
- **Record a graph** via `/solutions/workflows` (2B goals 3 and 4). The launch path
  exists and is tested; it needs one owner action to produce a real row.
- **Vercel** is refusing preview deployments on PR #95 with
  `api-deployments-free-per-day`. Account-level daily cap, unrelated to any diff, and the
  only remedy it offers is a paid upgrade — left alone on purpose.

---

## HANDOFF — Phase 2E portfolio scheduling (2026-08-15, previous session)

**Branch:** `claude/softwarefactory-phase-1e-ops-mjdiiq`, pushed. Six migrations,
`20260815000100` through `20260815000600`. Full scorecard in `AI/PHASE_2E_COMPLETION.md`:
**33 PASS · 2 PARTIAL · 0 FAIL · 1 BLOCKED — 92%**.

### What the factory can do now that it could not before

It schedules a *portfolio*. `claim_phase1c_run` was already durable, lease-based and
dependency-aware, and it had no way to compare two projects: a P3 chore outranked
critical work whenever its task priority happened to be higher, and concurrency was
bounded only by how many workers were registered. Now:

- Projects carry P0–P3, strategic focus, an engineering pause, and a run ceiling.
  Owner-only functions set each and write an activity event.
- Ceilings exist at four levels — worker, project, provider account (or a single
  connection), and portfolio — and a reserve inside the portfolio ceiling that only
  effective-P0 work may occupy.
- Waiting work gains a priority tier per fairness interval, floored at P1, so nothing
  starves and nothing ages into the emergency reserve.
- An open circuit breaker withholds work from the provider it names; the cooldown
  admits exactly one trial, and taking it restarts the clock.
- Every assignment is recorded with project, task, agent, provider, connection and
  reason. Work that was ready and withheld by a ceiling is recorded too, deduplicated
  per minute so a polling worker cannot flood the audit.
- `/solutions/portfolio` shows capacity, the queue in scheduler order with a reason on
  every waiting item, and per-project scheduling state.

### Two defects fixed that were not features

1. **One logical agent per organization made portfolio concurrency impossible.** The
   scheduler refuses a second concurrent run for one agent, and the roster gave the
   whole factory one Backend and one QA. Everything else in 2E would have been enforced
   on a factory that still ran one project at a time. Agents are now cloned per project.
2. **The portfolio console counted statuses no enum can hold** — commands in `planning`
   and `blocked`, tasks in `ready`, incidents in `acknowledged` and `mitigating`. Every
   project reported zero open incidents however many were open, and queued tasks were
   not counted at all. A test now reads the enums out of the migration.

### Genuinely open, and why

- **Goal 9 (2D Identity Router).** There is no `lib/identity/` in this repository; 2D is
  not built. The capability is enforced by the claim path's connection joins. When 2D
  lands it should replace that join, not duplicate it.
- **Goal 17 (work locks).** Two lock mechanisms exist — the 1C agent-level exclusion and
  the 2B `graph_work_locks`/`task_work_locks` — and are not unified. Nothing is unsafe;
  they simply do not know about each other.
- **Goal 35 (hosted).** ~~29 migrations are unapplied to hosted Supabase.~~ **Superseded —
  see the section above: the ledger was reconciled and 8 are unapplied, of 72 files.**
  Verified locally across the full chain. Owner action, unchanged: `AI/HOSTED_APPLY_RUNBOOK.md`.

### Before you add a migration

Eleven test files pin the newest migration filename, and three more derive counts from
the migrations directory. They exist so a new migration cannot land without those
suites being re-run against it. Update the pins and the two count sentences in
`AI/HOSTED_APPLY_RUNBOOK.md`; the failures tell you exactly what to change.

Note one ordering constraint the repair test now encodes: `20260815000500` and
`20260815000600` define `language sql` functions over `resource_breakers`, whose bodies
PostgreSQL resolves at creation. They cannot be applied to a database where
`20260814000210` is half-applied — the repair has to run first.

---

## HANDOFF — previous session (2026-08-14)

**Branch:** `claude/softwarefactory-phase-1e-ops-mjdiiq` · **PR #40 open**, CI running at handoff.
If #40 is green, merge it. If it failed, the cause is almost certainly the
latest-migration pin (see "The pin" below), not the code.

**Active goal when this session ended:** *"fully build out 1B GitHub, 100% production
ready and 100% connected to Supabase."* Half of that is reachable; half is not, and
the next agent should not burn time rediscovering which.

### The one thing that cannot be done from an agent container

`supabase db push --dry-run` → `LegacyProjectNotLinkedError`. There is no
`SUPABASE_ACCESS_TOKEN`, no `supabase/.temp` link, and **no Docker daemon**, so
`supabase start` cannot run a local stack either. Both verified this session, twice.

**Eleven migrations are unhosted** — everything after `20260813001400`. The exact
list, order, and a real-PostgreSQL-16 verification of the whole chain applied from
the hosted position are in **`AI/HOSTED_APPLY_RUNBOOK.md`**. Do not re-derive it.
One of them (`20260813001500`) needs its own fresh RED approval against a frozen SHA.

Until an owner applies those, the **newest** surfaces stay empty. But note the
correction recorded in `AI/PHASE_1B_COMPLETION.md`: unapplied migrations do not
mean the application is disconnected. Production serves marketing content from
Supabase right now — verified externally, because `ContentSourceNotice` would
render a **Demo data** banner if it were falling back to seeded copy, and does
not on `/`, `/features` or `/pricing`. All eleven Phase 1B migrations are hosted.
What is pending is the newest twelve migrations across all phases, one of which
(`20260814001100`) is 1B's.

### Where 1B actually stands

Done and merged, or in #40:
- Owner repository path live; draft-PR-only writes work.
- **Adverse lifecycle** — `tests/integration/github-adverse-lifecycle.behavior.test.ts`,
  9 tests. Approval expiry, owner-only decision, connection loss with history kept,
  repeated loss converging, disconnect refused on mismatched installation id, rows
  retained through disconnect, cross-tenant refusal, anonymous denial, member
  read-without-mutate.

**Next tranche, in priority order.** Each needs a mocked GitHub response rather than
schema alone, so they belong in a route/unit test, not a PGlite behavior test:

1. **Stale SHA.** A change whose `expected_blob_sha` no longer matches must be refused,
   not overwritten. `reclaim_expired_github_change_reservation` and
   `reserve_github_change_request` are the functions; the worker already rejects
   `stale_base_sha`, so mirror that vocabulary rather than inventing a new code.
2. **Rate limit must not falsely revoke.** `mark_github_connection_lost` accepts only
   `installation_revoked`, `insufficient_permission`, `provider_authorization_failed`.
   A 429 is none of those, and treating it as loss would disconnect a healthy
   integration during a traffic spike. `lib/github/errors.ts` is where the
   distinction lives; assert a 429 does **not** reach the loss path.
3. **Webhook provider ordering.** `github-webhook-ordering.test.ts` exists — extend it
   for out-of-order delivery of installation lifecycle events, where an older event
   arriving late must not resurrect a terminal state.

### Things that will bite you

**The pin.** Nine-plus test files assert the *last* migration filename as a tripwire so
a new migration cannot be added without someone reading the suites that replay the
chain. It is doing its job, but with several agents landing migrations the same day it
conflicts constantly. Resolve it to whichever filename genuinely sorts last —
check with `ls supabase/migrations/*.sql | sort | tail -3`, do not assume your own.
Newer suites (`phase2b-task-graph`, `phase2c-model-declaration`) deliberately assert
`toContain(<their own migration>)` instead, because which file sorts last says nothing
about what those tests depend on.

**Two tripwire counts** move whenever a table is added: the RLS count in
`phase1e-operations.behavior.test.ts` and the `publicTables` list in
`hosted-service-role-table-grants.test.ts` (keep it alphabetical).

**CI will not run on an unmergeable head.** If checks never appear on a PR, the PR is
`dirty` — merge `origin/main` into the branch first. That cost a confusing half hour
this session.

### Do not do these without an explicit owner decision

- **Build the 1D merge or deploy executor.** `AGENTS.md` forbids introducing auto-merge
  or a production deployment workflow in this line of phases. The tests asserting
  `MERGE_EXECUTOR_NOT_CONNECTED` / `DEPLOY_EXECUTOR_NOT_CONNECTED` are *designed* to
  fail when an executor appears — that failure is the signal to stop and ask, not to
  update the assertion.
- **Use a provider key pasted into chat.** One was pasted this session; it is
  compromised by having been pasted and must be rotated, never installed.

## BLOCKER 2026-08-15: GitHub Actions has no runners

Both required CI jobs fail three seconds after creation with `runner_id: 0` and no runner name.
Reproduced with a deliberate re-run (run `31853623402`). Workflow YAML is valid and unchanged;
the same tree passes lint, typecheck, 1748 tests and a clean build locally.

This is account-level — check Actions minutes / billing at <https://github.com/settings/billing>.

Two consequences worth stating plainly:

- **No PR can be gated normally.** PR #40 was merged on local gate evidence, and its merge commit
  says so rather than implying CI passed. Any agent that sees "checks never appeared" should
  suspect this before suspecting its own change — though note the *other* cause of missing checks
  is an unmergeable head, which looks identical from a distance.
- **The Phase 1C live canary cannot run**, because it runs on Actions. The zero-token Codex
  credential and working runners are independent blockers; both must clear before 1C can produce
  a live branch, commit and draft PR.

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
| Phase 2B — graph engineering | **Open in PR #27**; stages 1–5, 6 of 7 demonstrations passing | Provider credentials for the live model calls only |
| Phase 2C — resource manager | **Merged; scoring, persistence, UI and routing built** | Unhosted migrations; no declared models; no provider run has ever executed |
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

Both were tested against the live provider on 2026-08-15 11:49Z rather than assumed. One is
closed and one is not, and the open one is the more dangerous of the two.

- [x] **The `sb_secret_` Supabase service key is revoked.** Exposed in a screenshot. A request
      carrying it now returns `401` from the project's REST API, so the rotation happened and the
      old value is dead.
- [ ] **The `sbp_` Supabase personal access token is STILL LIVE.** Pasted into a session
      transcript, so it must be treated as public. `GET https://api.supabase.com/v1/projects`
      carrying it returned **`200`**.
      That is **account-level** Management API access, not project-scoped: it can enumerate every
      project on the account, read and write configuration, and execute SQL. It is a strictly
      wider credential than the service key that was correctly rotated.
      Revoke it at **supabase.com/dashboard/account/tokens**. Nothing in this repository needs it —
      the hosted audit below deliberately runs on the service-role key instead, precisely so that
      verifying hosted state never requires a token like this one again.

A note on how this was checked, because the method matters for the next one: confirming a leaked
credential is dead is done by *using* it once and requiring a rejection. A credential assumed
rotated because someone remembers rotating it is not rotated. This one was.

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
- [ ] **Apply the twelve unhosted migrations.** Measured against hosted 2026-08-14 21:00Z: the
      ledger holds **45 rows** ending at `20260814000200`; the repository holds **57** migrations.
      Nothing in the ledger is missing from the repository. `AI/HOSTED_APPLY_RUNBOOK.md` carries
      the exact list and order, and now leads with the measured position — its original table was
      stale, and two of its claims were wrong in a way that mattered:
      `20260813001500_expose_bounded_run_routing.sql` (the frozen, RED-approval one) is **already
      applied**, confirmed both by its ledger row and by `public.get_agent_run_detail` existing in
      hosted, so no fresh RED approval is needed for it; and the count was six rather than twelve.
      Two of the twelve sort **below** the ledger high-water mark, so they were skipped rather
      than deferred and `db push` may not pick them up unprompted.
      **An agent cannot apply these**: writing to hosted Supabase is refused by the Claude Code
      auto-mode classifier, which is the correct guard for a RED action against production.
      Verifying the position above was read-only and was permitted.
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
| AgentOS (spec in `docs/AGENTOS_SPEC.md`) | **Blocks A–G built and wired** | H (PWA/live viewer) unstarted; 10 unhosted migrations |

Gates on current `main`: lint, typecheck, 149 files / 1674 tests, clean production build,
Playwright across desktop/tablet/mobile including axe.
Gates on current `main`: lint, typecheck, 149 files / 1666 tests, clean production build,
Playwright 126 passed across desktop/tablet/mobile including axe.

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

### Done this session — the decision trail is now readable

`autonomy_decisions` had recorded every decision since `20260813001600` and **nothing read it**.
An append-only trail no surface can show is storage, not auditability. Added:

- `list_autonomy_decisions` — what the loop decided, why it refused, against which head. Reports
  whether an approval was *independent* rather than who signed it; the identities stay on the row
  for a targeted audit and never reach a caller (asserted).
- `list_autonomy_status` — the resolved envelope per project with **both interlocks and executor
  connectivity beside it**. Nine OFF flags alone read as "ready but idle"; with these they read as
  "nothing could run".
- `/api/autonomy/decisions`, `/api/autonomy/status`, `/solutions/autonomy`, nav + redirect + axe.
- Enabled actions are counted from `resolved_autonomy_controls`, never a project row, so an
  organization override cannot read as enabled.

The console deliberately offers **no toggle**. Enabling an automatic action is RED and needs its
own owner-approved migration; a test asserts no switch control exists on the page.

Migration `20260814001000_phase1d_decision_visibility.sql` is **unhosted** — add it to the runbook.

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

- [x] Thirteen tenant-scoped tables in `20260814002000_graph_engineering.sql`, all RLS + FORCE
      RLS, member-read-only, with no browser write grants.
- [x] Work locks with heartbeat, expiry and abandoned-lock recovery, enforced by a partial
      unique index on `state = 'HELD'` rather than by the scheduler remembering.
- [x] Write boundary (`20260814002100_graph_write_boundary.sql`): seven SECURITY DEFINER
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

- [x] **Persist breaker state and routing decisions** (migration `20260814000210`, RLS + FORCE RLS,
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
      → model profiles. Migration `20260814000220` adds owner-declared `strength_tier` and
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
- [x] **Adverse lifecycle covered twice, by two agents, against the real migrated schema.**
      `tests/integration/github-adverse-lifecycle.behavior.test.ts` (9 tests, from `main`) and
      `tests/integration/github-adverse-lifecycle.test.ts` (12 tests, from this branch). They
      overlap and that is fine — both survived the merge because each asserts something the
      other does not, and deleting either to remove duplication would remove coverage with it.
      Between them: revoked and insufficient-permission loss, idempotent re-signalling, repeated
      loss converging on one end state, explicit disconnect, terminal deletion, approval expiry
      (an expired row still reads `approved`; only the expiry distinguishes it), owner-only
      decision, cross-tenant refusal of every privileged function, anonymous denial, and member
      read-without-mutate.
      Each asserts the *refusal*, because the refusals are the paths that had never been
      exercised: a loss reason outside the declared set is rejected rather than stored; a
      disconnect aimed at the wrong installation ID fails, so it cannot hit a connection that was
      since re-installed; a non-owner cannot disconnect; a deleted installation cannot be
      restored, so a revoked integration cannot quietly come back; and status and deletion marker
      cannot disagree. `decide_approval` refuses a non-owner **outright** rather than recording a
      decision that later fails validation — the stronger guarantee, because no approved-looking
      row ever exists to be misread.
- [x] **Disconnect and loss preserve history.** Both paths keep the installation row: the record
      of what was connected is the only thing that explains what happened afterwards, and losing
      it with the connection would be worse than the loss.
- [ ] Still open: stale-SHA rejection, rate-limit handling that must not falsely revoke a
      connection, and webhook provider ordering. Each needs a mocked GitHub response rather
      than schema alone. (Provider ordering has schema-level coverage in
      `github-webhook-ordering.test.ts`; what is missing is the provider response.)
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

### Status — A through G are built, wired to Supabase, and pushed

| Block | State | Where |
|---|---|---|
| A Isolation model | **Done** | `20260814000300`, 9 tables + `agentos_resolved_agent_grants` |
| B Filesystem ACL | **Done** | `lib/agentos/filesystem-acl.ts`, pure + exhaustively tested |
| C Inbox | **Done** | `20260814000400`, one open question per run, resume contract |
| D Templates + gates + chains | **Done** | `20260814000500`/`000600`, the 9-step workflow seeded |
| E Goals + rails | **Done** | `20260814000700`, spend/time/stuck all stop the loop |
| F Triggers + automations | **Done** | `20260814000800` + `lib/agentos/webhook-payload.ts` |
| Wiring | **Done** | `20260814000900` projections, 5 API routes, `/solutions/agentos` |
| G CLI + `agentos.yml` | **Done** | `lib/agentos/project-config.ts`, `lib/agentos/cli-options.ts`, `scripts/agentos.mts`, `20260814001300`/`001400` |
| H PWA + live viewer + activity feed | **Not started** | mostly UI over data that now exists |

**Migrations `20260814000300`–`20260814001400` are all unhosted.** Add them to
`AI/HOSTED_APPLY_RUNBOOK.md` before anyone applies anything.

#### Block G, as built

- `agentos_export_project_config` / `agentos_apply_project_config` are the only write path.
  `authenticated` holds SELECT and nothing else on every `agentos_*` table, so a CLI writing
  through PostgREST could not insert a row even with a valid session. Applying a configuration
  requires **owner or admin**, not merely membership.
- **Deleting is off by default.** `p_prune` defaults to false; a push adds and updates, and
  reports anything the file omits as `extra` drift. The CLI needs `--prune --yes` — two separate
  flags — and prints what it would remove before it removes anything.
- A **builtin template is never redefined from a file**, and is excluded from export as well.
  Exporting it would hand back a file that push refuses, breaking the round trip on any
  organization that seeded the compound-engineer workflow.
- A **repository grant resolves against installed repositories**. A YAML edit cannot invent
  repository access by naming a string.
- Round-trip acceptance is proven twice: through the file format
  (`tests/unit/agentos-project-config.test.ts`) and through real PostgreSQL
  (`tests/integration/agentos-project-config-sync.behavior.test.ts`).

**Two traps found while building G, both worth knowing:**

1. A plpgsql local named `agent_id` shadows the column of that name, so
   `where agent_id = agent_id` is a tautology that deletes **every organization's** grants.
   Every local in `20260814001400` is `v_`-prefixed because of this. The regression test that
   catches it is the cross-organization bystander case — an in-organization test misses it,
   because a later agent in the same push rewrites what an earlier one wiped.
2. Nine integration tests assert "the newest migration is X" as a tripwire. Adding a migration
   means updating all nine. Do **not** blanket-sed migration filenames across `tests/` —
   `agentos-routes.contract.test.ts` reads a migration as a *source file*, not as a tripwire.

### If you pick this up next

- Every block reports `*_RUNNER_NOT_CONNECTED` and `maySpawn: false`. That is the `AGENTS.md`
  line held against a spec that assumes unattended multi-hour runs. **Do not connect a runner as
  a side effect of building G or H** — it is a RED action needing its own owner approval.
- The mutation-testing habit in this workstream has caught real defects repeatedly, including a
  live prompt-injection hole in the webhook sanitizer (a fixed delimiter a payload could print).
  When a mutation *passes*, check the mutation actually applied before concluding the guard is
  redundant — three did not, and one revealed a guard unreachable through its normal path.
- Two traps that bit more than once: the latest-migration tripwires in nine test files are
  guards, but some files reference a migration filename as a *source to read* — updating those
  breaks them. And a single `Response` object cannot be reused across concurrent fetches in a
  test; the first reader starves the rest.

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

## Provider sign-in (in progress)

**Goal from the owner:** "I do not want to have to know any values, make it
simple, login to the (for example) claude bot itself."

**The finding that shapes this.** Anthropic has no third-party OAuth. The only
supported way to obtain a Claude *subscription* token is `claude setup-token` /
`claude login` — Anthropic's own CLI running their own OAuth in the operator's
browser. Embedding a "Sign in with Claude" button would mean impersonating the
Claude Code CLI's private OAuth client: undocumented, breaks without notice, and
not ours to use. **Do not do it.** The same holds for Codex (`codex login`).

Subscription mode is also the $0 path. `lib/providers/claude-auth.ts` and
`lib/worker/auth.ts` already resolve it and already refuse to reach api_key mode
by fallback. The connect UI ignored all of this and only offered API keys, which
is both harder and the billed route.

**Owner decisions (asked and answered):**
- Full in-app login, accepting that the app stores the token.
- Subscription sign-in is the default; API keys stay available but secondary and
  labelled as billed per token.

**The flow to build.** The operator never sees a token or a variable name:

1. Click "Sign in with Claude" in the bot console.
2. Server creates a single-use connect session (code from
   `generateConnectCode`, ~10 minute TTL, owner-scoped).
3. UI shows one pre-filled command to copy.
4. That command runs Anthropic's real browser login locally, captures the
   resulting token, and POSTs it to the control plane over HTTPS.
5. Server seals it with `sealSecret` and marks the session claimed.
6. The existing live probe verifies it; the tile flips to Verified.

### Done

- `lib/server/secret-box.ts` — AES-256-GCM sealing, key derived per
  (organization, purpose), master key from `SOFTWAREFACTORY_CREDENTIAL_KEY` and
  never defaulted. 16 tests, 3 mutations verified. Commit `1edeb1e`.

### Next, in order

1. **Migration** — `provider_credentials` (organization_id, purpose, sealed
   envelope, created_by, rotated_at; RLS + FORCE RLS; owner/admin only; no
   browser SELECT of the envelope) and `provider_connect_sessions` (code hash,
   purpose, expires_at, claimed_at, single-use partial unique index on open
   sessions). Both need audit events.
2. **Routes** — `POST /api/bots/connect` creates a session and returns the
   command; `POST /api/bots/connect/claim` accepts the token, seals it, marks
   claimed. Claim must be constant-time on the code, rate-limited, and must
   refuse an expired or already-claimed session.
3. **CLI** — `scripts/connect.mts`: runs `claude setup-token`, posts the result,
   prints nothing sensitive.
4. **Resolver** — teach `resolveClaudeAuth` to read the sealed store before the
   environment, so a signed-in token wins over a stale variable.
5. **UI** — "Sign in with your Claude subscription" as the primary action;
   API-key path demoted and labelled billed.

### Owner action still required

`SOFTWAREFACTORY_CREDENTIAL_KEY` must be set before any credential can be
sealed — 32+ random bytes, base64. Generate with
`node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`.
Store in Vercel → Settings → Environment Variables, marked Sensitive, Production
and Preview. Never in source control. Rotating it makes every stored credential
unopenable, which is the intended blast radius.
