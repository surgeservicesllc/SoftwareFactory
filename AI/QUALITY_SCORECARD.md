# Quality scorecard

Last reviewed: 2026-08-25

**Addendum, 2026-08-25 — the ten-step factory: four engine defects found by
driving it, and what is actually proven (ADR-144, ADR-145):** the owner's
ten-step production-readiness goal was driven against live production, and
the drive — not review — found four defects in the graph engine. Each was
fixed with a regression that fails without it:

- **Gate-halted re-pay (ADR-143, `20260824001100`).** A gate-approved node's
  recorded work was re-executed on the next claim, spending a provider window
  on work the database already held. The resume read now offers VERIFYING
  runs. Hosted-applied.
- **A void consumed a gate approval (ADR-144, `20260825000100`).** The claim
  compared the owner's approval against the last RUN's close rather than the
  last ANSWERING run's, so a capacity-voided run silently staled the approval
  and stranded lifecycle `d7241cf4` permanently. The watermark now counts
  answers only. Hosted-applied, run `32805322660`, readback verified — and
  proven live: run `04e5f69f` reused all nine recorded stages at zero cost.
- **A flat turn budget (ADR-145).** The lifecycle's implement node exhausted
  24 turns twice; implementation surveys a repository before it can describe
  a build. Ceiling 48, implementation nodes granted it, both pinned against
  the ceiling so a silent clamp cannot recur.
- **The artifact guard killed the drain (ADR-145).** A node's real output
  tripped the sensitive-data constraint — the guard working — and the raw
  throw stopped the drain for every organization's graphs. The engine now
  writes the artifact before the COMPLETED mark and contains the refusal to
  its own node, with a message that never restates the payload.

**Ten-step flow, local: PASS.**
`tests/integration/ten-step-consecutive-flow.behavior.test.ts` drives one
`full_lifecycle` request to a COMPLETED run against the real migrated schema
across gate-halted windows: all eleven stages close with a COMPLETED node and
an artifact, no node executes twice, both human gates are owner-approved and
the automatic gate decides on its anchors, `list_graph_runs` reports
identically on a second read, and a signed-in outsider is refused outright.
Step 1's refusals are pinned at the route boundary (malformed body, non-uuid
project, unknown template, non-manager role, cross-origin), each asserting
its own error code. Full suite 4535 passed / 2 skipped, lint, typecheck and
production build green; all ten `/solutions/factory/*` pages serve 200 to a
signed-in user on `dab41e5`.

**Ten-step flow, live production: PARTIAL — steps 1-2 only.** Lifecycle
`1f9defa2`, launched by a signed-in user through the real product API, has
GOAL, PRD and all three DISCOVERY scans recorded from genuine model
execution. Steps 3-10 have NOT run live: the provider session limit voided
the run at `consolidate`, and windows reset roughly every five hours. This
is a capacity bound, not a defect — the void is the engine behaving
correctly. **PRODUCTION READY is therefore not claimed for the live
ten-step walk**; it remains PENDING the next windows.

**Seeded ten-step flow: PASS.** `tests/integration/dev-seed-drive.behavior.test.ts`
walks the whole flow to a COMPLETED run by calling `driveSeedLifecycle` — the
exact loop `npm run seed:dev` runs — against the real migrated schema, with
only PGlite substituted for supabase-js. All eleven stages close with a
COMPLETED node and a recorded artifact, the two human gates are approved by
the owner and the anchored gate decides itself, the walk halts for a person
without `--drain`, and every artifact carries `dev_seed`. Running the real
loop found two further defects: the claim was parsed before being checked
for null (an empty queue threw a malformed-projection error instead of
reporting an idle answer), and a `--drain` re-run claimed nothing at all,
because the first run leaves an OPEN gate that makes the graph deliberately
unclaimable and the loop only decided gates after a claim — so the obvious
two-step usage did nothing. Both fixed and pinned.

**Development seed setup: PASS — and it was broken.**
`scripts/seed-dev-lifecycle.mts` was first recorded here as unexercised,
because this container cannot start Docker. That was too generous: its setup
path was checkable against real PostgreSQL all along, and
`tests/integration/dev-seed-setup.behavior.test.ts` found **two defects that
would have failed the first time anyone ran it**.

It created its project with a direct service-role insert, but only
`postgres` may insert a project — migration 20260812001700 revoked that from
`authenticated`, and `service_role` never held it, because a project is born
from the audited `connect_github_project` path. And it read its world with
the service-role client, which holds SELECT on none of `projects`, `graphs`
or `graph_gates`: those are granted to `authenticated`, so RLS decides who
sees what. Both were fixed by respecting the boundary rather than widening
any grant — the seed now finds a project instead of inventing one, and reads
as the signed-in owner — and both failures are kept as assertions.

Now **PASS** at 5 cases against the real migrated schema: onboarding
idempotency, no role may invent a project, the discovery read refused the
service role and working as the owner, all eleven phases staged through
`create_graph_from_plan`, and the planted graph actually claimable. The full
end-to-end drive against a live Supabase stack remains **PENDING** the same
Docker limitation, and the script is idempotent, labels every payload
`dev_seed`, refuses the production project with no override, and refuses to
claim graphs it did not plant.


**Addendum, 2026-08-22 ~21:30Z — containment gate honesty and the audit
guard's hosted ACL (ADR-122):** four probe-guided rounds isolated why the
protected chain kept refusing at containment after every catalog gate went
green. The owner's Safety-page actions (~21:11Z: kill switch engaged,
Autonomous Mode OFF) satisfied every state and event clause — probe
`32599024205` reads all four project rows green with a disconnected worker
table — leaving exactly one red clause, `reject_mutation_function_posture`
(probe `32599284961`). Its two causes are fixed in one change: the gate's
space-only `btrim` source comparison, false on every database including a
pristine one, now trims `' \n'`; and `20260822001300` behind
`scope=audit-guard-acl-contract` removes the hosted Supabase default
`service_role EXECUTE` grant on `reject_activity_event_mutation()`.
Certified locally by `tests/integration/audit-guard-acl-contract.test.ts` —
**PASS** at 4 cases: clean-chain no-op, reproduced hosted default grant
contracted, unknown-ACL refusal, and full-chain replay including the
protected six. Hosted application of `20260822001300`, the protected chain,
and the production Step 8/9 acceptance remain **PENDING**.

