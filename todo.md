# SoftwareFactory — shared working status

## GRAPH — THE NODE EXPLAINS ITSELF (2026-08-23, round 11 — PICK UP HERE)

**Round 7's item 2 is done**, after rounds 8 and 9 each left it standing:
"clicking a node still reveals nothing." The goal document asks a node for its
job, inputs, dependencies, attempts, artifacts, timing and output;
`list_graph_runs` projected eight fields answering none of them.

**Nothing was missing but the read.** `node_runs` has stored `queued_at`,
`started_at`, `completed_at` and `blocked_reason` since 20260814000100 and
`record_node_state_as_worker` writes all four; `graph_nodes` has stored `job`
and `max_attempts`; `graph_artifacts` has carried `node_run_id`; `graph_edges`
has always known which node feeds which. `20260823001000` adds **no table, no
column, no backfill, and touches no writer** — it widens the `nodes` jsonb, so
`create or replace` sufficed and **the route needed no change at all** (it
already passes `row.nodes` through verbatim). ADR-140.

Node keys in the runs panel are now buttons; opening one shows job, what it
waited for, wall time, queue time, attempt ceiling, capability, artifacts by
kind, and why it stopped.

**Two traps this round, both worth knowing before you extend this:**

1. **`node_runs.attempt` is a column nothing writes.** The claim inserts it at
   its default 0 and no code path ever updates it — the runner counts attempts
   in memory. It is deliberately NOT projected: a permanent 0 under a heading
   like "attempt" reads as measured fact. `max_attempts` (the configured
   ceiling) is real and is shown. Two tests pin this — one asserts the key is
   absent from the projection, one asserts every stored `attempt` is still 0.
   **If you add a writer, project it and delete those.**
2. **`latency_ms` is not wall time.** It is the executor's own call time and is
   legitimately much shorter than the node's occupancy — 800ms of model call
   inside 90s of node. The table shows latency, the detail shows "Ran for", and
   neither is labelled as the other. Do not "fix" one by pointing it at the
   other.

Durations are derived in TS, not SQL, and return **null** in the three cases
where a duration is not knowable (never started, not yet finished, clocks out
of order). The panel omits the row rather than rendering an em dash — a detail
panel of eight dashes teaches the reader that opening a node is not worth doing.

**Next, highest value first:**

1. **The stage pages still show no nodes.** `/solutions/lifecycle/[stage]`
   lists counts; the projection now carries everything a per-stage node list
   needs, and `describeNode` is the model. This is the cheapest next thing and
   collides with nothing.
2. **Artifact *payloads* are still unreachable.** The detail reports counts by
   kind, deliberately — a payload can be large. A reader who wants the report
   itself has nowhere to go; that needs a per-artifact read path.
3. **The live drain is still the open evidence** — dispatch
   `graph-worker.yml`, watch the owner's `full_lifecycle` reach the
   ARCHITECTURE HUMAN gate. Round 10 (#376) landed the launch wake and ANCHOR
   support while this branch was in review, so the path exists and only the
   live run is missing. That is round 10's lane; coordinate before taking it.

   Worth knowing for next time: this branch was cut before #376 merged, so it
   carried no round-10 section and the merge conflicted on both this file and
   the ADR log. Neither conflict was hard — both files are append-only and the
   resolution is "keep both, newest first" — but the PR sat with **no CI runs
   at all** until it was resolved, because GitHub creates no Actions suite for
   a PR whose `mergeable_state` is `dirty`. Check mergeability first when a
   push seems to produce no CI.
4. Still open from round 6: owner-gated WebSearch for live-verifiable
   ecosystem candidates.

**Migration tail pins moved again** (20 files, 000900 → 001000). If you add a
migration, repin them in the same commit.
## GRAPH — THE LAUNCH BUTTON WAKES A WORKER THAT CAN RUN ANCHORS (2026-08-23, round 10)

The owner pressed Launch on `full_lifecycle` and the graph sat PLANNED
forever. Two independent gaps, both fixed this round:

**1. The Workflows launch never woke a worker.** `POST /api/graphs` recorded
the graph and stopped; the schedule is off by default (correct), and only the
*command* routes fired `dispatchGraphWorker`. The route now resolves the
project's GitHub binding (`resolve_phase1c_command_target`) and dispatches the
graph worker best-effort after `create_graph_from_plan` — the wake can never
fail a launch that already succeeded, and the response says truthfully which
world you're in (`workerWoken` + note). Pinned by
`tests/unit/graphs-launch-route.test.ts`.

**2. The worker declared no ANCHOR support, so claim_planned_graph refused
every lifecycle.** `claim_planned_graph` (correctly) only hands a graph to a
worker that declares every executor in it; the worker declared
DETERMINISTIC+MODEL. Run 32671104441: "No planned graph was claimable". Now
`WORKER_SUPPORTED_EXECUTORS` includes ANCHOR, executed by
`lib/worker/anchor-node-executor.ts` — **observations by instruments that
cannot be persuaded**, each fast (the budget estimator applies the slowest
node to every level, so a slow anchor would inflate every budget):

- **TEST anchor (`qa`)**: reads the CI check-run verdict for `GITHUB_SHA` via
  the workflow's own read-scoped token (`SOFTWAREFACTORY_CHECKS_TOKEN`, new
  `checks: read` permission). Green ⇒ SUCCEEDED with the observation as
  evidence; red ⇒ FAILED naming the failing checks; skipped/in-progress runs
  are not verdicts either way; no token/sha ⇒ Not Connected, stated.
- **MONITOR anchor (`synthesis`)**: probes `SOFTWAREFACTORY_PRODUCTION_URL`
  (var, default https://www.theagoras.com — same URL the apply workflow
  verifies against) and records status/latency; unreachable IS the
  observation. No URL ⇒ Not Connected.
- **DEPLOY anchor (default)**: refused by policy, on the record — Phase 1
  keeps deployment owner-approved; the refusal text says "policy holding, not
  a fault". Nothing auto-deploys.

Tests: `tests/unit/anchor-node-executor.test.ts` (12 cases);
`graph-worker-execution.behavior.test.ts`'s executor-matching case now uses an
explicit narrow worker (the shipped default includes ANCHOR — the *rule* is
what that test pins); `analysis-launch.ts`'s doc comment updated (lifecycles
stay out of the command→template table because a record-only command entitles
analysis, not a build lifecycle — no longer because of ANCHOR).

**The guide walk (owner asked for a step-by-step guide, then an e2e test of
it) found and fixed three more truth gaps in the same lane:**
1. `docs/FULL_LIFECYCLE_GUIDE.md` now exists — the owner's step-by-step from
   sign-in to the MONITOR loop, every claim naming the page or test that
   proves it.
2. The Workflows page Notice and the launch control still said "no executor
   is connected to the graph runner" — true when written, false since the
   worker shipped. Both now describe the record+wake reality; the control's
   button says **Launch**, and the server's `note` sentence stays the
   authority (`graph-launch-control.test.tsx` pins the new wording).
3. **A gate approval stranded the run**: `decide_node_gate` records the
   decision but nothing woke the worker, so an approved ARCHITECTURE gate
   waited for a manual Actions dispatch. The decide route now wakes the
   worker best-effort on approvals (gate → graph → project → binding →
   dispatch, all inside one try; `workerWoken` + truthful note in the
   response; rejections wake nothing — the stage staying blocked IS the
   outcome). `graph-gate-decision-route.test.ts` covers woken/unwakeable/
   rejection.

**The live end-to-end walk (owner: "test end to end all steps") found and
fixed two more, and settled the mystery:**

