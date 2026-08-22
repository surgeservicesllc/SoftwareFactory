# Handoff

Last updated: 2026-08-22

## Newest (2026-08-22): the Backlog and All Pipelines pages can be cleared

`/solutions/backlog` and `/solutions/pipelines?view=all` each carry a clear
control (ADR-119), landed on `main` as `9761055` (#317). One component,
`components/clear-surface-button.tsx`, serves both: press, confirm, give a
reason of at least ten characters, optionally tick the checkbox that also
deletes rows carrying run history.

The authority is entirely in the database. `clear_backlog_tasks` and
`clear_all_pipelines` (migration `20260822000800`) are SECURITY DEFINER, refuse
a caller who is not an owner or admin, refuse a short reason, skip live work,
and skip anything whose deletion would cascade into `agent_runs` unless the
caller opts in. Every call writes an audit row, including one that deleted
nothing. The two labels those rows use — `task.backlog_cleared` and
`command.pipelines_cleared` — are added in `20260822000700`, a separate file
because PostgreSQL refuses to use an enum value in the transaction that added
it.

**Hosted: applied.** Run `32582241930`, `scope=clear-controls`, both versions
absent from the ledger beforehand. The post-apply readback measured:

```
       proname       | security_definer | member_may_execute | anon_may_execute
 --------------------+------------------+--------------------+------------------
  clear_all_pipelines| t                | t                  | f
  clear_backlog_tasks| t                | t                  | f
```

Both enum labels present. That readback came from the step that ran the DDL, so
`scope=probe` now carries the same read independently, plus `service_role`
EXECUTE and the two labels asked of `pg_enum` directly. An apply grading its own
work cannot tell a wrong assertion apart from a wrong migration.

## Newest (2026-08-22): any model records safely; only exact Codex executes

The current release candidate resolves the Step 8 provider/model dead end
without pretending that every provider has an executor (ADR-115). Exact
`openai` / `gpt-5.3-codex` is still the only executable Factory identity. Every
other valid bounded pair, including Claude and alternate OpenAI models, is
`record_only`: command, task, immutable route, and disposition persist, while
the database and application both guarantee zero `agent_runs`, no worker
dispatch, and no branch, commit, pull request, merge, or deployment. Invalid
identities still fail closed. A nondefault `SOFTWAREFACTORY_CODEX_MODEL` also
fails before planning; do not use environment configuration to claim a second
executable model.

Step 8 now completes on durable recording. Step 9 consumes project-scoped safe
command history and explicitly reports that a `record_only` command has no run,
worker, branch, or PR by design. Reload must preserve the same project-only row,
and the projection must not reveal raw parameters.

Hosted migration `20260822000600_route_bots_onto_the_executable_model.sql` is
already applied. The protected database tail is not: `00300`, ACL normalizer
`00850`, `00900`, and `01000`, plus forward ACL containment `01100` and
`01200`, remain pending as one atomic forward-only chain. Apply them only through
`scope=factory-any-model-record-only`, after exact-main/READY-Vercel identity
and all immutable prerequisite, catalog, lint, health, and containment checks.
The owner directly requested this release in the active task; ADR-116 removes
the old magic RED phrase, predeclared-SHA, expiry, and repeat-approval ceremony
without weakening any technical or product/runtime gate. The workflow rehearses
the same six files under rollback
before the one transaction that records all six ledger rows. `00850` first
converges the exact four-function hosted ACL input: it restores required
`service_role` execution on `claim_provider_connect_session` and removes the
unintended service-role grants from normalize-configuration, claim-anchoring,
and pipeline-area validation. It preserves every function identity and keeps
the claim function's hosted `organization_id`/`purpose` OUT contract and OID.
`01100` removes
the exact hosted `service_role EXECUTE` overgrant on
`apply_resume_extraction(uuid,text[])` that the immutable `00500` left behind;
`01200` does the same for both clear-control functions left by immutable `00800`.
The retired standalone `00300` path must not mutate, and `scope=all` must not
introduce any member of the chain.

This is not a deployment handoff yet. No final candidate SHA, green exact-head
CI set, matching Vercel deployment, hosted atomic apply, or signed-in production
Step 8 -> Step 9/reload proof exists. Keep workers, autonomy, and automatic
actions OFF and the global kill switch ON. The next operator must freeze exact
identities, publish and verify the application, run the protected atomic scope,
then capture Claude/alternate-model project-scoped acceptance before using
"deployed" or "production ready."

## Prior (2026-08-22): every command was being refused, and why

`Issue a Command` refused every submission in every workspace with
`PROVIDER_MODEL_MISMATCH` — at the last step of the journey, after a project, a
pipeline and a bot had all been chosen. Nothing was misconfigured. The plan
fixed `gpt-5.3-codex`; `ensureProviderBot` named new bots `gpt-5.1-codex` from
the catalog's list; routing and `submit_factory_command` both compare the pair
exactly. One fact in two files, with nothing tying them.

`executionModel()` is now that tie (ADR-114), provisioning asks it, the roster's
picker marks each model **runs** or **cannot run**, and the refusal names the
bot, both models, and where to change one.

At this historical checkpoint, migration
`20260822000600_route_bots_onto_the_executable_model` was still outstanding.
It is now hosted; do not rerun it. The current pending database action is the
atomic ADR-115/ADR-118/ADR-120/ADR-121
`00300 -> 00850 -> 00900 -> 01000 -> 01100 -> 01200` scope described above.


## Prior (2026-08-22): application deployed; repaired database sequence local

Exact commit `30d7e824691bdd4f8fa72481b21c91d3da6e3a31` is current
`main`, with `surgeservicesllc <surgeservicesllc@gmail.com>` as author and
committer. Vercel production deployment
`dpl_FrvCToHvFhkzfwnkmEeeTyfuE3v2` is READY at
`https://softwarefactory-116001qbk-surgeservices-projects.vercel.app` and owns
the stable aliases. GitHub deployment `6036292508` and status `17160408639`
bind that production deployment to the exact commit.

Exact-head CI run `32570540183` is red. Browser/accessibility shards 1/3, 2/3,
and 3/3 passed; quality job `97025270055` failed during tests and skipped build.
The LF Linux/PostgreSQL chain reached `20260822000150`, where all seven legacy
routine hashes failed because `pg_proc.prosrc` line endings were not
canonicalized. Supabase Preview check `97025325852` failed separately at the
older provider-credential migration because `provider_credentials` already
exists, the same pre-existing preview drift seen on earlier heads.

The local repair canonicalizes CRLF and lone CR to LF before every
`md5(prosrc)` comparison and pins these exact repository files:

- 00150 —
  `6b24b6ebb57e59b9c4398c3e439221c27c300663a7b6932ff192996ffe6bcd93`;
- 00200 —
  `658e615580cc5b413f81fd45f5b884917c27f44b66395aa462f9640ac27c48bf`;
- 00300 —
  `79914bc97660eef908b6a0fa0c90abfdd15da1683b383ad568e34bf3bd32c5f7`.

Native PostgreSQL 17.10 and 18.4 full chains pass. Before hosted action, record
the exact forward-commit identity and require green CI plus fresh RED authorization. No hosted
database mutation has occurred: 00150/00200/00300 remain absent, CONTRACT was
not dispatched, and no apply, ledger insert, repair, reset, or down-migration
followed `30d7e824`.

Historical containment evidence remains valid: exact predecessor commit
`4fc18d3e5ecba6f362f14a7459e588a74a84b84b` reached READY deployment
`dpl_8yngqtjJkNbexxWAMfAhZtEf1RWU`; EXPAND run `32568221857` then stopped at
`LEGACY_CATALOG_READY` before its apply notice, DDL transaction, ledger insert,
or PostgREST reload. Never rerun that old EXPAND path.

## Newest (2026-08-22): Claude bot identity and Role assignment

The application portion is deployed at `30d7e824`; its protected database
sequence is not. AI Factory owns the one application
modal/backdrop/focus/close boundary. `ProjectBots`, its assign/configure/edit
states, and zero-role onboarding render inline inside that overlay instead of
opening nested dialogs. A zero-role organization sees the reviewed Backend
engineer starter selected by default; the complete template is submitted to
the existing same-origin manager-only `/api/bot-roles` boundary, and its exact
returned UUID is applied only to selected drafts with no role. Do not conflate
that role with the Developer permission preset used for a new posting. Existing
postings retain their authored role and configuration; with existing roles, a
new posting prefers the preset-matching slug before the first available role.

The owner screenshot exposed a UI-only identity shortcut: `ProjectBots` used
`credentialRef` similarity to hide the exact-link repair control. An unbound
Ready legacy bot could then be assigned while AI Factory correctly kept steps
5-7 incomplete. The local fix removes that inference, exposes the existing
exact `/api/bots/connect/provision` Link-or-repair/adoption path, awaits the
parent refresh, and provides an accessible **Return to AI Factory** action. The
affected completion predicate remains: connected account + exact
`aiAccountId` + current Ready + project assignment.

The containment is frozen in the current unpublished candidate. Focused UI
passes 75/75; focused ESLint, full typecheck, and lint/typecheck/build are green. The root
full suite passes 337 files / 4,054 tests, with 3 files / 7 tests skipped. Its
first contention-only `supabase-wiring` timeout cleared isolated 2/2 and on the
full rerun.

Migration `20260822000200_register_bot_for_ai_account.sql` is frozen at SHA-256
`658e615580cc5b413f81fd45f5b884917c27f44b66395aa462f9640ac27c48bf`.
`ensure_ai_account_bot` derives provider and credential slot from the exact
tenant account and returns a bot UUID bound to it. A default/non-additional
request reuses the account's bound bot or adopts at most one unambiguous legacy
bot in place; an explicit additional request creates another distinct bot with
the same account binding. Incoherent future writes are refused. Bot and
assignment revisions initialize at 1 and advance on every update. Checked assignment,
configuration, status, and model/work-effort writes lock and compare exact
assignment id, project id, and revision, and released postings reject further
checked edits. Existing grants are patched rather than rebuilt; the client
still requires the exact RPC result and committed readback.

`record_bot_readiness_preserving_disabled` is service-role-only and carries the
initiating owner/admin actor. Under row lock it compares exact bot revision,
account UUID, provider, model, credential reference, and base URL; stale
evidence fails, a check cannot author Disabled, and an existing Disabled value
survives unchanged. `bot.registered` and adoption-path `bot.updated` immutable
events include the exact `ai_account_id`. This is an EXPAND migration: legacy
registration/assignment/readiness definitions, signatures, `SECURITY DEFINER`,
pinned search paths, and exact ACLs remain unchanged. All six legacy mutation
RPCs temporarily retain authenticated-only execution so the deployed old app
survives migration-first cutover; checked wrappers and the service-only recorder
are additive. That is a bounded compatibility bypass, not the final contract.
Revoke those grants only in a separately approved forward CONTRACT migration
after the exact replacement app is deployed and accepted.

The read side filters released history in SQL and keyset-pages open assignments
by UUID until an empty terminal page. It does not treat a short page as final,
and invalid cursor progress or the 100-data-page guard fails the entire roster,
so incomplete data cannot mark the assignment-derived Assign/Configure steps
complete. Connect separately proves connected account -> exact account-bound
Ready bot; overall Factory evidence continues through the exact selected
project and revision-checked active configured posting across reload.

Broker start/retry/close/unmount cleanup is serialized. Exact session UUID and
generation fence every poll/callback; late superseded results are ignored.
Retry cancels before starting anew. Close blocks a racing retry, waits for an
in-flight start's exact session id, and refuses to dismiss/resumes polling when
cancellation cannot be confirmed.

Prepublication local gates and the three exact-head browser shards remain useful
evidence, but the failed quality job is the controlling release result. The
application was pushed and deployed; the protected database sequence was not.
The workflow verifies separate exact files and ledger/catalog boundaries for
00150, 00200, and 00300, and `scope=all` refuses to introduce them. Runtime
behavior, linked-database lint, application health, and kill-switch/autonomy/
worker containment remain separate mandatory post-apply release gates.

Freeze the repaired commit, request fresh exact RED approval, publish it, and
require green exact-head CI before any hosted DDL. Keep kill switch ON, raw
autonomy and all automatic actions OFF, and worker/executor disconnected.

## Newest (2026-08-22 ~01:30Z): agents are selectable into the AI Factory (ADR-107)

The owner's goal for /solutions/agents, shipped as the mirror of pipeline
selection: migration `20260822000100_project_agent_selection.sql`
(project_agents + three definer functions, RLS + FORCE RLS, no direct
table path), `/api/project-agents` (GET/POST/DELETE, unapplied migration
reported as Not Connected), and one shared `ProjectAgentSelector`
component rendering "Include in AI Factory" toggles on the Agents page
(standalone project picker) and inside the factory's new **Select
Agents** step (journey-scoped, done when at least one agent is included,
included names as evidence). Selection is routing intent — audit-evented,
advisory-locked, refused for archived projects, cross-project agents,
and non-managers. Local certification: 16 behavior cases against the
full migration chain, 10 route cases, 5 component cases, factory suite
updated to the nine-step journey; lint, tsc, and the production build
green. Hosted apply: `scope=agent-selection` added to the apply workflow;
runbook total is now 131 and the 13 tail pins moved to the new file.

## Newest (2026-08-21): AI Factory production pass is 4/8; bot fix pending

Exact candidate head `a020e8192d8512a1bb65112e01017047087f0528` is green in
CI run `32543409160`: quality and browser shards 1/3, 2/3, and 3/3 all passed.
That proves the candidate head only; it is not evidence that production serves
the candidate.

Authenticated production-browser evidence is now **4/8**. **Agentic SDLC** was
selected for the existing project, survived reload, and produced an immutable
`pipeline.selected` event visible in Activity. The owner reconnected Claude,
and production reports that account Connected. Refresh queued background
re-verification but remains pending because no worker sweep completed; do not
present the spinner as fresh worker or end-to-end health evidence.

Create Bot currently fails and leaves zero bots. Root cause is isolated outside
the owner-frozen connection path: Bot Manager forwards raw broker purposes
`claude`/`claude_N` or `codex`/`codex_N`, while
`/api/bots/connect/provision` accepts provider-neutral
`subscription`/`subscription_N` choices. The branch candidate now normalizes
all account-backed paths and fails closed on missing or mismatched metadata;
PR #309 exact head `db1958f8b501e865a9e741a21298683e0f88f969` has 99 focused
tests, lint, typecheck, production build, and secret/protected-path audit green.
It did not pass its merge gate: browser shards 1/3 through 3/3 in run `32545138211` failed
because the loading state omitted the page's H1. The forward candidate keeps
the `AI Factory` H1 in loading and every fail-closed state and adds a direct
regression test, so the prior exact-head merge approval is stale.

Do not merge after only repairing that shard. The protected credential
normalizer currently rejects the catalog-declared Claude/Codex subscription
references that provisioning writes, so a created subscription bot would read
Not Connected despite a stored vault credential. The manager-only manual
readiness endpoint also checks and serializes environment presence only, so it
persists the same false negative for vault-backed accounts. Those protected
paths remain unchanged pending exact owner approval. Provisioning also leaves
`bots.ai_account_id` null; full account-identity binding needs a separately
reviewed forward schema/RPC change. The fix is not deployed, so do not claim
the Claude account is yet usable or sticky as a bot; after an authorized
release, repeat create, assign, configure, and reload acceptance.
real broker-purpose fixtures, the focused 100-test run, lint, typecheck, and a
production build pass. The fix is not deployed, so do not claim the Claude
account is yet usable or sticky as a bot; after an authorized release, repeat
create, assign, configure, and reload acceptance.

Do not promote production while the known blockers remain: five linked lint
errors/ten findings, raw autonomy enabled for one organization, raw kill switch
off for one organization, two projects with effective kill off, no
connected/fresh worker, and hosted `20260821000300`/candidate
`20260821000400` drift. Worker/autonomy stays off and production is not fully
live.

## Newest (2026-08-22 ~00:45Z): the journey has now run against PRODUCTION itself — green

The owner's goal ("connect to the site remotely, fill every field with
fake data, prove every capability, everything wired to Supabase")
completed against https://www.theagoras.com directly. Sequence: the
owner approved the one-shot `journey-prod-user.yml` (#305, dispatched)
which marked the fake account jordan.seeker.prod1@example.org
email-confirmed in hosted GoTrue and swept the unconfirmed probe
residues — no auth configuration changed, confirmation stays ON for real
users. The journey lane gained a remote-target mode (#306:
`base_url`/`email`/`password` dispatch inputs skip the local-stack
steps). Dispatch run 32540879299: remote step green (one first attempt
timed out just after sign-in on a production cold start; the CI retry
ran the complete spec to the end — Playwright reports it flaky, the job
succeeded). Independently verified by signing in to production as the
fake user and reading back through the production API: 42 jobs in the
fake workspace (2 manual + 40 `via greenhouse` — real Stripe postings
imported live in production), all 42 scored, analytics computed from the
walked rows (applications 1, response rate 100%, interviews 1, offers
1). Sandbox note: this session's egress proxy accepts curl and raw
CONNECT but resets every Chromium TLS hello, so remote browser runs ride
the CI runner (the lane's remote mode) — playwright.config.ts now
forwards HTTPS_PROXY for remote HTTPS targets for environments where the
proxy accepts browsers. Cleanup when desired: delete the fake user in
Supabase Auth → Users; the cascade removes its workspace rows.

## Newest (2026-08-21): immutable Factory command routing (ADR-106)

The rebased release candidate adds
`20260821000400_command_factory_routing.sql` (34,999 bytes; SHA-256
`e45149db3ca7c66a27934b0b49ac160e1b5ef597fc8f34ad8547de4759086598`).
Only an authenticated organization owner may submit or replay. The database
uses the existing command/task/run transaction, rechecks the stored effective
risk, and freezes the selected pipeline/template, assignment, bot, role,
provider, resolved model, work effort, and configuration/risk snapshot in an
immutable route. Exact replay resolves that route before any mutable project,
pipeline, roster, readiness, or capacity state is read. This release creates
no worker dispatch or autonomy change; no connected/fresh worker was observed,
and approve, merge, deploy, and rollback remain unavailable. If the RPC is
absent, the API fails closed as Not Connected/503.

Two first-use UI failures are also closed in this candidate. The embedded
template-plan dialog derives its locked project synchronously, never flashes a
false empty-workspace state, and does not issue the wider `/api/projects`
request. The assignment wizard names the missing-role prerequisite, links to
the real Bot Manager route, and cannot advance from Configure until every
selected bot has a role.

Do not describe this candidate as live. Hosted production includes
`20260821000300` and still serves the old copy; `20260821000400` is unhosted.
The current release blockers are measured adverse state, not assumptions:
five linked-database lint errors across ten findings; one raw organization
with `autonomous_mode = true`; one raw organization with
`autonomy_kill_switch_active = false`; two projects whose effective kill switch is off;
and no connected/fresh worker. These measurements supersede older claims below
that linked lint is clean or that hosted controls are universally all-OFF and
kill-ON. Contain and remeasure them before any hosted apply or production
promotion.

Candidate lint, typecheck, and build pass. The default unbounded Windows run's
Supabase-wiring and pipeline failures were contention-only and both cleared on
isolated retry; the wiring contract passed 2/2 in 0.603s with `maxWorkers=1`.
The bounded current-head non-frozen command
`vitest run --exclude tests/unit/auth-broker-runner.test.ts --maxWorkers=4`
passes 317 files / 3,730 tests with 7 skipped in 183.78s. The excluded
owner-frozen auth-broker file contains 19 tests and is excluded locally solely
because Windows lacks Unix `script`. Linux CI must run it as part of the full
suite. The independent hosted-runbook/repository-memory guards remain 21/21.

## Newest (2026-08-21): FirstMate review → read-only Factory Briefing (ADR-104)

FirstMate was reviewed at exact commit
`738460d401b1115dab617c3859077973977615cb` (MIT, Copyright 2026 Kun Chen).
It is a single-user local Bash agent distribution, not a compatible web
dependency, so this change reimplements only its strongest information-
architecture invariant: one four-lane bearings view. The Dashboard's former
fragmented attention block is replaced by Factory Briefing, which classifies
live task/run/graph/inbox/incident/connection evidence into exactly one of
Needs owner now, Underway, Recently finished, or Up next; reports the logical
Orchestrator role and worker heartbeat separately; caps lists with totals; and
names every missing, malformed, or saturated source. Linked runs are folded
into their task. Eight parallel reads have timeouts, batch cancellation, and
stale-response protection; briefing-specific server responses omit prompt-
derived task titles, command prompts, inbox bodies/choices, graph node/
artifact/verification details beyond fail-visible verdicts, repository
details, and unrelated operations data. Malformed graph verification evidence
fails the source read closed. All actions navigate to authoritative screens
rather than mutating from the summary. No migration, auth/RLS boundary, worker, provider,
autonomy setting, workflow, merge, deployment, or production resource changed.

Local evidence: full ESLint and TypeScript clean; production Next build green;
57/57 focused classifier/component/minimized-route/operations-contract tests
green; the component browser matrix has 30 passes and 15 intentional skips in
the non-resizable mobile project across 320–1440 px, including populated
layout/control/axe checks and an unbroken
maximum-length coordinator at 320 px. On the rebased combined tree, the local
unit suite passes 2,506/2,506 after excluding two pre-existing Windows-only
process/permission files. Database behavior suites need their configured
stack; Linux draft-PR CI remains authoritative.
Publish only a draft PR; do not merge or deploy from this handoff.

## Newest (2026-08-21 ~23:45Z): Job Discovery is operational — real public-board imports (ADR-105)

The owner's goal "make /job-seeker?section=discovery 100% operational"
shipped as identifier-driven public imports: Greenhouse and Lever read
their providers' public keyless APIs, driven by a board token / site name
the user types on the card — the env-var "credentials" those two adapters
demanded were a misclassification, dropped. `POST /api/job-seeker/import`
fetches up to 40 postings per request (the reply states the board's true
total), records each through the same evaluate → job → match →
application chain as manual entry (shared `lib/job-seeker/record.ts`),
counts duplicates via the existing unique index, and skips-and-counts
anything the credential scanner refuses. Job rows carry `via {source}`
attribution. LinkedIn stays honestly Not Connected (real OAuth needed).
Proven live end to end: the journey's new discovery phase drives the real
Greenhouse API — a missing board's verbatim refusal, then the "stripe"
board imported and scored (local stack: 40/40 imported rows scored and in
the pipeline) — journey green in 32.7s. Also measured this session:
production sign-up still answers 202 confirmationRequired even after the
owner reported disabling confirmation — the dashboard toggle did not take
(wrong switch or unsaved); sign-in probes stayed 403 email_not_confirmed
through a 10-minute poll.

## Prior (2026-08-21 ~21:15Z): Job Seeker — full browser journey green against a real Supabase stack; three live defects found and fixed

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
provider usage in the lane. **The lane is proven live**: first dispatch
on main, run 32533731639, green in 3m40s — the runner provisioned the
stack, minted the user, built and served the production app, and the
whole journey passed.

**The production sign-in boundary is now measured, not assumed**: a probe
of production's own `/api/auth/sign-up` answers 202 with
`confirmationRequired: true`, so a signed-in production journey needs a
real inbox — only the owner has one. (Two probe residues exist in hosted
auth: `jordan.journey.b@example.org` — unconfirmed, org-less, cannot sign
in — and possibly `jordan.journey.2026@example.com` from a first attempt
that 503'd; the owner can delete both from Supabase Auth → Users, and
nothing references them.) If the owner ever wants the journey run against
production itself, either sign in and use the page, or temporarily
disable email confirmation in hosted Auth settings and say so — the spec
takes `JOB_SEEKER_E2E_EMAIL`/`_PASSWORD` overrides and would run as-is
with `PLAYWRIGHT_BASE_URL=https://www.theagoras.com`.

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

## Newest (2026-08-18): Use records a project's pipeline — one owner action outstanding

`Configure Pipeline` on `/solutions/ai-factory` now has something to configure.
Pressing **Use** on a template card selects it for the project the journey is
scoped to, writes that to `project_pipelines`, and the step reads it back: done
only when at least one pipeline is selected, with the chosen names rendered on
the page. Many can be selected; pressing a selected card again removes it. The
graph-planning dialog Use used to open is now its own **Plan graph** button.

**Applied on production**, 2026-08-21 23:27Z, run `32536895799`
(`scope=pipeline-selection`, `confirm=apply`). The run's own after-ledger
listing prints `20260821000300 | 20260821000300` — local and remote — so the
`project_pipelines` table and its three definer functions exist on the hosted
project and the ledger records them. The PostgREST schema cache was reloaded in
the same step, so a browser that had been seeing PGRST202 stops.

The Not Connected path stays in the code and is not dead: it is what any
database without this migration — a fresh preview branch, a restored snapshot —
will report, and it is the reason a missing migration cannot present as an empty
selection set. `/api/project-pipelines` returns
`pipeline_selection_not_connected` there and the Use button is disabled naming
that reason.

What this run does **not** establish is behaviour observed in production: a
ledger row proves the DDL ran, not that someone has pressed Use on the live
site and seen the selection survive a refresh. That observation is still
outstanding.

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


Finish Phase 1C live acceptance without overstating status. Historical reconciliation and verification below remain useful, but the current hosted release gate is adverse: five linked lint errors/ten findings, raw autonomy/kill-switch drift, and no connected/fresh worker. Production is on `20260821000300`; factory command routing in `20260821000400` is local and fails closed until hosted. No successful Phase 1C run or draft PR exists, so Phase 1C remains **Not Connected** and no command routing may dispatch work.

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

Phase 1D migration `20260813000600_phase1d_autonomy_controls.sql` remains part of the historical hosted chain, but its old all-OFF/kill-ON observation is no longer current evidence. Raw hosted data now includes one organization with `autonomous_mode = true`, one with `autonomy_kill_switch_active = false`, and two projects with effective kill off. No connected/fresh worker or executor was observed, so nothing is dispatched; contain the drift before any routing migration or promotion.

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

- Command route/composer: connected-project and exact selected-pipeline admission, command type, acceptance criteria, stable idempotency, deterministic risk, exact base SHA, fixed plan, immutable bot-route evidence, database-authoritative response snapshot, and truthful persisted-only/no-dispatch states.
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
- Current routing candidate: lint/typecheck/build pass. Default unbounded-run wiring/pipeline contention failures both clear in isolation. The bounded current-head non-frozen Windows suite passes 317 files / 3,730 tests, 7 skipped, in 183.78s with `maxWorkers=4`; it excludes only the owner-frozen 19-test auth-broker file because Windows lacks Unix `script`. Linux CI must run the complete suite. Hosted production has `20260821000300`, not `20260821000400`; linked lint currently has 5 errors/10 findings. Publication, Linux full-suite evidence, hosted apply, matching deployment, and owner acceptance remain pending.
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

- [ ] Re-establish a current hosted release baseline: resolve 5 linked lint errors/10 findings and the measured autonomy/kill-switch drift, then verify raw/effective controls and worker freshness before applying `20260821000400`.
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
- [x] Documentation and scorecard distinguish hosted `20260821000300`, unhosted `20260821000400`, the old production copy, and the current linked-lint/control/worker blockers without claiming Phase 1C Connected.
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