**Addendum, 2026-08-22 — Backlog and All Pipelines clear controls
(ADR-119):** `main` commit `9761055` (#317). Local verification before merge is
**PASS**: 345 test files, 4168 tests passed, 0 failed, 2 skipped, with lint,
typecheck and production build green. `tests/integration/clear-backlog-and-pipelines.behavior.test.ts`
is **PASS** at 15 cases against real PostgreSQL, covering the owner/admin check,
the ten-character reason floor, the live-work skip, the cascade-into-run-history
skip and its explicit opt-in, replay, and the audit row written by a clear that
deleted nothing.

Hosted application is **PASS**: run `32582241930`, `scope=clear-controls`,
ledger empty for both `20260822000700` and `20260822000800` beforehand. The
post-apply readback measured `security_definer t`, `member_may_execute t`,
`anon_may_execute f` for `clear_backlog_tasks` and `clear_all_pipelines`, and
both `activity_event_type` labels present.

That evidence is **self-graded**: the step that applied the DDL also asserted
it. `scope=probe` now reads the same catalogue independently — the definer
flag, owner, and EXECUTE for `authenticated`, `anon` and `service_role`, plus
the two labels from `pg_enum` — so a wrong assertion and a wrong migration can
no longer cancel out. The independent read has not yet been dispatched.

**Any-model safe command candidate (ADR-115): LOCAL/PENDING RELEASE.** Exact
`openai` / `gpt-5.3-codex` remains the only executable identity. All other valid
bounded provider/models are `record_only` and are contractually limited to
durable command/task/route history with zero runs, worker dispatch, repository
artifacts, or deployment. Invalid identities and every nondefault
`SOFTWAREFACTORY_CODEX_MODEL` execution pin fail closed.

Step 8 durable-record advancement and truthful Step 9 are implemented against a
project-scoped safe history projection; raw parameters are not part of that
projection, and reload persistence is covered locally. Hosted `00600` is
already applied. Protected `00300/00850/00900/01000/01100/01200` remain pending
as one atomic scope, with rollback rehearsal and exact ledger/catalog/ACL/lint/
health and safety gates. Read-only hosted probe `32591774367` measured twelve
exact guarded functions and four exact ACL deltas. `00850` converges only those
ACLs, preserving every OID and the claim function's hosted
`organization_id`/`purpose` OUT contract; `00900` freezes that legacy contract
instead of replacing it.

ADR-116 removes only the repository release ceremony: a direct owner request in
the active task is sufficient release authority, without a magic RED phrase,
predeclared commit/hash, expiry, or repeated approval. Exact-head CI, READY
deployment identity, immutable migration hashes, rollback rehearsal,
ledger/catalog/ACL/lint/health checks, audit evidence, and containment remain
mandatory. Product/runtime RED approvals are unchanged.

Release status is therefore **NOT DEPLOYED / NOT PRODUCTION-ACCEPTED** for this
candidate. Final commit identity, exact-head green CI, matching READY Vercel
deployment, hosted atomic apply, zero-run postflight, and signed-in
Claude/alternate-model Step 8 -> Step 9 -> reload evidence are all still
required. Existing workers/autonomy/actions remain OFF and the global kill
switch remains ON; no prior deployment is evidence for this new behavior.

**Historical release checkpoint before ADR-115, 2026-08-22 (ADR-111,
superseded):** exact commit
`30d7e824691bdd4f8fa72481b21c91d3da6e3a31` is on `main`, authored and
committed by `surgeservicesllc <surgeservicesllc@gmail.com>`. Exact Vercel
production deployment `dpl_FrvCToHvFhkzfwnkmEeeTyfuE3v2` is READY at
`https://softwarefactory-116001qbk-surgeservices-projects.vercel.app` and owns
the stable aliases. GitHub deployment `6036292508` and status `17160408639`
bind the deployment to that exact SHA.

Exact-head CI run `32570540183` is **FAIL**. Browser/accessibility jobs
`97025270171`, `97025270137`, and `97025270138` are **PASS**. Quality job
`97025270055` is **FAIL** during tests and skipped build because the LF
migration chain rejected all seven legacy routine hashes at the 00150
preflight. Supabase Preview check `97025325852` is also **FAIL**, separately,
at the older provider-credential migration with SQLSTATE `42P07` because
`provider_credentials` already exists; the same preview drift predates this
candidate.

The local repair canonicalizes CRLF and lone CR to LF before every
`md5(prosrc)` comparison and pins 00150, 00200, and 00300 respectively at:

- `6b24b6ebb57e59b9c4398c3e439221c27c300663a7b6932ff192996ffe6bcd93`;
- `658e615580cc5b413f81fd45f5b884917c27f44b66395aa462f9640ac27c48bf`;
- `79914bc97660eef908b6a0fa0c90abfdd15da1683b383ad568e34bf3bd32c5f7`.

Native PostgreSQL 17.10 and 18.4 full chains are **PASS**. The repaired forward
candidate is not yet pushed, deployed, or authorized for hosted execution. No
hosted database mutation occurred; 00150/00200/00300 remain unhosted and
CONTRACT was not dispatched. Historical predecessor commit `4fc18d3e...`,
deployment `dpl_8yngqtjJkNbexxWAMfAhZtEf1RWU`, and fail-closed EXPAND run
`32568221857` remain retained safety evidence.

**Addendum, 2026-08-22 — Claude bot identity and Role-assignment release
candidate (ADR-108/ADR-109):** this is local candidate evidence only. Migration
`20260822000200_register_bot_for_ai_account.sql` is frozen at SHA-256
`658e615580cc5b413f81fd45f5b884917c27f44b66395aa462f9640ac27c48bf`.
It binds each returned subscription bot to the exact tenant AI account and
derived provider/credential slot. A default/non-additional request reuses the
account's bot or permits only one unambiguous in-place legacy adoption; an
explicit additional request creates a distinct bot with that same exact account
binding. Future coherence is enforced. Positive bot and assignment revisions
start at 1, increment on every update, and make stale exact-config/readiness or
exact-posting writes fail under row lock. Checked mutation paths refuse
released history.

Readiness recording is service-role-only, carries the audited owner/admin actor,
and compares exact bot revision, AI account, provider, model, credential
reference, and base URL. A check cannot author Disabled and cannot overwrite an
existing Disabled management state. `bot.registered` and adoption-path
`bot.updated` immutable events include the exact `ai_account_id`. This is an
EXPAND migration: legacy function definitions, signatures, security attributes,
search paths, and exact authenticated-only execute ACLs remain unchanged while
checked wrappers and the service-only recorder are added. The accepted rolling-
cutover risk is that the old application can still use unchecked assignment and
legacy readiness calls. Revocation requires a separately approved forward
CONTRACT migration after exact-app deployment and acceptance.

The visible path also closes coherently. AI Factory supplies one application
modal/focus boundary and embeds the roster, assignment/configuration flow, and
starter-role control without nested dialogs. With zero roles, Backend engineer
is the reviewed starter default and its full template is saved through the
audited role API; the exact returned UUID fills only blank selected drafts.
Developer remains the separate default permission preset for a new posting,
while existing posting role/configuration is preserved. The account connector
serializes start/retry/close/unmount operations and fences async results by
session UUID plus generation. The roster filters released rows before a
terminal-proven keyset traversal, continues after short pages, and fails closed
on invalid progress or the page guard. Factory completion therefore follows
one complete connected-account -> exact account bot -> selected project ->
revision-checked active configured posting chain.

Owner-screenshot containment closes one UI-only identity shortcut:
`ProjectBots` had used `credentialRef` similarity to suppress the exact-link
repair control. An unbound Ready legacy bot could be assigned while AI Factory
correctly held steps 5-7 incomplete. The local fix removes that inference,
exposes the existing exact `/api/bots/connect/provision` Link-or-repair/adoption
path, awaits the parent refresh, and adds an accessible **Return to AI Factory**
action. The affected completion predicate remains connected account + exact
`aiAccountId` + current Ready + project assignment.

This UI containment is frozen in the current unpublished candidate. Focused UI
is **PASS 75/75**; focused ESLint, full typecheck, and lint/typecheck/build are **PASS**. The root
full suite is **PASS** for 337 files / 4,054 tests, with 3 files / 7 tests
skipped. Its first contention-only `supabase-wiring` timeout cleared isolated
2/2 and on the full rerun.

Focused coverage exists for migration behavior, hosted-scope guards, exact bot
and readiness synchronization, revision/stale/released handling, complete-
roster pagination, one-modal/zero-role onboarding, assignment preservation and
readback, broker races, and Factory progress/reload. The final semantic audit
also covers every assignment, manual-bot, authored-role, and advanced-command
field; it fixed controlled Instructions editing and required endpoint gating.
Prepublication local gates and the exact-head browser shards remain useful, but
the failed quality job controls the release verdict. The application commit has
matching `main` and Vercel evidence; the repaired forward candidate does not
yet have a published exact-head CI result.

No database release claim is made. Dedicated protected scopes enforce the exact
00150 -> 00200 -> signed-in application acceptance -> 00300 order, and broad
apply refuses to introduce those files. Runtime behavior, linked-database lint,
application health, and containment are explicit post-apply gates. Promotion
remains RED. Kill switch stays ON, raw autonomy and all automatic actions stay
OFF, and worker/executor remains disconnected.

**Addendum, 2026-08-21 — AI Factory production acceptance:** exact candidate
head `a020e8192d8512a1bb65112e01017047087f0528` passed all four jobs in CI run
`32543409160` (quality plus browser shards 1/3, 2/3, and 3/3). Production-browser
evidence is separately **4/8**: **Agentic SDLC** persisted after reload and its
immutable `pipeline.selected` event appeared in Activity; the owner-reconnected
Claude account reports Connected. Refresh remains pending because no worker
sweep completed, so it proves no fresh worker or end-to-end bot health.

Production Create Bot still fails and leaves zero bots. The proven mismatch is
that the Bot Manager sends raw broker purposes `claude`/`claude_N` (or
`codex`/`codex_N`) to a provision contract that accepts provider-neutral
`subscription`/`subscription_N`. PR #309 exact head
`db1958f8b501e865a9e741a21298683e0f88f969` normalizes every account-backed
path and fails closed on missing/mismatched metadata; 99 focused tests, lint,
typecheck, the production build, and the secret/protected-path audit pass. The full Windows run
passed 3,763 tests but retained one unrelated timing failure that passed 13/13
immediately in isolation, plus the existing `script`-binary runner errors. The
exact-head CI gate failed in run `32545138211`: browser shards 1/3 through 3/3 could not
find the `AI Factory` H1 while required reads were pending. The forward
candidate keeps the page H1 in loading and all fail-closed states and adds a
direct regression test.

The candidate still is not release-ready: the protected credential normalizer
rejects the catalog-declared Claude/Codex subscription reference that
provisioning stores, the manual readiness endpoint checks and serializes
environment presence only, and provisioning leaves `bots.ai_account_id` null.
No protected fix was made without exact owner approval. Bot creation, assignment,
configuration, readiness, identity binding, and reload stickiness therefore
remain unproved. Production is also still unsafe/not fully
`subscription`/`subscription_N`. The branch candidate now normalizes every
account-backed path and fails closed on missing/mismatched metadata; 100 focused
tests, lint, typecheck, and the production build pass. The full Windows run
passed 3,763 tests but retained one unrelated timing failure that passed 13/13
immediately in isolation, plus the existing `script`-binary runner errors. The
fix is not deployed. Bot creation, assignment, configuration, and reload
stickiness therefore remain unproved. Production is also still unsafe/not fully
live because of five linked lint errors/ten
findings, raw autonomy and kill-switch drift, two projects with effective kill
off, no connected/fresh worker, and hosted
`20260821000300`/candidate `20260821000400` migration/application drift.

**Addendum, 2026-08-22 — Job Seeker, production-behavior certified:** the
evidence tier above local-stack certification now exists: the full
fake-data journey ran against https://www.theagoras.com itself (journey
lane remote mode, run 32540879299 — first attempt timed out on a
production cold start immediately after sign-in; the CI retry completed
the entire spec, so the run is recorded flaky-then-green). Confirmed
independently by signing in to production as the fake account and
reading the production API back: 42 jobs in its RLS-isolated workspace
(2 manual + 40 imported live from Greenhouse in production), all 42
scored, analytics recomputed from the walked rows (1 application, 100%
measured response rate, 1 interview-stage count, 1 offer). Every
capability on /job-seeker has now been observed working in production,
wired to hosted Supabase end to end.

**Release addendum, 2026-08-21 — Factory command routing (ADR-106):**
implementation is locally complete but not live. Migration
`20260821000400_command_factory_routing.sql` is 34,999 bytes with SHA-256
`e45149db3ca7c66a27934b0b49ac160e1b5ef597fc8f34ad8547de4759086598`.
It makes owner-only submit/replay durable and immutable, stores the selected
pipeline, bot/assignment, provider/model, work effort, effective-risk and
configuration evidence, rechecks stored effective risk, and resolves replay
before mutable state. The API fails closed as Not Connected until the RPC is
hosted. Submission dispatches no worker and changes no autonomy control; no
connected/fresh worker was observed, while merge, deploy, and rollback remain
not connected.

The UI candidate also pins two first-use boundaries: embedded graph planning
renders and submits only the caller's project from the first dialog frame,
without a workspace project read; bot assignment cannot advance past Configure
with a missing role and gives a real Bot Manager recovery path.