1. **The owner's original launch never created a graph.** Worker run
   32674703858's new queue diagnosis (#378) listed all 8 hosted graphs:
   newest from 13:44Z — hours before full_lifecycle existed. The click
   landed on a pre-deploy build (or its then-"Recorded, nothing will run
   it" card read as launched). Nothing is stuck; there is simply no graph.
   The owner pressing Launch on the current build is the one remaining
   live step — everything downstream is now proven.
2. **"Nothing ran" now explains itself** (#378): when a drain claims zero
   graphs the worker prints one line per graph naming the excluding claim
   filter, mirroring claim_planned_graph exactly (ids/states only, never
   goal text). Proven live on its first run.
3. **The TEST anchor read every check; main carries a permanently red
   Supabase Preview** — every lifecycle would have failed TEST on an
   unrelated integration check. #379: the anchor honors
   SOFTWAREFACTORY_REQUIRED_CHECKS (same names, same pipe format as the
   Phase 1C worker; latest attempt wins; missing/running required check =
   "no verdict yet"). graph-worker.yml carries the third copy of the
   contract; required-checks-wiring.test.ts guards it both directions.
4. **Live production verification as the fake journey account**
   (jordan.seeker.prod1@example.org, the owner-approved throwaway):
   sign-in → `next: "/decision"`; /decision serves "Open the Software
   Factory"; /solutions/workflows serves the new record-and-wake Notice,
   "Launch this graph", and full_lifecycle — the deployed build is
   current. The fake workspace has no GitHub connection, so it cannot
   create a project (by design: a project IS a bound repository) — the
   final Launch click is genuinely owner-territory. Chromium-in-container
   cannot tunnel through the egress proxy (curl can); API-level walks are
   the pattern that works here.

**Open in this lane:** the owner presses Launch on Full Lifecycle (the click
now wakes the worker; approvals at the two gates wake it again), and the run
drains to the ARCHITECTURE gate. docs/FULL_LIFECYCLE_GUIDE.md is the manual.
Still open from round 6: owner-gated WebSearch for candidates.


## GRAPH — ONE REQUEST THROUGH ALL TEN PHASES: full_lifecycle (2026-08-23, round 9)

The owner's /goal: build all ten phases per the boards, from existing code.
The audit found every phase had engine + population + page (rounds 5-8), and
the one missing thing was the headline itself — no single graph walked
REQUIREMENT through MONITOR. Now one does. ADR-138.

**`full_lifecycle`** (BUILD, YELLOW, `isLifecycle: true`, 14 nodes): goal →
requirements (GOAL+PRD = the boards' REQUIREMENT) → three parallel scans →
consolidate (DISCOVER) → evaluate (EVALUATE) → decide (DECIDE, AUTOMATIC) →
architecture (ARCHITECT, **HUMAN**) → implement (BUILD) → review (REVIEW,
AUTOMATIC) → test (TEST, ANCHOR+AUTOMATIC) → deploy (DEPLOY, ANCHOR+**HUMAN**)
→ monitor (MONITOR, ANCHOR), with feedback edges monitor→goal (the boards'
continuous loop), test→implement, review→implement, architecture→decide,
decide→evaluate. **Zero new machinery** — every node is an existing
capability under existing contracts; the stage packages from round 6 are the
DISCOVER/EVALUATE/DECIDE handoffs.

Plumbing that had to move: template budget 220min (13 sequential levels ×
8min × 2 attempts = 208 worst case), so `graph-worker.yml` timeout-minutes
180→240; budget-fit pins the chain. Pins updated: iterating lifecycles =
["full_lifecycle", "agentic_sdlc"]; BUILD category gains it.

**Proof** (`tests/integration/full-lifecycle.behavior.test.ts`, real
PostgreSQL through `create_graph_from_plan`): a node stored in every one of
the eleven stages; no forward edge runs backwards through the stage order;
HUMAN gates at exactly ARCHITECTURE+DEPLOYMENT, AUTOMATIC at
PRD/DECISION/REVIEW/TEST; monitor→goal feedback recorded. The Workflows page
and the launch API pick the template up with no changes (both read
GRAPH_TEMPLATES).

**What "all ten working" means under this repo's policies, stated plainly:**
MODEL nodes execute through the proven record-only worker; the test node is
an ANCHOR that demands evidence; a run that reaches the deploy gate and
waits for the owner is the design succeeding — Phase 1 keeps externally
visible acts owner-approved and the kill switch ON. Nothing here pretends to
auto-deploy.

**Open in this lane:**
1. A hosted launch of full_lifecycle end-to-end (owner presses launch on the
   Workflows page; the worker drains it; ARCHITECTURE gate appears on the
   graph-runs panel for the owner to decide). The engine path is proven in
   PGlite; the live drain is the remaining evidence.
2. The stage pages (round 8) will show a full_lifecycle run across all
   eleven stages — worth one look once a live run exists.
3. Still open from round 6: owner-gated WebSearch for live-verifiable
   ecosystem candidates.


## GRAPH — THE STAGES HAVE PAGES, AND THE BROWSER SUITE OUTGREW ITS CEILING (2026-08-23, round 8)

**Round 7's item 1 is done.** `/solutions/lifecycle` is the stage index and
`/solutions/lifecycle/[stage]` is one page per stage, both driven by
`SDLC_LIFECYCLE` — so the eleven arrived without a stage list written out
anywhere, and the next one will too. `lib/sdlc/portfolio.ts` is built *on*
round 5's `summariseRunStages` rather than beside it: a second grouping of the
same rows would be a second answer to the same question, and the two would
eventually disagree. Every figure comes from `/api/graphs/runs`, the read the
runs panel already uses, so a stage page cannot contradict the run it links to.
`/solutions/ai-factory` was left as the setup journey, as round 7 said.

Where the portfolio *does* differ from `summariseRunStages` is deliberate:
within one run, omitting an empty stage is right, because "DEPLOYMENT 0/0" on
an audit graph invents a stage that graph was never going to enter. Across the
portfolio every stage is listed, because "no run has ever reached DEPLOYMENT"
is itself the finding.

**Two collisions this round, both resolved in favour of the other bot.** I had
written `lib/sdlc/run-summary.ts` and `components/graph/stage-rail.tsx`; round
5's `summariseRunStages` did the same job, so **mine were deleted** and the
portfolio rebuilt on theirs. Round 6 then grew the vocabulary to eleven, which
this code absorbed with no change but which made several of my comments
("eight, not ten") false — rewritten to describe the rule rather than the
count. **Fetch main and read the newest Graph section before starting in this
lane;** two rounds landed underneath this one while it was in flight.

### Two traps this round hit that will catch the next bot

**1. The browser suite outgrew its job ceiling, and the ceiling is not the
lever.** Run 32665994906 killed shards 1 and 2 at twenty minutes — shard 1 at
test **691 of 697**, six from the end — while shard 3 finished its identical
697 in four minutes. `--shard` splits by test *count*, so all three shards were
exactly equal and still differed fivefold in duration: shard 3 drew the cheap
`mobile-chromium` sweeps, shards 1 and 2 the desktop `component-layout` and axe
passes. **An even split of the count is not an even split of the work — read
the slowest shard, never the average.**

The fix was `playwright.config.ts`: CI ran Playwright at **one worker on a
four-core runner**. Measured on a four-core box, a 77-test slice took 86s at
one worker, 53s at two, 52s at three — the dev server is the bottleneck past
two, so two is the whole gain and the third worker only spends headroom. That
puts the slowest shard near twelve minutes.

Adding a fourth shard was tried first and **reverted**, and the reason matters
if you reach for it next: the shard count is a cross-file string contract in
four places — `SOFTWAREFACTORY_REQUIRED_CHECKS` in `codex-worker.yml`, the
exact-head gate in `apply-hosted-migrations.yml`, its scope test, and
`required-checks-wiring.test.ts` (which guards exactly this drift, correctly).
Renaming the checks means editing a protected release-gate workflow, and
branch protection is not readable from an agent token, so a stale required
name would leave a PR waiting forever on a check that never reports. When the
suite does outgrow two workers, **raise the shard count and update all four
places in the same commit.**

**2. A harness fixture stands in for the whole endpoint, not for your case.**
Pointing the harness's `/api/graphs/runs` at a new fixture broke the unrelated
`factory-briefing` case: `FactoryBriefing` reads the same endpoint and
validates the projection before trusting it, and the fixture omitted
`startedAt`, `completedAt` and `verifications`. The read failed validation, the
source counted as unavailable, and the briefing correctly reported itself
incomplete. Nothing was wrong with the briefing. **Match the route's
projection, not the fields your newest case happens to read** — and note this
was only caught locally, because the CI timeout meant those shards never
reported at all. A red suite that cannot finish hides real failures.

**Next, highest value first:**

1. **Stages still have no elapsed-time truth.** The portfolio deliberately
   shows no durations: `graph_nodes` has latency per node, which is time
   *executing*, not wall-clock time in a stage. Showing the sum as a duration
   would be a plausible-looking lie. It needs `started_at`/`finished_at` per
   stage, which do not exist — a migration, so check the tail pins first.
2. **No stage page shows artifacts or dependencies.** `graph_artifacts` and
   `graph_edges` both exist and neither is projected by `list_graph_runs`.
   This is round 7's item 2 and still the largest unclaimed read path.
3. **Round 7's item 3 stands unchanged**: graph-to-graph chaining,
   scout→agentic_sdlc. The handoff contract exists; the chaining does not.
4. Owner-gated, unchanged: the silent Run analysis taps, and live source
   lookups for discovery.

Verified this round: lint, typecheck, full unit suite, production build, and
the browser cases for every surface this touched.

## GRAPH — ROUND 6'S OPEN ITEM 1 IS ALREADY CLOSED, AND ADR-136 IS SUPERSEDED (2026-08-23, round 7)

A verification round, not a build round. Three bots are on this repository and
round 6 landed in the Graph lane while this session was mid-round, so this
re-scanned rather than assumed.

**Round 6's open item 1 is done.** It said "Hosted apply of
`scope=discovery-stages` — if this round's session did not dispatch it,
dispatch after merge... Until applied, launching the scout on hosted fails at
the stage cast." Dispatched it to be sure
([run 32665767520](https://github.com/surgeservicesllc/SoftwareFactory/actions/runs/32665767520)):
the scope refused in zero seconds with **"Ledger already records one of these
versions (growth=1 map=1; want 0/0)"**. Both `20260823000800` and
`20260823000900` are recorded — round 6 *had* applied them. Nothing was
written; the guard did its job. **Treat that item as closed**, and note the
failed run in the history is the refusal, not a failure to apply.

**ADR-136 is now marked superseded in part by ADR-137**, and the round 4
section below carries an inline correction. It said "the enum does not grow" —
true when written, false the same day. Its *rule* still stands and is the
better half: a stage is added when something produces it, never to make a
picture match. Round 6 met that precondition and then grew the enum, which is
the ADR working as intended rather than being overruled.

**Round 5's work survives round 6 untouched.** `summariseRunStages` reads
`SDLC_STAGES`, so the eleven-stage vocabulary was absorbed with no change —
all 20 Graph tests (summariser, panel, template lifecycle, SQL/TS agreement)
pass against round 6's main. Round 6 also updated the two tests of mine that
its capability additions touched, correctly.

**Lane split, so three bots do not collide.** This session has stayed in
`lib/graph/*`, `components/graph-runs-panel.tsx` and the Graph migrations. The
other two have been on sign-in/chooser, navigation, and the unrecorded-migration
backlog. Round 6 is also Graph — **coordinate before taking anything below.**

**Next, highest value first:**

1. **Per-stage pages are now unblocked for all ten**, which they were not
   before round 6: nine of the goal document's ten map one to one and
   REQUIREMENT covers GOAL+PRD. `summariseRunStages` is the grouping those
   pages want — a stage page is that filtered to one stage plus the nodes
   behind it. `/solutions/ai-factory` is still the *setup journey*, not the
   lifecycle; do not rename it into one.
2. **Clicking a node still reveals nothing.** The goal document asks for owner,
   inputs, dependencies, attempts, logs, artifacts, timing and output.
   `list_graph_runs` projects state/provider/model/latency/error; inputs,
   dependencies and per-node artifacts are not projected. A read path to widen
   — and it needs a migration, so check the tail pins (round 6 moved 21 files;
   another mover will conflict).
3. **Round 6's own item 3** — graph-to-graph chaining, scout→agentic_sdlc, the
   one-request experience. The handoff contract exists; the chaining does not.
   That looks like round 6's intended next; ask before taking it.
4. Owner-gated, unchanged: the silent Run analysis taps (one more tap separates
   403 / 404 / 409), and live source lookups for discovery (a tool-surface
   change).

## GRAPH — DISCOVER/EVALUATE/DECIDE ARE REAL CAPABILITIES WITH TYPED PACKAGES (2026-08-23, round 6)

Primary-bot round, from the owner's Step 2–5 boards + the GraphEngineering
master prompt. ADR-136 said the three dormant stages needed "a capability that
produces them, not an enum value" — this round built the capability, then grew
the enum exactly as that ADR prescribed. ADR-137 records it.

**What exists now:**

* `lib/graph/stage-packages.ts` — typed, versioned contracts for the three
  stage handoffs. Discovery candidates must declare how they are known
  (`REPOSITORY` / `DEPENDENCY` / `MODEL_KNOWLEDGE`) and a recalled candidate
  can never claim `VERIFIED_IN_REPO` (schema refinement, not prompt hope).
  Popularity metrics are deliberately absent — the executor has no network,
  and a stars count it cannot observe would be recalled and dressed as a
  reading. Evaluation: fixed 100-point rubric (weights in
  `EVALUATION_CRITERIA`), `weightedTotal()` computed from scores, never
  trusted. Decision: all five paths (USE/CONNECT/ADAPT/FORK/BUILD) weighed
  exactly once, chosen one must be among them — contract-enforced.
* Capabilities `discovery`, `evaluation`, `decision` in NODE_CAPABILITIES,
  with model tiers (STANDARD/STRONG/STRONG), task kind "plan", and
  stageForCapability → DISCOVERY/EVALUATION/DECISION.
* Template `open_source_scout` (INVESTIGATION, GREEN, 7 nodes): clarify →
  {scan_internal, scan_dependencies, recall_ecosystem} in parallel →
  consolidate (tolerant fan-in) → evaluate → decide (AUTOMATIC gate).
  Launchable from the Templates page like any template; prose from any of its
  package nodes is a contract violation that routes to retry, not downstream.
* `SDLC_STAGES` is now **eleven**: DISCOVERY, EVALUATION, DECISION sit
  between PRD and ARCHITECTURE. REJECTION_RETURNS_TO: DISCOVERY→PRD,
  EVALUATION→DISCOVERY, DECISION→EVALUATION; ARCHITECTURE still returns to
  PRD on purpose (every graph with ARCHITECTURE has a PRD; only some have a
  DECISION).
* Migrations `20260823000800` (enum growth, BEFORE 'ARCHITECTURE', add value
  if not exists, uses nothing it adds) and `20260823000900` (capability→stage
  map extension, zero rows qualify today). Two files because an enum value
  cannot be *used* in the transaction that added it and the hosted scope runs
  `psql -1` — same physics as clear-controls. Workflow scope
  **`discovery-stages`** applies both as separate psql invocations,
  sha-pinned (`f4bd0df5…` / `62468eef…`), one-shot, postflight asserts the
  eleven labels in lifecycle order plus working casts.

**For the presentation lane (rounds 4-5 bot):** `summariseRunStages` and any
per-stage work built against SDLC_STAGES pick the three new stages up
automatically; they are no longer the "permanently empty" stages ADR-136
warned about — the scout populates them. Your round-5 rule "no stage the run
never contained" already renders a scout run correctly.

**Still open in this lane:**

1. ~~Hosted apply of `scope=discovery-stages`~~ **Done** (run 32665300909):
   migrations, postflights and ledger rows all succeeded on hosted; the run
   shows red only because the scope's readback compared `name[]` to `text[]`
   after the fact. Fixed, and the readback SQL is now executed verbatim in
   the discovery-stages replay test. Do not re-dispatch — the one-shot guard
   now correctly refuses.
2. Live source lookups for discovery are an **owner-gated tool-surface
   change** (the node executor is Read/Glob/Grep by design; WebSearch would
   make ecosystem candidates verifiable). Until then the scout's ecosystem
   scan is honestly labelled MODEL_KNOWLEDGE/UNVERIFIED.
3. The scout's DECIDE hands an execution plan shaped for ARCHITECT; wiring a
   combined scout→agentic_sdlc flow (one request through all stages, the
   GraphEngineering one-request experience) is the natural round 6+. The
   handoff contract exists; the graph-to-graph chaining does not.
4. Tail pins now say `20260823000900_discovery_capability_stage_map.sql`
   (21 files moved). The agreement test reads the union of 000700+000900.


## SIGN-IN NOW LANDS ON /decision, AND THE HEADER NAMES TWO PRODUCTS (2026-08-23, latest)

Shipped and live: `main` `56641c13` (#365), ADR-135.

**What changed.** Every sign-in lands on `/decision` — two product cards (AI
Software Factory / AI Job Seeker), Getting started, and a Quick overview +
Recent activity rail. The global header now reads **Software Factory** and
**Job Seeker**; Administration is no longer an entry there.

**The bit worth knowing before you touch the auth paths.** The default
post-sign-in destination lives in exactly one place: the sign-in *route*
(`app/api/auth/sign-in/route.ts`) and the callback. The sign-in *page* used to
substitute `/solutions` when no `next` was supplied — which reached the route
as an explicit request and silently beat the route's own default. If you ever
change where sign-in lands and nothing happens, that is the shape of the bug:
look for a caller substituting a default before the decision point.

**The one-time gate** (`lib/auth/decision-gate.ts`) records the **decision**,
not the permission. Absent means "has not chosen since signing in" and the
chooser renders; `chosen` means they picked a product and `/decision` sends
them to the console. Signing in clears it (so the chooser returns on every login),
signing out clears it (so a shared browser inherits nothing).

**It shipped with that backwards and the page was dead on arrival.** The first
version wrote a cookie meaning "may see the chooser", set only by a fresh
sign-in — so every session that already existed, the owner's included, had no
cookie and was redirected straight to `/solutions`. A gate whose closed state
is also its uninitialised state denies every case it has never seen, and the
first such case is always the users who are already signed in. If you add a
gate, make absence mean the permissive case or initialise it explicitly.

Choosing is a Server Action form submit, **not** a link — a link gets
prefetched, and the prefetch would record a choice the person never made. Do
not "simplify" those forms into links.

**Testing note.** `/decision` is hard-gated, so like `/job-seeker` it is
exempted from `tests/e2e/responsive.spec.ts` (navigating to it destroys the
sweep's own execution context). Its layout is measured through the harness
cases `decision-products` and `decision-overview` instead. If you add UI to
that page, put the presentational part in a component and add a harness case,
or the coverage contract will (correctly) fail you.

**Open for the owner.** The page's wording is mine, built from the described
structure rather than pixel-matched. The console *sidebar* still says
`AI Factory` — that is a different destination (`/solutions/ai-factory`, the
guided journey) from the header entry that was renamed.

## AUTONOMY CLEAR IS HOSTED — AND IT ARCHIVES, IT DOES NOT DELETE (2026-08-23)

`20260823000600` is applied and verified (run `32657726992`). ADR-134.

The owner asked for a Clear that empties "What the loop may do". That list is
one row per project, so the obvious build was deleting projects. **Three
independent guards refused**, and the third settles it by name:
`refuse_project_deletion` (`20260815000900`) states a project's append-only
activity trail makes it undeletable from its first recorded moment, that this
is deliberate, that there is no escape hatch, and that "the supported end of a
project's life is archive_project". So Clear archives, and
`list_autonomy_status` excludes archived projects — same visible outcome,
nothing destroyed, unarchive from the Projects page.

**The failed first apply is the lesson.** It died on my own postflight:
`projects_guarded_deletion is missing`. That was true — hosted has never
recorded `20260815000900` — and the migration rolled back cleanly, applying
nothing. But the trigger is the *explanation*; the `activity_events -> projects`
`ON DELETE RESTRICT` is the *enforcement*, and it is present everywhere. The
postflight now asserts the constraint and only notices the trigger's absence.
**Assert the enforcing object, not the explaining one.**

**Ledger status, measured 2026-08-23:** 18 versions are unrecorded on hosted —
`20260815000200/000300/000400/000500/000600/000800/000900/001100/001200/
001300/001400/001500/001600`, `20260816000100/000200/000300/001600`, and
`20260821000400`. `Supabase Preview` stays red because the replay runs in
version order and dies on the earliest unrecorded file whose objects already
exist. Each wants the measure-then-finish discipline the vault got: probe
first, finish only what is missing, record the ledger row only once every
declared object is present. Applying them blind is how this began.
## GRAPH — A RUN NOW READS AS A LIFECYCLE, NOT JUST A NODE LIST (2026-08-23, round 5)

Three bots are on this repository. This round stayed inside the Graph lane
(`lib/graph/*`, `components/graph-runs-panel.tsx`) — the other two were on
sign-in/chooser, navigation and the unrecorded-migration backlog, so nothing
collided. Keep to that split.

Round 4 made every node's stage real and applied the backfill to production.
The only thing reading it was one column of a node table, which says *what ran*
but not *how far through the lifecycle the run got*. That is the gap this
closes — it consumes the data rather than adding more of it.

**Shipped:** `lib/graph/stage-summary.ts` (`summariseRunStages`) plus a
`StageSummary` block above the node table on each expanded run. Per stage, in
lifecycle order: completed/total, and failed / running / skipped when non-zero.

Three deliberate refusals, each tested:

- **No percentage.** A stage with three completed and one failed is not 75% of
  anything a person can act on, and a bar would imply otherwise.
- **A stage the run never contained is absent, not zeroed.** An audit graph is
  REVIEW work; a row reading `DEPLOYMENT 0/0` would invent a stage the graph was
  never going to enter.
- **Nodes with no recognised stage are counted and stated** ("N with no stage"),
  because otherwise the summary's totals silently fail to add up to the table
  directly beneath it. A run where *nothing* has a stage renders no summary at
  all rather than an empty frame — on a deployment that has not been backfilled
  that is the honest answer.

Mutation-checked both ways: deleting the render call fails the panel tests
(a summary computed and never shown passes every unit test the summariser has),
and dropping unstaged nodes instead of counting them fails both the summariser
and the panel.

**Next bot, in the Graph lane, highest value first:**

1. **Per-stage pages, for the eight** (ADR-136 settled the vocabulary; do not
   build ten — DISCOVER/EVALUATE/DECIDE have nothing that produces them and
   would render live-looking and always empty). `summariseRunStages` is the
   grouping those pages want; a stage page is that filtered to one stage plus
   the nodes behind it. Note `/solutions/ai-factory` is the *setup journey*
   (connect a repository, assign bots, issue a command), not the lifecycle —
   naming it the lifecycle surface would be the same untruth in the navigation.
2. **Clicking a node still reveals nothing.** The goal document asks for owner,
   inputs, dependencies, attempts, logs, artifacts, timing and output per node.
   `list_graph_runs` already returns state/provider/model/latency/error; inputs,
   dependencies and artifacts per node are not projected yet. That is a read
   path to widen, not a new table.
3. Still open, needs the owner: why the two silent Run analysis taps left no
   row. The alert now reports status and code, so one more tap separates origin
   (403) from wrong active organization (404) from a database refusal (409).
4. Not Graph: 19 migration versions remain unrecorded on hosted
   (`20260821000400` among them, its table demonstrably present). Another bot is
   on that; leave it alone unless it is handed over.

Verified this round: typecheck, lint, production build, full suite.

## GRAPH — THE BACKFILL IS APPLIED IN PRODUCTION, AND THE STAGE VOCABULARY IS SETTLED (2026-08-23, round 4)

**Applied.** `scope=graph-stage-backfill` ran against production —
[run 32660207022](https://github.com/surgeservicesllc/SoftwareFactory/actions/runs/32660207022),
step 33, success — and `20260823000700` is now recorded on **both** sides of
the ledger. The step's last statement is a hard gate: it exits non-zero if any
node whose capability the application defines still has no stage, so its
success is the verification, not a claim beside it. Every graph in this
workspace, including the first real Step 9 run, now carries a lifecycle stage
and the graph-runs **Stage** column reads for the whole history.

One honesty note: I did not capture the before/after distribution the step
prints — the log tail is dominated by the 130-line ledger listing that follows
it. The counts are in the run log if anyone wants them; what is proven here is
the gate, not a number I could quote.

**The vocabulary question is decided (ADR-136), and it was blocking per-stage
pages.** The goal document names ten stages; the database holds eight. They are
not two designs — the ten are a presentation of the eight:

```
REQUIREMENT -> GOAL + PRD          REVIEW  -> REVIEW
DISCOVER    -> (none)              TEST    -> TEST
EVALUATE    -> (none)              DEPLOY  -> DEPLOYMENT
DECIDE      -> (none)              MONITOR -> MONITORING
ARCHITECT   -> ARCHITECTURE
BUILD       -> IMPLEMENTATION
```

The enum does **not** grow — *superseded the same day by ADR-137, which built the
capabilities this paragraph named as the precondition and then grew the enum to
eleven. The rule stands; the verdict does not.* DISCOVER, EVALUATE and DECIDE have nothing that
produces them: no template declares such a capability and `NODE_CAPABILITIES`
has no member that resolves to one. Three enum values nothing can populate is a
stage filter that is permanently empty — scaffolding, in the same commit that
would claim to satisfy the goal. Discovery does exist engine-side
(`lib/graph/discovery.ts`, canary-proven); when a **stored** graph can add
rounds mid-run — the limitation recorded 2026-08-19 — a DISCOVERY stage will
have something real to hold, and the migration is additive so waiting costs
nothing.

**Next bot, in the Graph lane:**

1. **Per-stage pages are now unblocked, for the eight.** Build against
   `SDLC_STAGES`, presenting REQUIREMENT as GOAL+PRD if the goal document's
   wording is wanted. Do not build ten — three would read live and always be
   empty. Note `/solutions/ai-factory` is the *setup journey* (connect a
   repository, assign bots, issue a command), not the lifecycle; naming it the
   lifecycle surface would be the same untruth in the navigation.
2. **Nothing yet reads the stage except one table column.** The graph-runs
   panel shows it per node; no surface groups or summarises a run by stage.
   That is the cheapest next thing that consumes the data rather than adding
   more of it.
3. Still open, unchanged: why the two silent Run analysis taps left no row. The
   alert now reports status and code, so one more tap separates origin (403)
   from wrong active organization (404) from a database refusal (409).
4. Still open, not Graph: 19 migration versions remain unrecorded on hosted
   (`20260821000400` among them, its table demonstrably present). Each wants
   the probe-first discipline the vault repair used.

## GRAPH — THE BACKFILL FOR EVERY GRAPH THAT PREDATES THE STAGE RULE (2026-08-23, round 3)

Follows the round below, which made new graphs carry a stage. Existing rows
still stored null, so the graph-runs **Stage** column read as an em dash for the
whole of this workspace's history — including the first real Step 9 run. That
is now derivable rather than lost: `capability` is already on every row, and the
stage is a property of the work the node does.

**Shipped:** `20260823000700_backfill_graph_node_lifecycle_stage.sql` — data
only, no schema change. `update ... where lifecycle_stage is null and capability
in (the nine the application defines)`.

Three properties, each of which is the reason it is safe, and each tested:

- **Replay is a no-op.** The null guard means a second run changes nothing.
- **A declared stage is never overwritten.** A template that names its own
  stage keeps it; only stageless rows are filled.
- **An unrecognised capability is left alone.** The column is free text, not an
  enum, so a value this system never defined stays null. An honest em dash
  beats a confident wrong stage.

**Drift is guarded, because the rule now exists twice.** `stageForCapability()`
in TypeScript for new graphs, and the CASE in SQL for old rows.
`tests/unit/graph-stage-mapping-agreement.test.ts` reads the migration and holds
it to the function for every capability in `NODE_CAPABILITIES` — a capability
added to the code without a branch in the migration fails there rather than
silently backfilling null.

**It can actually reach production.** `scope=graph-stage-backfill` in
`apply-hosted-migrations.yml` applies that one file: hash-pinned, refuses if
the ledger already records 20260823000700, refuses unless
`graph_nodes.lifecycle_stage` and the `sdlc_stage` type are really present
(the object, not merely a ledger row), prints the stage distribution before and
after, and verifies no node with a known capability is left stageless. The hash
pin is itself tested — editing the migration without repinning fails at commit
time instead of turning the scope into a step that always refuses.

**Verified:** four behaviour tests against the real migrated schema (derivation
across all nine capabilities, unknown capability untouched, declared stage
preserved, replay no-op); mutation-checked — dropping the null guard fails
three of them, and making the SQL disagree with the code fails the agreement
test. Typecheck, lint, full suite, production build all green.

**Next bot, in the Graph lane:**

1. **Run `scope=graph-stage-backfill`** — it is staged and not yet applied. It
   writes production rows, so read the before/after distribution it prints.
2. The goal document's ten stages (REQUIREMENT → MONITOR) are still **not** the
   shipped 8-value `sdlc_stage` enum (GOAL, PRD, ARCHITECTURE, IMPLEMENTATION,
   REVIEW, TEST, DEPLOYMENT, MONITORING). Nothing reconciles them. Decide
   deliberately whether the enum grows or the ten map onto these eight before
   building per-stage pages — `/solutions/ai-factory` today is the setup
   journey, not the lifecycle.
3. Still open: why the two silent Run analysis taps left no row. The alert now
   reports status and code, so one more tap separates origin (403) from wrong
   active organization (404) from a database refusal (409).

## GRAPH — THE STAGE COLUMN WAS DEAD, AND LABELLING IT WOULD HAVE STARTED LOOPS (2026-08-23, round 2)

The graph-runs panel has had a **Stage** column since the Agentic SDLC
migration (`20260821000200`, `sdlc_stage` enum, `graph_nodes.lifecycle_stage`).
It rendered `—` for every node of every run the owner actually produces.

Measured, not guessed: of 16 templates, **only `agentic_sdlc` declared any
lifecycle stages**. Every analysis template the Step 9 button launches —
`production_readiness`, `bug_sweep`, `security_audit` and the rest — declared
none, so the resolved Step 9 run (command `0e9a4765`, 7 artifacts) has no stage
on a single node.

**The trap, found before shipping it.** The obvious fix — declare stages on the
audit templates — would have caused a regression. `isLifecycle` was *inferred*
in `buildLaunchPlan` as "any node declares a `lifecycleStage`", and
`lib/sdlc/orchestrator.ts` uses `isLifecycle` to decide whether a graph
ITERATEs instead of HALTing when acceptance is unmet. Labelling an audit node
would therefore have turned every read-only analysis into a graph that re-runs
itself, spending subscription turns on repeat passes nobody asked for. That
conflation *was* the defect: you could not say which stage a node sits in
without also changing how the graph runs.

**What shipped:**

- `GraphTemplate.isLifecycle` is declared, not inferred. `agentic_sdlc` sets
  it; nothing else does. A stage is now a label and nothing more.
- `stageForCapability()` is the single rule: qa → TEST, implementation →
  IMPLEMENTATION, architecture → ARCHITECTURE, planning → PRD, and the
  read-only capabilities (review, security_review, extraction, synthesis,
  reporting) → REVIEW. An audit examines something that already exists and
  says what it found, which is REVIEW.
- `templateStageFor()` resolves a declared stage first and falls back to the
  capability. One rule at the read boundary rather than 100+ hand-typed labels
  that drift the first time a template gains a node — all 16 templates, every
  node, now have a stage.
- `supabase/fixtures/production_readiness.launch-plan.json` regenerated: the
  diff is exactly 7 lines, `lifecycle_stage: null → "REVIEW"`. **Note for
  whoever runs `scope=analysis-launch-commit`:** that scope now sends nodes
  carrying a stage. The column exists on hosted (`20260821000200` is recorded),
  so this is a fill, not a schema change.

**Mutation-checked, and the first attempt did not hold.** A test asserting
"only `agentic_sdlc` iterates" passes under *both* the inferred and the
declared rule, because no shipped template declares a stage override — the two
expressions agree on today's data. The guard that actually holds the
decoupling builds the case that separates them: an audit-shaped template with
one explicitly staged node and no lifecycle claim, asserted to compile with
`isLifecycle === false`. Reverting to inference fails it. Dropping the
capability fallback fails the coverage guards.

**Next bot, in the Graph lane:**

1. The Stage column is now populated for *new* graphs only. Graphs already in
   the database — including the resolved Step 9 run — still have
   `lifecycle_stage = null` on their nodes. A backfill would need to map stored
   `graph_nodes.capability` through the same rule; it is a one-statement
   update per template shape, but it writes production rows, so measure with
   `scope=probe` first.
2. The 10-stage lifecycle in the attached goal document (REQUIREMENT →
   MONITOR) is **not** the same vocabulary as the shipped `sdlc_stage` enum
   (GOAL, PRD, ARCHITECTURE, IMPLEMENTATION, REVIEW, TEST, DEPLOYMENT,
   MONITORING — 8 values). Nothing reconciles them. Decide deliberately
   whether the enum grows or the goal's ten map onto these eight before
   building any per-stage pages; `/solutions/ai-factory` today is the setup
   journey, not the lifecycle.
3. Still open from the round before: why the two silent Run analysis taps left
   no row. The alert now reports status and error code, so one more tap is
   enough to separate origin (403) from wrong active organization (404) from a
   database refusal (409).

Verified: typecheck, lint, production build, full suite green.

## THE VAULT MIGRATION IS FINISHED, AND THE DELETE HAD A THIRD BLOCKER (2026-08-23, latest)

**`20260814002500_provider_credential_vault` is complete and recorded** (apply
run 32653491713). The section below headed "FOUR MIGRATIONS ARE OUTSTANDING"
is now one out of date on this file — read it for method, not for status.

It was measured before it was touched. `scope=probe` gained an exact object
inventory, and run 32652393423 answered: both tables present with every
column, the index present, RLS and FORCE RLS on with no client grants, and
five of six functions created. Exactly one was missing —
`resolve_provider_connect_session`. That single gap was the live cost this
file has described since 2026-08-20: `POST /api/bots/connect/claim` calls it
first, so every **correct** sign-in code was answered
`connect_session_invalid`. `20260823000500` creates it byte-for-byte from the
original, and the apply scope reads it back and re-checks all nine of the
original's objects **before** recording `20260814002500` — the ledger can
never claim "applied" about a database still short a function.

That removes **one** cause of the red `Supabase Preview`, and it verifiably
moved the replay forward: before the repair the preview died on
20260814002500 (`relation "provider_credentials" already exists`, 42P07);
after it, the same check on 379a0193 dies on **20260815000200** instead
(`column "maximum_concurrent_runs" of relation "organizations" already
exists`, 42701). Same partial-apply class, next file along, different error
code — a duplicate COLUMN from an `alter table add column` rather than a
duplicate table.

The check is still red, and expected to stay red until the rest are
finished. The preview branch replays every
migration the ledger does not record, and the ledger listing in run
32652305439 shows **20 unrecorded versions**, of which 20260814002500 was
only the first to fail. The replay runs in version order, so the EARLIEST unrecorded file whose
objects already exist is the one that fails. That is currently
**20260815000200**. (An earlier note here guessed
`20260821000400_command_factory_routing` would be next because its table
demonstrably exists — this session deleted rows from
`factory_command_routes` on production — but that file is far later in the
queue and will only be reached once everything before it is finished. The
guess was right about the class and wrong about the order.)

So do not read the vault repair as "the check is fixed". The remaining
unrecorded versions, from the same listing, are:

```
20260814002600  20260815000200  20260815000300  20260815000400
20260815000500  20260815000600  20260815000800  20260815000900
20260815001100  20260815001200  20260815001300  20260815001400
20260815001500  20260815001600  20260816000100  20260816000200
20260816000300  20260816001600  20260821000400
```

Each wants the same discipline the vault got: measure its objects with a
probe inventory first, finish only what is missing, and record the ledger row
only after every object it declares is present. Applying them blind is how
this class of problem was created.

**The Pipelines delete needed three separate fixes**, each invisible until the
one before it was removed:

1. Live work was skipped, not stopped (ADR-131) — two record-only rows queued
   for hours could never be claimed, so "protect live work" was protecting
   rows nobody could finish.
2. `command_analysis_graphs.command_id` is `on delete restrict`, so a command
   with an analysis graph failed on a foreign key. The link is released; the
   graph, its run and its artifacts survive.
3. `factory command routing evidence is immutable` (ADR-132) — a trigger that
   refuses every delete plus a restrict foreign key did not make routing
   evidence immutable, it made the **command immortal**. The audited delete
   now announces itself with a transaction-local setting the guard honours;
   an UPDATE is still refused, and the table still has no grants for any
   client role. Proven against the real hosted rows, rolled back:
   `update refused=t delete refused=t` (run 32652305439).


## GRAPH — THE SILENT TAP: TWO DEFECTS FOUND IN THAT PATH, BOTH FIXED (2026-08-23, round 1)

Step 9 is resolved above — a real run COMPLETED with 7 artifacts, and the
application's own launch path is working again. What that section leaves open
is the one thing this round went after: **why the two earlier taps failed
silently is still unexplained**, and its stated next step was "the next
failure should leave a usable clue... wants the verbatim alert text".

Reading the tap path end to end found two real defects in it. Neither is
proven to be the no-trace cause — I am not claiming the mystery is solved —
but both were live on the exact path the owner pressed, and both are fixed.

**1. The manual button could never send the command's type, so every launch
ran the wrong template.** `POST /api/commands/{id}/analysis` took
`commandType` from the request body, defaulted to `other`. The command list
the button renders from (`list_factory_commands`) never projected the type, so
the client had nothing to send and always defaulted. Because `other` maps to a
real template (`production_readiness`) rather than refusing, a `fix_bug`
command silently got a production-readiness graph instead of `bug_sweep` — no
error, wrong analysis. Note the resolved run above *is* command `0e9a4765`
("Fix high-priority bugs"), launched through the workflow's hash-pinned
`production_readiness` plan; through the button it would have taken the same
wrong template by accident rather than by choice. The submit and replay
auto-launch paths were unaffected — they pass the type they just recorded.
**Fixed:** the route reads `commands.command_type` under the caller's RLS and
uses that; the body carries `projectId` only, so the browser cannot choose
which template runs. A command the caller cannot see returns 404
`command_not_found` instead of a guessed type entering the doorway.

**2. The "best effort" worker wake was not best effort.** Only
`dispatchGraphWorker` sat inside the try; the `resolve_phase1c_command_target`
lookup before it did not. A *throw* there (not an `error` result — that was
handled) escaped to the 500 handler **after** the graph had been created, so
the caller was told the launch failed while the database held a launched
graph. **Fixed:** the whole wake, lookup included, is inside the try.

Worth stating for the diagnosis: defect 2 produces the *opposite* symptom to
the reported one (a row exists, the caller sees failure), and defect 1
launches the wrong template rather than none — so neither explains 0 link
rows. The silent-tap cause is still open.

**What this round adds for that:** the refusal now reaches the person. The
alert carries the HTTP status and error code
(`"<message> (409 analysis_launch_refused)"`), a network throw says it never
reached the server rather than borrowing the refusal's sentence, and the alert
renders under the row that failed instead of under every row — it was rendered
for each `<li>`, so one refusal looked like the whole list refusing.

**Next bot:** ask the owner to tap Run analysis once more and read back the
alert. The status and code now separate the candidates without Vercel logs —
403 = origin (`assertSameOriginRequest` compares the `Origin` header with
`new URL(request.url).origin`, a known proxy-mismatch shape); 404
`command_not_found` = the active organization is not the command's; 409
`analysis_launch_refused` = the database doorway refused, reason quoted
verbatim. `scope=analysis-launch-doorcheck` still re-proves the database
without writing.

Also still open, unrelated and blocking the hosted lane:
`20260822000900_repair_hosted_plpgsql_catalog_and_lint.sql` fails on real
PostgreSQL (`relation "_sf_20260822000900_foundation_state" does not exist`),
which will stop the next `apply-hosted-migrations` run. And `Supabase Preview`
is red on recent main commits (blocks nothing; nobody has looked).

Verified this round: typecheck, lint, 4287 tests / 2 skipped, production
build. New coverage in `tests/unit/analysis-launch-route.test.ts` (3 tests):
the template follows the command's recorded type, a body naming its own
`commandType` is refused 400, and an unreadable command is 404 before any
launch — the success case asserts the response stays under 400 while the
worker wake throws.

## STEP 9 IS DONE — THE BOT RAN FOR REAL (2026-08-23, resolved; read the section below for how)

Command `0e9a4765` ("Fix high-priority bugs") → analysis graph `e3097ed8` →
graph run `6d6c0a07`: **COMPLETED with 7 artifacts**, 13:42:37Z to 13:48:30Z
(worker run 32643138657, confirmed by probe run 32646908822). That is the
Claude bot executing an owner-issued command as a read-only analysis on the
subscription credential, with durable artifacts — Step 9's first real run.

The application's own launch path is working again too: command `d8777258`
gained graph `a9fc2de2` at 13:44:25Z with no workflow involvement (its run
`cc39a49f` finished PARTIAL with 5 artifacts, and is reported as PARTIAL).

Two loose ends for whoever picks this up:

- **Why the two earlier taps failed silently is still unexplained.** If it
  recurs: `scope=analysis-launch-doorcheck` re-proves the database without
  writing anything, and the endpoint now returns request-shape refusals
  (origin, body size) with their real status instead of a generic 500, so
  the next failure should leave a usable clue. Diagnosing further wants
  Vercel runtime logs or the verbatim alert text from under the request card.
- **`Supabase Preview` has been red on every recent main commit**, including
  ones this session did not touch. It is not one of the four required
  checks, so it blocks nothing — and it is **not a mystery**: it is the
  partially-applied `20260814002500_provider_credential_vault` described in
  the section below, showing up in a second place. The check is Supabase's
  own GitHub App branching production and replaying every migration the
  hosted ledger does not record. `20260814002500` is not recorded (the
  ledger's remote column is blank) but its table *does* exist on hosted
  (probe run 32646908822: `20260814002500 | table | provider_credentials |
  t`), so the replay hits that file's unguarded `create table` and dies
  with `ERROR: relation "provider_credentials" already exists (SQLSTATE
  42P07)`. Exactly the failure mode the runbook warns about — "NOT VISIBLE
  is not absent". Fixing it means finishing that migration on hosted, which
  is an owner-approved action nobody has taken; the red check is the
  symptom, not a separate bug.

Also shipped 2026-08-23: **multi-select delete on the Pipelines page**
(ADR-130). `20260823000200` is applied on hosted (run 32647755059);
`delete_selected_pipelines` keeps every refusal `clear_all_pipelines` makes
and adds organization scoping plus a 200-row cap. Not yet exercised against
a real production row — the backlog item says so.

## HOW THE STEP 9 DIAGNOSIS WENT (2026-08-23, kept for the method)

The goal in flight: the AI Factory's Step 9 runs the owner's recorded Claude
command as a real read-only analysis (graph → subscription graph worker →
artifacts), and Runs + Step 9 show it. The full lane shipped through PR #344
(migration `20260823000100` is APPLIED on hosted; submit/replay auto-launch;
`POST /api/commands/{id}/analysis` behind the Bot Manager "Run analysis"
button; Runs-page analysis rows; Step 9 analysis states).

**The open defect:** the owner tapped Run analysis twice (2026-08-23 ~02:26Z
and ~13:25Z) and the hosted database kept no trace — `command_analysis_graphs`
still has **0 link rows** (probe runs 32613345163, 32642517130). Meanwhile the
rolled-back rehearsal proved the database layer performs the exact launch for
the real command and returns a graph id
([doorcheck run 32614371816](https://github.com/surgeservicesllc/SoftwareFactory/actions/runs/32614371816),
command `0e9a4765-954b-4477-956b-a416e53fb29e`). A `NOTIFY pgrst, 'reload
schema'` was re-sent before the second tap, so a stale PostgREST schema cache
no longer explains it. The failure is in the Vercel/Next edge path and is
invisible without runtime logs — the endpoint exists (unauthenticated POST
returns our own 401/403 shapes), the composer POST works from the same phone,
and the tap's error alert text has not been reported back.

**What finished it** — the three steps below ran in order and are repeatable
for any future stranded command (workflow `apply-hosted-migrations.yml`):

1. `scope=analysis-launch-commit` — commits the one launch the taps asked
   for, through the same DB doorway, as the command's own organization owner,
   with the hash-pinned fixture plan
   (`supabase/fixtures/production_readiness.launch-plan.json`, regenerated by
   `scripts/emit-analysis-plan.mts`, drift-pinned by
   `tests/unit/analysis-launch.test.ts`). Refuses if the link already exists.
   Ran as 32643074805 → graph `e3097ed8`.
2. Then dispatch `graph-worker.yml` (plain workflow_dispatch — manual mode is
   unconditional) so the PLANNED graph is claimed and executed on the
   subscription credential. A real drain takes minutes. Ran as 32643138657,
   ~10 minutes, success.
3. Then `scope=probe` shows the truth: link row for the command, graph with 7
   nodes, `graph_runs` reaching COMPLETED with artifacts. The Runs page and
   Step 9 read the same `list_command_analysis_graphs` and light up on their
   own once the run exists. Ran as 32646908822 → COMPLETED, 7 artifacts.

**Still unexplained:** why those two authenticated browser POSTs died
silently, given that a third one three minutes later worked. Diagnosing it
wants either Vercel runtime logs or the verbatim red alert text under the
request card after a failing tap. `scope=analysis-launch-doorcheck`
re-proves DB health any time without writing. Note the endpoint hardening in
`app/api/commands/[commandId]/analysis/route.ts` now returns request-shape
refusals (origin/body) with their real status instead of a generic 500 —
future taps leave a better clue. New commands are unaffected in the common
case: the submit and replay paths auto-launch at composer time.

Context rules that bind this lane: read-only analysis only (no repository
writes — the write lane stays with Codex and is owner-gated off), zero
API-token execution (subscription credential only), kill switch stays ON,
autonomy OFF. `AI/HANDOFF.md` and `AI/BACKLOG.md` carry the longer trail
("Step 9 real run" item).

## FOUR MIGRATIONS ARE OUTSTANDING ON HOSTED, AND ONE IS COSTING A USER PATH (2026-08-20)

The hosted schema audit had been answering "0 outstanding" from a list of four
migrations written by hand, while the directory held 124. It derives its
expectations now and also reads PostgREST's description for functions, so it
covers 50 of the 124 rather than 4. First honest answer: **46 applied, 4
outstanding, 0 indeterminate, 74 not probeable**
([run 32316446825](https://github.com/surgeservicesllc/SoftwareFactory/actions/runs/32316446825)).

- `20260814000300_agentos_isolation_model` — nine `agentos_*` tables
- `20260814002500_provider_credential_vault` — `resolve_provider_connect_session()`
- `20260815001100_connection_routing_decisions` — `connection_routing_decisions`
- `20260816001600_phase2c_resource_reservations` — `resource_reservations`, `resource_rate_events`

The vault one has a live cost: `POST /api/bots/connect/claim` calls that
function first, and answered its absence with `connect_session_invalid` — so
every **correct** sign-in code was told the link was not valid, and each retry
minted another code that failed the same way. The route now separates a failed
lookup (`503 connect_unavailable`) from an unmatched code, but the function is
still missing and the flow still cannot complete.

**Before applying anything**, run `scripts/hosted-state-report.sql` in the SQL
editor. NOT VISIBLE is not absent: PostgREST cannot see a table that exists with
no grants, which is exactly what a migration that died before its grant
statements leaves behind, and re-running that file fails with `42P07`.

Applying is an owner-approved action. No agent has taken it.

Also from that walk: `lib/resources/reservation-store.ts` and the batch
dispatcher are built, tested, and imported by nothing that executes. Do not wire
them before the migration lands — the store fails closed, so an admission gate
against a missing table would refuse every claim and stop the graph lane, which
is the one execution path working today.

The whole component walk, with each step's evidence, is
`AI/FACTORY_COMPONENT_AUDIT.md`.

## IF YOUR PULL REQUEST IS GETTING NO CI RUNS, CHECK MERGEABILITY FIRST (2026-08-19)

A conflicted pull request gets **no `pull_request` workflow runs at all**. No run
object, no error, no annotation — the checks simply never appear, which looks
exactly like a dropped webhook or an Actions outage.

```
curl -H "Authorization: Bearer $GITHUB_TOKEN" \
  https://api.github.com/repos/surgeservicesllc/SoftwareFactory/pulls/<N> \
  | jq -r '"mergeable=\(.mergeable) state=\(.mergeable_state)"'
```

`mergeable_state=dirty` means conflicted, and until you merge main into the
branch you will get no checks no matter what you push. Empty commits, closing and
reopening, and editing the workflow all do nothing.

This matters here more than in most repositories because main takes several
merges an hour, so a branch that was clean when you opened it goes conflicted
while you work.

**It cost roughly an hour and three wrong diagnoses to find**, each of which
looked well-supported at the time:

1. *"Infrastructure."* Wrong — Actions was creating runs for other pull requests
   minutes apart.
2. *"My `ci.yml` edit breaks run creation."* Wrong, and I committed that claim
   into `ci.yml` as a comment before checking it. Reverting the file appeared to
   fix it and re-adding half of it appeared to keep it fixed; both were
   coincidence.
3. *"Actions stalled repo-wide."* Half right — creation genuinely stalled between
   16:49 and 17:04 — but that explained only some of the failures, and I nearly
   accepted it for all of them.

The lesson worth keeping is the shape of the mistake rather than the specific
wrong answers: each time I accepted a signal that *correlated* with what I cared
about instead of one that *was* it. `yaml.safe_load` parsing for "GitHub accepts
this file". Two coincidental timings for causation. Any workflow run — including
cron-triggered ones — for "`pull_request` runs are being created". Check the
thing itself.


## AUDIT: SIX ROUNDS, AND WHAT THEY KEPT FINDING (2026-08-19)

Six discovery rounds over the whole repository. Every defect found in rounds 1-4
had the same shape, and naming it is more useful than the individual fixes:

**One rule, implemented twice, drifted apart.**

| Where | The two copies | What drifted |
| --- | --- | --- |
| `lib/graph/scheduler.ts` | `tick()` against its own doc comment | BLOCKED propagated one hop, so a failure deeper than one edge left a subtree PENDING forever and reported the graph `stalled` |
| `lib/graph/verification.ts` | `SPECIALIZED_LENSES` against every other strategy | `warnPasses` ignored, so a WARN cleared the quorum on the one strategy carrying a required security lens |
| `AI/CURRENT_STATE.md` | Two paragraphs of one file | Hosted backlog stated as 29 and 15; it was 9 |
| `lib/worker/redact.ts` vs `lib/server/sensitive-data.ts` | Two secret detectors | Worker missed AWS and Stripe keys — and the worker's is what gates whether a bot may commit a file |
| `lib/bots/credentials.ts` vs the `bots` CHECK | ADR-036's "rejected by both" | Five of fourteen privileged names missing from the constraint, reachable by calling `register_bot` directly through PostgREST |
| `lib/autonomy/diff-risk.ts` | Its own rules against each other | `no force row level security`, `grant … to anon`, and `disable trigger …_append_only` scored YELLOW while their siblings scored RED |

Rounds 5 and 6 were clean, which is the convergence condition.

### If you are auditing this repository, start here

Grep sweeps produced almost nothing but false positives — 51, then 28, then 10
"unguarded" API routes, all of which used a helper the pattern missed, and 22
tables "missing FORCE RLS" that get it through a `format()`/`execute` loop.
Every real defect came from **reading a module and comparing it to its second
copy**. `tests/unit/secret-detector-parity.test.ts`,
`tests/integration/secret-detector-sql-parity.behavior.test.ts` and
`tests/unit/bot-credential-denylist-parity.test.ts` now pin three of those pairs
so they cannot drift again.

One near-miss worth repeating: `public.text_has_likely_secret` is defined by
three migrations, and the **first** is missing a pattern the **third** adds.
Reading the earliest definition would have produced a confident report of a gap
closed months earlier. Take the last definition.

### Checked and sound — do not spend a round re-deriving these

Route authorization (every route uses a shared guard); RLS **and** FORCE RLS on
every public table; no SECURITY DEFINER function missing `set search_path`; the
only function granted to `anon` is the public newsletter signup;
`read_provider_credential` is service-role-only and returns ciphertext useless
without a key held outside the database; `npm audit` clean; no `.only`, empty
catch, floating promise, `console.log`, TODO/FIXME, stub return or duplicate
migration prefix in production code; 61 SQL enums compared against their
TypeScript counterparts with no drift (risk level differs by case only, via the
named `toDatabaseRiskLevel` converter).

### Still open, and owner-gated

- **ADR-036 blocks bot execution.** The bot fabric is deliberately a registry:
  `bot_id` appears in zero execution code paths, and connecting one "would
  require separate owner-approved activation". Wiring bots to runs is a decision
  plus a new ADR, not an audit fix.
- Codex quota, the GitHub App install on `bubalysupport-prog`, and recording a
  graph through `/solutions/workflows` are unchanged owner actions.


## RESPONSIVE + NAVIGATION: WHERE THIS LANDED (2026-08-18)

Coverage is now derived rather than asserted, which is the part that had been
missing every time this was called incomplete.

`tests/integration/responsive-coverage.contract.test.ts` computes two claims:
every `page.tsx` under `app/` is in a width sweep, and every component under
`components/` is reachable from something that measures it. Reachability is
transitive, so a component has to be *rendered* by a measured surface rather
than listed — adding a page or a component without coverage fails the build.

`tests/harness/` mounts 35 real component surfaces in a real browser at
320/375/390/430/768/1024/1280/1440, because the console resolves its tenant on
the server and the route sweep only ever reaches the "not configured" gate.
`tests/integration/supabase-wiring.contract.test.ts` traces all 109 API routes
to the Supabase boundary and refuses seeded records.

### Defects this found, all of which had reached production

- A bare `grid` cannot shrink: its implicit column is `auto`, minimum
  min-content. 37 files; one long project name made a console 498px wide
  inside 320px.
- `w-full` does not stop a form control widening its parent — a select's
  min-content is its widest option. Fixed once on the `.input` token.
- Six copies of a date formatter, none guarding an unparseable value.
  `Intl.format(new Date(bad))` throws, and a throw in render blanks the page.
  Now one safe formatter in `lib/format/date.ts`.
- Button rows that did not wrap: Disconnect on an account, Cancel in two
  forms — you could open a form and not get out of it on a phone.
- `truncate` on a flex row rather than its text, clipping the control beside it.

### The navigation, against the owner's reference

Carried from it: the nine top-level destinations in the reference's order,
the mark at the top left aligned with the menu, one highlighted row per group
with its chevron inside, New Project as a button, and the closing card.

**Secrets** was absent on the grounds that nothing backed it. That stopped
being true when the provider credential vault landed
(`20260814002500`/`002600`); it now points at `settings#providers`, where
credentials are actually connected and rotated.

**Watch and Advanced** are kept although the reference does not show them.
They hold Operations, Activity, Files, Agents, Resources, AgentOS and
Autonomy — all real pages. Matching the image exactly would delete the only
route to them, and "do not remove functionality" is not a rule the picture
overrides. Pinned by a test so it reads as a decision rather than drift.

### The two production blockers

**Eight `href: "#"` marketing links — fixed.** Each resource now has a page at
`/resources/<slug>` showing what the library holds and saying plainly that the
piece itself is not written yet. Inventing an article to fill the page would
have been worse than the dead link. Unknown slugs 404 rather than rendering an
empty body with a 200, which is what `dynamicParams = false` is for.

**Unhosted migrations — measured, and smaller and stranger than stated.**
This entry previously ended "the assign wizard's configuration fields have no
columns on production." That is false, and the correction matters more than
the entry did.

Probe run `32103778884` (`scope=probe`, read-only — the three apply steps were
skipped and the log shows it) printed the hosted ledger. It is **not a
contiguous prefix** of the local files, which is the premise every earlier
count rested on. Nineteen versions are missing from the middle
(`20260814002500`–`002600`, most of `20260815`, `20260816000100`–`000300`),
while every row of the `20260817` range sits above them — including
`20260817000700_bot_assignment_configuration`. **The assign wizard's
configuration columns and `assign_bots_to_project` are live on production.**

And the ledger still understates the schema: the same run's object probe
returned 19 of 19 present, among them `scheduling_decisions`,
`provider_capacity_limits` and `projects.engineering_priority` — all owned by
`20260815000200`, which has no ledger row. So part of the remaining gap is
bookkeeping over DDL that already ran, and the fix there is
`migration repair --status applied <version>`, not re-running the file.

Which of the nineteen are which is now answerable in one read-only run: the
probe names the marker object each of them introduces and prints a `present`
boolean per version, so a genuinely missing object shows as `f` instead of
being invisible. `AI/HOSTED_APPLY_RUNBOOK.md` carries the table and the
repair-versus-apply procedure, and a guard test keeps the runbook's list, the
workflow's probe and the migration directory in agreement.

**Not run: the mutating scopes.** `AGENTS.md` puts RED actions behind explicit
owner approval in Phase 1 and the runbook requires a fresh exact approval per
apply, so `scope=all` / `broker-functions` / `project-controls` remain an owner
decision. Only the probe was run. What is already proven about the set is that
it applies: every integration test execs all 109 migration files in order
against real PostgreSQL.

---

## GRAPH-ENGINEERED EXECUTION: THE PLANNED-GRAPH DEAD END IS WIRED (2026-08-19)

Owner goal: transform linear/queue-based execution into a graph-engineered
system. Audit first — the map before the change:

  UI (pipelines Templates → Use) → POST /api/graphs → create_graph_from_plan
  → graphs/graph_nodes/graph_edges/node_contracts/graph_budgets … DEAD END
  (every graph stayed PLANNED). Engine (lib/graph, 26 modules: compiler,
  scheduler, runner, fan-in, budgets, provider-bridge, verification) complete
  and live-proven by the Phase 2B canary — three parallel Claude nodes +
  synthesis + fresh-context verifier over the subscription credential — but
  the canary builds its graph in code and persists nothing. The DB run
  lifecycle (start_graph_run/record_node_state/complete_graph_run) is
  member-gated on auth.uid(), unreachable from a service-role worker. The
  Phase 1C worker executes COMMANDS linearly and knows nothing of graphs.

The missing wire, built by extension (no duplicate systems):

- Migration `20260819000100_graph_worker_execution`: the worker-facing half
  of the write boundary, service_role-only, Phase 1C-style —
  `claim_planned_graph` (atomic: FOR UPDATE SKIP LOCKED oldest unrun
  non-approval-gated graph → RUNNING run + PENDING node_runs + event +
  complete jsonb projection of nodes/contracts/edges/budget in ONE call),
  `record_node_state_as_worker`, `record_graph_artifact_as_worker`,
  `complete_graph_run_as_worker`. Same truth rules as the member half:
  terminal states final, partial input can never read COMPLETED.
- `lib/worker/graph-run.ts` (pure): parse the claim → recompile through the
  SAME compiler the console previews with (dependsOn recovered from stored
  edges — an edge exists only because downstream consumes upstream) →
  runGraph with injected executor + injected store; blocked/pending nodes
  closed SKIPPED after the run so every node is accounted for.
- `lib/worker/graph-store.ts`: the four RPCs over service-role supabase-js.
- `lib/worker/claude-node-executor.ts`: one bounded job per node through
  executeClaudeThroughCli (the canary's proven subscription path), read-only
  tools, model tiered by node (ECONOMY→haiku, extraction→sonnet, else opus).
  File-writing nodes stay with Phase 1C's isolation discipline — stated, not
  hidden.
- `scripts/graph-worker.mts` (--once/--drain/loop) +
  `.github/workflows/graph-worker.yml` (manual dispatch; schedule gated on
  SOFTWAREFACTORY_GRAPH_WORKER_SCHEDULED; subscription credential; no API
  key can leak in).

Verified against the real migrated schema
(tests/integration/graph-worker-execution.behavior.test.ts, 6 tests):
atomic claim with whole projection + second-claimer-finds-nothing +
approval-gated graphs wait; the diamond executes with MEASURED parallel
fan-out (maxInFlight >= 3) and synthesis last; real RPC persistence (node_runs
all COMPLETED, run COMPLETED, 4 RAW artifacts); one failed inspector is
CONTAINED (siblings COMPLETED, dependent SKIPPED, run PARTIAL with
had_partial_input); terminal protection on nodes and runs; bounded re-claim
(a failed-only graph is claimable again with a fresh run, capped at three
total runs; answered graphs never re-enter the queue). Templates-manager
copy updated to name the executor honestly.

Driven against production: migration applied (run 32208528984), first
worker dispatches claimed both real graphs and closed them honestly FAILED
— run 32208699123 died at import (server-only marker → shim, PR #237),
run 32208975669 dispatched all nodes in parallel but the CLI was missing
(install pinned + node-failure logging, PR #238). The convergence gap that
left those graphs dead — only never-run graphs were claimable — is closed
by PR #239: failed-only graphs re-enter the queue for at most three total
runs, so an infrastructure fix makes the next dispatch execute them for
real instead of a person re-planning.

Round 3, from worker run 32209893742 (the re-claim's own production proof:
both graphs re-claimed to their caps, every node failing on a REAL provider
answer — "You've hit your session limit · resets 7:30am (UTC)"):

- Edges now carry data in the worker path. `runClaimedGraph` hands each
  node its upstreams' actual outputs plus an explicit missing list, and the
  executor folds them into the prompt (bounded, labeled truncation; missing
  inputs demand stated incompleteness). Before this, a synthesis node ran
  blind — the exact silent-quality failure the goal bans.
- Capacity refusals are classified, not spent. A session/rate-limit failure
  is non-retryable within the run (`isCapacityRefusal`), a run in which
  nothing succeeded and every failure was a refusal closes CANCELLED (void,
  with an honest detail), and the drain STOPS instead of burning the queue
  against an exhausted credential. `claim_planned_graph` treats CANCELLED
  as retryable-but-uncounted: the three-attempt convergence bound counts
  only FAILED runs, under a hard total-run ceiling of 10.
- A non-retryable node failure is recorded FAILED at once (previously a
  node with attempts remaining could strand its node_run RUNNING forever),
  and `complete_graph_run_as_worker` refuses non-terminal "closures".
- `20260819000200_replant_exhausted_graph` re-plants ONE copy (fixed id,
  replays no-op forever) of the owner's first-day readiness graph, whose
  three chances were all consumed by infrastructure faults now fixed —
  so the capacity-aware worker has something real to claim after the
  session limit resets at 7:30am UTC.

Round 3 production verification (worker run 32211229999): the re-planted
graph was claimed, every session-limit refusal was classified (one attempt
per node, not two), the run closed CANCELLED with the honest detail, and
the drain stopped with "graphs keep their chances for a dispatch the
provider will fuel". The graph holds 0 FAILED / 1 CANCELLED of 10. A
send_later check-in at 07:40 UTC dispatches the worker after the reset.

Round 4 — tolerant fan-in (goal rule 14, the last engine-rule gap):

- `NodeContract.toleratesPartialInputs` (opt-in): the scheduler readies a
  tolerant fan-in once every dependency has SETTLED (terminal or blocked)
  with at least one COMPLETED input, instead of blocking on the first
  failure — the surviving branches' work is synthesized, stated as
  partial. A tolerant node with zero completed inputs is still blocked:
  a synthesis with no inputs would be invented, not synthesised. Run-level
  honesty unchanged: the run still closes PARTIAL when any input failed.
- Migration `20260819000300_tolerant_fan_in`: guarded graph_nodes column +
  create_graph_from_plan persists it; claim projection (20260819000100)
  carries it; worker treats absence as false.
- Templates: aggregating capabilities (extraction/synthesis/reporting)
  with dependencies default to tolerant; implementation/QA/review keep the
  strict rule. Explicit per-node override available.
- Truthfulness: POST /api/graphs' "no executor is connected" note predated
  the worker and is corrected.
- Tests: scheduler tolerance triple (runs with what completed / waits for
  in-flight / blocks on nothing-completed), tolerant-diamond behavior test
  through the real chain (synthesize COMPLETED with missing list, run
  PARTIAL), full graph suite 10/10, all 12 tail-pin chain suites green on
  the 114-migration chain. Applied to production by run 32212056032.

Round 4b — executors dispatch by declaration, not by assumption:

- The worker sent EVERY node to the CLI, DETERMINISTIC (model tier NONE)
  included — the first-day template's reduce node would have spent a
  subscription turn on work code does perfectly. `executeDeterministicNode`
  routes reduce nodes through the engine's own reducers (dedupe first
  occurrence wins, severity-ranked, stable), with honesty in-band:
  malformed rows counted, unreducible inputs named, missing inputs listed.
  A DETERMINISTIC node with nothing reducible fails plainly and without
  retry (deterministic means deterministic). ANCHOR nodes (test runs,
  probes) fail with the reason they need the Phase 1C workspace path —
  never quietly routed to a model.
- Deferred deliberately: output-schema enforcement (validateOutput +
  transport outputFormat) waits until the first real production run proves
  live output shapes, then tightens; enforcing now could fail the first
  live nodes on a shape the prompt merely suggests.

Round 5 — graph runs become visible (nothing read graph_runs/node_runs/
graph_artifacts; results landed in tables no human saw):

- Migration `20260819000400_list_graph_runs`: member-facing definer read
  (membership-checked, authenticated only, service_role revoked) returning
  each run with per-node truth (state/provider/model/latency/error
  verbatim) and artifact counts. Also widens node_runs' provider check to
  admit 'deterministic' — caught before production: the old check would
  have failed the first deterministic COMPLETED record.
- GET /api/graphs/runs (no derivation) + a "Graph runs" view on the
  pipelines console: state-badged rows, expandable per-node tables,
  incompleteness stated when the database says so, empty state naming the
  next step. The Use-template dialog's success line now links straight to
  it. PRs #243 (executor dispatch), #244 (visibility).
- Known limitation recorded: a stored DISCOVERY_GRAPH executes as its
  recorded DAG — the worker does not add rounds mid-run; bounded discovery
  stays engine-side (canary-proven) until stored-graph discovery is a
  designed increment.

THE COMPLETE RUN (2026-08-19 23:01Z) — drain 32310917147, graph run
1df3fd45-5501-4912-81f8-26448b865af3: **COMPLETED, 7 succeeded, 0 failed**,
6m26s wall. Five MODEL inspectors in parallel through the subscription CLI,
the deterministic reduce, the report synthesis — dispatched alone in the
fresh 22:50Z window exactly as 20260819001200 planned, zero API tokens. No
graph-execution claim is withheld any longer.

Rounds 14-16 — each found and fixed one defect (none clean):

- Round 14: ARCHITECTURE/CURRENT_STATE still described the one-argument
  claim; aligned with the shipped five-function boundary. (#274)
- Round 15: four workflows — three of them credential-bearing — ran actions
  off floating v4 tags; pinned to the reviewed SHAs, guarded by
  workflow-action-pins.test.ts. (#275)
- Round 16: three workflows installed the Claude CLI unpinned; pinned to the
  one version everywhere, guard extended. (#276) (The same evening also
  produced ADR-095 — usage is a property of the connection — and the CI
  install-retry fix #279, both from measured evidence.)

Round 17 — CLEAN. Checked: the complete-run drain log (no node errors, no
stderr, queue empty at exit); CI green on the last four main tips with the
sharded suite and cleaned retry; the ADR-095 observation is the newest usage
row and the only one in four hours (memo working); harness route-matching
audit (specific-before-generic holds); no uncommitted drift beyond the
evidence records themselves.

Round 18 — CLEAN. Checked: repository gates on the tip (CI quality job =
lint, typecheck, 3400+ vitest, build; three browser shards green); secrets
scan of the day's full diff (fixture tokens only); zero-token rule intact
(no ANTHROPIC_API_KEY in any worker env); RPC drift (all called functions
defined; contract suite green in CI); migration ledger reconciled through
20260819001200 with the version-uniqueness and replay-drop guards standing.

Two consecutive clean rounds: the /loop's stop criterion is met.

## Final output — graph-engineered multi-agent execution (goal closed 2026-08-19)

**Topology.** Recorded graphs (nodes = bounded jobs, edges = data) compile
through one compiler shared by console preview and worker execution.
Executors: MODEL (subscription CLI, tiered models, read-only tools),
DETERMINISTIC (engine reducers, no model turn), ANCHOR (workspace lane —
deliberately not claimable by the analysis worker, stated on template
cards). Independent nodes run concurrently (measured max parallelism 5);
fan-ins declare partial-input tolerance; verification lenses record
verdicts per subject with evidence. Convergence: ≤3 FAILED runs, ≤10 total,
capacity refusals void (CANCELLED), stale-worker reclaim after 2h silence.

**Changes.** ~45 PRs merged today alone (#236-#280 span): the worker
boundary (5 SECURITY DEFINER functions), executor-capability claiming,
tolerant fan-ins, verification recording + console visibility, data-carrying
edges, budget/timeout/turn envelopes pinned by tests after every guessed
number failed in production, CI verdict integrity + 3-way sharding + install
retries, workflow action/CLI pinning, the Bot Manager usage truth chain
(ADR-094/095), and three fixed-id re-plants ending in the complete run.

**Tests.** 3,400+ vitest (unit+integration incl. PGlite full-chain behavior
suites), 1,605 Playwright checks across three viewports, all green on main.

**Verified E2E flows (production, zero API tokens).** (1) Plan → claim →
parallel inspectors → reduce → synthesis → COMPLETED 7/7 (run 1df3fd45).
(2) Tolerant-fan-in PARTIAL with named gaps (ca347ab9, 4d3f44a7). (3)
Capacity-refusal voiding (4cd11dc4). (4) Live canary: fan-out + synthesis +
fresh-context verification (32283945714). (5) Member visibility:
list_graph_runs/verifications on the Pipelines console.

**Remaining blockers (external).** Usage bars need a fuller-scoped
interactive OAuth flow (provider declines setup-token scope — ADR-095,
backlog). ANCHOR nodes await a workspace-capable worker. Scheduled draining
stays owner-gated (SOFTWAREFACTORY_GRAPH_WORKER_SCHEDULED).

**Production-readiness evidence.** Ledger reconciled through
20260819001200; every apply/probe run cited in AI/HOSTED_APPLY_RUNBOOK.md;
RLS + definer-function boundary pinned by schema-security-invariants; CI
required checks wired to the worker's gate by test; honest terminal states
(COMPLETED/PARTIAL/FAILED/CANCELLED) proven live in all four forms.

Rounds 12-13 — the day's cadence audited itself, and the owner's page told the truth again:

- **Main's CI verdict was `cancelled`, not `success`, for most of the day.**
  The concurrency group keyed pushes by `github.ref` — identical for every
  commit on main — with cancel-in-progress true, so each merge killed the
  verification of the merge before it (runs 32272713212, 32216103242).
  Pushes now get a per-commit group and are never pre-empted; PR refs keep
  the supersede. Two guards pin the shape, not the spelling. (#267)
- **The probe asked the constraint itself**: scope=probe now queries
  pg_constraint directly for bots_credential_ref_not_privileged, because the
  20260819000700 ledger row proves nothing. Measured verdict:
  covers_all_five_added = t — the ADR-036 parity fix is genuinely live. (#266)
- **The worker claimed graphs it structurally cannot run.** feature_build
  and the incident template carry ANCHOR nodes (run the tests, attempt the
  reproduction); the analysis worker failed them after claiming, blocking
  everything downstream and spending one of three chances saying what was
  knowable pre-claim. claim_planned_graph now takes the caller's declared
  executors (required, no default; empty set raises) and skips unrunnable
  graphs — they stay PLANNED, budget intact. The template cards say so
  before a person records such a graph. ADR-093. (#269, #272)
- The guard that reviewed that change was itself blind: the RPC-contract
  parser split argument objects on commas without stripping comments, so a
  comma in comment prose hid the key that followed — a false "omits the
  argument" one way and a hidden misspelled key the other. String-aware
  stripping now. (#269)
- **The browser suite outgrew its ceiling mid-day** — killed at 1582/1605,
  forty seconds from green. Sharded 3x535 (verified with --list) instead of
  raising the ceiling a third time; required checks, merge-readiness
  fixtures, and a matrix-expanding guard all move together, plus a guard
  pinning the --shard denominator to the matrix length. First sharded run
  then found the NEXT weak joint: two shards hung 19 minutes in apt-get
  update inside playwright install. The install step is now bounded per
  attempt (timeout 240, 3 tries) with its own ceiling. (#270, #272)
- **Owner report: amber "Usage unavailable … HTTP 429" beside a green
  Connected badge.** Four layers each told a small truth composing into a
  lie: the probe recorded a bare status code; the projection returned only
  the newest observation, erasing the last real numbers; the component
  painted every non-measured row amber; and the broker's push trigger
  multiplied startup probes by the day's merge cadence — the probable cause
  of the 429 itself. Fixed at every layer: bounded Retry-After retry +
  truthful 429 wording; migration 20260819001100 carries the latest measured
  observation alongside the latest one; the console keeps real numbers on
  screen under their own timestamp and renders probe failures as muted
  information (account health is the badge's statement); push-handover runs
  skip the startup probe. Applied to production in run 32279867500.
  ADR-094. (#271)

Rounds 9-11 — what checking the WHOLE found that checking the parts did not:

- Verification gates were schema-and-engine only. graph_verifications,
  record_verification, independence and quorum all existed; the executed
  path used none of it, so a reviewing node's verdict was filed as an
  ordinary artifact. record_verification_as_worker now records verdict,
  lens, evidence and shared-context per subject (derived from the answer
  already given — never a second call), list_graph_runs returns them, and
  the panel shows them. Unreadable output yields NO verdict: absence of
  evidence is not evidence of passing. (#260, #261)
- The panel crashed the whole view on a payload without `verifications` —
  which is what an older deployment or a partial rollout serves. Every
  list it reads now tolerates absence, with a test rendering a
  pre-verification payload. (#261)
- Six engine modules have no production caller (discovery, handoffs,
  integration, optimizer, connection-bridge, anchor-store). Not dead code —
  unwired capability. ARCHITECTURE now separates what executes from what
  merely exists, and the one a user can see (a DISCOVERY_GRAPH template
  promising rounds the executor does not run) says so on the template
  itself. (#262)
- **Running the full suite instead of the touched parts found a version
  collision**: 20260819000700 was claimed by an ADR-036 security fix at
  09:18Z and again by my verification boundary. 97 tests red — but the
  quiet half was worse: both applies had run `repair 20260819000700`, so
  production recorded the version while the constraint it named had never
  run, and a later scope=all would have skipped it forever. Renumbered to
  000900, the security fix added to the apply list, the ledger row
  documented as untrustworthy, and a guard added so no two migrations can
  share a version again. (#264)
- **The replayed apply was idempotent per file but not as a sequence**:
  000800 widens list_graph_runs, so replaying 000400 tried to narrow it and
  Postgres refused — aborting the run before the same security fix, twice in
  one afternoon. 000400 now drops first, and a guard requires a guarded drop
  wherever two replayed migrations define one function. (#265)

Round 8 — THE FULL CHAIN EXECUTED IN PRODUCTION (drain 32254860997,
graph run ca347ab9-5e4c-4f9b-a60a-cd357c5696bb):

- **PARTIAL: 3 succeeded, 4 failed — and no node "never reported".** Every
  previous drain listed reduce and report as never dispatched. This one ran
  them: the rollback inspector completed through the CLI, the DETERMINISTIC
  reduce folded its findings in code (no model turn spent), and the report
  synthesis completed from the reduce output carried in its prompt. That is
  fan-out → parallel model execution → deterministic reduction → synthesis,
  end to end, on production data, with the incompleteness stated.
- The tolerant fan-in is what made it possible: four inspectors failed, and
  under the old strict rule reduce and report would have been SKIPPED and
  the surviving inspector's work thrown away. Instead the graph produced a
  real report that says exactly which four inputs are missing.
- Root cause of the four failures, found by reading the log rather than
  guessing: "Reached maximum number of turns (8)" — while the executor
  declared 24. `MAX_TURNS_CEILING = 8` in the transport was **silently
  clamping** the declared budget, so round 7's fix looked correct and
  changed nothing. Ceiling raised to the measured 24, and the two numbers
  are now pinned against each other by a test (a declared budget quietly
  discarded is a change that looks made and is not).
- Also fixed this round: artifacts were all labelled RAW, discarding the
  schema's RAW/REDUCED/SYNTHESIS/ANCHOR distinction exactly where a
  reviewer needs it. `artifactKindForNode` labels by declaration.

Round 7 — the first real production node success, and the turn ceiling
(worker run 32228988434, post-reset live proof):

- Graph run e51c57a5: **the rollback inspector genuinely completed through
  the CLI in production** — 1 of 7 contributed, RAW artifact recorded, run
  closed PARTIAL (an answer; the graph retired honestly). The re-claim loop
  also proved itself live: claim → all-turn-limit FAILED (counted, 1 of 3)
  → immediate re-claim → the partial success.
- Every other failure was "Reached maximum number of turns (8)" — the
  executor's ceiling, not the work. Fixed by measurement: 24 turns, and
  MODEL template nodes now carry an eight-minute timeout instead of the
  three-minute default that boxed the old ceiling in.
- buildLaunchPlan never passed timeout_ms/max_attempts — every planned
  graph silently got database defaults regardless of contract. The payload
  now carries the compiled envelope, pinned by a launch-plan test.
- `20260819000500_replant_with_room_to_work`: one final fixed-id copy of
  the first-day graph, planned with the measured envelope, for the next
  dispatch to drive to a full COMPLETED. CI on main also went fully green
  (run 32216103242, 1605 browser tests) after PR #248 raised the outgrown
  e2e ceiling.

Round 6 — durability and accounting (PR #246):

- Dead workers no longer strand graphs. claim_planned_graph sweeps
  abandonment before claiming: a RUNNING run silent for over two hours
  (run row AND every node row; the worker's own ceiling is one hour)
  closes FAILED with a reclaim event, unfinished nodes close CANCELLED
  with the reason on the row, and the graph re-enters the convergence
  rules. Concurrency-safe; a genuinely live run is untouched (tested).
- Token usage reaches the budget: the transport's inputTokens/outputTokens
  now travel on each success, the runner sums them, and the run closure
  records tokens_used — so max_tokens has something real to bind against.
  Cost stays unstated: the subscription is not per-token billed, and an
  invented price would be budgeted against.

Remaining blockers requiring external services/credentials: executing real
nodes needs the graph-worker workflow dispatched (or its schedule variable
set) with the existing subscription secret; file-WRITING graph nodes are
future work through the Phase 1C workspace path.

## AGENTS SELECTABILITY, REDONE SERVER-SIDE AND PROVEN (2026-08-18 23:5xZ)

The owner reported the first round incomplete. The button-dependent seed was
the weakness: selection still hinged on a person finding the control and
eight client requests all succeeding. Redone decisively: migration
`20260818000200_seed_standard_model_catalogue` seeds the eight standard
models per organization server-side (attributed to the earliest
owner/admin, ON CONFLICT DO NOTHING — replay-safe and coexists with
console-seeded rows). Applied to production by run 32199155823; probe run
32199285229 then measured the live database: **both organizations hold 8
enabled model configurations (11 and 12 agents), and
`set_agent_provider_assignment` as the impersonated owner succeeded —
anthropic / claude-fable-5 (rolled back)**. Every select on
/solutions/agents now offers the real models with zero setup, and each
choice persists to Supabase. Behavior test applies the chain, re-runs the
seed file against a later-created org (the hosted re-apply shape), asserts
8 enabled rows, replay no-op, and a successful assignment. PR #233.

## AGENTS PAGE: EVERY AGENT SELECTABLE (2026-08-18, second session)

The owner's goal: make any or all agents selectable at /solutions/agents.
The whole selection chain already existed and was Supabase-wired end to end —
per-agent select → POST /api/agents/[id]/assignment →
`set_agent_provider_assignment` (owner/admin, activity-evented, hosted since
the 20260813 range) — but the RPC only accepts **enabled catalogue
configurations** (`provider_model_configurations`), and a fresh organization
has an empty catalogue. So every select offered exactly one row, "Automatic
routing", and the way out lived unexplained on the settings page.

Fix, no migration needed: `lib/providers/standard-catalogue.ts` derives the
standard model list from the bot catalog's per-provider suggested models
(one source of truth; display names spelled where the schema demands one),
and the Agents page's assignment boundary now offers **Enable the standard
model catalogue** exactly when the catalogue has no enabled models and the
viewer can manage — one click seeds all 8 through the same
`/api/providers/models` upsert the settings page uses (idempotent), reloads,
and every agent's select becomes a real choice persisted to Supabase.
Refusals are counted and named, never celebrated. Boundary copy names the
dead end when it exists. 1 new unit test (provider-surfaces: 11) walking
empty catalogue → seed → 8 upserts → options present. Also fixed
bot-connect-key-route's client mock, which still modelled the pre-#228
two-eq read chain.

## CREATE BOT MADE NOTHING, SAID NOTHING — FIXED (2026-08-18, second session)

The owner finished the connect flow, the success screen said Ready, Create My
First Bot was clicked — zero bots, zero words. Probe run 32192344287 proves
`register_bot` itself works on production (created as the impersonated owner,
rolled back; the org holds 0 bot rows), so the failure lived entirely in the
layers above it, each of which ate part of the truth:

1. `/api/bots/connect/provision` answers 200 for "made one", "already had
   one", AND "the database refused" (ensureProviderBot swallows every error
   into `skipped` — by design, so auto-provision never fails a connection).
   Every caller checked only `response.ok` and celebrated. Now the skip's
   reason travels (the database's own sentence for vetted codes), and every
   caller — provisionBot, createBotsForAccounts, addSelectionToProject, the
   fabric console's connect finish, the assign wizard's linking — treats an
   unprovisioned answer as the failure it is.
2. Bot names are unique per ORGANIZATION; the auto-name was numbered by a
   per-PROVIDER count, so deletions/renames/cross-provider squats made
   "Label N" collide (23505 → silent 200). Names are now picked from the
   names actually taken.
3. `botNotice` rendered only inside modal stages; the selection bar's flows
   run with none open, so even a carried reason had nowhere to appear. A
   page-level role=status line now renders under the accounts panel.

PR #228, merged ed19a61, live on production (~15s). Tests: bot-provisioning
10 (free-name + vetted-sentence), bot-manager-home 21 (skipped-200 shows its
sentence).

## REMOVE AND RECONNECT: ROOT CAUSES MEASURED AND FIXED (2026-08-18, second session)

**Remove.** The re-aimed probe (run 32188102707) impersonated the real owner of
the organization that actually holds the accounts and got the answer no
catalogue query could: `can_manage_organization: t`, then
`remove_ai_account as owner: 42501 usage observations are append-only`. The
account delete cascades into `ai_account_usage_observations` (FK `on delete
cascade` from 20260816001500), and that table's own append-only trigger
refuses the cascaded delete. The two declarations contradict each other; every
account with recorded usage — every real account within minutes — was
unremovable. Fix: migration `20260818000100_removable_accounts_keep_usage_evidence`
drops the cascade and keeps the trigger; usage evidence is history and now
survives removal, like activity events. The removal integration test gained
the missing state (an account WITH usage rows) — triggers fire for superusers
too, so PGlite reproduces the hosted 42501 exactly without the fix.

**Reconnect.** The broker log (run 32183453093) shows session after session
ending `status=connected` — reconnect always worked. What made it LOOK broken:
the usage sweep treats 403 from Anthropic's usage endpoint as
`credentialRejected` and demotes the account, so every successful reconnect
bounced straight back to "Needs sign-in again" on the next sweep. 403 is the
provider declining THAT ENDPOINT for a credential it authenticated (scope,
plan, gating); dead credentials answer 401. Fix in `lib/worker/usage-probe.ts`:
only 401 demotes; 403 records "The provider declined the usage probe (HTTP
403); usage stays unknown, and the sign-in itself is unaffected." After one
more reconnect per demoted account, they go green and stay green.

Follow-up noted, not done: a needs_reauth account's Refresh marker can only
expire (mark_ai_account_verified touches connected rows only), so the panel
shows "the refresh has not completed yet" for a sweep that did complete —
cosmetic once the demote loop is gone.

## "THE ACCOUNT COULD NOT BE REMOVED. (42501)" (2026-08-18)

A SQLSTATE and no words. `42501` is `insufficient_privilege`, and it covers two
completely different problems: an authorization refusal, whose message is a
sentence this repository wrote — "owner or admin role is required to remove an
AI account" — and a missing privilege on a table, which names the table.
Telling them apart is the entire diagnosis, and the route was discarding the
only thing that could.

**Every mutation in this section did the same.** Remove, Disconnect, the
session read and its cancel all answered with a house sentence and, at best, a
bare code. They now go through `databaseErrorResponse`, which is the shared
policy and already the right one: it passes the database's own message for the
codes it has vetted as client-safe (`22023`, `23502`, `23514`, `42501`,
`40001`, `55000`, `P0002`) and stays generic for everything else — so an
unrecognised fault still says nothing, which is what the original caution was
actually about. Rename keeps its one friendly translation, because `23505` is
*not* on that list and a raw unique-violation names a constraint.

**The function itself is correct.** `remove_ai_account` was exercised against
the real migrated schema in the four states production actually holds, and all
four pass: a disconnected account whose credential is already gone, a second
removal of something already removed (answers false rather than raising), a
member (42501 with that sentence), and an outsider's organization id. Only the
happy path had been covered, so the state most likely to be removed was
untested.

So the hosted failure is not the logic — it is a privilege difference on that
database. A `SECURITY DEFINER` function runs as its owner, and if the function
and the tables it writes were applied by different roles, the function can lack
privileges on them. The `scope=probe` step now prints the owner of every
function and table in this section, whether each function is definer, and
whether `authenticated` may execute it; every function should share one owner
with every table. With the route fixed, the next attempt also names the cause
on screen instead of "(42501)".

### The rest of the section, audited

`tests/integration/bots-section-wiring.contract.test.ts` extracts every
`/api/...` path the five Bots components call — thirty of them — and resolves
each against the route files on disk, matching `${...}` segments to `[param]`
directories the way Next does. A path typed into a template literal has no
compiler behind it: rename a segment and the button still renders, still
clicks, and answers 404, which the console reports as the generic failure for
whatever it was trying to do. Renaming one path to a route that does not exist
fails the test and names it.

---

## THE CONSOLE WAS ENFORCING A RULE THE SERVER DOES NOT HAVE (2026-08-18)

The owner's screenshot is the whole bug report: four accounts, three of which
had refused their stored credential with HTTP 403, one disconnected, and no
bots. The bar read "2 selected · 0 can create a bot", the button read "None can
create a bot", the team section was empty so there was nothing else to select,
and **Add Bots never appeared**. The journey simply stopped.

It stopped on a rule the console invented. A bot's readiness is resolved by
`evaluateBotReadiness`, which asks whether the **credential resolves on the
server** and nothing else — the same test `POST /api/projects/:id/bots` applies
before assigning. And `mark_ai_account_needs_reauth` writes only `status` and
`last_error`; it does not touch the vault. So an account whose last
verification came back 403 still holds its credential, and a bot referencing
that slot is `ready` by the server's own definition. The console was refusing
to offer what the server would have accepted.

`lib/bots/accounts.ts` now holds the rule in one place: an account can back a
bot when it is `connected` **or** `needs_reauth`; `pending`, `disconnected` and
`revoked` cannot, because those have no credential material — and an unknown
status is treated as unusable rather than guessed at.

Two facts that had been conflated are now separate, because they call for
different actions:

- **Cannot back a bot** — final until something changes, counted against the
  offer, and the reason named ("not signed in yet", "its credential was
  removed", "its credential was revoked").
- **Needs signing in again** — does not stop anything being created or
  assigned; it means the work waits. Said as its own line: "their bots are
  created and assigned, but will not run until you reconnect."

`bot-manager-stalled` is the screenshot as a harness case — four stale
accounts, no bots — and its browser check asserts the workspace has a way
forward from exactly that state. Reverting the rule to `connected` alone fails
one browser check and four unit tests.

### One more thing this explains

The intermittent single vitest failure in the combined gate was a live
`next dev` rewriting `.next/dev/types` while `tsc` read it. Next re-adds that
path to `tsconfig.json`'s `include` on every build, so it cannot be excluded —
the operational rule is simply not to run the typecheck while a dev server is
up.

---

## CONNECT BOTS FINISHES THE STEP IT IS PART OF (2026-08-18)

Inside the AI Factory, Connect Bots could only connect. The selection made
there had nowhere to go: finishing meant closing the overlay and starting the
assign step over from a project picker the page had already filled in.

The journey now hands the step its project, and the panel gains **Add Bots** —
one press for the whole chain:

1. every selected account that is connected but has no bot gets one,
2. the bots that appeared between two reads of `/api/bots` are identified by id
   — the provision endpoint answers "made one" or "already had one" rather than
   naming a row, and deriving an id from the account would be a guess that
   assigns the wrong bot,
3. those plus any directly selected bots land on the project in one atomic
   assign,
4. `onFinished` returns the caller to the journey.

The role the assignment requires is chosen in the same row rather than in a
second dialog, since the only thing the standalone dialog still had to ask for
was the project.

**Two labels that were lying.** "Create 0 bots" — a disabled button whose count
is zero reads as broken rather than as unavailable; it now names the reason.
And the bulk bar's "Add to project" at a selection of one was the same string
as every row's own button, two identical controls doing different things; the
bar always counts.

Selecting an account that needs signing in again deliberately does **not** count
towards the offer, so Add Bots never promises what the next request would
refuse — pinned by the browser check, which selects such an account first and
asserts the row stays absent.

---

## CONNECT BOTS, REDRAWN TO THE OWNER'S IMAGE, WITH ONE-OR-MANY SELECTION (2026-08-18)

**The account row is a column now, not one wrapping flex row.** The design puts
the name and its SELECT control on the first line, the account's own facts
under it, and the state badge at the head of the action row where it explains
the buttons beside it. As a single wrapping row the badge landed wherever the
name's length left it — on a narrow panel, between the name and the buttons it
describes.

**SELECT, and it means one or many.** Selecting is a set, not a radio: every
account row and every bot row carries the control, pressed state is
`aria-pressed` rather than colour alone, and a bar above the list states the
count with the action that applies to it.

- **Accounts → bots.** "Create N bots" provisions one bot per selected account,
  sequentially, because `ensureProviderBot` decides whether the organization
  already has a bot for a provider and four simultaneous requests would each
  read "none yet" before any of them wrote. A second account on the same
  provider passes `additional`, so it gets its own bot rather than being told
  one exists. Accounts that cannot back a bot are counted separately and named
  — "3 selected · 2 can create a bot, the rest need signing in again" — so the
  button's number is never a mystery.
- **Bots → a project.** "Add N to a project" sends the whole selection in one
  request, because `assign_bots_to_project` is atomic: together is the
  difference between "these five are on the project" and "three are, work out
  which two are not". The single-bot button stays for the common case.

The name lives in each control's `aria-label` rather than an `sr-only` span: a
hidden text node carrying the account's name puts that name in the accessible
tree twice, and in anything matching on text twice as well.

---

## CONNECT BOTS: WHY IT WAS UNUSABLE, AND THE ROUTE ONTO A PROJECT (2026-08-18)

**Create Bot offered to add a fifth account.** It called
`provisionBot(connectedAccounts[0].provider)` and, when nothing was connected,
silently fell through to the *add an account* chooser. The owner's screenshot
shows four accounts, every one of them needing to sign in again — so pressing
"Create Bot" opened "Add AI Account" and explained nothing. It now asks which
account should back the bot, lists only the ones that can, and when none can
says so with the number of accounts and where Reconnect is. With no account at
all it still offers the chooser, which is the right answer to a different
question.

**A bot on the roster had no way onto a project.** Assignment lived only in the
project page's wizard, so someone looking at their bots was told, in effect, to
start again from somewhere else. Each row now carries **Add to project**: pick
a project and a role, and it posts through the same
`POST /api/projects/:id/bots` the wizard uses — readiness resolved server-side,
least-privilege defaults, and the server's own refusal repeated rather than a
generic failure. Missing prerequisites are named (no projects, no roles) with a
link, instead of an empty dropdown beside a dead button.

**The tile stopped wrapping mid-phrase.** "0 of 4 Connected" broke across three
lines on a phone and doubled the card's height. The count is the value and
"Connected" is a line beneath it.

### What the harness had been hiding

`canManage` never reached it: `/api/ai-accounts` returned accounts and no
permission flag, so the Bot Manager rendered **read-only** in every layout
check. Add AI Account, Create Bot, rename, remove and the new Add to project
were all absent from the width sweep. Supplying the flag the route actually
returns turned three checks red immediately — the bot roster carried `truncate`
on the *row* rather than the name, so a long bot name pushed its rename and
remove buttons past the edge and the row clipped them: on the page and
unreachable at 320 and 375. The accounts panel had been fixed for exactly this
and carries a comment saying so; the roster copy had it the wrong way round,
and no test could see it while the fixture rendered the roster read-only.

---

## THREE WAYS A PLAYWRIGHT ACTION COULD HANG (2026-08-18, fixed)

Adding the sidebar collapse toggle turned 86 browser checks red, and none of
them were about the sidebar. Playwright's default `actionTimeout` is 0 —
unbounded — so any locator action on an element that is not there consumes the
whole test budget and then reports as a timeout with no bearing on the cause.
It bit three times in one sitting:

- `locator.textContent()` in the interactive sweep, on a control index that an
  earlier click had removed. Latent since that sweep was written; the collapse
  toggle is simply the first control whose click deletes the controls after it.
- `locator.click()` on a drawer scrim that the drawer itself covers, so the
  click could never be delivered.
- The same click again, after the scrim and the X inside the drawer turned out
  to share the accessible name "Close console navigation" — two elements for
  one name, one of them unclickable.

`actionTimeout: 10_000` now bounds all of them, well under the 45s test
timeout, so each fails at the line that caused it. The sweep also re-reads the
live control count before addressing an index, the scrim became a click-away
(`aria-hidden`, `tabIndex={-1}`) rather than a second control with the same
name, and the drawer interaction in the page suite retries the *click* rather
than polling an assertion — a click that lands before hydration attaches the
handler does nothing at all, and only the heaviest console page was slow enough
to show it.

---



Adding the sidebar collapse toggle turned 86 browser checks red, and none of
them were about the sidebar. `locator.textContent()` takes no timeout from this
config — Playwright's default action timeout is unbounded — so reading a
control that an earlier click removed waits until the *test* times out at 90s.
Every `survives its own controls at 1280px` case then failed with "the page
closed", which is the teardown rather than the cause.

The flaw was latent from the day that sweep was written; the collapse toggle is
simply the first control whose click deletes the controls after it. It now
re-reads the live count before addressing an index and bounds the label read to
a second, so a shrinking list ends the sweep instead of stalling it. Thirty-five
cases that had been hanging now finish in thirty-nine seconds.

---

## TWO HAMBURGERS, ONE PHONE (2026-08-18, from the owner's screenshots)

The red box in the third screenshot is the console's own mobile bar, and the
problem it frames is that the page has a second menu button in the bar above
it. The console renders the global header *and* its own drawer, so a phone
showed two identical hamburger icons in two stacked bars, distinguishable only
by accessible names nobody sees, and 137px of chrome before any content.

The console's button is the one that stays — it opens the navigation the page
is about. The global header suppresses its own on console pages, and its
destinations move into the console drawer under a "Site" heading, so nothing
that was reachable stops being reachable. Pinned by a test that counts the
menu buttons on `/solutions` at 390px and then opens the drawer to confirm
Platform and Pricing are still one tap away; mutation-checked by removing the
suppression, which reports "Expected: 1, Received: 2".

### The other two screenshots

Both show production, which is behind `main`, and both are already fixed
there. The "AI Accounts 0 Connected" tile above a list headed "AI accounts 4"
now reads "n of m Connected" and carries a comment naming that contradiction as
the reason. The Configure Pipeline dialog's **Use** is a real flow, not a
label: it reads the workspace's projects, refuses honestly when there are none
(with a link to create one rather than an empty dropdown beside a dead button),
and posts to `/api/graphs` with the project and template to record a planned
graph through the engine's own write boundary — reporting the topology and node
count it actually produced. **Clone** copies a built-in into an editable
workspace template. Nothing on that dialog is a mock.

---

## THE THREE NAVIGATION REQUIREMENTS THAT WERE STILL UNMET (2026-08-18)

Re-read against the brief rather than against the last summary. Three items
were still not done, and each is now measured rather than asserted.

**"When a caret is opened, reveal its submenu smoothly."** The chevron rotated
with a transition; the submenu itself was `{expanded ? <ul> : null}` — an
instant mount. It now animates on a grid track from `0fr` to `1fr`, which
reaches exactly the submenu's own height without anybody measuring it and
without a hard-coded number that goes stale the first time a subpage is added.
`invisible` rides alongside the clipping, because `overflow-hidden` hides links
from the eye and not from the keyboard: without it, tabbing through a collapsed
navigation walks destinations nobody can see.

**"Desktop: compact collapsible sidebar."** There was no way to collapse it.
The column was a fixed `w-64` at `xl` and hidden below it, so a 1280px laptop
gave up 256px permanently. There is now a rail: a toggle at the top of the
column, icons with `sr-only` labels (an icon-only link with no accessible name
is an unlabelled link, and `title` alone does not reliably reach a screen
reader), and groups rendering as their own link rather than growing a flyout
with nowhere to go but over the content.

**"The main content area must automatically shift/recalculate available
width."** The width lived twice — `w-64` on the column, `xl:pl-64` on the main —
two values with no way to disagree loudly. It is one custom property now, so
the content's available width is derived from the column's rather than kept in
step by hand.

**"Tablet: reduce sidebar footprint intelligently."** There were two tiers, not
three: the column existed from 1280px up and everything below it got the
phone's drawer, so a landscape tablet had no standing navigation on a screen
with room for it. From 1024px the column is now present as the rail; from
1280px the person's own choice decides. Below 1024 the drawer is still right,
and still what renders.

The preference is read through `useSyncExternalStore` with a server snapshot
rather than `localStorage` in an effect: reading storage during render hydrates
into a mismatch, and the effect-plus-`setState` workaround is a render the
person sees at the wrong width — React's own lint rule rejects it. A `storage`
listener comes free, so a second tab does not disagree about a preference set
once.

Both new tests were mutation-checked: dropping `invisible` fails the tab-order
test, and pinning `xl:pl-64` back onto the main fails the reflow test with "the
column narrowed but the content kept its old left padding".

---

## THE LAYOUT SUITE WAS MEASURING ALMOST NOTHING (2026-08-18, fixed)

Found by attacking the suite rather than reading it: a deliberate defect was
put into the assign wizard and the whole width sweep stayed green. Pulling that
thread turned up four independent reasons, each sufficient on its own, and
every one of them had been silently in effect.

**1. The harness served a build from hours ago.** Playwright's harness entry is
`harness:build && harness:serve` — `vite preview`, which serves a compiled
artifact — and `reuseExistingServer` is on outside CI. So the first local run
built the bundle and every run afterwards reused that server and skipped the
build. A preview started at 02:18 answered every request for the rest of the
session; components edited after that were measured in their old form. CI was
never affected (`reuseExistingServer` is false there), which is why it
survived: it only misleads the machine drawing the conclusions. Now
`reuseExistingServer: false` on that entry. A dev server was tried first and
reverted — it compiles per request, which took this suite from ten minutes to
over twenty-five; one build per run is the cheaper half of the trade.

**2. Nothing inside a dialog was measured.** `overflowing()` returns early when
the document fits, and a dialog is `position: fixed` — it never widens the
document however wide its contents get. Over-wide content makes the *overlay*
scroll sideways instead, which every check either skipped or counted as
legitimate reach. Eight components render dialogs; none had horizontal
coverage. `sidewaysScroll()` now measures the overlay itself, which keeps a
deliberate inner scroller legitimate — a wide table with its own `overflow-x`
absorbs its overflow and the overlay never grows.

**3. Every gate-consulting console was rendering its signed-out state.** Seven
components call `isBrowserSupabaseConfigured()`, and `useTenantList` returns
signed-out when it says no. Vite's build shims `process.env` to `{}`, so it
said no for every case — and this suite, built precisely because an earlier
populated sweep turned out to be measuring gates, was measuring gates. The
vacuity moved rather than went away, and nothing failed when it did. The
harness now defines those values.

**4. Unserved endpoints answered 200 with no keys.** The fixture server ended
in `return json({})`. Components believed it: `AgentsConsole` read
`/api/providers`, got `{}`, entered its ready state and threw on
`payload.providers.map`, so the case rendered nothing at all while the sweep
reported it fitting at every width. `ReportsConsole` threw the same way on
`report.type` — the reports fixture used `kind`, `projectId` and `projectName`,
none of which that route returns, and nobody noticed because the console was
showing a gate and never read the fixture. Unserved now answers 503 and names
the URL, and thirteen endpoints gained fixtures shaped like their routes.

### What the honest suite then found

`portfolio-controls` overflowed a 320px screen and kept overflowing to 430px:
its Project `<select>` lists project names, and a select's min-content width is
its widest option. Same root cause as the earlier `.input` fix, which this file
missed by using raw classes rather than the token. Fixed here and on the three
other unguarded selects, since an option list that is short today can hold a
long name tomorrow.

### A fifth, in the route sweep

`responsive.spec.ts` walks all thirty-four routes inside one test with the
default 45s timeout, against `next dev` — which compiles a route the first time
it is asked for. That fits only when the server is already warm, and locally it
always was, because `reuseExistingServer` kept one alive between runs. Against a
cold server the sweep times out mid-walk and reports `net::ERR_ABORTED; maybe
frame was detached?`, which reads like a layout failure and is a stopwatch. Ten
of these appeared the moment the stale servers were cleared. The sweep now sets
a timeout scaled to the route count; a warm run still finishes in about twenty
seconds and exits early.

### What now prevents each from returning

- `tests/integration/responsive-coverage.contract.test.ts` fails if the harness
  webServer both serves a build and permits reuse. Either half alone is fine;
  the combination is what lies.
- Every case asserts it renders no sign-in gate heading — matched on the
  heading, because the guided journey's own step description reads "Sign in to
  Claude or Codex…" and is content, not a gate.
- Every case asserts it read no endpoint the harness cannot answer. An error
  card is the same shape of lie as a gate: a few centred words that fit every
  width.
- `open()` collects page errors, so a case that throws during mount fails with
  the exception instead of a bare "#root is empty" after a 15s timeout.
- The portfolio fixture is built by calling the route's own pure aggregator
  rather than transcribing its output, so it cannot drift out of shape the way
  the reports one had.

---

## RESPONSIVE COVERAGE: WHAT IS AND IS NOT MEASURED (2026-08-18)

An attempt to sweep the console's *populated* layouts at all eight widths was
written and then deleted, because it did not test what it claimed.

The console pages resolve their tenant on the **server**. Without Supabase
configured for the browser suite they render "Projects are unavailable —
Supabase is not configured for this environment" and never mount the client
components, so intercepting the browser's `/api/*` reads changes nothing: the
fetches never happen. The sweep passed at every width without laying out a
single row. A test that green-lights an empty gate while claiming to measure a
populated table is worse than no test.

**Measured today:** every route's chrome and empty/gated state at
320/375/390/430/768/1024/1280/1440; the console drawer and every navigation
caret, opened one at a time and all together; the marketing pages fully
populated (they need no session); dialogs on signed-out console pages.

**Not measured:** any console layout that only exists once there are rows —
the projects table with data, the bot roster, the assign wizard's three steps,
the Connect Bots panel. These have component tests (behaviour, in jsdom, no
layout) but no width coverage.

**What would close it,** in preference order:
1. A seeded Supabase project for the browser suite, so the server renders rows.
2. Playwright component testing, which mounts the real components in a real
   browser without needing a server session. No config exists for it yet.

Both are real work rather than an oversight. Until one exists, defects inside
populated console layouts are found by hand — which is how the three fixed on
2026-08-18 were found, from owner screenshots.

---

## PROJECT-WIDE RESPONSIVE AUDIT (2026-08-17)

Every route measured at 320/375/390/430/768/1024/1280/1440, plus an
interaction sweep: console drawer, every navigation caret opened one at a time
and all together, collapse-and-return, site nav drawer, pricing cadence toggle,
resources search, and disclosures on five console pages.

Starting point: 79 findings. Ending point: 0 overflow, 0 nested scrollbars,
0 load failures, 0 interaction findings.

### Fixed

- [x] **`/pricing` scrolled the whole page sideways on every mobile width.** A
  720px-minimum table inside a horizontal scroller still inflates the root's
  scroll width, and the table was unusable at 320px even when the scrolling
  worked. Now a stacked block per plan below `md`, carrying the same rows,
  values and included marks; the table returns from `md` up.
- [x] **Text painting over its neighbour** on `/platform` and `/` (six columns
  at 1280) and `/pricing` (five at 640) — grids one breakpoint too tight for
  the words in them. Six only from `2xl`, five from `lg`, and the connector
  arrows moved to the breakpoint their row starts at.
- [x] **The newsletter field was 18px tall on a phone.** `flex-1` is
  `flex: 1 1 0%` along the container's main axis, and the container is a column
  below `sm` — so it governed the *height* and overrode `h-11`. Now `sm:flex-1`.
- [x] **Footer navigation links were the height of their own text** on every
  marketing page. The inline-prose exemption does not cover a stacked list.
- [x] **Resource cards had a 15px tap target** on a card hundreds of pixels
  tall; the link is stretched over the card now.
- [x] Topic and role links in the resources sidebar, same defect, same fix.
- [x] The overflow detector in `tests/e2e/responsive.spec.ts` blamed the wrong
  element — anything inside a scroller is past the viewport by design, and it
  sorted to the top of the report. It now skips contained elements, and the
  sweep covers all 29 routes rather than five.

### Found, not fixed — needs an owner decision

- [ ] Eight entries in `lib/marketing/content.ts` carry `href: "#"`, so the
  featured resource cards are links that go nowhere. There is no
  `/resources/[slug]` page for them to point at, so the destination has to be
  decided rather than guessed. Removing the link was tried and reverted: an
  existing contract test asserts these render as links.

### Not defects

24 remaining tap-target readings are three links inside sentences ("Sign in",
"Create one", "Sign in first"). WCAG 2.2 SC 2.5.8 exempts inline targets whose
size is constrained by the line-height of the text around them.

---

## GLOBAL NAVIGATION REBUILD (2026-08-17, owner reference image)

Owner goal: rebuild the global navigation to match the reference image as
closely as technically possible, fixed once at the architecture level so every
applicable page inherits it.

### Done

- [x] `components/brand-mark.tsx` — the mark existed twice, drawn differently
  in the header and in the console sidebar, so the same page could show two
  logos that disagreed about their own colours. Both now render one component.
- [x] Header rebuilt against the reference: hexagon-with-AI mark instead of the
  gear tile, FACTORY in the lime the console already uses as its accent, the
  bar full-bleed instead of a centred 1400px column (which had the logo sitting
  280px in from the left edge), and the account cluster as the image shows it —
  two-line super-admin chip, truncated address, gradient Open Console, Sign out.
- [x] `lib/navigation.ts` untouched: the entries and their order
  (Dashboard, Projects, Runs, Activity, Admin, Platform, Features, Pricing,
  Resources, About) already matched the reference exactly.
- [x] `app/auth/layout.tsx` — `/auth/sign-in`, `/auth/sign-up` and
  `/auth/onboarding` sit outside both route groups and inherited only the root
  layout, so they rendered **no header at all**. They now render the same one.
- [x] The "every page has the global navigation" contract is asserted for every
  route in `tests/e2e/pages.spec.ts`, not for the two that were broken, so a
  future route group cannot become the next exception. Removing the auth layout
  fails both auth routes.

### Deliberate departures from the image

- The super-admin chip breaks over two lines by width, not a `<br>`: a hard
  break splits the accessible name into two text nodes, so a screen reader
  stops hearing one phrase.
- Open Console keeps its label on one line. The reference wraps it, but that
  reads as a squeeze at that viewport rather than an intent.
- The mark takes `min-w-0`, not `shrink-0`. Written the other way it refused to
  give at 320px and pushed the account controls off the right edge — caught by
  the responsive sweep. The glyph holds its size; the words truncate.
- `/offline` keeps no header: it is the one page the service worker caches, so
  it must not depend on a server-resolved session.

---

## MULTI-BOT PROJECT ASSIGNMENT (2026-08-17, active goal)

Owner goal: assign several connected bots to ONE project, configure each
independently, define responsibilities and permissions, work in parallel,
monitor, and manage afterwards. UI -> API -> database -> orchestration, wired
end to end. No mock UI.

Starting point: `bot_assignments` already carried bot/project/role and
`assign_bot` moved one bot at a time. What was missing was everything that
makes several bots on one project different from one bot repeated.

### Done

- [x] Migration `20260817000500_bot_assignment_configuration.sql` — per-posting
  configuration (preset, responsibilities, instructions, repository access,
  branch strategy, PR open/merge, pipeline access, environment access, tools,
  approval, concurrency, priority), plus `assign_bots_to_project` (atomic
  multi-bot) and `update_bot_assignment_configuration`.
  Two structural rules, not advisory:
  **authority is nested** (`bot_assignments_authority_nested`: open needs
  repository write, merge needs open) and **elevated authority keeps its human**
  (`bot_assignments_elevated_requires_approval`: merge or production forces
  `requires_human_approval`), matching `policies/AUTO_MERGE_POLICY.md`.
  Defaults are least privilege. Verified against real PostgreSQL (PGlite) in
  `tests/integration/bot-assignment-configuration.behavior.test.ts` — 33 cases,
  three mutations confirmed non-vacuous.
- [x] `lib/bots/assignment-config.ts` — shared browser-safe vocabulary: the
  seven presets (Developer, Reviewer, Tester, Security, DevOps, Research,
  Documentation), zod bounds, elevated-permission detection, and row
  round-tripping that reads an unknown or absent stored value as the *narrow*
  option so an older assignment cannot gain authority by being displayed.
- [x] `POST/GET /api/projects/[projectId]/bots` and
  `PATCH/DELETE /api/projects/[projectId]/bots/[assignmentId]`. Connectedness is
  resolved server-side from the credential overlay, never from anything the
  browser sent; one unconnected bot refuses the whole selection.
- [x] Assign wizard in `components/project-bots.tsx` — Select (search,
  multi-select, Select All, health, usage, workload, "this moves it off
  Mobile App"), Configure (presets + every field, per bot), Review (permissions,
  estimated concurrency, elevated-permission acknowledgement), Confirm. Plus the
  roster with pause/resume/configure/remove. Rendered from both the project
  inspector and the project detail page.
- [x] `lib/bots/assignment-routing.ts` — the configuration now *decides*
  something: permission is an eligibility gate evaluated before ordering (so
  priority can never outvote a missing permission), capacity is a second gate,
  every refusal is a named code, and `dispatchWorkAcrossBots` threads capacity
  and path claims forward through a batch so two bots cannot be handed the same
  slot or the same file.

### Still open

- [ ] The routing module has no production caller yet. Phase 1C claim is hosted
  and live but nothing executes, so wiring it now buys no behavior; it is
  covered by tests and ready for the claim path.
- [x] Migration `20260817000500` — and the rest of the `20260817` range,
  `20260817000700` included — is **on hosted**, measured by probe run
  `32103778884` on 2026-08-18. The wizard's configuration columns exist in
  production. The earlier "unhosted" claim came from a ledger high-water mark
  that does not describe this ledger; see `AI/HOSTED_APPLY_RUNBOOK.md`.
- [ ] Playwright coverage of the wizard at mobile/tablet/desktop widths.

---

## PRODUCTION-READINESS AUDIT LOOP (2026-08-16 20:25Z, active goal)

Owner goal: autonomously test/audit/fix/verify EVERY feature until
production-ready; todo.md is the source of truth; loop until a full sweep
finds zero actionable defects.

### Frictionless UX sweep (2026-08-17, owner goal)

Evidence base: the owner's own questions this session - "what am I
adding here", "where is the readout", "how to tell if this is running",
"how can I choose which bot(s) per project" - each marked a page that
was truthful and a dead end.

- [x] #187 empty pages name their next step (TenantListShell gains an
  optional action; Runs/Reports/Backlog/Autonomy wired, jargon rewritten)
- [x] #188 failed work appears on the dashboard with its reason
- [x] #189 a saved request says what is happening to it, and links to Runs
- [x] #190 a set-up project leads to "Give this project work", carrying
  the project into the composer
- [x] Unwired-control sweep: every button in components/ has a handler or
  is a submit; no dead controls found
- [x] Nav sweep: all 16 sidebar links and every static href resolve
- [x] #192 the setup guide names connecting an AI account - previously
  absent, while "Check your AI worker" (Actions worker status) could tick
  green with zero accounts connected. "Your Factory is ready" now requires
  a genuinely connected account.
- [x] Raw-identifier sweep: status text is underscore-normalized, not raw
  enums; no jargon leaks found beyond the ones rewritten in #187/#189
- [x] Touch targets: .btn 40px / .btn-sm 36px / .input 40px - above the
  WCAG 2.2 24px minimum; axe passes on every route at three viewports

### Navigation subpages (2026-08-17, owner goal + follow-up images)

Owner design: subpage groups under the sidebar destinations, plus quick
actions. Contract held throughout (ADR-077): every entry links a real
page or anchored section; aspirational subpages are not rendered.

- [x] Collapsible groups, default-expanded: Projects (All Projects,
  Archived), Pipelines (Templates, Backlog), Bots (Connect Bot #connect,
  My Bots, Bot Activity), Settings (General, Bots & Integrations
  #providers), Watch (Operations, Activity), Advanced (5 consoles).
  Labels renamed: Overview / Bots / Integrations. Quick actions: New
  Project (#add-project), Give a bot work, Import Repository, View
  Documentation. Administration section unchanged for super admins.
- [x] Archived made real: GET /api/projects accepts opt-in
  ?status=archived (default still excludes archived); projects console
  reads ?filter=archived via useSearchParams (page wrapped in Suspense,
  files-page idiom); archived rows render as records with "Unarchive on
  Portfolio"; empty state says nothing is archived. archive_project /
  unarchive_project RPCs existed since 20260815000700.
- [x] NOT rendered, no backing surface: Secrets, My Projects / Shared
  with Me / Starred, pipeline Active / All / Schedules / Archived,
  Members / Teams / Permissions / Billing. Templates IS the workflows
  page (compiled graph templates), so that label is now the truthful one.
- [x] Gates: unit 2948+15 green (new collapse/order/archived tests),
  eslint 0, tsc clean, production build exit 0, Playwright console+pages
  72/72 across 3 viewports (30-label reachability contract).
- [x] Merged #194 (b57cea1); production verified live: all new labels
  serving on /solutions, archived route 200.
### AI FACTORY (owner goal 2026-08-17, /loop active — reference image)

Round 1 (this merge):
- [x] /solutions/ai-factory + "AI Factory" nav entry under Overview
  (redirect contract, pins, pages.spec, 35-label reachability). Guided
  8-step journey — Connect Repository → Create Project → Pipeline Ready
  → Connect Bots → Assign Bots → Configure Bot Settings → Issue a
  Command → Watch It Ship — with completion DERIVED from live records
  (installations, projects, accounts, assignments incl. configured
  count, commands), so progress survives refresh by construction; each
  step deep-links the real flow (composer carries ?project=). Command
  execution section shows recent commands with worker-advanced stages.
  Integrated services (GitHub live count, Vercel-on-merge, Supabase) +
  Observability links — only real services listed. Mobile-first
  vertical stepper. 4 unit tests.
- [x] Owner add-on: per-posting Model (Fable 5/Opus 5/... from the
  provider's suggested list, or bot default) + Work Effort
  (low/medium/high/max) — migration 20260817000900
  (bot_assignments.model bounded identifier + work_effort check,
  set_bot_assignment_execution owner/admin RPC, audit event), PATCH
  /api/bot-assignments/[id] extended, selects on each PostingCard in
  the project roster (steps 6/7 surface), serialized through
  lib/bots/service. 1 new unit test.
- [x] Round 2 (stop-hook directive: "one seamless guided workflow", not
  deep links): every step now opens its REAL control in place, as an
  accordion — Connect Repository embeds ConnectionsConsole; Create
  Project embeds AddProjectForm (extracted from ProjectsConsole into
  components/add-project-form.tsx, identical markup, both surfaces
  share it); Configure Pipeline embeds PipelineTemplatesManager with
  built-ins compiled server-side by the page (editable stages, Use →
  POST /api/graphs); Connect Bots embeds BotManagerHome (Add AI
  Account/Create Bot flows); Assign + Configure embed the per-project
  ProjectBots roster (Select→Configure→Review wizard, role,
  responsibilities, repository access, Model, Work Effort) behind a
  project picker when >1; Issue a Command embeds CommandComposer
  (onSaved refreshes derivation); Watch It Ship's body is the live
  command list with worker-advanced stages. Current step auto-opens
  ("follow the journey"); clicking any header opens that step; a
  desktop horizontal number band (reference's connector strip) jumps +
  scrolls. Completion still derived from live records only. 5 unit
  tests (auto-open assertion, embedded-control mount on header click,
  live-evidence body). Gates: tsc, eslint 0 warnings, vitest 3170,
  build, Playwright 171.
- [x] Round 3 (owner goal 2026-08-17 23:2xZ): options open as OVERLAYS
  over the page instead of jumping — StepOverlay (same shell idiom as
  the console's other dialogs: fixed inset, top-aligned scrollable
  panel, X, backdrop mousedown, Escape), one per step, opened from the
  row action button or the desktop number band, aria-haspopup=dialog
  announced. Nothing opens uninvited. Closing ALWAYS re-reads the
  journey (closeOverlay = setOpenStep(null) + load), and the controls
  that know their completion close themselves: AddProjectForm
  onCreated + CommandComposer onSaved → closeOverlay — selection made,
  back on the page with it showing. 6 unit tests incl. "returns to the
  journey on its own once the overlay's control completes".
  responsive.spec: +/solutions/ai-factory route; flaky nav-group test
  stabilized (retrying toBeVisible before the non-retrying count()).
- [x] Round 4 (owner goal 2026-08-17 23:3xZ): the Assign Bots pop-up
  links the Bot Manager's accounts, multiple at once. ProjectBots
  reads /api/ai-accounts (best-effort); the wizard's Select step gains
  "From your Bot Manager": connected accounts with no bot yet (matched
  by credential variable — account credentialPurpose slot ↔ bot
  credentialRef over the provider's subscription variable), tick any
  number → Link N bots → POST /api/bots/connect/provision per account
  at ITS slot (additional:true), roster re-read, the new bots selected
  automatically, ready for Configure. Empty state now links the Bot
  Manager page by name. ProjectBot type gained credentialRef (already
  serialized). 1 new unit test (two accounts → two slot-correct
  provisions → "2 bots selected").
- [ ] Round 5+: full journey re-test from a fresh workspace against
  production, breakpoint sweep beyond the e2e viewports.

### Template CRUD (owner goal 2026-08-17)

- [x] Migration 20260817000700: create/update/delete_pipeline_template
  over the EXISTING graph_templates table (RLS + member SELECT since the
  graph engine landed; these are its first write path) — owner/admin,
  bounded audit-areas definition (1-12 areas, unique ids, no secrets),
  version bump per edit, pipeline_template.* activity events, delete
  keeps planned graphs (template_id SET NULL).
- [x] One builder, no divergence: auditTemplate exported; custom
  templates build + compile through the exact built-in path
  (lib/graph/custom-templates.ts); the API refuses a definition the
  compiler refuses (422 with the compiler's own errors) so every stored
  template stays runnable.
- [x] /api/pipeline-templates GET/POST + [id] PATCH/DELETE; built-in
  slugs reserved (409). /api/graphs POST now accepts custom slugs —
  loads the row, rebuilds, same launch plan, same truthful
  PLANNED-not-dispatched note.
- [x] Templates tab → PipelineTemplatesManager: Your templates (Use /
  Edit / Delete with in-place confirm) + Built-in templates (Use /
  Clone; edited as code, stated in place) + New-template editor (key,
  name, summary, category, capability, 1-12 area rows) + Use dialog
  (project picker → real POST /api/graphs, result repeats the
  endpoint's honesty). 4 manager unit tests + console test updated.
- [x] Pins ×12 → 000700; allowlist+repairs; runbook 105/41. Hosted
  apply pending post-merge.

### Safety page fully wired (owner goal 2026-08-17 — ADR-080)

- [x] Migration 20260817000600: the Phase 1D scaffold gives way to
  owner-gated operations — set_autonomy_kill_switch (release needs a
  reason), set_organization_autonomy_controls (partial), member-scoped
  read; immutable autonomy.* activity events per transition. Survives
  as DB refusals: RED ceiling never (both scopes, constraint+trigger+
  RPC), born fail-closed, owner-only (admins excluded).
- [x] /api/autonomy/controls GET/POST; SafetyControls rewritten live —
  real switches for the owner (kill switch with in-place reason flow,
  autonomous mode, GREEN/YELLOW ceiling picker with RED labeled "Never
  automatic", all nine action toggles), read-only for members,
  fail-closed signed out; per-row "switched on, held off: <cause>"
  honesty (kill switch / mode off / capability missing for merge+deploy
  which record intent only). Static "Kill switch ON" badges removed
  from Settings + Autonomy headers (would now be able to lie).
- [x] phase1d behavior suite: "nothing was relaxed" → "the
  owner-operated contract" — 44 green incl. owner release/re-engage
  with 2 audit events, owner enable+revert, RED refusals, born
  fail-closed. 5 rewritten SafetyControls unit tests.
- [x] Pins ×12 → 000600; allowlist+repairs through 000600; runbook
  104/40. Hosted apply pending post-merge.

### Runs clear/delete (owner goal 2026-08-17)

A sibling session shipped per-run review + owner-only deletion (#201,
migrations 000200/000300/000400 — reason-required, live-lease/queued
refused, evidence detach opt-in, deletion audit-recorded before it
happens). This session completed the goal:
- [x] Clear ALL finished runs: delete_finished_agent_runs (migration
  20260817000500) loops the SAME per-run guarded path, counting what it
  refused (kept_for_evidence / kept_for_activity) — never forcing.
  POST /api/runs/clear-finished; Runs page gains a reason-carrying
  confirm naming what is untouched (queued/running) and what survives
  (audit trail; PR/deployment/test-run rows unless keep-and-unlink).
- [x] Hosted-apply logistics for the WHOLE 2026-08-17 set: 000200-000500
  joined the surgical allowlist + repairs (000300/000400 made
  replay-safe first — add column if not exists, drop-constraint-before-
  add, create index if not exists — the 001500 precedent); tail pins ×12
  → 000500; runbook 103/39. Without the apply, production's run
  edit/delete/clear controls receive function-missing refusals.
- [ ] Trigger hosted apply post-merge and verify.

### PIPELINE SYSTEM (owner goal 2026-08-17, /loop active)

AUDIT (round 1, verified against code):
- COMPLETE: graph engine (26 modules — compiler, scheduler, launch-plan
  topology SINGLE/LOOP/DAG/DIAMOND/DISCOVERY, locks, fan-out/in,
  discovery, budgets, verification) + persistence (graph_templates,
  graphs, graph_runs, node_runs, artifacts, handoffs, verifications,
  work_locks; create_graph_from_plan RPC); 14 versioned code templates
  covering 12/13 of the owner's list (no Database Migration template);
  command lifecycle with verified intake, RED approval gate, worker
  claim leases, stale-base replan, cancel/retry, draft-PR-only output;
  real anchors already exist for CI (GitHub checks), deploy (Vercel on
  merge), risk (GREEN/YELLOW/RED + kill switch), monitoring
  (operations/activity/reports).
- PARTIAL: pipeline experience — round 1 ships /solutions/pipelines
  (Active / All / Templates over live commands + server-compiled
  templates); commands list API carries no branch/PR linkage yet, so
  stages beyond Complete (PR, CI, PREVIEW, VALIDATE) are not stitched
  into the row; simple-mode confirmation (template/team/stages preview
  before Start) not yet in the composer.
- MISSING: stage-level pipeline persistence (PENDING/READY/RUNNING/...
  vocabulary per stage), advanced-mode visual builder, failure-route
  configuration, schedules, Database Migration template, graph-node
  executor (graphs API truthfully says PLANNED-only: "no executor is
  connected to the graph runner" — the Phase 1C worker executes
  commands, not graph nodes).
- BROKEN: nothing found; every unconnected surface names itself.

- [x] Round 1: /solutions/pipelines — Active (live stages from the
  worker-advanced command status: Intake / Waiting for your approval /
  Planning / Building / Complete / Failed / Cancelled; owner-attention
  count; elapsed + duration), All Pipelines (history + outcomes),
  Templates (versioned, compiled topology facts; deep previews link to
  Workflows — one engine, no duplication). Nav Pipelines group → Active,
  All Pipelines, Templates, Backlog (37-label contract); /pipelines
  redirect; pages.spec route; 15s live re-read; 5 unit tests.
- [x] Round 2: Database Migration template (auditTemplate, 5 areas —
  forward-only/replay-safe, RLS, grants, consumers, ledger; completes
  the owner's 13); simple-mode confirmation in the composer — a
  "Pipeline" card appears once goal+project are set naming Project,
  Requested risk, Suggested template (suggestTemplateForGoal keyword
  matcher over GRAPH_TEMPLATES, labeled informational — the worker
  executes the goal as written), and the real stages (RED → stops at
  approval), linking to Pipelines. 4 new tests (matcher precedence,
  fallback).
- [ ] Round 3+: PR/CI/deploy evidence joined per pipeline run (needs
  branch/PR in list_commands or a detail RPC), stage-state persistence
  (PENDING/READY/... vocabulary), failure-route configuration,
  schedules, graph executor bridge, advanced-mode builder.

- [x] Edit/delete everywhere (owner goal, 2026-08-17 — ADR-078):
  Projects editable (update_project_details, migration 20260817000100,
  PATCH /api/projects/[id]; Edit dialogs on the All Projects table +
  inspector) and archivable/unarchivable in place (reason-carrying
  dialogs + Unarchive button on the Archived view, existing RPCs). Bots
  removable from the roster (retire_bot; confirm-in-place naming what is
  released vs kept) alongside the existing rename. Accounts already had
  rename/disconnect/remove; runs keep cancel/retry. REFUSED: edit/delete
  of runs, activity events, audit records (immutability contract), hard
  project delete, template forms (templates are code). Tail pins ×11 +
  hosted-apply allowlist moved to 20260817000100; hosted apply pending
  post-merge; 6 new unit tests.
- [x] Bot Usage page (owner mockup, same day): /solutions/bot-usage
  renders per-account provider-subscription windows from the REAL
  observation store (ADR-076) — reuses AccountUsage (percent bars +
  provider reset times; every absence named), headroom bands derived
  from the same thresholds the bars color by, summary cards (bots
  connected + average week_all_models across measured bots), Refresh
  wired to POST /api/ai-accounts/refresh (managers only), View details →
  Bot Manager, 30s re-read. Mock's plan/billing footer, date-range
  picker, history tabs ABSENT (observations are latest-per-account; no
  billing model). Nav Bots group gains Bot Usage (33-label contract);
  /bot-usage redirect added; pages.spec covers the route; 4 unit tests.
- [x] All Projects dashboard (owner mockup, same day): /solutions/projects
  is now the organize/overview posture — stat cards (total / active% /
  authorized repositories / connected, all counted from the live reads,
  no trend deltas: no historical snapshots exist), tabs (All Projects |
  My Projects | Archived; Starred/Shared absent, no model), a projects
  table (repository+branch, status badges, last run + success rate from
  /api/runs where only succeeded/failed carry a verdict, updated_at now
  exposed by GET /api/projects, Open → /solutions/portfolio/{id}),
  10/page pagination with truthful "Showing X to Y of N", right rail
  (projects-by-status incl. archived count via the opt-in read + recent
  activity from /api/activity?limit=8, best-effort with named absence).
  Page header follows the mock ("All Projects", Import Repository / New
  Project); add-project form still anchored below the table. The
  inspector-evidence unit tests moved to MyProjectsConsole, where the
  inspector now lives inline; 3 new dashboard tests. pages.spec heading
  pin → "All Projects".
- [x] My Projects (owner mockup, same day): /solutions/myprojects renders
  every project as a chevron-collapsible row (first open by default)
  expanding into the SAME ProjectInspector the Projects page uses (now
  exported, one source of truth); page actions Import Repository / New
  Project land on existing controls; nav Projects group gains My Projects
  (31-label contract); pages.spec covers the route; 3 new unit tests
  (multi-project expand/fold, empty→add-project, signed-out gate).
  Shared with Me / Starred still have no backing model and stay absent.

### Audit backlog (loop working set)

- [x] **Loop tick 2026-08-17 01:11Z**: parallel sessions landed #176-#179
  (repository picker, usage metrics, audit doc, blocker evidence) with TWO
  unhosted migrations and no apply coverage - the deployed picker/usage UI
  would have hit missing-function errors live. Fixed (#180): 001500 made
  replay-safe (if-not-exists guards), both migrations joined the surgical
  allowlist, merged f64ee63, hosted apply run 31984194358 SUCCESS - both
  features now fully live. Full vitest on the merged tree: 2889/0.


- [ ] **P0 — live canary journey**: Audit Round 2 run `8b5fdd2c` claimed via
  the FIRST manual dispatch (owner-ordered workflow_dispatch, main-guarded,
  PR #171) and failed `stale_base_sha` — correctly: five fix merges moved
  main after it was planned. Recording worked perfectly (truncation fix
  proven live). ROOT FIX (ADR-075): never-started runs now re-plan to the
  observed head — `replan_phase1c_run` (migration 20260816001300,
  service_role, lease-held + head_sha-null guard), WorkspaceError carries
  the observed SHA, worker re-plans once and retries, `replanned_base`
  event names both SHAs. Post-execution staleness still fails closed.
  REMAINING: apply 001300 hosted (surgical scope now covers it), owner
  queues the audit once more; npm bootstrap retry still untested live.
- [x] Full gates on current main (01ae6a8 lineage): vitest 2843/0 (+2 new),
  eslint 0 errors, tsc clean, production build exit 0, Playwright full run
  exit 0 (6 skipped by design) incl. axe on ~20 routes × 3 viewports and
  the zero-browser-errors console spec.
- [x] Checks truthfulness: the Projects page counted a cancelled worker
  beat as "1 check is failing on the main branch" (owner screenshot
  20:50Z-era) while every real check was green. Only conclusions carrying
  failure evidence (failure, timed_out, action_required, startup_failure)
  now count as failing in the warning and the summary chip; cancelled runs
  still render their literal conclusion in detail rows.
- [x] TODO/FIXME/HACK sweep: zero real instances (2 matches are detection
  regexes in sensitive-data.ts / redact.ts).
- [x] Mock/placeholder sweep: Demo Data labelling is centralized in ui.tsx per
  AGENTS.md; marketing fallback is labelled. `otherProviders` chips in
  connections-console are static but truthful — Anthropic/Vercel "Not
  Connected" (true), Supabase "Connected" renders only in the ready state,
  which itself requires a successful Supabase read (evidence-based in
  context). No change needed.
- [ ] Env docs: `SOFTWAREFACTORY_CREDENTIAL_KEY` (vault key) is used by the
  worker but absent from `.env.example` — add a documented server-only entry.
  (Other absents are platform-provided: NODE_ENV, PATH, VERCEL_*.)
- [x] Route inventory: 29 pages (6 marketing, 19 portal, 3 auth, offline),
  95 API routes. Every sidebar nav link resolves to a real page; every
  static href in app/components resolves. Journey-verify portal pages via
  Playwright (pages/journey/console specs) + owner live proofs
  (connections/projects/bot-manager proven live today).
- [x] API auth sweep: 19 routes with no direct auth import all delegate to
  shared authenticated handlers (tenant-list/tenant-detail
  requireActiveOrganization; github route prepareGitHubRepositoryRequest →
  requireGitHubUser; operations route context). No unauthenticated data
  route found. Webhooks use signature verification by design.
- [ ] Accessibility/responsive: Playwright axe suite exists — run it; spot
  gaps for new UI (workspace switcher, device-code branch).
- [ ] Secrets: tracked-file scan before each merge (standing); no findings.

### Sweep 2 (2026-08-16 21:21Z, from the beginning)

- [x] **eslint now 0 errors AND 0 warnings repository-wide** (was 10
  warnings waved through as "pre-existing"): standard `^_` ignore
  convention configured for @typescript-eslint/no-unused-vars (mock
  signatures carry parameters for their types), two dead eslint-disable
  directives removed (sw.js no-undef, connect.mts no-control-regex —
  the `` escape never triggers the rule), three unused callback
  params renamed to the convention. Touched suites 64/64.
- [x] `npm audit`: **0 vulnerabilities**, production and dev trees.
- [x] proxy.ts (middleware): Supabase auth refresh with graceful
  fallback; static assets excluded; secure handlers fail closed in the
  DAL — correct.
- [x] public/sw.js: documented refusal rules — never caches /api/
  responses or authenticated navigations, only content-hashed build
  assets + the offline shell — correct.
- [x] Dead-code scan: `components/task-run-launcher.tsx` was the one
  component imported by nothing (no page, no test) — a Phase 2A-era
  launcher superseded by the Bot Manager composer; removed. All other
  components are wired.

### Final regression (2026-08-16 21:20Z, merged tree f37c7e4)

- vitest: **2846 passed / 0 failed** (2 skipped by design), 243 files
- production build: exit 0
- Playwright: exit 0 — full route sweep + axe × 3 viewports, journey,
  console (zero browser errors), bot-manager, marketing, auth specs;
  6 skipped by design
- eslint 0 errors; tsc clean
- Hosted: migration 20260816001300 applied via surgical run 31972616619
  (success); replan_phase1c_run live in production

**Remaining item — precisely why it is owner-blocked, with evidence:**
the live canary needs one command queued from /solutions/bot-manager.
`submit_command` grants execute to `authenticated` only; service_role is
refused (ACL verified in the grants suite). No agent in this loop holds
an authenticated user JWT: sign-up requires e-mail confirmation to an
inbox no agent has (and the project's built-in sender is rate-limited),
and minting a bypass (a service-role submit path) would weaken the
tenant-security boundary — forbidden by this goal's own fix rules. This
is exactly the "blocked by unavailable external credentials/access"
category; it is documented, not marked complete.

**De-risking evidence for the last untested link (21:32Z):** cold-cache
`npm install next@16.3.0 --ignore-scripts` with npm 10.9.7 / node
22.22.2 on a plain filesystem extracts the full docs tree cleanly —
the TAR_ENTRY_ERROR is specific to the worker's container/bind-mount
environment, which is what the clean-retry fix (#168) targets. If the
live retry still fails, the next lever is pinning npm inside the
container step; the failure will record legibly either way.

Completed defect chain for this goal: #167 (mute failures), #168
(bootstrap retry + truncation cap), #170 (cancelled ≠ failing), #171
(owner-ordered manual dispatch, main-guarded), #172 (stale-base re-plan,
ADR-075 + live-installation protection list). Older completed goals below.

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

### Owner goal — BotBuildv2: FULL Bot Manager redesign (opened 2026-08-16 15:30Z, supersedes the v1 UX work below)

Spec: uploads/bbe1c92d-BotBuildv2.txt. Product promise: "Connect Claude or
Codex as easily as signing into any modern SaaS application. Then create as
many specialized bots as needed." Journey: Bot Manager → Add AI Account →
Claude/Codex → Sign In → provider login → Connected → Create Bot. The v1
broker BACKEND (accounts, sessions, worker runner, unbounded slots — merged
#136/#138) is exactly the spec's §7 architecture and stays; the v1 UI
(quick-connect command tiles, check-now, OpenRouter CTA, worker banner,
Fleet/Bots/Roles zero tabs, auto-degrade-to-command) is what gets REBUILT.
CLI/diagnostic surfaces survive only under Developer Diagnostics (§35).

**Checklist (status vocabulary: TODO / IN PROGRESS / BLOCKED / VERIFIED):**

**GO-LIVE LEDGER (2026-08-16 16:40Z):** #141 `f580db3` (worker default-ON,
honest stall UI) merged + deployed 16:13:23Z. #142 `de055c9` (lingering
worker, session diagnostics, Remove account) merged 16:26 at owner
instruction; its deploy completed after the owner upgraded Vercel to Pro
(the free-tier 100/day cap had halted deploys 16:16-16:3x). Worker run
31958640122 confirmed LIVE and LINGERING on the new script (step held open
vs. previous 1-2s exits). All three Actions secrets present (masked in
worker env). Broker schema confirmed live on hosted by production behavior;
Supabase integration applies migrations on merge. Remaining to a completed
live sign-in: the owner's click-through with the lingering worker up.

**REMOVE FIXED LIVE + BOTH WORKER FIXES SHIPPED (2026-08-16 17:10Z):**
Run `31960618697` (apply workflow, scope=broker-functions, password-only
pooler fallback — the access-token secret is malformed, not `sbp_…`-shaped)
applied `20260816000400`/`000500` to hosted via psql and recorded them:
`remove_ai_account` is live, the PGRST202 root cause is gone (the user's
error screenshots at 16:36/16:51/17:03 all predate the 17:07 apply). The
same run reverted the stale remote-only ledger row `20260814000200` — the
real blocker of every previous full push (the runbook's `20260814002000`
derivation was wrong in detail; see the runbook's live-measured section).
#143 (Enter-as-its-own-keystroke — the verifying death) and #144
(stale relay codes fail fast on resumed sessions) both merged to main;
worker dispatched on `72e6a20` at 17:10 with both fixes. AWAITING: the
owner's live click-through of Remove and a fresh Connect (real provider
auth — cannot be exercised by an agent).

**GITHUB INSTALL HOST-SKEW FIXED + BOTH PROVIDER PATHS FROZEN (2026-08-16
~21:30Z, goal):** owner goal "(1) lock down both the Claude and Codex
connections. (2) GitHub connection is not returning back data." Part 1:
the Codex device-auth path (worker driver, device-login fragment contract,
device UI branch, migrations 000800–001200) joined the ADR-072 freeze —
policies/PROTECTED_RESOURCES.md extended, ADR-073 recorded. Part 2 root
causes (owner screenshot on softwarefactory-tan.vercel.app): the install
state cookie and Supabase session are host-scoped while the deployment
answers on multiple hostnames, so a launch on one host and a callback on
another could never validate (`github_state_invalid` with a VALID
signature — the "expired or does not match this session" branch); the
failure notice lives in query params nothing cleared, so one stale failure
re-rendered forever; 10-minute state lifetime too short for a real org
install; and the browser callback is the ONLY connections-row-creating
path (webhooks just update known installations), so a dead callback =
GitHub installed, database empty, page truthfully "Connect GitHub to
begin". Fixes (ADR-074): launch + callback 303-converge on the configured
callback host before any cookie/session work; verify failures name their
real cause (invalid vs expired vs different-browser-session); lifetime
30 min; console strips one-shot github params after reading. Recovery for
installed-but-empty: click Connect GitHub again — GitHub re-issues the
callback for installation 153479019 and persist adopts it.

**CANARY ROUND 3 — REAL CAUSES CAPTURED AND FIXED (20:16Z):** the owner
queued "Audit Round 2" (run 8b5fdd2c, worker run 31970012582 on 3aa6cb6 —
the first run carrying the truth-telling fix), and both real failures
surfaced exactly as designed. (A) Run failure `worker_failed`:
"Dependency bootstrap failed" — npm ci inside the pinned container dies
extracting the next package's docs tree onto the bind-mounted workspace
(TAR_ENTRY_ERROR ENOENT on node_modules/next/dist/docs/**.md, ENOTEMPTY
cleanup); deterministic 3/3; same lockfile installs clean on plain
runners, so it is the container/bind-mount npm extraction path. Fix:
bootstrap retries once on a cleaned node_modules and reports both
outputs on a double failure. (B) Recording failure 23514:
tasks_blocked_reason_check caps blocked_reason at 1000 chars
(20260813000900) and redactText appended "\n[TRUNCATED]" BEYOND its
1000-char cap → 1012 chars → every long failure overflowed the
constraint by construction. Fix: the marker now counts inside the cap.
The stuck run recovers by lease-expiry reap → retryable attempt; the
next scheduled worker beat claims it with both fixes aboard.

**FIRST LIVE CANARY BLOCKED BY MUTE FAILURES (20:05Z, in progress):** the
owner queued the first real command (c618be8e, YELLOW: full site audit →
draft PR with docs/AUDIT_2026-08-16.md). The worker claimed it twice
(runs 31969101724 19:57Z and 31969473610 20:04Z) and both attempts died
~25s after "ready" with `Run failure failed: [object Object]` — a double
blindfold: the run execution failed (cause unknown), then recording that
failure via complete_phase1c_run ALSO errored, and safeErrorMessage
rendered the plain PostgREST error object with String() as
"[object Object]", masking both. complete_phase1c_run's signature matches
the code (20260813001300, hosted), so the RPC error is a raised exception
inside the function — invisible until now. Fix shipped: safeErrorMessage
surfaces message/details/hint/code of plain objects (JSON fallback,
redaction preserved); the worker prints the original failure to the
process log BEFORE attempting to record it; a recording failure now
throws a combined message naming both errors. Next: owner re-queues the
audit (idempotency may dedupe identical text — vary the wording), read
the REAL error from the next worker run's log, fix the true cause.

**RESOLVED — GITHUB CONNECTED LIVE (owner screenshots 19:47Z):** banner
"GitHub installation connected with 1 selected repository."; account
surgeservicesllc Connected; fresh installation #154236235, repository
access Selected → surgeservicesllc/SoftwareFactory (main); Codex worker
chip Worker Connected. Path taken: the post-#165 reload showed NO
Workspace card — the owner's login holds exactly one workspace, so the
old installations (primary 153445938 and candidate 153479019, both from
the 2026-08-13 setup) were bound to a workspace this login cannot reach.
Recovery: owner uninstalled the primary GitHub App ("Surge
SoftwareFactory") and clicked Connect GitHub — a genuinely fresh install,
scoped to only the SoftwareFactory repository, bound cleanly to the live
workspace. Residue: the candidate App "Surge SoftwareFactory Next"
remains installed on GitHub with its stale phantom-workspace binding —
inert; optional cleanup is uninstalling it on GitHub. The prior
Phase 1B identifiers (installation 153479019, connection 85591f43,
project b1f23696) are historical, not the live path.

**Round 2 (owner screenshot 21:31Z, after #164 deployed):** the host fix
is verified live — the probe shows theagoras.com hopping to the configured
callback host (softwarefactory-tan.vercel.app) and the owner's retry got
PAST state validation, code exchange, and snapshot fetch, failing at the
database's deliberate cross-tenant guard: "GitHub installation is already
bound to another organization (github_callback_failed)" (42501 from
sync_github_installation — NOT weakened). Meaning: the browser's active
workspace is not the workspace that owns installation 153479019, which
also explains the empty list (connections are workspace-scoped). The
console offered no workspace context once one resolved — the wrong-
workspace trap had no exit. Fix: a Workspace switcher card renders
whenever the person belongs to more than one organization, naming the
current one and switching via /api/organizations/active + reload; its
copy explains both symptoms. Owner recovery: switch workspace on the
Connections page — the existing connection and repositories appear; no
reinstall needed.

**BOTH PROVIDERS LIVE E2E — THE PRODUCT PROMISE HOLDS (2026-08-16 19:07Z):**
owner screenshot: 4 Connected accounts — three Claude (Blackstone, NWV,
Bubaly; connected live ×3 today, all re-verified 19:03:10 by the restored
sweep, proving the 42501 vault-read fix) and **Codex Daniel, "Signed in as
daniel.hughen@gmail.com", verified 19:06:41 — the first live Codex
connection**, completed through the device-code flow (code displayed with
Copy, OpenAI approval, credential sealed under the raised envelope cap,
awaiting_user→verifying transition). The full defect chain that stood
between "worked once" and "works": Enter-as-keystroke (#143), stale-code
fail-fast (#144), coverage linger + release-SHA handover (#151/#158/#161),
sweep non-fatality (#156), cancel-discards-pending (#157),
cancellation-noticing (#158), vault-read grants (#159), envelope cap
(#160), device-flow state gap (#162). Multi-account, multi-provider,
rename, identity, Remove, cancel-cleanup: all owner-verified in
production.

**CLAUDE E2E VERIFIED LIVE ×2, PATH FROZEN BY OWNER (2026-08-16 ~18:00Z):**
the owner confirmed "Claude connected, it is working perfectly" after the
coverage fix — the second live end-to-end connection (first: 17:18Z). The
owner ordered the connection path protected: no modification without a
specific owner instruction. Recorded as a freeze in
policies/PROTECTED_RESOURCES.md (frozen files listed there; diagnosis stays
allowed, fixes go to the owner as proposals). Frozen-good configuration:
main 74843ef.

**COVERAGE REGRESSION FIXED (2026-08-16 17:47Z):** the owner's "Claude is
now not connecting" was a coverage gap, not a code change — the Claude
sign-in code is byte-identical to what connected them at 17:18. The 4.5-min
claim window (#145) left multi-minute holes between GitHub's throttled cron
beats (measured: no worker 17:33:00-17:39:37). Restored the 25-minute
linger — the configuration that worked — and replaced the short deadline
with a staleness self-check: every sweep the idle worker compares main
against its own release SHA and exits on mismatch, so a merge still reaches
the queue within ~5 minutes without ever cancelling a live login.

**CODEX ERROR TRIAGED (2026-08-16 17:42Z):** the owner's "Only Claude
accounts…" failure came from a pre-#146 worker — the string no longer exists
in code, and the first Codex-capable worker run (31961503881, 17:28-17:33)
saw zero pending sessions, so no Codex attempt has yet reached the new
driver. Fresh evidence: the driver's URL phase is probe-PASSED against real
codex-cli 0.147.0 in this container (auth URL captured with client_id +
redirect_uri, port parse 1455, paste roundtrip); the session projection
prints live rows (000400 serving); apply runs for 000600/000700 succeeded;
b6f8fe2 deploy READY; cron handover confirmed (worker 31962262809 live on
b6f8fe2). Second probe (17:44Z): the CLI's own redirect_uri path is exactly
/auth/callback on port 1455, and a fake-callback replay against the live
listener answered HTTP 400 (state mismatch, correctly rejected) — the
replay transport, port, and path are all proven against codex-cli 0.147.0.
Every mechanically-verifiable step of the Codex flow now has evidence;
AWAITING: one owner Codex click-through (REAL PROVIDER AUTH REQUIRED — the
OAuth exchange itself is the only unproven step, and no agent can perform
a human's OpenAI login).

**VERIFYING-DEATH ROOT CAUSE (2026-08-16 16:50Z, named from code against the
live symptom):** the owner's 16:3x sign-in reached "Verifying account" and
died there — the CLI's paste prompt reads raw keypresses, where Enter is a
lone carriage return chunk; `submitCode` wrote `code\n` as ONE chunk, so the
code filled the field and the Enter never registered. The token never
printed, `waitForToken` expired at 120s, and the session failed (silently on
de055c9, which predates the failure logging). Fixed in #143: the keystroke
plan (`codeSubmissionKeystrokes`) types the trimmed code, settles, presses
Enter alone, then once more against paste-burst swallowing — property pinned
by a unit test. Remove-error diagnosis rides the same PR: the route's
`detail` field will read PGRST202 if migration 000500 was missing at click
time (integration lag), which self-heals on apply.

**MAJOR HOSTED FINDING (2026-08-16 16:00Z, production evidence):** the owner's
live screenshot shows the Connecting Claude modal in progress phase — which
only renders after POST /api/ai-accounts/connect returns a sessionId — so
`create_ai_account`/`open_ai_auth_session` EXIST on hosted: **the Supabase
GitHub integration applies migrations on merge to main.** The runbook's
measured position (65 rows @ 20260814002300) is stale; the manual apply
workflow is moot for schema. The pinned HOSTED_LEDGER_ENDS_AT stays until an
owner SQL re-measure confirms the new position (inference ≠ measurement).
Remaining gap to a working sign-in is ONLY the worker: auth-broker.yml now
default-ON (disable via SOFTWAREFACTORY_AUTH_BROKER_DISABLED=true); still
required in Actions secrets: SOFTWAREFACTORY_CREDENTIAL_KEY (must equal the
Vercel value so seals interoperate). UI: the stuck-at-step-1 spinner now
becomes a calm blocked state after the 75s stall window (what happened,
nothing changed, Try Again / Close).

**Hosted apply status (2026-08-16 15:45Z):** owner authorized the apply and
pasted a Supabase access token + DB password INTO CHAT — both treated as
compromised on arrival (standing rule) and NOT used; owner told to rotate
both. Direct CLI apply from the agent container is additionally blocked by
the auto-mode classifier (RED against production — correct guard). Shipped
instead: `.github/workflows/apply-hosted-migrations.yml` — owner adds FRESH
SUPABASE_ACCESS_TOKEN + SUPABASE_DB_PASSWORD as Actions secrets, runs the
workflow with confirmation "apply"; it lists the ledger, repairs the renamed
row idempotently, pushes all outstanding migrations, and lists again as
evidence.

Architecture
- VERIFIED §7 auth architecture (browser→SF→session→broker→CLI→provider→detect→update): merged as #136/#138; acceptance journey test walks it end to end
- VERIFIED §19 domain model (account→profile→worker→bot→role): ai_accounts + bots.ai_account_id + per-account CLAUDE_CONFIG_DIR in worker; credentials never on bot records
- TODO §22 realtime channel for auth sessions (current: 3s bounded polling — acceptable interim, no manual refresh/check-now; note as limitation)

Worker
- VERIFIED worker auth runner + heartbeat on sessions (#136); gated workflow default-OFF
- BLOCKED §8 live worker green-dot state — REAL WORKER REQUIRED (owner: hosted migrations + SOFTWAREFACTORY_CREDENTIAL_KEY secret + SOFTWAREFACTORY_AUTH_BROKER_ENABLED=true)
- TODO §8 calm reconnecting presentation replacing "Worker Stale"/"Worker Not Connected" in normal UX

Claude/Codex Authentication
- VERIFIED Claude: headless setup-token drivable (probe); broker relays code in-page
- BUILT Codex callback-address relay (2026-08-16 17:23Z): the worker drives `codex login` under a pty, reports the auth URL, and replays the pasted dead-localhost callback address against the CLI's own listener (the CLI holds the PKCE verifier and finishes the exchange); the credential sealed is the auth file the CLI writes, matching the existing shape check. UI paste step carries Codex-specific copy ("copy the page's full address"). CLI pinned @openai/codex@0.147.0 in the worker. AWAITING first live Codex click-through (REAL PROVIDER AUTH REQUIRED)
- BLOCKED real end-to-end provider sign-in — REAL PROVIDER AUTH REQUIRED (owner go-live steps + a human at claude.ai)

Multi-Account Isolation
- VERIFIED unbounded accounts/slots; per-purpose seal binding proven (journey test: slot 2 envelope refuses slot 1 purpose); per-account worker config dirs
- BLOCKED §14 live two-account concurrent proof — REAL PROVIDER AUTH REQUIRED

Database
- VERIFIED ai_accounts/ai_auth_sessions/RLS/audit (#136), verification RPCs (#138)
- IN PROGRESS §25/§26 session resume: find_open_ai_auth_session migration + connect-route resume instead of supersede-on-refresh

Account Management
- VERIFIED panel: lifecycle chips, Reconnect, consequence-naming Disconnect (#136)
- TODO §27 Manage menu (Rename, Test Connection, View Bots) + §15 grouped accounts view with per-account bot counts

Bot Creation
- TODO §16 Create Bot wizard (provider→account→name/role→access→autonomy)

Bot Fleet / Details
- TODO §17 Your AI Team cards (role · provider · account · status) + filters; §18 details view

UI/UX (§2-§6, §10-§11, §30-§32, §34)
- IN PROGRESS new Bot Manager home: header+subtitle, +Add AI Account / +Create Bot, summary cards, §3 empty state (Claude/Codex cards, Advanced collapsed), §4 modal, §5/§6 connect screens, §10 progress checklist states, §11 success screen
- IN PROGRESS remove from normal UX: command cards, copy buttons, check-now, Start again/manual-command buttons, OpenRouter CTA, worker banner, zero tabs, control-plane language → Developer Diagnostics section (§35)

Security (§29)
- VERIFIED no passwords/no tokens client-side/sealed vault/audit/rate-shape checks (v1, tested)

Recovery (§23-§26)
- IN PROGRESS resume-on-refresh, duplicate-click protection (server already supersedes; client must resume)
- TODO calm error rewording per §23; §24 matrix noted per-item

Testing / Evidence (§36-§37, §43-§44)
- TODO docs/verification/bot-manager.md evidence ledger
- TODO Playwright screenshot pass over the new surfaces; visual review
- BLOCKED §38-§40 functional acceptance (real Claude/Codex journeys) — REAL PROVIDER AUTH REQUIRED

### Owner goal — BotBuild: AI Accounts + automatic auth broker (opened 2026-08-16)

**LIVE DEFECT (owner report + screenshot, 2026-08-16 15:22Z) — FIXED SAME
HOUR:** clicking Claude in production showed "The Claude sign-in did not
finish — The sign-in could not be started" — the broker backend is not
available on hosted (its migrations/worker are among the owner-gated go-live
steps), and the UI surfaced that as a dead-end error tile requiring another
click. Fix: `AiAccountConnect` gained `onUnavailable` — when the broker
cannot even START a session, the console degrades to the command flow
automatically (zero extra clicks, no error tile), exactly as if the broker
had never been offered; mid-journey failures (worker/timeout) still render
honestly with Start again. The AI Accounts panel's Reconnect keeps the
error tile (it has no command fallback). Console test now pins the
automatic degrade: broker 503 → `connect.mts claude` command visible with
no error and no second click.

**MERGED TO MAIN 2026-08-16 14:47Z:** PR #136 "BotBuild foundation: AI
accounts, auth broker, worker runner, unbounded slots, auto-completing UI"
squash-merged as `859ceed` with both real CI checks green on head `8d08307`
(Lint/typecheck/test/build job 95180034616 success 14:45:37Z; Browser/a11y
job 95180034594 success 14:43:26Z; full local gate: vitest 2804/0, tsc
clean, eslint 0 errors, production build exit 0). Vercel production deploy
of `859ceed`: **VERIFIED — status API `success`, "Deployment has
completed", 14:49:27Z**; live `/solutions/bot-manager` re-checked 200
after the deploy. Go-live remains gated on three owner
actions (migration apply per runbook; Actions secret
SOFTWAREFACTORY_CREDENTIAL_KEY; repo var
SOFTWAREFACTORY_AUTH_BROKER_ENABLED=true) — documented in
`AI/AI_ACCOUNTS_BROKER.md`.

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
  while Claude gets the full broker flow. **Probe result (2026-08-16, this
  container, claude CLI 2.1.233): PASS — headless `claude setup-token` under
  `script -qec` (fake TTY) with an isolated `CLAUDE_CONFIG_DIR` prints the
  OAuth authorize URL (`https://claude.com/cai/oauth/authorize?code=true&…`)
  with no browser and no real TTY; the flow then waits for a pasted code.
  Implementation note: the pty wraps output at 80 columns, so URL capture
  must strip ANSI and join wrapped lines before matching.**

**Task breakdown (loop step 3):**
- [x] P0 | BotBuild | **No hard-coded account/bot maximums** (owner goal
  update 2026-08-16): slots unbounded everywhere — `purposeForSlot`/
  `slotIndexForPurpose` generate `claude_N`/`codex_N` for any N (vault regex
  already admits them); `planConnect` fills the lowest free slot and says
  "full" only at configured capacity (`SOFTWAREFACTORY_MAX_AI_ACCOUNTS_PER_
  PROVIDER`, default 100 — platform capacity, not a product cap); connect
  route + `connect.mts` accept any slot purpose (enum removed); provision
  route resolves `subscription_N` for any N; providers route reports
  discovered-length `subscriptionSlots`; overlay bridge enumerates stored
  purposes via new service-role `list_provider_credential_purposes` (names
  only; falls back to the pre-slot static list against a not-yet-migrated
  hosted DB); console cap removed ("Connect another account" always
  offered). Each bot already carries a unique uuid, per-bot readiness,
  and per-bot assignments; per-bot queue/runtime/logs/history tracking
  beyond assignments remains project-scoped (agent_runs) — gap recorded
  in P1 redesign row | PASS — 89 unit tests across 8 suites + 20
  integration (incl. claude_47 end-to-end walk + enumeration privacy);
  tsc clean; eslint 0 errors | 2026-08-16

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
- [x] P0 | BotBuild | Broker API: POST /api/ai-accounts/connect (plans
  reuse-vs-create against the three purpose slots per provider, opens the
  broker session), GET /api/ai-accounts (identity + lifecycle, no secrets),
  GET sessions/[id] (polling projection; sealed code structurally absent),
  POST sessions/[id]/code (pastes into the WEB APP; sealed via sealSecret
  bound to `ai_auth_relay:<sessionId>` before storage), POST
  sessions/[id]/cancel, POST [accountId]/disconnect. Owner/admin checks +
  same-origin asserts; audit events come from the definer functions
  themselves. `cancel_ai_auth_session` added to the (unmerged) migration —
  cancel ends the session, touches neither account nor credential |
  PASS — 18 route tests + broker suite 11/11; tsc + eslint clean | 2026-08-16
- [x] P0 | BotBuild | Worker auth runner: `lib/worker/auth-broker.ts`
  (DI-tested protocol: claim → start CLI → URL → awaiting_user → poll sealed
  relay code → unseal only into CLI stdin → verifying → token → seal under
  account purpose → connected; failure/timeout/supersession paths),
  `scripts/auth-broker.mts` (env-gated entry, expire sweep, deadline loop),
  `.github/workflows/auth-broker.yml` (repository_dispatch
  `softwarefactory_auth_broker` + cron + manual; gated on repo var
  `SOFTWAREFACTORY_AUTH_BROKER_ENABLED`; claude CLI pinned 2.1.233),
  `wakeAuthBrokerWorker` best-effort dispatch on Connect. Headless probe
  PASS (recorded above); `server-only` split into `lib/security/
  secret-box-core` + `lib/ai-accounts/purposes` so the worker seals/opens
  under plain Node — guarded re-exports keep app imports unchanged. Codex
  refusal RETIRED 2026-08-16 (#146): the worker now drives `codex login`
  via the callback-address relay; the URL phase is probe-PASSED against
  codex-cli 0.147.0 | PASS — 9 runner tests + 18 route tests; script boots under tsx and
  refuses with named env vars; NOT live-tested end-to-end (needs owner:
  Actions secrets SOFTWAREFACTORY_CREDENTIAL_KEY + repo var
  SOFTWAREFACTORY_AUTH_BROKER_ENABLED=true, then a real click-through) |
  2026-08-16
- [x] P0 | BotBuild | Auto-completing UI: `components/ai-account-connect.tsx`
  — every rendered state read from the broker session (3s bounded polling),
  never assumed: waiting-for-worker (honest schedule note + 75s stall
  detection offering the manual path), worker-initializing, awaiting_user
  (real login URL as "Continue to {label} sign-in" opened in a new tab +
  paste-the-code field posting to the relay endpoint), finishing/verifying,
  Connected, failed (sanitized reason + Start again + fallback + Close),
  cancel posts the cancel endpoint. NO check-now button, NO command shown
  on the primary path. Console integration: Claude button broker-first
  ("Connect another account" too); Codex keeps the command flow (its login
  is a localhost callback the worker cannot drive); on connected the
  console maps the account's credentialPurpose (now in GET /api/ai-accounts)
  to the provision slot and finishes with a Ready bot. Fallback preserved:
  broker-can't-start → "Use the manual command instead" → old flow intact |
  PASS — console suite 12/12 incl. full broker walk (no command, no
  check-now, code pasted in-page, Ready + both uncapped follow-ups) and
  fallback walk; tsc + eslint clean | 2026-08-16
- [ ] P1 | BotBuild | Bot Manager redesign: header counts (Worker/Accounts/
  Bots/Roles), empty state per spec (Claude + Codex cards primary, Advanced
  below, OpenRouter demoted), AI Accounts management section (Manage/
  Reauthenticate/Disconnect), Create Bot with AI Account selector
  (ai_account_id), worker-required state | e2e + component tests | P0 rows
- [x] P1 | BotBuild | Disconnect/reauth lifecycle (UI + API):
  `components/ai-accounts-panel.tsx` — org-wide AI Accounts section in the
  Bot Manager listing every account with its honest lifecycle chip
  (Connected / Needs sign-in again / Not signed in yet / Disconnected /
  Revoked), last-verified time, sanitized last error; Disconnect is
  two-step in place and its confirm names the consequence ("Remove its
  credential — confirm") → POST [id]/disconnect (vault row deleted,
  sessions revoked, account kept for Reconnect); Reconnect runs the same
  auto-completing broker flow against exactly that account
  (`AiAccountConnect` gained `accountId`); read-only members see status
  only. Server-side `mark_ai_account_needs_reauth` exists for the
  verification loop (still open) | PASS — 5 panel tests + console 12/12;
  tsc + eslint clean | 2026-08-16
- [x] P1 | BotBuild | Verification loop: migration `20260816000200` adds
  `list_ai_accounts_for_verification` (connected subscription accounts
  only — needs_reauth is repaired by a person, not a sweep) +
  `mark_ai_account_verified` (a routine pass is a timestamp, not an
  event; refuses non-connected accounts). Worker sweep
  (`verifyStoredAccounts`) runs on every auth-broker start: vault row
  exists → seal opens under the current key → provider shape matches
  (sk-ant-… for Claude, JSON auth file for Codex; unknown providers
  pass); each failure demotes via `mark_ai_account_needs_reauth` with a
  named, actionable reason. HONEST LIMIT (documented in the migration
  and `AI/AI_ACCOUNTS_BROKER.md`): shape-level only — a pass never
  asserts the provider still honors the token; that verdict comes from
  real use. Guards: tail pins ×11 → 000200, runbook 85/21, invariants
  +2 service-role functions | PASS — sweep unit tests (pass/3 failure
  kinds/shape table) + behavior 13/13 incl. enumeration scope, refused
  pass, browser-role denial; tsc + eslint clean | 2026-08-16

**#137 merged 2026-08-16 15:02Z** as `3f7a081` (docs + evidence; both CI
checks green); production deploy verified success 15:03:16Z.
- [ ] P2 | BotBuild | Multi-account worker isolation live proof (two Claude
  accounts, no auth collision, per-account config dirs) | live evidence | P0
- [ ] P2 | BotBuild | Docs: architecture, auth lifecycles, worker setup,
  troubleshooting | — | P1
- [x] P3 | BotBuild | Acceptance journey + test matrix:
  `tests/integration/ai-account-acceptance-journey.behavior.test.ts` walks
  the spec's journey end to end against the real migrated chain with the
  REAL worker protocol (`runAuthBrokerOnce` + `verifyStoredAccounts` over a
  PGlite-backed store calling the same definer functions production does):
  Connect → claim → login URL → the person pastes the code (sealed,
  session-bound, attached mid-poll exactly as the route does) → token
  minted → credential sealed into the vault and openable as exactly that
  token → sweep verifies → disconnect empties the vault → reconnect
  re-claims the same account; plus a two-account walk proving seal
  isolation (slot 2's envelope refuses to open under slot 1's purpose).
  The one substitution is the provider CLI (scripted; a human at claude.ai
  cannot be automated) — the live 30-step click-through remains owner
  work after go-live. Matrix coverage to date: 13 behavior + 2 journey
  integration tests, 5 panel + 12 console + 18 route + 12 runner/sweep +
  5 purposes unit tests, all green | PASS | 2026-08-16

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

- **Persistence now exists but is not adopted.** Migration `20260815000700` adds
  `resource_reservations` and `resource_rate_events`, and `acquire_resource_reservation`
  checks and takes a slot under an advisory lock in one statement — closing the failure
  no TypeScript could reach, where two processes each hold their own reservation list and
  each takes the same last slot. `lib/resources/reservation-store.ts` calls it and
  **fails closed**, unlike `store.ts`: an unreadable breaker means "no observed failures"
  and work proceeds, but unreadable *usage* means "unknown", and admitting on unknown
  deletes the limit during exactly the incident it exists for. What is left: the
  migration is **unhosted** (one of nine), and **no live path calls it** — `dispatch`
  still routes against an in-memory set, which is right within one tick and bounds
  nothing across processes. Wiring that is the next unit of work.
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

### Found by the end-to-end audit, left as a judgement call

- **`lib/supabase/browser.ts` has no callers.** `createSupabaseBrowserClient` is exported
  and imported by nothing; the console components use `isBrowserSupabaseConfigured` from
  `browser-config.ts` and fetch through API routes instead. Not deleted, deliberately:
  it is ambiguous whether this is dead by accident or reserved for client-side use,
  `tests/integration/supabase-auth-routes.contract.test.ts` enumerates the file in its
  no-service-role-credential check, and several agents work this repository in parallel,
  so a unilateral delete is the kind of change that collides. Decide it, then act.

The rest of the audit found nothing, which is worth recording so the next agent does not
repeat it: every API route enforces authorization through a shared helper
(`requireActiveOrganization`, `operationsContext`, `tenantRpc*`, `requireGitHubUser`,
`requireAuthenticatedUser`, or webhook signature verification); every public table has RLS
**and** FORCE RLS; no SECURITY DEFINER function is missing `set search_path`; the only
function granted to `anon` is the public newsletter signup; `read_provider_credential` is
service-role-only and returns ciphertext useless without a key deliberately absent from the
database. No `.only`, no empty catch blocks, no floating promises, no `console.log` in
shipped code, no duplicate migration version prefixes.

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
