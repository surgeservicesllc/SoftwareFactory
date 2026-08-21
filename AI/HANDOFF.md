# Handoff

Last updated: 2026-08-21

## Newest (2026-08-21 ~21:15Z): Job Seeker — full browser journey green against a real Supabase stack; three live defects found and fixed

The owner's verification goal ("go through /job-seeker, fill every field
with fake data, prove every capability, everything wired to Supabase") was
executed as a real browser journey, not a mocked one:
`tests/e2e/job-seeker-journey.spec.ts` (guarded by `JOB_SEEKER_E2E=1`)
drives sign-in through real GoTrue, workspace onboarding, every profile
field including employment/education entries and a resume upload,
preferences, job recording + scoring, the duplicate refusal, prepare →
review → approve → applied, contact + outreach draft, and analytics —
against `supabase start` (the full 127-migration chain on real Postgres +
PostgREST) with the production `next build` in front, asserting
persistence by reload. It passes end to end (23.7s). Signed-out production
was verified directly: `https://www.theagoras.com/job-seeker` streams the
sign-in redirect and all `/api/job-seeker/*` endpoints answer 401.

The journey caught three real defects the mocked suites could not, all
fixed in the same change: (1) a signed-in person with **no workspace** hit
a dead-end "could not be loaded" error — the page now redirects them to
onboarding (which honors `?next=` and returns them), and the console
renders a "Create your workspace" call-to-action on the 409 as the
client-side floor; (2) **live PostgREST returns one-to-one embeds as
objects** — `job_seeker_matches`/`job_seeker_applications` both carry
`unique (job_id)` — while `toView` read `[0]` as if they were arrays, so
every live record showed "Recorded." with no score and no stage;
`firstEmbed()` now accepts both shapes (ADR-097); (3) an employment-history
entry added and never filled made the whole profile save fail 422 — the
form now prunes untouched entries before submit. Local-stack notes for
re-running the journey live in the spec header; the sandbox needs
`supabase start -x realtime,storage-api,imgproxy,mailpit,postgres-meta,studio,edge-runtime,logflare,vector,supavisor`
(an excluded service trips a forbidden rlimit syscall in this sandbox) and
the wipe between runs must TRUNCATE because generated documents refuse row
deletes by design. Gates on the merged state: lint clean, tsc clean, 3,465
vitest green, production build, journey green.

**Round 2 (same day, ~22:30Z): the whole capability surface, and two more
wiring gaps closed.** The journey now also walks: CRM details (notes, the
submitted application URL, a follow-up date — a per-card "Notes &
follow-up" editor was ADDED, because the PATCH actions existed with no UI
reaching them, and the jobs embed now carries those fields), every
remaining pipeline stage (Applied → Follow Up → Recruiter Response →
Interview → Final Interview → Offer, each proven by its group heading),
the reject side of the gate on a second recorded job (reject → no forward
moves anywhere → close), the stored resume made visible from load (the
profile view now embeds resume metadata via the `resume_upload_id`
pointer, which previously went unread — the link used to vanish on
reload) with the BYTEA download round-tripped and its content asserted,
history-entry removal persisted through reload, and analytics re-checked
after the walk (2 jobs, 1 application, 100% measured response rate, 1
interview-stage count, 1 offer). Extended journey green in 30.8s.

**Round 3 (same day, ~22:45Z): the journey has a CI lane.** ADR-097's one
open item is closed: `.github/workflows/job-seeker-journey.yml`
(workflow_dispatch + daily 07:41 UTC) provisions the lean local Supabase
stack on the runner, mints the pre-confirmed journey user through
GoTrue's admin API, builds and serves the production app, and runs the
JOB_SEEKER_E2E journey — so live-wiring regressions surface within a day
instead of at the next manual run. Actions pinned to reviewed SHAs
(pin-guard test green); no deployment, no production credentials, no
provider usage in the lane.

## Prior (2026-08-20 ~02:20Z): Job Seeker — all seven increments live; the goal's own E2E journey passes