Current candidate lint, typecheck, and production build pass. Default
unbounded-run Supabase-wiring and pipeline failures were contention-only and
both clear on isolated retry; the wiring contract passes 2/2 in 0.603s with
`maxWorkers=1`. The bounded current-head non-frozen command
`vitest run --exclude tests/unit/auth-broker-runner.test.ts --maxWorkers=4`
passes 317 files / 3,730 tests, 7 skipped, in 183.78s. The excluded owner-
frozen auth-broker file has 19 tests and is excluded locally solely because
Windows lacks Unix `script`; Linux CI must run the complete suite. Hosted-
runbook/repository-memory guards separately pass 21/21. Production still hosts
`20260821000300`, not `20260821000400`, and serves the old application copy.
Hosted quality is blocked by five linked lint errors/ten findings, one raw
organization with `autonomous_mode = true`, one with
`autonomy_kill_switch_active = false`, two
projects with effective kill off, and no connected/fresh worker. Older clean-
lint/all-OFF/kill-ON statements below are historical and are not current
hosted evidence.

**Addendum, 2026-08-21 — Job Seeker, live-stack certified (ADR-097):** the
surface's strongest evidence tier so far: one continuous browser journey
(`tests/e2e/job-seeker-journey.spec.ts`, guarded by `JOB_SEEKER_E2E=1`)
green against real GoTrue + PostgREST + Postgres carrying all 127
migrations, under the production `next build` — every section filled with
fake data, every capability exercised, persistence proven by reload, the
approval gate and duplicate refusal observed in the browser, and the
anti-fabrication contract asserted on a live generated document. The run
found and fixed three live defects the mocked suites could not see (the
PostgREST one-to-one embed shape chief among them — the mocks had encoded
the wrong shape). Round 2 the same day extended the journey to the whole
capability surface (all eleven stages, reject+close, entry removal, the
resume BYTEA download round-trip, analytics re-checked after the walk)
and closed two more wiring gaps: the CRM details editor and the
persistent current-resume link. Suite counts on the merged state: 3,470
vitest green (2 skipped), lint and tsc clean, production build clean,
extended journey green in 30.8s. The journey also runs in CI now:
`.github/workflows/job-seeker-journey.yml` (dispatch + daily schedule),
proven live by run 32533731639 — green in 3m40s on a runner that
provisioned the stack itself. Live-wiring regressions surface within a
day without anyone asking.

**Addendum, 2026-08-21 — Factory Briefing (ADR-104):** locally implemented
as a read-only Dashboard projection with no schema or authority change. The
pure classifier pins mutual exclusivity, task ownership of linked runs
records, lifecycle precedence, deterministic priority/recency sorting, caps,
cancelled omission, coordinator/crew counts, stale-worker escalation, and
fail-visible unknown states. The component suite pins signed-out zero-read
behavior, eight concurrent `no-store` GETs with no mutating method, all four
populated lanes, GitHub-only evidence links, server-minimized briefing payloads,
omission of prompt-derived titles, command prompts, inbox bodies, and detailed
graph evidence beyond fail-visible verdicts; explicit unavailable/malformed/
saturated-source integrity warnings, and expired-session handling. Reads have
per-source timeout, batch cancellation, stale-response protection, and
visibility-aware polling. The populated browser harness covers every width from 320 through
1440 px and drives the component's refresh control; axe scans cover 320 and
1440 px, and a maximum-length coordinator has an explicit 320 px overflow
regression. Local evidence is full lint/typecheck/build green, 57/57 focused
tests, a browser matrix with 30 passes plus 15 intentional non-resizable-
project skips, and 2,506/2,506 unit tests on the rebased tree after excluding
two known Windows-only process/permission files. Database behavior suites need
their configured stack; Linux draft-PR CI remains authoritative. Production
behavior is not claimed until an authorized deployment and live authenticated
observation exist.

