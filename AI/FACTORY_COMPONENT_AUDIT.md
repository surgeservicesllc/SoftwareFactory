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
