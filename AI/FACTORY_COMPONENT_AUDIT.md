# AI Factory component audit

A component-by-component walk of the factory, with the evidence each step
produced. Every row is a real command or a real workflow run, not a reading of
the code. "Not Connected" rows record what is missing, never a pass.

Date started: 2026-08-19. Branch: `claude/github-connection-confirm-qe3tqm`.

## Method

For each component: run the thing, read the output, and either record the pass
with its evidence or fix the defect and re-run. The Claude job under test is
deliberately the simplest routine available — `claude -p` returning one fixed
string — so that a failure is attributable to authentication or the runner, not
to the prompt.

## Results

| # | Component | How it was tested | Result | Issue found | Resolution |
|---|-----------|-------------------|--------|-------------|------------|
| 1 | Repository gate — lint, typecheck, unit + integration suite, production build | `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` locally on `main` | PASS — 287 files, 3409 tests, build exit 0 | None | — |
| 2 | Claude bot job (`claude-worker.yml`) | Dispatched on `main`; the job installs the CLI and runs one `claude -p` returning a fixed string | PASS — run [32314101440](https://github.com/surgeservicesllc/SoftwareFactory/actions/runs/32314101440), every step success | None. The subscription credential authenticates and the CLI answers | — |
| 3 | Graph executor worker (`graph-worker.yml` → hosted Supabase) | Read the live drain of 2026-08-19 22:54Z | PASS — graph `c9d4f1e8` ran 7 nodes, run `1df3fd45` finished COMPLETED, 7 succeeded 0 failed | None in the lane itself | — |
| 4 | Codex one-shot worker (`codex-worker.yml`) | Read run [32311563906](https://github.com/surgeservicesllc/SoftwareFactory/actions/runs/32311563906) | FIXED — job was green and silent | The log ended at `is ready.`; `runOnce()`'s outcome was discarded, so a job that claimed and executed a durable run and a job that found nothing to claim produced identical green output | Added `lib/worker/drain-report.ts` and reported the outcome in `scripts/worker.mts`. `describeClaimOutcome` says "finished", not "succeeded" — a claimed run that failed is still finished here, and the run record carries the terminal state |
| 5 | Graph drain summary | Same reading, applied to `scripts/graph-worker.mts` | FIXED | `SoftwareFactory graph worker is done.` is equally true of a drain that ran six graphs and one that ran none | Added `lib/graph/drain-report.ts`; the drain now names how many graphs it ran. Covered by `tests/unit/drain-report.test.ts` |
| 6 | Hosted schema audit (`hosted-schema-audit.yml`) | Dispatched; run [32314214622](https://github.com/surgeservicesllc/SoftwareFactory/actions/runs/32314214622) | FIXED — the probe worked, its scope did not | It reported "4 applied, 0 outstanding" against a hand-written list of four migrations while the repository holds 123. The reassuring line was true only of the four it still knew about | Derived the expectations from `supabase/migrations` (`lib/supabase/migration-tables.ts`). 29 migrations create the 114 public tables and are probed; the other 94 create only functions, policies, grants or data and are now **named** as not probeable rather than silently omitted. Parser ignores DDL inside comments and non-`public` schemas. Covered by `tests/unit/migration-tables.test.ts` |
| 7 | Graph live canary (`graph-live-canary.yml`) — five real Claude nodes through the Phase 2A transport | Dispatched; run [32314191037](https://github.com/surgeservicesllc/SoftwareFactory/actions/runs/32314191037) | FIXED — two defects, one of them in the production transport | (a) The synthesis node spent its whole six-turn budget. (b) The transport reported that as `ProviderError: upstream_unavailable` — an Anthropic outage — because the SDK **threw** the exhaustion instead of yielding it as a result message. The result path already called the identical condition `invalid_response`, so which cause an operator saw depended only on the SDK's reporting shape | (a) `SYNTHESIS_TURNS` 6 → 12, with the measurement recorded rather than a new guess. (b) `lib/providers/claude-cli-transport.ts` now classifies a spent budget the same way on both paths; `tests/unit/claude-cli-transport.test.ts` asserts both shapes give `invalid_response` and that a real transport failure still gives `upstream_unavailable`. Verified the test fails without the fix |
| 8 | Handoff canary (`handoff-canary.yml`) — Claude plan → Codex implementation → fresh Claude review | Read the last run, [31896595171](https://github.com/surgeservicesllc/SoftwareFactory/actions/runs/31896595171) | **Blocked, not broken** — the Claude leg passed (`PLAN OK files=2 criteria=12`), the Codex leg refused | `You've hit your usage limit … try again at Aug 20th, 2026 10:05 AM` — the ChatGPT subscription quota, not a code defect | Nothing to fix in the code: the canary failed honestly and named the cause. Re-runnable after the quota resets on 2026-08-20 |
| 9 | AI account auth broker (`auth-broker.yml`) | Read the run history | PASS — run 32289234105 has been live since 18:46Z, with one queued successor | The cancelled scheduled runs looked like failures at first glance | Not a defect: `concurrency: auth-broker` with `cancel-in-progress: false` admits one waiter and cancels the rest while the six-hour worker holds the group. Working as designed |
| 10 | Hosted schema, re-audited with the derived list | Dispatched the fixed audit on this branch, four times as its coverage improved; final run [32316446825](https://github.com/surgeservicesllc/SoftwareFactory/actions/runs/32316446825) | **Owner action required** — the answer moved from "0 outstanding" to **46 applied, 4 outstanding, 0 indeterminate, 74 not probeable (of 124)** | Four migrations are not fully visible on hosted: `20260814000300_agentos_isolation_model` (nine `agentos_*` tables), `20260814002500_provider_credential_vault` (`resolve_provider_connect_session()` — its sibling `claim_provider_connect_session()` **is** visible, which is what makes this a real absence rather than a probe artifact), `20260815001100_connection_routing_decisions`, and `20260816001600_phase2c_resource_reservations` (`resource_reservations`, `resource_rate_events`) | Not applied by an agent — production DDL is owner-approved, and NOT VISIBLE cannot be told from absent without `scripts/hosted-state-report.sql`. Recorded here and in `AI/CURRENT_STATE.md`. Rows 11, 15 and 16 cover how the application behaves meanwhile |
| 11 | Failure behaviour of the code that depends on those tables | Read the consumers of each missing table | PASS — all three degrade honestly | — | `resource_reservations`: `lib/resources/reservation-store.ts` returns `ADMISSION_UNAVAILABLE` and refuses, so a missing admission table cannot silently delete the limit. `agentos_*`: `/api/agentos/grants` answers `agentos_grants_unavailable` with "Agent permissions could not be loaded." `connection_routing_decisions`: no application consumer reads it at all |
| 12 | `apply-hosted-migrations.yml`, `scope: probe` | Read the step gating with a YAML parse | FIXED | The workflow documents `probe` as changing "nothing at all", but "Repair stale ledger rows" sat above the scope branch and so ran on every scope. A probe — the scope an operator picks precisely when they do not trust the ledger — could rewrite production history rows | Gated the repair on `inputs.scope != 'probe'`. `tests/unit/hosted-apply-probe-is-read-only.test.ts` pins the exact set of steps a probe can reach, so a future ungated step fails the test rather than production |
| 13 | Live production request boundary (`softwarefactory-tan.vercel.app`) | Unauthenticated GETs against the marketing site and three control-plane routes | PASS | None | Marketing `/` and `/pricing` render 200. `/api/providers`, `/api/graphs/runs` and `/api/agentos/grants` each answer `401 {"error":{"code":"authentication_required"}}` and leak nothing else |
| 14 | Production security headers | `curl -I` against production | PASS | None | `content-security-policy` with `frame-ancestors 'none'` and `default-src 'self'`, `x-frame-options: DENY`, `x-content-type-options: nosniff`, `strict-transport-security` (2 years, preload), `referrer-policy`, `permissions-policy` all present |
| 15 | Bot connect — claim a signed-in credential from a CLI (`POST /api/bots/connect/claim`) | Traced the consumer of the one function row 10 found missing | FIXED — a live user-facing path was misreporting its own failure | The route calls `resolve_provider_connect_session`, which hosted does not expose. A `peekError` and "no session matched" both answered `connect_session_invalid`, so **every correct code was being told "that sign-in link is not valid"** — and each retry mints another code that fails identically | Split the two: a failed lookup now answers `503 connect_unavailable`, an unmatched code still answers `400 connect_session_invalid`. This does not reopen the guessing oracle the uniform failures exist to close — the new branch depends on whether the lookup works at all, never on which code was presented, and a test asserts unknown and malformed codes still answer byte-identically. The underlying absence still needs the owner-approved apply from row 10 |
| 16 | Coverage of the audit probe itself | Four dispatches, each narrowing a false signal | FIXED, three times over | (a) The probe could only speak to tables, so it was silent about the graph lane's entire write boundary, which is functions. (b) Probing every function reported thirty fully-applied migrations as `PARTLY VISIBLE`, because PostgREST cannot list a trigger function. (c) Probing functions granted only to `authenticated` reported `find_open_ai_auth_session`, `declare_cross_project_dependency` and `agentos_resolved_agent_grants` as outstanding when the tenant boundary was simply doing its job | Read PostgREST's own OpenAPI description, which names every callable routine and executes none; exclude trigger functions; and ask only about functions granted to `service_role`, the role the audit reads as. Guarded by `CONTROL_FUNCTION = claim_planned_graph`, which the graph worker called against this database at 22:54Z, so a privilege-filtered or empty description cannot read as "everything is missing" |
| 17 | The eight-step AI Factory journey (`/solutions/ai-factory`) | Read each step's completion derivation; probed all five endpoints it reads on production | PASS | None | Every step derives from live records, never stored wizard state. "Watch It Ship" is `status === "succeeded"` alone, so nothing in flight can mark it done. All five endpoints (`/api/github/connections`, `/api/projects`, `/api/ai-accounts`, `/api/bots`, `/api/commands`) answer 401 unauthenticated, and the page itself renders only a sign-in state with no tenant content |
| 18 | Webhook ingress and static surfaces, live | `GET` against production | PASS | None | `/api/github/webhooks` answers 405 to a GET, so the endpoint exists and accepts only its signed POST. `robots.txt` disallows `/solutions`, `/api/`, `/auth/` and `/sign-in`; `sitemap.xml`, `manifest.webmanifest` and `/offline` all serve |
| 19 | Durable resource reservations (`lib/resources/reservation-store.ts`, migration `20260816001600`) | Traced every importer outside the module's own tests | **Known gap, deliberately not closed today** | Nothing executing imports it. The batch dispatcher and the durable store are built, tested, and unreachable — the shape this audit exists to catch | Not wired, and the ordering is the reason: the store fails closed by design, and its table is one of the four row 10 reports as not visible on hosted. Wiring a fail-closed admission gate against a missing table would refuse every claim and stop the graph lane, which is the one execution path working today. Apply the migration first, then wire. `AI/CURRENT_STATE.md` now says this rather than describing the lane as merely "pure functions" |

## Round 2 — the AI Factory journey, filled in with fake data

The eight-step guided journey at `/solutions/ai-factory`, walked step by step
against real PostgreSQL with the real migrations, every field filled with fake
data and every write through the same SECURITY DEFINER function the browser
reaches. `tests/integration/ai-factory-journey.behavior.test.ts` is the walk;
it prints what it did, so a green run is readable rather than merely green.

| # | Step | How it was tested | Result | Issue found | Resolution |
|---|------|-------------------|--------|-------------|------------|
| 20 | 1 Connect Repository | Connected GitHub connection with a selected repository | PASS | None | `done` reads `connectedInstallations`, which is real. The payload carries `selected`, so the repository count is real too |
| 21 | 2 Create Project | `connect_github_project` with a fake repo, name and description | PASS | None | Binds by immutable external repository id, not by a name a prompt could choose. A rival tenant calling it is refused |
| 22 | 3 Configure Pipeline | `create_pipeline_template` / `update_pipeline_template` with fake areas | **FIXED** | `done` was `activeProject !== null` — character for character the same expression as step 2, so creating a project marked the pipeline configured and the step could never be outstanding. Its evidence was a constant string naming the built-ins whether or not any compiled. The page read **nothing** from Supabase for this step | Derived from `/api/pipeline-templates` (which the journey was not fetching at all) plus what actually compiles, still scoped to the active factory so an empty workspace reads zero. A template that stops compiling now shows here rather than nowhere |
| 23 | 4 Connect Bots | `create_ai_account` + `register_bot` with a fake subscription account | PASS | None | A credential *value* in the credential-ref field is refused by the database, not just by the form |
| 24 | 5 Assign Bots | `save_bot_role` + `assign_bots_to_project` | PASS | None | — |
| 25 | 6 Configure Bot Settings | `update_bot_assignment_configuration`, checked against the console's own predicate | **FIXED** | `done` was `roleId \|\| responsibilities.length`. `bot_assignments.role_id` is NOT NULL, so the first half was true of every assignment that can exist, and the API nests `responsibilities` under `config`, so the second read `undefined`. The step was done the instant a bot was assigned; its evidence could only ever read "N of N configured" | `assignmentIsConfigured` compares against `LEAST_PRIVILEGE_CONFIG`, which is what the module already says configured means: a posting created with no settings *is* least privilege, and every departure is something somebody chose |
| 26 | 7 Issue a Command | `submit_command` with the exact parameter object the browser sends, built from the app's own plan builder | PASS | None | Idempotency key suppresses a duplicate; a destructive prompt is held for owner approval even when GREEN was requested |
| 27 | 8 Watch It Ship | Read the command's state, and what the page tells the owner | **FIXED** | The step said "Every run lands as a draft pull request with CI evidence" and headed its panel "Command execution, live" over a command that would sit queued indefinitely. `/api/bots` has been publishing `executor.connected = false` all along; the page never read it | Reads that field and says **Not Connected** in those words. An absent or unreadable field reads as Not Connected — the one direction this must never fail is claiming an executor that is not there |
| 28 | Tenant isolation and evidence | Same journey re-run as a rival tenant | PASS | None | Projects, bots, assignments and templates are invisible; `list_activity` returns nothing; activity events refuse deletion for every role |
| 29 | The Create Project form itself | Filled every field and submitted | **FIXED** | Its tests covered which pickers appear and **never submitted**. The POST is the entire capability step 2 depends on | Added submit coverage asserting the exact body, that the repository goes by numeric id, and that a 409 keeps the failure on screen instead of reporting a project that was not created |

Two unit fixtures had been keeping the step-6 defect green by describing rows
the database cannot hold — an assignment with no `roleId`, and one with a
`roleId` and no config. Both now describe real records. That is the same shape
as the defects themselves: a check that cannot fail, and a fixture that cannot
exist, agreeing with each other.

**What could not be tested this round.** The live page at
`www.theagoras.com/solutions/ai-factory` renders only a sign-in state to an
unauthenticated visitor, and no credential for that tenant is available here.
Filling the live form would also write fake data into the owner's production
tenant, which is not an agent's call. This container has a Docker client but no
daemon, so `supabase start` (GoTrue + PostgREST + Mailpit) cannot run either.
Real PostgreSQL with the real migrations is what remains, and it is what every
row above was proved against.

## Round 3 — the journey in a real browser, against a real stack

`supabase start` needs a Docker daemon. This container ships `dockerd` and runs
as root, so the daemon can simply be started — which turns the whole full-stack
lane on: real Postgres carrying the production migration chain, real PostgREST,
real GoTrue, the production Next build in front, driven in Chromium.
`tests/e2e/ai-factory-journey.spec.ts` is the walk;
`.github/workflows/ai-factory-journey.yml` is the same sequence on a runner.

Only two things are seeded, both being external systems whose *recorded result*
is the honest fixture: the GitHub App installation (step 1) and the AI account
sign-in (step 4). Everything else is performed in the browser.

| # | Step | Result | Issue found | Resolution |
|---|------|--------|-------------|------------|
| 30 | 2 Create Project | PASS live | None | Filled and submitted in the browser; Postgres holds `Storefront Rebuild -> fake-owner/storefront` |
| 31 | 3 Configure Pipeline | PASS live | None | "Use" on a built-in recorded `agentic_sdlc` in `project_pipelines`, and the selection survived closing the overlay |
| 32 | 4 Connect Bots | PASS live | None | Create Bot on a connected account registered a real bot row |
| 33 | 5 Assign Bots | **FIXED — the round's most serious defect** | The bot's checkbox was **permanently disabled**. `ALLOWED_CREDENTIAL_REFS` was built from the catalogue's `defaultCredentialRef` alone, so the two `subscriptionCredentialRef` values *the same catalogue declares* were rejected: `normalizeCredentialRef` threw, `isCredentialPresent` returned false, and a bot made from a connected subscription account read "Needs credential" forever. The path the product recommends over API keys could never reach an assignment | Both fields are sourced from the catalogue now, and `tests/unit/credential-ref-catalogue-parity.test.ts` walks every reference it declares. The denylist and the "not declared" refusal are unchanged and asserted |
| 34 | 6 Configure Bot Settings | **FIXED** | With no roles in the workspace the role select was blank, Confirm stayed dead, and nothing said an assignment needs a role or where to make one | The wizard names the gap and links to Bot Manager. The underlying requirement is correct and is asserted, not seeded past |
| 35 | 7 Issue a Command | PASS — an honest refusal | None | The server re-resolves the repository and base commit from the live GitHub API before queueing; the seeded repository does not exist there, so it refuses and **says** "Command submission failed safely". No command row is written. The journey asserts the refusal is stated rather than swallowed |
| 36 | 8 Watch It Ship | PASS live | None | Reads **Not Connected** from `/api/bots`, as fixed in round 2 |
| 37 | Signed-out visitor | PASS live | None | A fresh browser context sees the gate, no tenant content, and not one 200 from `/api/*` |

Read back from Postgres after the run: the project bound to its repository, the
pipeline selection, one bot, **zero** assignments, **zero** commands, four
activity events — the refusals left no phantom rows.

### The live deployed site

Not reachable from this sandbox, measured three ways rather than assumed:

1. `www.theagoras.com/solutions/ai-factory` returns 200 and renders only the
   sign-in gate to an unauthenticated visitor.
2. **Sign-up on production is failing.** `POST /api/auth/sign-up` returns
   `503 authentication_unavailable` on every attempt, while sign-in correctly
   returns `401 invalid_credentials` for a bad password — GoTrue is up,
   registration is not. `scripts/configure-auth-email.sh` documents the cause:
   the hosted project requires email confirmation and has no custom SMTP.
   **No new user can register on the live site right now**, and only project
   configuration can fix it.
3. A browser in this sandbox cannot reach any external host — Chromium gets
   `ERR_CONNECTION_RESET` on `example.com` exactly as on `theagoras.com`,
   through every proxy configuration, while `curl` through the same relay
   returns 200.

The deployed bundle does confirm round 2's fixes are live: it contains
`assignmentIsConfigured`, `LEAST_PRIVILEGE_CONFIG`, `When an executor is
connected`, and the pipeline-templates read.

## Round 4 — what the honest state cost the page's heading

The unavailable state added in round 3 made a blocked state reachable without
a session, and the repository's own page check caught what had been hiding
behind that: `AiFactoryConsole` returned its blocked states *instead of* the
page, `PageHeader` included. `/solutions/ai-factory renders its heading, stays
in the viewport, and passes axe` failed on all three browser shards — the page
had no `h1` and no place in the heading outline, only an `h2` inside a card.

8. **A blocked console dropped the page's title.** Every early return now
   renders inside the same header ("AI Factory" plus its one description),
   so loading, signed-out, unavailable, and setup all keep the page's
   heading. A unit test walks 401, 409, and 503 and asserts the level-1
   heading survives each.

## Where this leaves the factory

Working, with live evidence from tonight: the Claude bot job, the graph
executor lane end to end (7 nodes to COMPLETED against hosted), the production
request boundary and its security headers, the eight-step AI Factory journey's
derivation, the auth broker, and the repository gate (lint, typecheck, 3431
tests, build).

Blocked on something no agent may do:

1. **Four migrations outstanding on hosted** (row 10) — needs
   `scripts/hosted-state-report.sql` to separate absent from ungranted, then an
   owner-approved apply. One of the four is already costing a user-facing path
   (row 15).
2. **Codex subscription quota** until 2026-08-20 10:05 UTC — the handoff
   canary's second leg and the Phase 1C worker's execution both wait on it
   (row 8).
3. **The merge-queue ruleset** is still not applied: `GET /rules/branches/main`
   returns `[]`, so the `merge_group:` trigger merged as c02a275 has nothing to
   respond to.
4. **ADR-036** still blocks wiring bots to execution; that needs an owner
   decision and a new ADR, not an agent's judgement.