**Addendum, 2026-08-19 — graph execution (ADR-092):** the graph executor
boundary (migration `20260819000100`), the worker
(`scripts/graph-worker.mts`), edge data flow, capacity-refusal voiding, and
the one-time re-plant (`20260819000200`) are locally certified —
`tests/integration/graph-worker-execution.behavior.test.ts` (9 cases against
the full migrated chain, including measured parallel fan-out and both
convergence caps) and `tests/unit/claude-node-executor.test.ts` (8 cases) —
and hosted-behaviorally observed as far as the provider allowed: production
worker runs 32208699123 / 32208975669 / 32209893742 demonstrate claim,
parallel dispatch, containment, honest closure, and bounded re-claim on the
live database. **A node has now succeeded in production**: post-reset drain
run `32228988434`, graph run `e51c57a5-…` — the rollback inspector completed
through the CLI, its RAW artifact was recorded, and the run closed PARTIAL
with the incompleteness stated (every other node hit the worker's old
8-turn ceiling, since raised to 24 with an eight-minute MODEL-node
timeout). **The full chain has now executed end to end in production**: drain run
`32254860997`, graph run `ca347ab9-…` — an inspector completed through the
CLI, the deterministic reduce folded its findings in code, and the report
synthesis completed from the reduce output, with no node left undispatched
and the incompleteness stated. **Every inspector has now
succeeded in production**: post-reset drain run `32283900970`, graph run
`4d3f44a7-…` — all five MODEL inspectors completed in parallel through the
CLI with the corrected 24-turn/eight-minute envelope, the deterministic
reduce folded their findings, and the run closed PARTIAL naming its one
failure: the report synthesis, refused capacity minutes after the window
opened (the same window had just paid for the live canary's five nodes).
The live canary itself is green end to end — run `32283945714`, "fans out,
synthesizes, and verifies with a fresh context", 176.6s, zero API tokens —
so fan-out, synthesis, and fresh-context verification each have live
proof. **The complete run has now executed
in production**: drain `32310917147`, graph run
`1df3fd45-5501-4912-81f8-26448b865af3` — COMPLETED, 7 succeeded, 0 failed,
in 6m26s (22:54:48-23:01:14Z): five MODEL inspectors in parallel through
the CLI, the deterministic reduce, and the report synthesis, dispatched
alone in a fresh provider window per the plan in `20260819001200`. No
graph-execution claim is withheld any longer. CI on main is green on the
merged state with the browser suite sharded 3×535.

**Addendum, 2026-08-18 — a project's selected pipelines (ADR-098):**
migration `20260821000300` (`project_pipelines`, RLS + FORCE RLS, all table
privileges revoked from `anon`/`authenticated`/`service_role`, three definer
functions), `GET`/`POST`/`DELETE /api/project-pipelines`, the Use toggle in
`PipelineTemplatesManager`, and the AI Factory's Configure Pipeline step are
covered by `tests/integration/project-pipeline-selection.behavior.test.ts` (16
cases against the real migration chain, including owner-allowed,
member-denied-write/allowed-read, outsider-denied, anonymous-denied, and no
direct browser write path), `tests/unit/project-pipelines-routes.test.ts` (14
cases) and the two component suites. Lint, typecheck, the full 3258-test suite
and a production build are green on this change.

**Hosted evidence class: schema present, behaviour unobserved.** Run
`32536895799` (2026-08-21 23:27Z, `scope=pipeline-selection`) applied the
migration to the hosted project and its after-ledger listing shows
`20260821000300` local and remote. That proves the DDL ran — the table, the
three definer functions, and the ledger row — and nothing more. No one has yet
pressed Use on the live site and watched the selection survive a refresh, so no
production *behavioural* claim is made here.

The Not Connected path is retained and still correct for any database without
the migration: `/api/project-pipelines` reports PGRST202 with its own code and
the Use button is disabled naming that reason, rather than rendering an empty
selection set that would make a working button look broken.

**Addendum, 2026-08-18 — hosted evidence, measured (ADR-081):** the "the
migration is unhosted, so no hosted claim is made" qualifier attached to
several entries below was derived from a ledger high-water mark, and probe run
`32103778884` (read-only) shows that mark does not describe this ledger: it has
nineteen gaps in the middle and carries every row above them. Two entries below
are wrong as written — `20260816001500` (usage observations) and
`20260816001400` (repository picker) are both **on the hosted ledger**. The
`20260817` range is on it too, `20260817000700` included.

That is not the same as a hosted *quality* claim, and none is added here. A
ledger row proves the DDL ran; it does not prove behavior observed in
production, which is what these entries withhold. What changes is only the
stated reason for withholding it: for those migrations the reason is now "no
hosted behavioral observation", not "the schema is absent". The nineteen still
absent, and the per-version marker that decides repair-versus-apply for each,
are in `AI/HOSTED_APPLY_RUNBOOK.md`.

**Addendum, 2026-08-16 — per-account usage evidence (ADR-076):** migration
`20260816001500` (append-only usage observations, worker-only write, member
latest-per-account read), `lib/worker/usage-probe.ts` with the auth-broker
capture hook, `GET /api/ai-accounts/usage`, and the Bot Manager usage rows are
implemented and locally certified: the new behavior suite
`tests/integration/ai-account-usage.behavior.test.ts` and unit suite
`tests/unit/usage-probe.test.ts` pass alongside the updated
schema-security-invariants pins (service_role gains exactly
`record_ai_account_usage`; the policyless allowlist gains the evidence table),
with lint, typecheck, full vitest, and a production build green on this tree.
Hosted behavioral evidence does not exist yet. This entry originally said the
migration was unhosted; the 2026-08-18 measurement finds `20260816001500` **on
the hosted ledger**, so the schema is there and the panel fills in from the
already-deployed worker cadence. What is still unobserved is a production row. No execution
authority changes.

**Addendum, 2026-08-16 — project repository picker:** implemented and locally certified:
migration `20260816001400` (two definer functions, no table/grant/RLS changes),
`PUT`/`DELETE /api/projects/[projectId]/repository`, and the Connections console picker.
Evidence: `tests/integration/project-repository-picker.behavior.test.ts` (8 tests against
the full migrated chain: function ACLs, member refusal, link/relink/unlink evidence, the
named uniqueness refusal, the pending-reservation freeze, the archived-project refusal),
`tests/unit/project-repository-route.test.ts` (11 tests: same-origin, role, body, RPC
wiring, verbatim 55000 refusals, 23505 race mapping), and six new Connections console
component tests (picker render, link, unlink, uniqueness message, load-failure state,
no-installation state, zero-repository state). Local evidence only, and no hosted claim is made. The
"unhosted" reason originally given here is withdrawn: `20260816001400` is on
the hosted ledger as of the 2026-08-18 measurement. What is missing is a
production observation, not the schema.

**Addendum, 2026-08-16 — BotBuild (AI accounts + auth broker):** the P0 layer is
implemented and locally certified: migration `20260816000100` (two RLS+FORCE
tables with zero direct table access, 16 definer functions, `bots.ai_account_id`),
the `/api/ai-accounts` broker API, the worker auth runner + gated Actions
workflow, the auto-completing connect UI (no command, no check-now on the
primary path), unbounded account/bot slots (configured capacity only), and the
AI Accounts management panel (reconnect/disconnect). Full local gate on head
`1cab6f5`: vitest 2804/0, tsc clean, eslint 0 errors. **Superseded live
(2026-08-16):** the broker is LIVE in production for both providers — three
Claude accounts and one Codex account are Connected with identity capture and
periodic verification, owner-verified by screenshot at 19:07Z — and both
paths are owner-frozen (ADR-072/ADR-073). The freshest full local gate is on
merged head `aeabc95` (GitHub install host-convergence + freeze extension):
vitest 2839 passed / 2 skipped / 0 failed, tsc clean, eslint 0 errors
(10 pre-existing warnings in untouched files), production build exit 0.
Still open from this addendum: the verification loop UI and per-bot
runtime/log tracking beyond assignments (todo.md P1–P3).

Decision: **Phase 1C is re-architected to zero-token subscription-authenticated Codex execution, the credential is configured, and the worker is LIVE — scheduled Actions runs pass preflight in subscription mode and poll for work every ~5 minutes (run `31894356952`, 2026-08-15). No live canary exists yet because no command is queued; that is one owner action, not an engineering gap. Superseded text follows for history: ** The paid-API dependency is removed from the execution path: `OPENAI_API_KEY` is no longer a worker configuration field, `new Codex()` is constructed without an api key, preflight makes no `api.openai.com` request in subscription mode, and no workflow step receives a paid key. The billed mode must name itself and can never be reached by fallback. The schema, worker, and fail-closed provider-startup recovery are published, but Phase 1C remains Not Connected. The first owner-approved live acceptance attempt failed safely before any repository mutation. Distinct no-claim diagnostic run `31748582858` passed the exact-model GET and classified the bounded Responses failure as `credit_balance_exhausted`, while skipping Docker preload and durable claim. The failed run's immutable base predates current `main`, so it must not be retried; acceptance requires a new current-base command after funded-provider proof. Activation is OFF. Phase 1D execution and provider execution also remain Not Connected.**

Reason: exact project `qpuofpmagrmyamahqwxw` is reconciled and current through forward migration `130014`; linked lint and focused catalog/runtime/ACL checks pass. Local `130015` restores the assignment/run model constraint bound from 120 to the original 128-character provider catalogue/API contract, adds four no-secret constraints for catalogue model/display-name, assignment model, and routing policy-version/selected-model text, adds bounded routing evidence, and closes authenticated raw routing-decision/event reads while retaining tenant-scoped model-catalogue reads, but is unhosted pending fresh exact RED approval. The prior verified production baseline before this update was `0c662a24393f682073e6002c5aff9339292226d8`; it passed both required jobs in CI run `31749352644`, and matching Vercel deployment `dpl_FJKMapsyLB4hQPDsaykUo1cVUQp7` was READY. Live command `0c4d0ca8-1867-4d00-80cf-476401491a17` produced durable run `f4594556-6f72-4763-a480-6993939e3651` and worker Actions run `31746057998`; a real claim, heartbeat, and provider thread occurred, then provider startup failed before changed files, commit, branch, PR, validation, or exact-head CI. Diagnostic `31748582858` identified exhausted project credits without a claim. The failed run is now stale against the verified baseline and must not be retried. The user-pasted OpenAI key is treated as compromised and its GitHub Actions secret is deleted; the other six protected secrets remain. A successful live draft-PR journey requires credits or a fresh funded replacement key, a passing provider-only diagnostic, and a new current-base command.

Phase 1E decision: **Production-operations control plane implemented, hosted, and locally verified; unobserved, so no live monitoring claim is made**

Reason: migration `028` adds ten RLS/FORCE-RLS operations tables and owner-scoped workflows with zero new `service_role` table privileges. Its schema effect and reconciled ledger row are hosted, but no monitor has observed a real production target. Every Phase 1E surface therefore reports **Not Connected** or **Unknown**. Rollback and repair execution remain absent by design.

Phase 1D decision: **Decision layer exists and no executor is connected; current hosted control drift blocks an all-OFF quality claim**

Reason: migration `130006` defines the intended nine-action, two-scope interlock model and the decision modules still classify diffs, require gates, and prohibit self-approval. Current hosted evidence, however, contains one raw organization with `autonomous_mode = true`, one with `autonomy_kill_switch_active = false`, and two projects with effective kill off. No connected/fresh worker or merge/deploy executor was observed, so execution remains inert; the data drift must be contained and remeasured before the intended all-OFF policy can regain a Pass.

### Phase 1D completion

| Objective area | Completion | Note |
| --- | --- | --- |
| Controls (9 actions, 2 scopes, most-restrictive-wins, emergency STOP) | **100%** | STOP and freeze were already Phase 1E; this phase added the missing five actions, the organization scope, and the resolver |
| Risk classification, before work and on the final diff | **100%** | Derived from paths and content; escalation past a declaration blocks |
| Gates (GREEN set, YELLOW set, blocking findings) | **100%** | A missing result blocks; `not_connected` distinct from `not_run` |
| Review / QA / Security agents | **100%** as deterministic analysers | Model-backed review needs Phase 1C/2A binding, which this phase does not claim |
| Approval (tri-state, no self-approval) | **100%** | Evaluated after the gates; unsound work is never escalated to a person |
| Orchestrator stage machine | **100%** as a decision machine | Twelve stages, halts at the first block |
| Deploy / preview / validate | **Validate: storage 100% (Phase 1E), decision 100% (Phase 1D); deploy and preview 0%** | **Blocked** — no Vercel API connection, and no validator produces the evidence. `lib/autonomy/post-deploy.ts` decides what a validation record proves: attribution before check results, and missing/stale/mismatched evidence is `inconclusive`, never `passed`. The pipeline's `validate` stage previously reported satisfied unconditionally; it now routes the absent case through the same evaluation |
| Rollback | **Decision 100% (Phase 1E); execution 0%** | **Blocked** — no adapter; `AUTO_ROLLBACK.md` disables it |
| Healing / repair | **Creation 100%, queueing 100% (Phase 1E); execution 0%** | **Blocked** — repair work now reaches the Phase 1C queue through `submit_command` instead of a task nothing could claim, but the manual Phase 1C candidate is **Not Connected** and grants no autonomous authority, so the run stops at `queued` |
| Auto merge | **0%** | **Blocked** — `AGENTS.md` forbids introducing the workflow in this line of phases |
| Backlog Autopilot | **Selection 100%; execution 0%** | Orders eligible P0–P3 work by priority then lower risk, holds behind unmet and unknown dependencies, refuses above the ceiling, and skips a degraded/critical/paused project. Starting the selected work is **blocked** on the two rows above |
| Bounded retries | **100%** | Per-stage caps with backoff; the budget escalates rather than retrying again, and a permanent refusal never retries |
| Recovery ordering on failure | **100%** as a decision machine | Freeze first (it only removes authority), then incident, rollback, repair, escalate |
| Never auto-reverse a destructive migration | **100%** | A destructive release resolves owner-only, outranking controls, ceiling and approval alike |
| Merge revalidation against the current head | **100%** | A push after approval invalidates it; a push after verification invalidates the gates; a required check with no report blocks rather than being read as satisfied |
| Decision auditability | **100%** | `autonomy_decisions` is append-only with RLS and FORCE RLS, no browser write, named blocker codes only. Self-approval and unexplained refusals are rejected by the table itself |
| Enabling any automatic action | **0% by design** | RED under `RISK_CLASSIFICATION.md`; needs an owner-approved migration. The classifier now enforces this rather than relying on it: any diff enabling an action, clearing the kill switch or emergency stop, raising the ceiling, or dropping the GREEN-observation constraint classifies RED on content, wherever it appears |
| Guardrails a loop could weaken about itself | **100%** as classification | Authority-widening and audit-evidence destruction are RED on content; `lib/autonomy/controls.ts` is RED by path; `AI/DECISIONS.md` is raised to YELLOW so a guardrail decision cannot be deleted inside an otherwise-GREEN diff |

**Overall: the decision half of the loop is complete; the executor half is blocked on three
things an agent cannot supply.** Everything that decides, restricts, records or refuses is built,
hosted and demonstrated. Everything that would mutate a protected resource is reached, evaluated
and blocked by a named blocker that the tests assert — so connecting an executor fails those
assertions deliberately rather than silently granting authority.

The three remaining blockers are a funded OpenAI project and rotated key (Phase 1C), a
`VERCEL_TOKEN` (deploy and preview), and an owner decision on the `AGENTS.md` auto-merge
prohibition. None is a code gap.

### Schema and wiring guards added 2026-08-14

Each of these encodes something that was already true and was verifiable only by a manual run, which does not survive the next migration. They are listed here because the scorecard previously credited manual verification as if it were standing coverage.

| Guard | What it prevents | Status |
| --- | --- | --- |
| `tests/integration/migration-version-uniqueness.test.ts` | Two migrations sharing a version prefix. Supabase's ledger keys on the prefix, so a duplicate is two applies competing for one primary key — `db push` fails partway and leaves the hosted schema half-applied | **Caught a live defect.** `20260814000300` was held by both `agentos_isolation_model` and `declare_model_characteristics`; the latter moved to `20260814000250`. Neither was hosted, so the fix carried no ledger consequence |
| `tests/integration/schema-security-invariants.test.ts` | A new table shipping without RLS, `service_role` quietly gaining a table privilege, a SECURITY DEFINER function without a pinned `search_path`, or a new function reachable anonymously | Pass - RLS and FORCE RLS on every public table across the whole chain; `service_role` table privileges limited to exactly `github_change_requests`, `github_installations`, `github_repositories`, `github_webhook_deliveries`; `anon` holds no write anywhere. **All 172 SECURITY DEFINER functions pin a `search_path`**; `anon` may execute exactly one of them (`subscribe_to_newsletter`) and `service_role` exactly twenty, each pinned by name |
| `tests/integration/required-checks-wiring.test.ts` | A renamed CI job leaving a live Phase 1C run waiting for a check that never reports — a hang rather than an error, after real work has been pushed | Pass - `SOFTWAREFACTORY_REQUIRED_CHECKS` matches `ci.yml` job names in both directions |
| `tests/integration/supabase-rpc-contract.test.ts` (pre-existing) | An `.rpc()` argument-name typo that type-checks and only fails against a real database | Pass - every call site in `app`, `lib`, `scripts` resolves against the migrated schema |

Two findings while writing these turned out to be the code being right and the assertion being wrong: `newsletter_subscribers` is deliberately policyless behind the SECURITY DEFINER `subscribe_to_newsletter`, and the four `service_role` tables are not the names assumed. Both corrections went into the tests.

### Authorization boundary audit, 2026-08-14

Every `app/api/**/route.ts` was checked for an authentication guard. **74 of 74 are guarded.**

Most do not call an auth helper directly — they delegate to a shared boundary that authenticates the caller, resolves the exact active organization, and reads through the caller's own JWT so the RPC enforces membership rather than the route re-implementing it: `tenantRpcListResponse` / `tenantRpcDetailResponse` (`lib/server/tenant-list.ts`), `operationsContext` (`lib/operations/route.ts`), and `prepareGitHubRepositoryRequest` (`lib/github/route.ts`). Concentrating the check is why the count is 74 rather than 74-minus-the-ones-someone-forgot.

Five routes are unauthenticated by design and were confirmed to be the intended set: `auth/sign-in`, `auth/sign-up`, `auth/magic-link`, `auth/resend-confirmation`, and `newsletter`. The newsletter route writes through the SECURITY DEFINER `subscribe_to_newsletter` into a table that holds RLS with no policy, so an anonymous caller can insert a subscription and read nothing.

Recorded because an audit with no record is an audit that gets repeated. A first pass using a naive grep reported 32 unguarded routes; every one was a false positive from the shared-helper indirection. The finding is that the boundary is centralized, not that it is missing.

### Client bundle secret scan, 2026-08-14

The production build output was scanned for credential-shaped strings and for the names of server-only secrets. **Nothing leaks.**

| Check | Result |
| --- | --- |
| Credential-shaped strings in the 35 client JS chunks | **none** |
| Credential-shaped strings anywhere in `.next` (excluding cache) | **none** — the apparent hits were `sk-async-storage-instance` inside Next.js's own `after-task-async-storage-instance.js` |
| `SUPABASE_SERVICE_ROLE_KEY`, `GITHUB_APP_PRIVATE_KEY_BASE64`, `SOFTWAREFACTORY_CODEX_AUTH_JSON`, `GITHUB_WEBHOOK_SECRET` in client JS | **absent** |
| `OPENAI_API_KEY` / `ANTHROPIC_API_KEY` in client JS | **present as names, not values** |

The last row is the one worth explaining. `lib/bots/catalog.ts` carries `defaultCredentialRef: "OPENAI_API_KEY"` so the console can tell an owner which environment variable a provider's credential lives under. The name of a variable is not the variable's contents, and this is the pattern `AGENTS.md` prescribes: "A connection record is metadata plus a reference to server-side secret material; it is not a credential store."

`NEXT_PUBLIC_*` is limited to `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` — all intentionally public, with row level security rather than obscurity as the protection.

### Deployment position

Measured 2026-08-14 23:04 UTC rather than inferred from merges succeeding. `https://www.theagoras.com`, `/solutions`, and `/platform` all return **200**, and the served build's sitemap `lastmod` is `2026-08-14T23:03:49Z` — the deploy from `baf8ce0`. **Production is current with `main`.**

It lagged for roughly ninety minutes because Vercel's free-tier hundred-per-day cap, exhausted by this session's pull-request volume, rejected deployments at 21:54, 22:02, 22:17, and 22:33 while allowing previews at 22:16 and 22:48. The cap throttles rather than blocking for a day, contrary to its own message, and a rejected deployment is not retried — the lag cleared when a later merge gave Vercel a fresh commit to build.

### Secret boundary

Scanned on 2026-08-14 across every tracked file and the full git history for OpenAI keys, GitHub
PATs, Slack tokens and private-key blocks. Twelve historical matches exist and **all twelve are
deliberate fake fixtures in test files** — `provider-config`, `autonomy-diff-risk`,
`github-rls-behavior`, `worker-foundation`, `provider-contract`, `bot-schemas`,
`bot-credentials`, and `provider-execution-rls`, each of which needs a credential-shaped string to
prove its detector fires. No real credential appears in any tracked file or in history, and no
`.env` file is tracked. The OpenAI key the roadmap records as exposed was exposed in chat, not
committed; the repository is consistent with that account.

## Phase 1E and retained Phase 1B evidence

| Area | Evidence | Status |
| --- | --- | --- |
| Phase 1B close-out (merge `c325dbb`) | `AI/PHASE_1B_COMPLETION.md`; `tests/integration/github-lifecycle-matrix.test.ts`; `tests/unit/github-lifecycle-errors.test.ts` | 18 PASS / 2 PARTIAL / 0 FAIL. Three real defects fixed: generic-500 lifecycle refusals, a stale suspension marker after revocation, and an aborted discovery against a terminally deleted installation |
| Full chain on real PostgreSQL 16.13 | 57 migrations applied in order from empty | Pass - 0 of 83 public tables missing RLS/FORCE RLS; `service_role` on exactly the four GitHub ingress tables with no DELETE; both Phase 1D interlocks intact |
| Merged-tree gates (2026-08-14) | `npm run lint`, `npx tsc --noEmit`, `npx vitest run`, `npm run build`, `npx playwright test` | Pass - lint/typecheck clean; 1724 tests / 155 files; build exit 0; Playwright 126 passed, 3 skipped incl. axe |
| GitHub Actions CI on merge SHA | Run `31848857261`, two attempts | **Could not run** - no runner assigned (`runner_id: 0`), no logs (HTTP 404), 2s duration. Account-level Actions blocker, not a code signal. Identical code passed run `31846219078` |
| Merged-tree gates | `npm run lint`, `npm run typecheck`, `vitest run`, `npm run build` | Pass on the merged tree at 2026-08-14 22:00 UTC - lint/typecheck clean; **153 files/1704 tests**; production build clean. CI green on both required jobs for the commit merged as `145a31d` |
| Phase 1D E2E/accessibility | Local Playwright across desktop/tablet/mobile with axe | Pass - 117/117 |
| Phase 1D control interlocks | `tests/integration/phase1d-autonomy-controls.behavior.test.ts` against the migrated schema | Pass - 35 tests: each of nine actions refused at each of two scopes, both ceilings, both mode flags, the kill switch, and a new project or organization trying to be born with authority; both constraints `convalidated`; `anon` holds no write |
| Phase 1D decision modules | `tests/unit/autonomy-*.test.ts` | Pass - 277 tests across 12 files: controls, diff risk, gates, agents, approval, retries, autopilot, decision records, merge revalidation, recovery, post-deploy validation, and the stage machine |
| Phase 1D post-deploy validation | `tests/unit/autonomy-post-deploy.test.ts` | Pass - 38 tests. `passed` requires matching, complete, finished, fresh evidence with every required stage reporting and the observation window closed; mismatched evidence is `inconclusive` even when it records a failure, because a failure that cannot be attributed to this deployment is not this deployment's failure |
| Phase 1D end-to-end loop | `tests/integration/phase1d-loop-journey.behavior.test.ts` | Pass - a GREEN change reaches `APPROVED_AUTOMATICALLY` and then halts at `MERGE_EXECUTOR_NOT_CONNECTED`; a failed release drives incident, automatic freeze, Last Known Good, blocked rollback and bounded repair through Phase 1E's real functions, and the freeze is shown propagating back into the decision layer |
| Phase 1D self-approval boundary | Same journey plus `tests/unit/autonomy-approval.test.ts` | Pass - the author is refused as approver at every risk level, including RED and including an owner |
| Phase 1D hosted state | Ledger reconciled/current through `130014`; resolver checked live | Pass - decision-only migration `20260813000600` is hosted; all nine actions remain OFF and the global kill switch remains ON |

| Phase 1E gates | `npm run lint`, `npm run typecheck`, `vitest run`, `npm run build` on the Phase 1E tree | Pass - lint/typecheck; 132 files/1621 tests on the merged tree |
| Phase 1E coverage | `npm run test:coverage` | Pass - merged tree with Phase 2A: statements 72.94%, branches 69.92%, functions 64.57%, lines 74.29%. The Phase 1E tree alone measured 78.02/77.79/70.00/79.15 |
| Phase 1E E2E/accessibility | Local Playwright across desktop/tablet/mobile with axe, `/solutions/operations` included | Pass - 117/117 on the merged tree |
| Phase 1E detection pipeline | `tests/integration/phase1e-operations.behavior.test.ts` against the migrated schema | Pass - 30 tests: threshold detection, dedupe, upward-only severity, automatic freeze, owner-only resume, Last Known Good, blocked/failed rollback, bounded repairs, resolution gating, event idempotency, RLS, append-only |
| Phase 1E end-to-end journey | `tests/integration/phase1e-incident-journey.behavior.test.ts` | Pass - ordered Monitor→Detect→Incident→Freeze→Rollback→Diagnose→Repair→Validate→Resolve, plus failed-rollback escalation to SEV1; Codex-fix and deploy stages asserted as blocked, not simulated |
| Phase 1E boundary contracts | `tests/integration/phase1e-operations.contract.test.ts` | Pass - 19 tests: same-origin and role checks on every mutation, execution envelope on every response, no provider deployment call, no new `service_role` table grants, Phase 1D interlocks preserved, and repair promotion asserted to go through `submit_command` with a live base SHA rather than a privileged lane |
| Phase 1E repair promotion | `tests/integration/phase1e-repair-promotion.behavior.test.ts` against the migrated schema | Pass - 6 tests: the assembled parameters equal Phase 1C's exact-key allowlist, `submit_command` creates a real command and task, promotion is idempotent per attempt, a second promotion and an undiagnosed attempt are refused, a release freeze does not block promotion while the emergency stop does, and a security-shaped repair is forced to RED and `awaiting_approval` |
| Phase 2C durable circuit breaker | `tests/integration/phase2c-resource-persistence.behavior.test.ts` against the migrated schema | Pass - 12 tests driving faults through **separate calls**, which is the defect being fixed: an in-memory breaker reads zero every request and reaches no threshold ever. Also covers fault-class restart, close-on-success, transitions recorded only on real state changes, append-only enforcement, cross-tenant and anonymous denial, and zero `service_role` grants |
| Phase 2C decision storage | Same suite plus `tests/unit/resource-store.test.ts` | Pass - 11 unit tests: a stored timestamp converts to the epoch milliseconds the cooldown arithmetic needs, an unreadable breaker falls back to closed rather than blocking work, a lost fault observation throws rather than looking like health, thresholds are passed from the shared table rather than copied, candidate evidence is capped at 20 and carries named codes only, and an unevidenced prediction stores no success rate in either the module or the constraint |
| Phase 2C Resource Manager UI | `/solutions/resources`, `tests/unit/resource-manager-console.test.tsx`, `tests/e2e/pages.spec.ts` | Pass - 8 unit tests asserting that each empty panel says *which kind* of empty it is: "nothing has failed here" is distinguished from "proven healthy", an unevidenced prediction reads "No recorded history" and never 0%, candidate eligibility shows its named rejection codes, and the Execution card shows `—` while loading rather than defaulting to **Not Connected** |
| Phase 2C real-row candidates | `tests/unit/resource-candidates.test.ts` | Pass - 13 tests: an undeclared strength resolves to the weakest tier and an undeclared context limit to zero, both proven by routing the *same* model with and without the declaration and getting `RISK_TIER_TOO_WEAK` / `CONTEXT_TOO_SMALL`; an unrecognised capability is dropped rather than guessed; `custom` agents inherit nothing from their role; every agent status except `idle` is unavailable |
| Phase 2C routing boundary | `tests/integration/phase2c-routing.contract.test.ts` | Pass - 7 tests: the routing path contains no claim, token mint, or provider call; role and origin are checked before any tenant read; `performance: null` is never replaced by an invented zero; `reporting` and `structured_output` are not mapped onto Phase 2C capabilities; an unconfigured organization is distinguished from a routing failure; a decision that could not be stored is still returned |
| Phase 2C route collision | `tests/integration/console-routing.contract.test.ts` | Pass - `/resources` is a live public marketing page, so the console page gets **no** bare-path redirect. Adding one would have 308-redirected the marketing page to the console; the collision is now asserted in both directions. Caught by the production build listing both routes, not by the pre-existing test, which asserted the old rule faithfully |
| Phase 1E privilege boundary | Post-`028` grant assertions in the behavioral and hosted-grant suites | Pass - `service_role` still holds table privileges on exactly the four GitHub ingress tables; 63/63 public tables have RLS and FORCE RLS |
| Phase 1E probe SSRF guard | `tests/unit/operations-address.test.ts`, `tests/unit/operations-guarded-lookup.test.ts` | Pass - 13 tests. A public hostname resolving to a private address is refused at connect time via undici `connect.lookup`, so the checked address is the connected address. Covers loopback/private/CGNAT/link-local/metadata/reserved in both families, IPv4-mapped forms in dotted **and hex** spelling (`::ffff:7f00:1` was a live bypass in the first implementation), octal/hex/decimal-integer encodings, zone indices, and the public boundary addresses just outside each range |
| Phase 1E monitoring truth | `production_monitors_enabled_requires_connection`; provider registry; probe target validation | Pass - an unconnected monitor cannot be enabled; private/loopback/metadata targets are refused; no response body is read |
| Phase 1E execution boundary | `autonomous_release_allowed`; `PHASE_1E_ROLLBACK_EXECUTOR_CONNECTED`; `PHASE_1E_REPAIR_WORKER_CONNECTED` | Pass - release authority returns false unconditionally with `EXECUTOR_NOT_CONNECTED`; no rollback, deployment, merge, or repair is executed |
| Phase 1E synthetic journeys | Database CHECK constraints plus `tests/unit/operations-journey.test.ts` and the behavioral suite | Pass - destructive paths, undeclared writes, and uncovered profiles are refused by constraint; execution stops at the first failure; declared writes are recorded as skipped and never issued |
| Phase 1E live production observation | `AI/PRODUCTION_OBSERVATION_EVIDENCE.md` — shipped probe against `https://www.theagoras.com` | Pass - 4/4 routes observed at 200 within threshold (190-933 ms). Observations are **not stored**: migrations `028`-`030` are unhosted. |
| Phase 1E external observability of the recorded deployment | Same evidence file | **Blocked** - both `*.vercel.app` hosts return `302` to Vercel SSO for every route, so no external monitor can observe them. Owner decision required. |
| Phase 1E hosted state | Schema effects present; ledger reconciled | `028`/`130002` objects and ledger rows exist; no production target or journey has been observed |
| Phase 1E release | Merge commit `b243e1ddf9ce8155c4440c56d7b846ccc3d74ce0` on `main`; CI run [`31731632715`](https://github.com/surgeservicesllc/SoftwareFactory/actions/runs/31731632715) | Pass - both jobs green: lint/typecheck/tests/build, and browser/accessibility. Vercel Preview for the merged head deployed READY before the merge. |
| `/solutions` routing | `npm run lint`, `npm run typecheck`, `vitest run`, `npm run build`, Playwright; plus live checks against `https://www.theagoras.com` | Pass - lint/typecheck; 83 files/824 tests; build lists twelve `/solutions` routes; Playwright 117/117 with axe on each moved page. Live: all twelve pages `200` with both landmarks and the shell offset, every former path `308` to its new home, `/solutions` `noindex` and disallowed |
| `/solutions` routing contract | `tests/integration/console-routing.contract.test.ts` | Pass - 5 tests: no stray `app/(console)` group, a redirect for every console route, `/solutions` disallowed, no sitemap entry contradicting robots, a title on every console page. The sitemap assertion was mutation-checked |
| Scope/implementation | Auth/onboarding; signed-out fetch suppression; active-tenant GitHub boundaries; safe projections; stable repository UUID; protected approval/token/lease integrity; lifecycle/order/recovery; dual-App handoff; migrations `011`-`027` | Application/schema hosted; candidate owner path passes; remaining acceptance pending |
| Historical Phase 1B cutover-tree lint/typecheck/Vitest/build | `npm run check` plus main CI at the cutover release | Retained historical pass - lint/typecheck; 56 files/436 tests; 38 routes; CI `31716263910` green. Not current-update evidence. |
| Dual-App replacement boundary | Isolated candidate config; state binds App slot/ID; token routing uses persisted installation App ID; webhook verifies signing App provenance | Deployed and live for candidate installation `153479019` |
| Migration `027` atomic handoff | Immutable exact-tuple owner RED approval/execution; same account/external repository; both installations live; post-sync processed signed target delivery; cross-App/pending-change serialization; preserved history; bounded reverse | Hosted and live handoff passed |
| Hosted handoff database audit | Candidate sync `2026-08-13T15:26:56Z`; earliest qualifying delivery `2026-08-13T15:27:38Z` with exact App ID; immutable RED same-owner approval/execution succeeded; three request/approved/completed events; append-only triggers enabled; old installation/repository retained | Pass - project/link rebound to candidate while four completed change requests and five prior activity rows remain |
| Verified application-release integration suite | `npm run test:integration` | Pass - 21 files/163 tests; focused `026` grant test passes separately |
| Current-tree coverage | `npm run test:coverage` | Pass - statements 75.06%, branches 69.97%, functions 72.60%, lines 76.66% |
| Migration `026` | Narrowed exact table grants; function grants unchanged | Retained pass locally and hosted; pre-`027` history matched, dry run/lint clean, ACL mismatch count zero |
| Current-tree production build | `npm run check` | Pass - compiled 38 routes on Node 22.23.1; `/` is dynamic |
| Signed-out dashboard regression | Focused browser-error race repeated locally and against production | Retained pass - 30/30 production runs; current exact-commit CI is green |
| E2E/responsive/accessibility | Exact-main production Playwright plus CI browser job | Pass - production 48/48 desktop/tablet/mobile including axe; CI `31716263910` green |
| Secret/client boundary | Prior full source/rebuilt-static scan plus current CI secret-boundary contracts and production 20-asset marker scan | Pass - no secret/helper committed; 20 deployed JavaScript assets clean |
| Hosted Supabase identity | Exact project `qpuofpmagrmyamahqwxw`, ledger current through `130014`; earlier wrong/unauthorized CLI profile was not used for mutation | Reconciled history, linked lint, focused runtime/catalog/ACL, and hosted autonomy resolver checks pass; reconfirm identity before any future linked command |
| Hosted migrations | Catalog-proven `028`/`130001`-`130005` repaired history-only; forward migrations `130006`-`130014` applied without reset, down-migration, or DDL replay | Hosted through `130014` |
| Hosted database identity/lint | Exact `qpuofpmagrmyamahqwxw`; 5 linked lint errors across 10 findings | Blocked pending remediation and remeasurement |
| Hosted RLS/catalog/browser grants | Post-`027`: 25/25 RLS+FORCE, 34 policies, zero policyless; narrow owner-read/no-browser-mutation grants on both handoff-evidence tables; 22 secret guards and raw browser denials retained | Pass |
| Hosted service-role table grants | Verified pre-`027`: SELECT/INSERT/UPDATE on four GitHub ingress tables; no table privileges on other 19; `027` revokes direct access on its new evidence tables | Pass baseline; live `027` path uses narrow RPCs |
| Safe browser projections | Base-table SELECT revoked for five sensitive domains; bounded caller-member RPCs; allowlisted activity evidence | Hosted; owner Activity caller path passes; live second-tenant matrix pending |
| Stable repository authorization | Project connection/change/webhook attribution follows tenant-scoped repository UUID, not mutable name | Hosted via `021`; live rename/same-name acceptance pending |
| Protected-resource writes | Exact active-owner RED approval is immutable, path/digest/SHA/branch-bound, and draft-only; no local HTTP writer | Live protected draft PR `#7` and immutable approval/provider evidence pass; live expiry/admin-denial matrix pending |
| Draft-commit attribution | Deployed boundary strictly validates one server-only deployment identity before authorization/persistence and supplies it as both Contents API author and committer; no App-bot fallback or browser/database/log path | Pass - draft commits `e789303`, `6a808de`, and candidate-backed `204ed79e` verify both fields as `surgeservicesllc <surgeservicesllc@gmail.com>` |
| Idempotency/recovery | Same browser intent retains key; exact-binding reservation; five-minute pre-provider lease; existing draft-PR evidence recovery | Application plus migrations `015`/`017`/`022` hosted; live acceptance pending |
| Lifecycle safety | Provider-time installation/repository ordering; terminal deletion; explicit newer restore remains unselected | Hosted via migrations `016`/`018`; live acceptance pending |
| Service-role CHECK boundary | Only sensitive-JSON SECURITY DEFINER wrapper granted for provider-ingress constraints | Hosted via `019`; real provider-ingress insert/rejection acceptance pending |
| Browser/request hardening | Command same-origin enforcement; restrictive CSP/security headers; external Markdown images suppressed | Build and public production checks pass; authenticated verification pending |
| Projects provider detail | Sync freshness, branch protection/SHA, commit and PR timestamps/authors, mergeability, default-branch and per-PR head-SHA checks | Pass against the live selected repository |
| GitHub App configuration | Primary App `4573846`; candidate App `4582606` (`surge-softwarefactory-next`) owner-only with retained exact callback/active webhook; distinct candidate variable names Sensitive in Production/Preview; commit identity configured | Candidate is live; primary remains active rollback with impaired webhook |
| Supabase Auth owner | `surgeservicesllc@gmail.com` confirmed/authenticated; SoftwareFactory org/workspace owner onboarding succeeded | Pass for onboarding |
| GitHub provider installations | Candidate `153479019` is live for exactly `surgeservicesllc/SoftwareFactory`; primary `153445938` remains active for rollback | Pass for candidate; rollback retained |
| GitHub real connection | Candidate connection `85591f43-dd4e-46d2-8a1b-0f036b32639f`; project `b1f23696-437e-4d89-b55f-d7a949980e8f`; callback/sync/handoff/read/write/audit journey observed | Connected for the owner repository path |
| GitHub webhook | Candidate-signed deliveries for installation `153479019` process with exact App-ID provenance after sync and stream push/check Activity. Primary App `4573846` remains blank/inactive under OPEN Support ticket [#4660724](https://support.github.com/ticket/personal/0/4660724). | Candidate Connected; primary webhook impaired |
| Local credential cleanup | Temporary downloaded App PEM and ignored provider-verification helper scripts deleted after use; no credential/helper artifact persisted | Pass |
| Project/repository and file-to-draft-PR flow | Candidate-backed branches/commits/checks/PRs/tree/file reads; ordinary draft `#6`; protected RED draft `#7`; candidate acceptance draft `#8`; likely-secret rejection; immutable Activity evidence | Pass for accepted owner scenarios; remaining adverse matrix pending |
| Acceptance cleanup | Prior PRs `#4`/`#5` and candidate acceptance PR `#8` were closed unmerged with isolated branches deleted; PR `#8` passed CI `31716958685` and Vercel Preview; `main` unchanged by acceptance writes | Pass |
| Git provenance for application release | Commit `799d2cea189b6860a03987ae75c25765f9ac4aca`, tree `a7731dc5626f1d014a446e94e989a1ac3f4f72a1`, author/committer `surgeservicesllc <surgeservicesllc@gmail.com>`; CI run `31716263910`, both jobs green | Pass; docs-only successors retain this evidence unless application code changes |
| Vercel production | `dpl_853oYWK122qrTHhqtqDhsEYJkKaQ`; `https://softwarefactory-7kfx3u1ey-surgeservices-projects.vercel.app`; stable alias; source exact main commit `799d2cea189b6860a03987ae75c25765f9ac4aca` | READY; production Playwright 48/48; 13/13 public routes `200`; invalid webhook `401` private/no-store; 30-minute logs clean; 20 JavaScript assets clean |
| OpenAI/Codex | Published worker claimed one real run and emitted a transient heartbeat/provider thread, then failed before repository mutation. No-claim diagnostic `31748582858` passed exact-model lookup and returned `credit_balance_exhausted`; no successful run or draft PR exists. | **Not Connected** |
| Anthropic/Claude | Advisory adapter source exists; no hosted schema, verified credential, enabled switch, or live run | **Not Connected** |
| Automation safety | No merge/deploy/rollback executor; controls OFF | Pass |
| Phase 1D observation scaffold | Intended OFF/kill-ON policy; current raw/effective rows have measured drift | Execution remains blocked because no connected/fresh worker or executor exists; control remediation required |

## Phase 2A and Phase 1C reconciliation evidence

| Area | Current evidence | Status |
| --- | --- | --- |
| Command/orchestration | Connected-project-only intent; command type/criteria; stable idempotency; exact base SHA; fixed provider/model/role/budgets/workflow; independent SQL risk/config enforcement | Published and hosted; first live command persisted and was claimed safely |
| Phase 2A advisory providers | Official Anthropic/OpenAI adapters; consent-gated health/model discovery; deterministic routing; bounded fallback; independent review; advisory artifacts only | Published on `main`; `130001` hosted and ledger-reconciled. Execution OFF returns local Disabled status, suppresses outbound discovery/probes, and no successful live advisory run exists; **Not Connected** |
| RED ceiling | SQL and worker exclude RED; owner approval does not widen Phase 1C | Published and hosted; all autonomy controls remain OFF |
| Durable schema | Existing hosted chain plus `20260821000300`; immutable Factory routing `20260821000400` remains local | Production has `210003` and the old copy; `210004` fails closed until hosted. Linked lint is currently 5 errors/10 findings |
| Logical agent identity | Eleven standard logical roles for existing/future organizations; provider-account identity remains separate; general Phase 1C work maps to Orchestrator | Implemented and hosted in `130010`; authenticated production owner reads prove all eleven roles. No successful provider run exists. |
| Dependency and budget integrity | Canonical same-project pre-existing dependencies, atomic/idempotent persistence, derived criteria, total turn/input/output budgets across retries | Implemented and hosted in `130011`; focused hosted runtime/catalog checks pass. Live retry/provider acceptance remains pending. |
| Recovery/report integrity | Coherent artifact replay, draft projection, bounded retry/resume, stale-lease/cancel terminalization, structured success/failure/cancellation reports | Implemented and hosted in `130010`/`130011`; authenticated owner failure-detail/report reads pass. Live branch/PR recovery success remains pending. |
| Bounded routing evidence, model-contract restoration, scalar-secret rejection, and raw-read closure | Local `130015` restores assignment/run model checks from 120 to 128 characters, adds four no-secret constraints covering catalogue model/display-name, assignment model, and routing policy-version/selected-model text, adds capped/allowlisted Phase 1C/2A routing detail with absent/null rolling compatibility, revokes authenticated raw routing-decision/event SELECT, and retains tenant-scoped model-catalogue SELECT. Runtime/API validation rejects credential-shaped default-model/model/display-name scalars before serialization/RPC. | Local implementation and final gates pass. Hosted remains through `130014`; fresh exact RED approval and exact six-constraint/valid-and-negative-scalar/table-function-ACL/direct-denial/runtime/RLS/lint/health verification are required. |
| RLS/ACL | New tables declare RLS/FORCE RLS; browser table grants revoked; bounded member RPCs and service-role-only worker RPCs | Hosted catalog/function-identity/ACL and focused runtime checks pass; authenticated owner projections and anonymous denial for twelve hosted read RPCs are live-proven. Unrelated-authenticated and mutation-shaped live denial remain pending because hosted membership currently has only the owner. |
| Codex integration | Pinned `@openai/codex-sdk` `0.147.0`; isolated home; bounded turns/tokens/time; workspace-write/no approval/no workspace network/web search | Published; first real provider startup failed safely before repository work |
| Workspace/GitHub | Repository-ID token; exact base-SHA check; isolated `factory/*` branch; required commit identity; draft-PR-only publisher; exact-head CI polling | Implemented/tested locally; no live Phase 1C artifact |
| Validation sandbox | Exact pinned Node image; restricted bootstrap; network-none diff/lint/typecheck/test/build; process/resource/output limits | Implemented/tested locally; live runner proof pending |
| Policy scan | Path containment; forbidden/symlink/binary/secret/protected/file-count/size limits | Implemented/tested locally |
| Durable worker workflow | Opaque command dispatch, five-minute recovery, distinct `softwarefactory_phase1c_preflight` diagnostic dispatch, no branch-selectable manual trigger, read-only workflow token, no persisted checkout credentials | Published at `bc95b9e3a5952864bd26da778a052f37400ea747`; first claim failed safely, and diagnostic `31748582858` skipped Docker preload and claim. |
| Recovery preflight patch | Pinned CLI `0.147.0` plus non-billable exact-model lookup before every claim; distinct `softwarefactory_phase1c_preflight` bounded non-stored response that skips Docker preload/claim; structured terminal-error preservation | Published and exercised. Exact-model GET passed; bounded Responses returned the safe code `credit_balance_exhausted`. CI run `31748567790` and READY Vercel deployment `dpl_3hTUZ1aJy2b2BSdhTZMnZRMfxnhh` verify the exact recovery commit. |
| Safe UI/APIs | Worker status, agent/task/run/report detail, timelines/artifacts/validation, cancel, retry, responsive real-data consoles | Hosted authenticated owner reads pass across Bot Manager, Runs/detail, Backlog/detail, all-eleven-role Agents/detail, Reports/detail, and Connections. Signed-out UI and anonymous read-RPC denial pass; unrelated-authenticated and mutation-shaped live denial remain pending. Current routing UI local final gates pass; publication remains pending. |
| Consolidated lint/typecheck/tests/build | Frozen current-update local candidate | Pass on Node `24.19.0`: lint, typecheck, 118 files/1,311 tests, and production build with 74/74 route entries. Publication CI remains pending. |
| Consolidated coverage | Frozen current-update local candidate | Pass - 76.70% statements / 71.47% branches / 74.04% functions / 78.11% lines |
| Focused migration suites | Hosted chain through `130014` plus local `130015` | Pass - provider and Phase 1C integration 55/55; hosted `130015` verification remains pending fresh exact RED approval |
| Secret/tracked-file/client scan | Frozen current-update source | Pass - 0 high-confidence credential values in the changed tree; the user-pasted credential remains excluded and treated as compromised |
| Responsive/E2E/axe | Frozen current-update production build across desktop/tablet/mobile | Pass - 117/117 |
| Production dependency audit | Frozen current-update `npm audit --omit=dev` | Pass - 0 vulnerabilities |
| Disabled worker smoke | Prior verified baseline worker disabled/incomplete configuration | Prior evidence passed safely; current-update smoke remains pending |
| Diff and independent severity audit | Frozen current update | Pass - clean diff-check and independent frozen-tree review found no remaining P0/P1 source blocker |
| Hosted migrations | Exact project `qpuofpmagrmyamahqwxw` | `20260821000300` hosted; `20260821000400` unhosted. Current lint/control blockers prevent a release-ready claim |
| GitHub Actions secrets | Six non-OpenAI names currently present; OpenAI absent | The user-pasted OpenAI key is treated as compromised and `SOFTWAREFACTORY_OPENAI_API_KEY` is deleted. It must remain absent until a fresh funded replacement is available; configuration alone is not connectivity. |
| Worker activation gate | Repository Actions variable `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` | Enabled only for the approved first claim, then removed; currently absent/OFF |
| Required CI checks | `SOFTWAREFACTORY_REQUIRED_CHECKS` exact names for both CI jobs; complete stable set; required conclusions `success`; PR base/head recheck | Implemented locally; live proof pending |
| Worker heartbeat | Fresh service-role worker registration/heartbeat | Observed transiently during Actions run `31746057998`; provider failure prevents a Connected claim and the heartbeat ages to stale |
| Live Codex acceptance | Real command/thread/branch/commit/draft PR/validation/exact-head CI/report/audit | Command `0c4d0ca8-1867-4d00-80cf-476401491a17` / run `f4594556-6f72-4763-a480-6993939e3651` failed safely before branch/commit/PR. Diagnostic `31748582858` identified exhausted credits without a claim. The failed run is now stale against current `main`; acceptance requires a new command after funded-provider proof. |
| Autonomous safety | Kill switch ON; Autonomous Mode and auto approve/merge/deploy/rollback OFF | Pass by design; hosted `010` retained |
| Commit identity | `surgeservicesllc <surgeservicesllc@gmail.com>` required for author/committer | Enforced in worker/workflow; live Phase 1C proof pending |

## Retained Phase 1B live evidence

- Candidate App `4582606`, installation `153479019`, connection `85591f43-dd4e-46d2-8a1b-0f036b32639f`, project `b1f23696-437e-4d89-b55f-d7a949980e8f`, signed webhook, handoff, reads, and prior draft-only write acceptance pass for exactly `surgeservicesllc/SoftwareFactory`.
- Primary installation `153445938` remains rollback; its webhook defect remains tracked by GitHub Support `#4660724`.
- The prior verified production baseline before this update was `0c662a24393f682073e6002c5aff9339292226d8`; it passed both required jobs in CI run `31749352644`, and matching Vercel deployment `dpl_FJKMapsyLB4hQPDsaykUo1cVUQp7` was READY. Neither publication nor the no-claim diagnostic makes Codex Connected.
- Phase 1B still lacks a live second tenant, reverse handoff, disconnect/loss, and remaining adverse provider matrix.

## Phase 1C release acceptance required

1. Preserve the prior verified production baseline before this update: commit `0c662a24393f682073e6002c5aff9339292226d8`, CI run `31749352644`, and READY deployment `dpl_FJKMapsyLB4hQPDsaykUo1cVUQp7`.
2. Complete and record all current-update final gates, publication CI, and deployment; do not reuse prior counts.
3. Obtain fresh exact RED approval for the complete `130015`, apply only that forward migration, and verify its two 120-to-128 constraint restorations, all four new no-secret constraints, 128-character assignment/run/project behavior, valid and negative credential-shaped catalogue/assignment/routing scalar behavior, two raw-SELECT revokes plus retained model-catalogue SELECT, run-detail identity/security/ACL, bounded routing behavior, raw-table/tenant denial, lint, and health.
4. Revoke the user-pasted OpenAI key at the provider. Keep its repository secret absent and activation OFF while adding project credits or obtaining a fresh funded replacement project key.
5. Configure only the fresh funded replacement key through the protected secret path, then dispatch only `softwarefactory_phase1c_preflight`; require pinned CLI `0.147.0`, exact-model access, and one bounded non-stored response while Docker preload and durable claim remain skipped. Return activation to absent/OFF after admission and stop on failure or ambiguity.
6. After the diagnostic passes, leave stale run `f4594556-6f72-4763-a480-6993939e3651` untouched, submit a new current-base GREEN command, and restore activation absent/OFF immediately after claim.
7. Preserve durable repository/base SHA, neutral logical agent, routing reasons, lease, recovery state, timeline, validation, artifacts, changed paths, usage, factory branch/commit/open draft PR, stable exact-head CI, structured report, activity, cancellation state, and final-result evidence.
8. Prove no default-branch write, PR approval/merge, deployment, rollback, RED execution, workflow/provider-setting change, or secret disclosure occurred, and complete the remaining unrelated-authenticated/mutation-denial matrix.

## Phase 2E portfolio scheduling evidence, 2026-08-15

| Check | Result |
|---|---|
| Unit and integration tests | 2360 passed, 0 failed, 2 skipped |
| Playwright, desktop + tablet + mobile with axe | 132 passed, 3 skipped |
| Lint | 0 errors, 3 warnings (all pre-existing, in test files) |
| Typecheck | clean |
| Production build | succeeds |
| Migration chain on PGlite from empty | 70 applied in order |
| Tables under RLS + FORCE RLS | 104 of 104 |
| `service_role` table privileges | still exactly the four GitHub ingress tables |

The five required canaries run in `tests/integration/phase2e-portfolio-scheduling.behavior.test.ts`,
each against two competing projects in one organization, and each asserting on the run a worker
actually claimed through `claim_phase1c_run` rather than on a projection:

| Canary | What it proves |
|---|---|
| A — competing projects | Beta queued first, Alpha (P1) claimed first, Beta claimed on release |
| B — P0 | Ceiling 1 with 1 reserved: routine work withheld, an incident-linked repair claimed at effective P0, the routine run still `queued` afterwards |
| C — capacity | Project ceiling 1 with worker capacity 2: excess withheld with `projectActive: 1, projectLimit: 1`, claimed after release |
| D — failure | Three outages open a breaker, work withheld naming it, another provider's breaker does not interfere, cooldown admits one trial, the trial consumes the window, success reopens |
| E — reprioritize | Focus set and cleared in one statement, next claim follows it, the running run keeps its lease token, one activity event |

**What this evidence does not cover.** PGlite is a single connection, so every claim above is
sequential. These prove ordering, ceilings, release and recovery; they do not prove behaviour
under simultaneous contention, which rests on the `for update ... skip locked` the claim has used
since Phase 1C and which these changes did not alter. Nothing here is hosted: 29 migrations remain
unapplied to hosted Supabase.

## Release-blocking invariants

- Configuration, source code, a queued row, a mocked SDK result, or a GitHub Actions file never counts as Connected.
- A clean idle one-shot heartbeat is briefly Available/Connected while fresh; stale, explicitly disabled, or missing heartbeat state is **Not Connected**. Idle availability is not end-to-end run proof.
- Missing or inconclusive validation/CI is failure, not success.
- RED, protected-without-exact-approval, secret-bearing, stale-base, cross-tenant, lease-mismatched, or oversized work must fail closed.
- Any browser exposure of raw command/model/provider errors, service credentials, raw audit details, or broad worker tables is a failure.
- Any default-branch write, non-draft PR, approval, merge, deploy, rollback, workflow/provider administration, or Autonomous Mode widening is a failure.
- A code/schema/provider/deployment change invalidates affected evidence and requires rerunning it.