Increments 5-7 joined 1-4 (#289, #290, #291): contacts + outreach drafts
that never claim a send; resume upload in a person-scoped BYTEA table
(migration 20260820000300, applied in run 32322900245 — hosted storage
policies are unownable from our apply path and the web tier holds no
service-role key); and the goal's finishing requirement executed as ONE
continuous test (job-seeker-journey.behavior.test.ts): Profile →
Preferences → Discover → Score → Qualify → Resume → Cover Letter → QA →
Review → Approve → Apply → Follow-Up → Analytics against the real schema
through the real engine functions, with the QA contract asserted (a term
the profile does not record never appears in a generated document) and the
gate proven in both directions inside the journey. Import adapters exist as
a typed registry whose `configured` flips only by detection of named
variables — Not Connected on the page with exact needs listed, no fetch
implementation until real. Completion score against the /goal's criteria:
everything in-repo is done and tested (3,463 green, sharded browser CI
green); the two open items need external inputs — an import credential
(SOFTWAREFACTORY_GREENHOUSE_BOARDS / _LEVER_SITES / _LINKEDIN_*) and a
live launch of the job_search_pipeline template from Pipelines → Templates,
which spends the owner's provider window and is theirs to click.

## Prior (2026-08-20 ~01:35Z): Job Seeker — four increments live (ADR-096)

The owner's /job-seeker goal, increments 1-4 merged and deploying (#283,
#284, #285, #286, #287): hard-gated page (server redirect, e2e-proven),
eight person-scoped tables with the approval gate / dupe key / score
integrity as CHECKs (migrations 20260820000100/000200, applied in run
32318712493), career profile + preferences CRUD, manual job recording with
deterministic fact-only scoring (reasons and gaps name their facts,
exclusions veto), the eleven-stage pipeline with Approve/Reject recording
decision evidence, fact-only ATS resume + cover letter generation with
immutable versions, counted analytics (rates with no denominator render
"—"), and the seven-agent job_search_pipeline graph template on the
production-proven execution lane. Remaining (BACKLOG): contacts/outreach
UI over the existing tables, uploads (storage-bucket decision), import
adapters, model-polished documents through the graph lane with QA lenses.
Watch: the width sweep initially died on the redirect route — fixed by
measuring the gate AS a redirect (#287); confirm CI green on c68d4cc.

## Prior (2026-08-19 23:05Z): THE COMPLETE RUN — the graph goal's last live proof is delivered

Drain `32310917147`, graph run `1df3fd45-5501-4912-81f8-26448b865af3`:
**COMPLETED, 7 succeeded, 0 failed**, 6m26s wall. Five MODEL inspectors in
parallel through the subscription CLI, the deterministic reduce, the report
synthesis — dispatched alone in the fresh 22:50Z window exactly as planned
by `20260819001200`, so nothing competed for fuel. Zero API tokens. The
scorecard withholds no graph-execution claim any longer. Also confirmed
this window: the ADR-095 unsupported observation (18:55:40Z) is the newest
usage row and the ONLY one in four hours — the memo ended the five-minute
re-probe spam, and the Bot Manager states the correct status (Connected,
usage not measurable for this connection type, reason on the card).

## Prior (2026-08-19 ~18:05Z): all five inspectors succeeded in production; one node from a COMPLETED run

The 17:50Z window delivered the strongest evidence yet, then ran dry:

- **Drain 32283900970, graph run `4d3f44a7-…`: 6 of 7 — every MODEL
  inspector succeeded in parallel** through the CLI (24-turn/480s envelope),
  the deterministic reduce folded their findings, and the run closed PARTIAL
  naming its one failure: the report synthesis, refused capacity (the fresh
  window had also just paid for the canary's five nodes; resets 22:50Z).
- **Live canary 32283945714 fully green**: "fans out, synthesizes, and
  verifies with a fresh context", 176.6s, zero API tokens — no capacity
  skip, no turn-budget failure.
- Migration `20260819001200` plants one fixed-id copy
  (`c9d4f1e8-7a52-4b3c-9e16-4f8a2d5c7b91`) cloned verbatim from the
  PARTIAL-retired copy, for a **solo** dispatch after 22:50Z (no canary in
  the same window) to convert 6/7 into the COMPLETED all-seven proof.
- The auth-broker's post-reset usage sweep still recorded `1 unavailable`
  (counts only in the log); the probe now prints the last five usage
  observations' status+detail (constraint-guaranteed secret-free), so the
  next probe run reads WHY without a database console. Rounds 15-16 also
  pinned every workflow action to a reviewed SHA and the Claude CLI to one
  version everywhere, both guarded by tests.

## Prior (2026-08-19 ~17:15Z): the day's own cadence audited, and the Bot Manager tells the truth again (ADR-093, ADR-094)

Applied to production through apply runs 32277018759 (…001000) and
32279867500 (…001100); ledger confirmed both. Highlights, in the order the
day found them:

- **Main's CI verdict is real again**: pushes get a per-commit concurrency
  group and are never pre-empted, so a merge no longer cancels the previous
  merge's verification (#267). The probe now asks `pg_constraint` directly
  and measured `covers_all_five_added = t` — the ADR-036 parity fix is
  genuinely live (#266).
- **The claim matches worker capability** (`20260819001000`, ADR-093): the
  analysis worker declares DETERMINISTIC+MODEL and never claims a graph
  containing ANCHOR nodes; such graphs stay PLANNED with budget intact, and
  the template cards say so before recording one (#269, #272). Drain
  32277660454 exercised the two-argument claim live: five inspectors
  dispatched in parallel, session limit refused capacity, run closed
  CANCELLED (void) — graph `51816274-…` still claimable for the 17:50Z
  window.
- **The browser suite is sharded 3×535** after being killed at 1582/1605 by
  its own ceiling; required checks and merge-readiness fixtures moved with
  the rename, and the install step is bounded per attempt after two shards
  hung 19 minutes in a stalled apt mirror (#270, #272).
- **Owner-reported Bot Manager defect fixed end to end** (ADR-094,
  `20260819001100`): a rate-limited usage probe (HTTP 429) no longer
  impersonates a broken account. Probe retries once within a small
  Retry-After and records what 429 means; the projection carries the last
  measured windows past a newer failure; the console renders probe failures
  as muted information and keeps real numbers on screen; push-handover
  broker runs skip the startup probe that caused the burst. The account
  badge (Connected) is the statement of health. The next broker sweep
  records the first observation under the new wording; numbers appear when
  the provider window reopens (17:50Z).

## Prior (2026-08-19 ~03:10Z): graphs execute — the worker boundary is live on production (ADR-092)

The planned-graph dead end is wired. Migration `20260819000100` (claim /
node-state / artifact / closure as service-role definer functions), the
executor worker (`scripts/graph-worker.mts`, `graph-worker.yml`), the
`server-only` shim, and the pinned CLI install are all merged (PRs #236-#240)
and applied to production. Three real dispatches each surfaced and fixed one
defect: run 32208699123 (import — shim), run 32208975669 (missing CLI —
pinned install), run 32209893742 (a session limit burned every remaining
re-claim chance in seconds — capacity refusals now void runs as CANCELLED,
uncounted, and stop the drain). Edges now carry data into node prompts, and
migration `20260819000200` re-planted one fixed-id copy of the owner's
first-day readiness graph so the next dispatch after the session limit
resets (7:30am UTC) has real work. **The post-reset dispatch delivered the
first real production node success** (run `32228988434`, graph run
`e51c57a5-…`: the rollback inspector completed through the CLI, RAW
artifact recorded, run closed PARTIAL honestly). The residual failures were
the executor's own 8-turn ceiling — raised to 24 by measurement, with MODEL
template nodes now carrying an eight-minute timeout, and `buildLaunchPlan`
now passing the compiled timeout/attempts instead of letting database
defaults override the planner. Drain `32254860997` (graph run `ca347ab9-…`) then executed **the whole
chain**: inspector → deterministic reduce → report synthesis, nothing left
undispatched, closed PARTIAL with the four failed inputs named. Those four
failed because the transport's `MAX_TURNS_CEILING` was silently clamping
the executor's declared 24 back to 8 — raised to 24 and pinned against the
executor's constant by a test, so the pair cannot drift again. The next
dispatch is the attempt at every inspector succeeding. CI on main is fully green
(run `32216103242`) after the outgrown e2e ceiling was raised (PR #248).
The worker's schedule stays off until the repo variable
`SOFTWAREFACTORY_GRAPH_WORKER_SCHEDULED` is set. File-writing nodes remain
deliberately with the Phase 1C path. The owner's standing merge cadence for
this goal: merge immediately, verify on production, keep looping.

## Newest (2026-08-18 05:40Z): the hosted ledger, measured — read this before any "unhosted" claim below

Probe run `32103778884` (`.github/workflows/apply-hosted-migrations.yml`,
`scope=probe`, read-only; the three apply steps were skipped and the log shows
it) printed the full local-vs-remote ledger. **It is not a contiguous prefix of
the local files.** Nineteen versions are missing from the middle —
`20260814002500`–`002600`, `20260815000200`–`000600`,
`20260815000800`–`001600`, `20260816000100`–`000300` — while every row above
them is present, the whole `20260817` range included.

Every "the migration is unhosted" note further down this file was written
against a high-water-mark model that the measurement disproves. Check a version
against the table in `AI/HOSTED_APPLY_RUNBOOK.md` before acting on any of them.
Two that are now known to be wrong as written: `20260816001500` and
`20260816001400` are both **on the ledger**, so the usage rows and the
repository picker are backed on production.

The ledger also still understates the schema: 19 of 19 probed objects came back
present, among them `scheduling_decisions` and `projects.engineering_priority`,
both owned by `20260815000200`, which has no ledger row. Where a marker object
is present the correct action is `migration repair --status applied <version>`,
recording history that is already true — not re-running the file. The probe now
prints a `present` boolean per version so that call can be made per file rather
than for the batch.

Only the probe was run. `AGENTS.md` puts RED actions behind explicit owner
approval in Phase 1, so `scope=all`, `broker-functions` and `project-controls`
remain the owner's to trigger.

## Newest (2026-08-16 ~23:20Z): per-account usage on the Bot Manager, captured by the broker sweep

The owner asked for each connected bot's usage (session % and weekly %) on
`/solutions/bot-manager`, fully automated. Landed as ADR-076: evidence table
`ai_account_usage_observations` (migration `20260816001500` — recorded as
unhosted when this was written; the 2026-08-18 measurement finds it **on the
hosted ledger**, so live rows are possible), probe module
`lib/worker/usage-probe.ts`, a bounded capture hook in
`scripts/auth-broker.mts` (frozen file, touched under the owner's explicit
instruction; login semantics untouched), `GET /api/ai-accounts/usage`, and the
usage rows in `components/ai-accounts-panel.tsx` /
`components/bot-manager/account-usage.tsx`. Truthfulness contract: the UI
renders only recorded observations — measured windows, a named failure, or
"no usage recorded yet" — and the probe never demotes an account. Codex
records `unsupported` until a real usage endpoint is proven; proving one is
the natural next step.

## Project ↔ repository picker (2026-08-16, branch `feat/project-repo-picker`)

Owners/admins can now choose, change, and unlink which GitHub repository an existing
project connects to, end to end: migration `20260816001400_project_repository_picker`
(two definer functions, serialized with handoff and change reservations, uniqueness
refusals that name the holding project), `PUT`/`DELETE
/api/projects/[projectId]/repository`, and a per-project picker in the Connections
console with explicit no-installation / zero-repository / projects-load-failure states.
The migration was recorded as **unhosted** here; the 2026-08-18 measurement finds
`20260816001400` on the hosted ledger. `AI/HOSTED_APPLY_RUNBOOK.md` carries the
current position. Nothing here touches the frozen AI-account connection path, execution
authority, or RLS.

## Newest (2026-08-16 ~21:30Z): both provider paths frozen; GitHub install host-skew fixed

Both AI-account connection paths are owner-frozen — Claude (ADR-072) and now
Codex (ADR-073, after the first live Codex connection at 19:06:41Z). The
operative file list is in `policies/PROTECTED_RESOURCES.md`; diagnosis stays
allowed, fixes are owner proposals. Separately, the GitHub App install flow
was failing across the deployment's hostname aliases (`github_state_invalid`
on `softwarefactory-tan.vercel.app`): the launch and callback legs now
303-converge on the configured callback host before touching cookies, state
verification failures name their real cause, the state lifetime is 30
minutes, and the Connections console strips its one-shot notice query
parameters after reading them (ADR-074; the host-skew entry in
`todo.md` has the full defect story). Outcome, owner-verified 19:47Z:
GitHub is Connected live on a fresh installation `#154236235` scoped to
exactly `surgeservicesllc/SoftwareFactory`, bound to the owner's live
workspace. The old installations from the 2026-08-13 setup were bound to
a workspace the owner's login cannot reach (single-membership login, no
Workspace card); recovery was uninstall + fresh Connect, not adoption.
A Workspace switcher card now renders on Connections whenever a login
belongs to several workspaces (PR #165).

## Active goal: BotBuild — AI accounts + automatic auth broker (2026-08-16)

The owner's active goal (spec recorded in `todo.md` → "Owner goal — BotBuild")
replaces the copy-a-command connect flow with a fully in-browser one: Add AI
Account → Connect → the provider's real login → automatic detection →
Connected. The foundation landed in `20260816000100_ai_accounts_auth_broker`
(see ADR-071): `ai_accounts` identities, the `ai_auth_sessions` broker state
machine (worker-driven, definer-function-only, sealed relay code, audit
events on every transition), and nullable `bots.ai_account_id`. The
verifying suite is `tests/integration/ai-accounts-auth-broker.behavior.test.ts`.
Still open, in order: broker API routes, the worker auth runner (GitHub
Actions job that runs the provider CLI login against a claimed session —
including a live probe of headless `claude setup-token`; Codex's
localhost-callback login is a known risk recorded in `todo.md`), the
auto-completing UI, the Bot Manager redesign, disconnect/reauth surfaces,
and the verification loop. The subscription connect-command flow (PRs
#133/#134/#135) keeps working during the transition; do not remove it until
the broker path is live end to end.

## Read this first: master clean-room audit + frictionless goal (2026-08-16)

The authoritative current state is `todo.md` → "Master clean-room audit
(2026-08-16, iteration 24 — FINAL GATE)" and the "FRICTIONLESS COMPLETION
REPORT" above it. Summary: full local gate PASS on merged `main` `69a0156`
(eslint 0 errors, tsc clean, vitest 2741/0, production build OK), 22/22 live
production routes 200, zero-token PASS, no unblocked P0/P1 — everything
remaining is owner-only (1C canary, hosted-ledger position, second
repository, 2A decision). A nine-iteration frictionless owner-experience
loop merged as PRs #121, #123–#129 (guided setup, one-click bot connect,
simple goal box, attention area, plain-language runs, iOS GitHub-connect
fix, owner-first navigation, journey e2e) with **zero safety-surface
changes** — presentation and tests only. Deployment caveat: Vercel's
free-tier daily quota exhausted mid-sequence; production serves main through
`0126825` (#126) until the next deploy after quota reset, an owner Redeploy,
or a plan upgrade. The worker's one-click sign-in flow for the owner is:
production `/auth/sign-in` → "Email me a sign-in link instead" → click the
link promptly on the same device (PKCE — raw `/auth/v1/otp` links do NOT
sign into this app; the session travels in a fragment the app ignores).

## Mission and boundary

**Phase 2E portfolio scheduling landed on `claude/softwarefactory-phase-1e-ops-mjdiiq` on 2026-08-15** (migrations `20260815000100`-`20260815000600`, scored 33/36 PASS in `AI/PHASE_2E_COMPLETION.md`). Read that file and the 2E handoff block at the top of `todo.md` before touching the claim path: `claim_phase1c_run` now orders by effective priority and filters on four ceilings plus circuit-breaker health, and its body has been rewritten twice by copying the previous version and editing it, so a third rewrite should do the same rather than retyping it. Two ordering facts matter operationally — five of the six migrations are ledger-absent as measured on 2026-08-18 (`20260815000100` is on the ledger; `000200`-`000600` are not, though `000200`'s objects are demonstrably live), and `20260815000500`/`20260815000600` cannot apply to a database where `20260814000210` is half-applied, because their `language sql` bodies are resolved at creation.



**Phase 1B close-out merged as `c325dbb` on 2026-08-14.** Scoring is in `AI/PHASE_1B_COMPLETION.md` (18 PASS / 2 PARTIAL / 0 FAIL). Three real defects were fixed, not just covered: generic-`500` lifecycle refusals, a stale suspension marker left after a revocation, and a discovery that aborted against a terminally deleted installation. `tests/integration/github-lifecycle-matrix.test.ts` is the access-loss proof — it attempts a real change reservation after every transition rather than reading a UI label, so do not weaken it into asserting rendered state. Migration `20260814001100` is **unhosted**; apply it as item 7 of `AI/HOSTED_APPLY_RUNBOOK.md`.

Two environment blockers were hit and are not code defects: Vercel's free-tier `api-deployments-free-per-day` limit, and GitHub Actions failing to assign a runner at all (`runner_id: 0`, no logs, two attempts). The second matters for Phase 1D, whose goal item 12 requires gates to rest on real CI evidence.


Finish the Phase 1C routing projection and live acceptance without overstating status. Provider-credit recovery is no longer the task: Phase 1C was re-architected to zero-token subscription-authenticated Codex execution, so there is nothing to fund. The protected Supabase ledger reconciliation and forward-only chain through `130014` are complete on exact project `qpuofpmagrmyamahqwxw`; linked lint and focused runtime/catalog/ACL checks pass. Migration `20260813001500_expose_bounded_run_routing.sql` is local and unhosted; no earlier approval authorizes applying it. The prior verified production baseline before this update was `0c662a24393f682073e6002c5aff9339292226d8`; CI run `31749352644` passed both required jobs and matching Vercel deployment `dpl_FJKMapsyLB4hQPDsaykUo1cVUQp7` was READY. Distinct no-claim diagnostic Actions run `31748582858` passed the exact-model GET, then the bounded non-stored Responses probe returned the safe code `credit_balance_exhausted`; Docker preload and durable claim were skipped. Durable run `f4594556-6f72-4763-a480-6993939e3651` remains failed after attempt 1 of 2, but its immutable base predates the verified production baseline; do not retry it. Activation is absent/OFF. The user-pasted OpenAI key is treated as compromised and `SOFTWAREFACTORY_OPENAI_API_KEY` has been removed from repository Actions secrets; it stays absent permanently, because Phase 1C has no paid-API path to restore it to. No successful Phase 1C run or draft PR exists, so Phase 1C remains **Not Connected**. All automatic actions remain OFF and the global kill switch remains ON.

## Phase 1D state for the next agent

The autonomous-loop **decision layer** is complete and lives in `lib/autonomy/`. It decides; it
never executes.

- `controls.ts` — nine automatic actions at two scopes, resolved most-restrictive-wins. Read the
  envelope from `public.resolved_autonomy_controls(project_id)` rather than assuming it.
- `diff-risk.ts` — classifies a real diff. Do not reintroduce caller-declared risk as the only
  input; the whole point is that the thing being judged does not supply its own verdict.
- `gates.ts`, `agents.ts`, `approval.ts`, `pipeline.ts` — the gate sets, the three reviewing
  agents, the approval tri-state, and the twelve-stage machine.

Rules that must survive any future change:

1. **Approval never outranks verification.** Owner approval is evaluated after the gates. If you
   find yourself moving that check earlier, stop.
2. **No self-approval, at any risk level, including for an owner.**
3. **A missing gate result is a blocker, never a pass.**
4. **Blocked stages are named, not skipped.** `MERGE_EXECUTOR_NOT_CONNECTED`,
   `DEPLOY_EXECUTOR_NOT_CONNECTED` and `CODEX_WORKER_NOT_CONNECTED` are asserted in
   `tests/integration/phase1d-loop-journey.behavior.test.ts`. If you connect an executor, those
   assertions are supposed to fail — update them deliberately, and do not weaken them to
   "either blocked or not".
5. **The Phase 1D control migration relaxes nothing.** Enabling any automatic action is a RED action
   requiring an owner-approved migration. Do not do it as a side effect of anything else.

Phase 1D migration `20260813000600_phase1d_autonomy_controls.sql` is applied to hosted Supabase as part of the owner-approved, ledger-reconciled forward chain through `130014`. Hosted resolution confirms all nine actions OFF and the global kill switch ON. Applying that execution-inert decision schema did not authorize or execute an automatic action.

Manual Phase 1C execution may handle only authenticated owner-submitted GREEN/YELLOW commands. RED remains non-executable. Autonomous Mode is OFF, the global kill switch is ON, and auto approve/merge/deploy/rollback are OFF. The worker ends at an open draft PR plus observed CI; it never writes the default branch or performs delivery.

## Current repository work

**Phase 2B (graph engineering) is open in draft PR #27**, branch
`claude/github-connection-confirm-qe3tqm`. Stages 1–5 are built: the pure engine
core (`lib/graph/`), thirteen durable tables plus a SECURITY DEFINER write
boundary (both **applied to hosted**), the runner and provider bridge, the
templates/Workflows/observability/optimizer surfaces, and six of the seven
demonstrations. Read `todo.md` first — it opens with a pickup section — then
`AI/GRAPH_ENGINEERING.md` and `AI/PHASE_2B_DEMONSTRATIONS.md`.

Three facts a successor needs and will not infer:

- **The credential boundary is narrower than it looks.** `runGraph` takes an
  injected `executeNode`, so every decision the engine makes is testable without
  a provider. Only the claim that a real model satisfies these contracts needs
  `ANTHROPIC_API_KEY` and a funded `OPENAI_API_KEY`. Stage 5 was once recorded
  as fully credential-blocked; that was wrong, and six demonstrations now pass.
- **Migration versions collide across concurrent workstreams.** Twice so far:
  `20260813000500`, then `20260814000100` when Phase 2C's
  `phase2c_resource_persistence` and Phase 2B's `graph_engineering` both claimed
  it. The ledger stores one row per version, so the loser can never be applied.
  `graph_engineering` was already hosted and could not move, so the unhosted
  Phase 2C file was renamed to `20260814000300`. Check `supabase/migrations/`
  before choosing a version.
- **Automatic CI is intermittent.** A missing run and a not-yet-started run are
  indistinguishable. Confirm an Actions run exists for the exact head SHA before
  treating a PR as gated.

Phase 2A is a separate advisory path. It can route a bounded task to an official Anthropic/OpenAI adapter and store a structured analysis artifact only after hosted schema, server credential, provider health, and explicit organization enablement exist. It cannot access a Git workspace or authorize a repository, approval, merge, deployment, rollback, or Phase 1C/1D switch.

## Repository identity

- Exact GitHub repository: `surgeservicesllc/SoftwareFactory`.
- Exact live owner: `surgeservicesllc@gmail.com`.
- Every commit author and committer: `surgeservicesllc <surgeservicesllc@gmail.com>`.
- Existing connected candidate App path: App `4582606`, installation `153479019`, connection `85591f43-dd4e-46d2-8a1b-0f036b32639f`, project `b1f23696-437e-4d89-b55f-d7a949980e8f`.
- Primary installation `153445938` remains rollback; Support `#4660724` remains the webhook defect record.

## Phase 1E production operations

The production-operations control plane is implemented in source and migration `028`. Its schema effect and reconciled ledger row are present on hosted Supabase, but no monitor has observed a real production target, so every Phase 1E surface reports **Not Connected** or **Unknown** today.

What it does: monitors production through one bounded HTTPS-probe adapter, derives project health with a stored reason, opens and deduplicates SEV1–SEV4 incidents, freezes autonomous releases automatically on SEV1/SEV2, resolves Last Known Good only from a validated deployment, evaluates rollback fail-closed, diagnoses deterministically, creates bounded repair work, orchestrates ten durable event types idempotently, gates resolution on real restoration evidence, and reports daily.

What it deliberately does not do, and why:

- **No rollback execution.** No deployment provider adapter exists, `policies/AUTO_ROLLBACK.md` disables automatic rollback, and migration `010` pins `auto_rollback` off. Every rollback decision records `EXECUTOR_NOT_CONNECTED`. No database or data migration is ever reversed.
- **No repair execution.** Repair work can now be promoted into the ordinary Phase 1C command queue (owner-only, through `submit_command`, with a live base SHA), which it previously could not be at all — `create_repair_attempt` wrote a task `claim_phase1c_run` could never select. The promoted run stops at `queued`: Phase 1C is Not Connected, no worker is registered, and migration `20260813001700` is unhosted.
- **No deployment, merge, or scheduled monitoring.** Checks are owner-triggered; authorizing a scheduler identity must not widen `service_role`.

Invariants a future change must not break: `service_role` gains no new table privileges; the four append-only evidence tables stay append-only; `production_monitors_enabled_requires_connection` stays in place so an unconnected monitor cannot be enabled; `rollback_operations_failure_escalates` stays in place so a failed rollback cannot be silent; `incidents_resolution_requires_cause` stays in place so a green deployment cannot close an incident; and `EXECUTOR_NOT_CONNECTED` stays unconditional in `autonomous_release_allowed`.

Released to `main` as merge commit `b243e1ddf9ce8155c4440c56d7b846ccc3d74ce0`; CI run `31731632715` passed both jobs against that commit.

Next Phase 1E steps: configure an owner-authorized monitor target and record the first real detection-to-resolution journey. Hosted ledger reconciliation is complete and must not be replayed.

## Implemented boundaries and migration state

### Hosted Phase 1B and published Phase 1E migrations

- `011`: initial direct mutation closure and `github_pat_` detection.
- `012`: actor-attributed terminal change audit.
- `013`: bounded service-role repository-grant reconciliation.
- `014`: exact linked-project repository/default-branch propagation with audit.
- `015`: existing-draft-PR completion recovery.
- `016`: terminal/provider-time installation lifecycle.
- `017`: remaining direct connection/project/link/change-request write closure plus authenticated exact-binding reservation RPC.
- `018`: provider-time repository lifecycle and terminal delete/explicit restore handling.
- `019`: minimal service-role execute on the SECURITY DEFINER sensitive-JSON CHECK wrapper; recursive/text helpers remain inaccessible.
- `020`: remove authenticated base-table SELECT for agents/commands/tasks/runs/reports and add caller-member safe list RPCs.
- `021`: persist stable GitHub repository UUID bindings for projects/change authorization.
- `022`: immutable owner-only RED protected-change approval plus five-minute pre-provider reservation lease/reclaim boundary.
- `023`: bounded verified GitHub activity details with stable repository-to-project attribution.
- `024`: raw Activity/webhook direct-read closure plus caller-member bounded `list_activity`.
- `025`: generic secret-assignment detection, protected approval/reservation/token-order integrity, and serialized stable repository relinking.
- `026`: revoke all `service_role` public-table privileges, then restore only SELECT/INSERT/UPDATE on the four GitHub ingress tables.
- `027`: hosted; immutable owner RED approval/single-use execution, exact candidate signed-delivery provenance/freshness, cross-App repository serialization, atomic history-preserving project handoff, and evidence-bound reverse handoff.
- `028` and canonical `130001`-`130005`: schema effects and reconciled ledger rows are present. Their DDL was not rerun; preserve the completed history-only repair evidence.

### Published Phase 2A/Phase 1C and provider-startup recovery

- Command route/composer: connected-project selection, command type, acceptance criteria, stable idempotency, deterministic risk, exact base SHA, fixed plan, opaque dispatch, dispatch evidence, truthful RED/delayed states.
- Orchestration: provider `openai`, model `gpt-5.3-codex`, role mapping, 45-minute/four-turn/token/one-repair/15-minute-CI budgets, and fixed inspect-to-report draft-PR workflow.
- Provider layer already on `main`: official Anthropic/OpenAI adapters, health/model discovery, routing, bounded fallback, independent review, owner execution controls, advisory run persistence, and provider settings/run surfaces; `130001` schema and its reconciled ledger row are hosted, while advisory execution remains OFF/**Not Connected**.
- Schema: `130006` Phase 1D decision-only interlocks; `130007` provider compatibility; `130008` enum-only commit; `130009` core command/task/run/worker/evidence/RLS/RPC schema; `130010` provider-neutral roster, owner/risk/ACL/recovery/report hardening; and `130011` canonical dependencies, derived criteria, idempotent replay, and cumulative retry budgets. All are hosted; `130012`-`130014` are forward-only containment/lint/emergency-stop corrections. Only `130007`-`130013` contain Phase 1C changes.
- Pending compatibility/projection/read boundary: local `130015` is frozen at 13,121 bytes with SHA-256 `3E1BEA8F5DAB912D5D7D6251E4503C319816B27EF2465DB5E8612E26A3DD1A13`. It widens the assignment/run model checks from 120 to the original 128-character provider catalogue/API contract while preserving their other semantics; adds four named no-secret constraints covering catalogue model/display-name, assignment model, and routing policy-version/selected-model text; replaces `get_agent_run_detail(uuid, uuid)` to expose capped/allowlisted routing evidence; revokes authenticated raw SELECT on routing decisions/events; and retains tenant-scoped model-catalogue SELECT. Provider runtime/API boundaries also reject credential-shaped default-model/model/display-name scalars before serialization or RPC and fail closed on dirty pre-migration catalogue rows. The application accepts an absent/null routing field for rolling compatibility. Hosted Supabase remains at `130014`; apply `130015` only under a fresh exact RED approval using that frozen source identity and verify all six changed/added constraint definitions, 128-character assignment/run/project behavior, valid and negative credential-shaped scalar behavior, function signature, `SECURITY DEFINER`, pinned `search_path`, exact table/function ACLs, tenant isolation/direct denial, lint, and health.
- Worker: supported `@openai/codex-sdk`, isolated `CODEX_HOME`, controlled environment, exact repository/base-SHA workspace, `factory/*` branch, bounded Codex, pinned Docker validation, protected-path/secret scan, commit/push, draft-PR recovery, exact-head CI observation, bounded repair, redacted persistence.
- Workflow: `.github/workflows/codex-worker.yml` runs one claim on opaque repository dispatch or every five minutes for recovery; branch-selectable manual dispatch is intentionally absent, workflow token permission is contents read, actions are commit-SHA pinned, checkout credentials are not persisted, and the job remains skipped unless the activation variable is literal `true`.
- Recovery patch, published on `main` at `bc95b9e3a5952864bd26da778a052f37400ea747`: before every claim, verify the installed Codex CLI is the reviewed `0.147.0` and perform a non-billable exact-model lookup using only the OpenAI secret. The distinct repository-dispatch event `softwarefactory_phase1c_preflight` additionally requests one bounded, non-stored response, then skips Docker preload and durable claim. The Codex adapter retains the redacted structured `turn.failed`/error message if the event iterator subsequently exits with a generic CLI trailer.
- UI/APIs: bounded list/detail/status for Agents, Backlog, Runs, Reports, Dashboard, and Bot Manager; cancellation and eligible retry; worker status is heartbeat-derived rather than configuration-derived.

## Critical protected configuration

GitHub Actions does not permit secret names beginning `GITHUB_`. The reviewed workflow expects these repository secrets:

- `SOFTWAREFACTORY_SUPABASE_URL`
- `SOFTWAREFACTORY_SUPABASE_SERVICE_ROLE_KEY`
- `SOFTWAREFACTORY_CODEX_AUTH_JSON`
- `SOFTWAREFACTORY_GITHUB_APP_ID`
- `SOFTWAREFACTORY_GITHUB_APP_PRIVATE_KEY_BASE64`
- `SOFTWAREFACTORY_GITHUB_CANDIDATE_APP_ID`
- `SOFTWAREFACTORY_GITHUB_CANDIDATE_APP_PRIVATE_KEY_BASE64`

The workflow maps the four App values to runtime `GITHUB_*` names only inside the worker step. Never print, persist, copy into source, or expose secret values. The public workflow identity is fixed to `surgeservicesllc <surgeservicesllc@gmail.com>`.

`SOFTWAREFACTORY_OPENAI_API_KEY` is intentionally and permanently absent. The value pasted into chat must be treated as compromised and revoked at the provider; do not restore it, and do not add a replacement. Phase 1C authenticates Codex with the owner's ChatGPT subscription through `SOFTWAREFACTORY_CODEX_AUTH_JSON`, the contents of `~/.codex/auth.json` from a subscription `codex login`. Never instruct the owner to fund an OpenAI API account for this phase.

The non-secret repository Actions variable `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` must equal literal `true` or every repository-dispatch/schedule job is skipped. It is the final fail-closed activation gate. It was enabled only long enough for the first approved acceptance claim and is now absent/OFF; any further activation remains bounded by the exact owner approval.

`SOFTWAREFACTORY_REQUIRED_CHECKS` must be a non-empty, unique pipe-delimited list of 1-20 exact check names. The reviewed workflow value is `Lint, typecheck, test, and build|Browser and accessibility tests`, matching `.github/workflows/ci.yml`. Before activation, verify no CI job rename drift. Missing/invalid configuration blocks worker startup; incomplete/missing/unstable checks or a changed draft PR cannot pass CI.

## Verification state

- The prior verified production baseline before this update passed supported Node `24.19.0` lint/typecheck, 117 files/1,282 tests, a production build with 74 page/route entries, prior coverage 75.06/69.97/72.60/76.66, Playwright/axe 117/117, focused migration/security suites, production dependency audit 0, and safe disabled-worker smoke. Baseline commit `0c662a24393f682073e6002c5aff9339292226d8` passed both required jobs in CI run `31749352644`, and matching Vercel deployment `dpl_FJKMapsyLB4hQPDsaykUo1cVUQp7` was READY.
- Hosted history is reconciled through `130014`, and linked lint is clean. The frozen current candidate passes local final gates on Node `24.19.0`: lint/typecheck, 118 files/1,311 tests, coverage 76.70/71.47/74.04/78.11, 74/74 routes, Playwright/axe 117/117, audit 0, and clean diff-check. Publication/CI/Vercel and hosted `130015` evidence remain pending.
- First acceptance evidence: command `0c4d0ca8-1867-4d00-80cf-476401491a17`, durable run `f4594556-6f72-4763-a480-6993939e3651`, and worker Actions run `31746057998`. A real heartbeat and provider thread identifier were recorded, then Codex startup failed. No changed file, factory branch, commit, PR, validation, or exact-head CI evidence was created. Its planned base is now stale against current `main`, so the failed row must not be retried. Activation is OFF.
- Published provider-only diagnostic `31748582858` skipped Docker preload and durable claim. The exact-model GET passed; the bounded non-stored Responses call returned only the safe machine-readable code `credit_balance_exhausted`. The stale failed run was not touched and activation is OFF.
- The exact blocker is no longer funding. The paid dependency was removed from the execution path; the blocker is the owner-supplied `SOFTWAREFACTORY_CODEX_AUTH_JSON`. Configure it, rerun the no-claim diagnostic, then submit a new current-base command. Never retry the stale failed run. No production-monitor journey or successful live Phase 1C provider result exists.

## Immediate sequence

1. Preserve the prior verified production baseline before this update: commit `0c662a24393f682073e6002c5aff9339292226d8`, CI run `31749352644`, and READY deployment `dpl_FJKMapsyLB4hQPDsaykUo1cVUQp7`.
2. Preserve the passing frozen candidate. Publish only after exact review; record the new commit, CI, and deployment rather than reusing the prior baseline.
3. Obtain fresh exact owner RED approval for the complete `20260813001500_expose_bounded_run_routing.sql`, then apply only that migration forward to `qpuofpmagrmyamahqwxw` and verify ledger, exact definitions for both widened and all four no-secret constraints, 128-character assignment/run/project behavior, valid and negative credential-shaped catalogue/assignment/routing scalar behavior, both routing-table ACL revokes plus retained model-catalogue SELECT, function definition/signature/security/search-path/ACL, bounded Phase 1C/2A/legacy routing runtime, raw-table/RLS denials, lint, and health. Stop on any mismatch.
4. Revoke the user-pasted OpenAI key at the provider. Keep `SOFTWAREFACTORY_OPENAI_API_KEY` absent permanently and activation OFF. Configure `SOFTWAREFACTORY_CODEX_AUTH_JSON` from a subscription `codex login` through the protected secret path; do not fund an OpenAI API account.
5. Within a separately approved window, admit only `softwarefactory_phase1c_preflight`, then return activation to absent/OFF. Require the pinned CLI, exact-model GET, and bounded non-stored Responses probe to pass while Docker preload and durable claim remain skipped.
6. If that diagnostic fails or is ambiguous, stop. Only after it passes, leave stale run `f4594556-6f72-4763-a480-6993939e3651` untouched, submit a new current-base safe GREEN command, and return activation to absent/OFF immediately after claim.
7. Observe command -> task -> neutral logical agent -> routing reasons -> run -> Codex thread -> validation -> factory branch/commit -> open draft PR -> stable exact-head required checks -> structured report/activity; prove no default-branch write, approval, merge, deployment, rollback, workflow/provider-setting mutation, secret disclosure, or RED execution occurred.
8. Complete the unrelated-authenticated and mutation-denial live matrix, then update repository memory with exact success or failure evidence before changing OpenAI/Codex from **Not Connected**.

## Safe operating notes

- Never print or commit App private keys, client/state/webhook secrets, OAuth/installation tokens, service role, or database credentials.
- Service role is limited to narrow provider-ingress/terminal evidence boundaries and never proves RLS.
- Before any new linked database command, reconfirm the authenticated release identity and exact project `qpuofpmagrmyamahqwxw`; never fall back to the previously wrong/unauthorized profile. No mutation used that profile, and hosted production must never be reset.
- Preserve **Demo Data** and **Not Connected** language when live evidence is absent.
- Keep default-branch writes, non-draft PRs, merge, deploy, rollback, workflow/administration writes, and autonomous execution unavailable.
- `main` is currently unprotected and the published release commit is unsigned; changing branch protection or signature requirements is a separate protected owner-review action.
- Unexpected `theagoras.com` aliases require owner review before any retain/remove routing action; do not mutate protected routing without exact approval.

## Completion checklist

- [x] Hosted migration history is reconciled/current through `130014`; linked lint, focused RLS/catalog/ACL/runtime checks, and live `027` owner approval/execution/rebind behavior pass.
- [x] Migration `026` is hosted; exact ACL mismatch count is zero, with four intended `service_role` ingress tables and no table privileges on the other 19.
- [x] Historical candidate lint/typecheck, 56 files/436 tests, 38-route build, and 48/48 E2E evidence is retained only as historical Phase 1B evidence.
- [ ] Run and record the complete final gate set for the current routing/UI update; no prior count is current-update evidence.
- [x] Published application-release source/rebuilt-static and production privileged-marker gates pass.
- [x] Candidate cutover publication passed main CI secret-boundary tests; no secret/helper artifact was committed. Prior full source/client scan evidence remains clean.
- [x] Application release `799d2cea189b6860a03987ae75c25765f9ac4aca` is published, CI `31716263910` passes both jobs, and matching READY production deployment `dpl_853oYWK122qrTHhqtqDhsEYJkKaQ` is verified. Production Playwright 48/48, 13/13 routes, invalid webhook, log, and 20-asset checks pass.
- [x] Migrations `011`-`027` are hosted; the prior dry-run/lint/ACL baseline and live `027` behavior pass.
- [x] Authenticated production owner reads pass through Bot Manager, Runs/detail, Backlog/detail, all-eleven-role Agents/detail, Reports/detail, and Connections. Signed-out UI leaks no tenant records, and twelve hosted Phase 1C target/read RPCs deny anonymous callers with `401`/`42501`.
- [ ] Complete the live unrelated-authenticated and mutation-shaped denial matrix. Hosted membership currently has only the owner, so an owner-authorized second tenant/session is required; local integration tests cover this boundary but are not live evidence.
- [x] Real GitHub callback/sync/project/read/edit/ordinary-plus-protected-draft-PR/audit journey passes for the owner connection.
- [x] Exact deployment commit identity is configured server-side in Production/Preview and live draft commits prove matching author and committer without App-bot fallback.
- [x] Dual-App code is deployed, migration `027` is hosted, candidate App `4582606` is installed as `153479019`, and an exact post-sync signed delivery is processed.
- [x] Owner handoff, project/history continuity, candidate-backed reads, draft-only PR `#8`, and cleanup pass.
- [ ] Reverse observation and disconnect/loss journey pass before primary retirement.
- [ ] Failure/revocation/rate-limit/stale-SHA/protected approval/expiry/lease/idempotency/recovery/out-of-order/terminal states pass.
- [x] Documentation and scorecard distinguish hosted `130014`, local/unhosted `130015`, the prior verified production baseline, proven owner/anonymous reads, and remaining unrelated-authenticated/mutation/provider acceptance without claiming Phase 1C Connected.
- [x] Phase 1E control plane passes lint, typecheck, 143 files/1621 tests, a clean build, and Playwright 117/117 including axe, with the end-to-end journey and failed-rollback escalation proven against the migrated schema.
- [x] Migration `028` is hosted in the reconciled ledger. No real production target has been observed, so every Phase 1E monitoring surface remains **Not Connected** or **Unknown**.
- [x] The control plane is served under `/solutions` and verified live: twelve pages serve both navigation landmarks, every former path returns `308`, and the console stays `noindex` and out of the sitemap. See ADR-041.

## Additional Phase 1C release safeguards

- Do not infer approval for protected migrations/secrets/workflow activation from urgency, prior approval for another phase, or a generic "continue."
- Do not use service role as the user-under-test for RLS acceptance.
- Do not run `supabase db reset` against hosted production or repair/renumber migration history.
- Do not let a Vercel READY state, workflow file, configured secret name, queued command, or mocked SDK response count as a live worker.
- Keep the Phase 1B candidate/primary distinctions and remaining tenant/adverse gaps intact.
- Any new code/schema/provider/deployment change invalidates affected evidence and requires rerunning its gates.
