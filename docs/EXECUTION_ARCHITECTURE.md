# Execution architecture

How an owner command becomes a reviewable draft pull request, and what each step
is and is not allowed to do.

## The loop

```text
Owner command
  -> Orchestrator (deterministic plan: intent, risk, tasks, agents, dependencies)
    -> Durable run queue (Postgres)
      -> Worker tick (leased, bounded, idempotent)
        -> Provider adapter (structured proposal only)
        -> Diff review (scope, protected paths, secrets, recalculated risk)
        -> Isolated branch + commits
        -> Draft pull request
        -> Real repository CI
        -> Bounded repair loop
  -> Human review
```

There is no merge, deploy, or rollback step anywhere in this loop.

## Why the worker is a leased state machine

The runtime has no long-lived process, so an execution model that depends on one
would lose work whenever a function ended. Instead:

- **All state lives in Postgres.** `agent_runs` holds status, step, attempt
  counters, and lease fields. `run_events` is an append-only evidence stream.
  Nothing is held in process memory between steps.
- **A tick leases work.** `/api/worker/tick` calls `claim_agent_runs`, which uses
  `for update skip locked` to hand a small batch of runs to exactly one worker
  and stamps `lease_owner` and `lease_expires_at`.
- **A tick advances each run by a bounded number of steps**, then releases the
  lease and schedules the next attempt.
- **Leases expire.** A crashed tick, a timeout, or a redeploy leaves an expired
  lease, which the next tick reclaims and records as `run.lease_expired`. The
  cost of a lost tick is one step, never a lost run.
- **Closing the browser changes nothing.** No run depends on an open page, a
  websocket, or a signed-in session.

## Tick cadence is a deployment constraint, not a design choice

A run advances by one bounded step per tick, so tick frequency sets how quickly
work moves. The committed `vercel.json` cron runs **once per day**, because the
Vercel Hobby plan rejects any cron that would fire more than daily — a more
frequent entry fails the deployment outright.

A daily tick is a safety floor, not a working cadence. A run that needs six
steps would take six days. To actually operate the loop, do one of:

- **Point an external scheduler at the endpoint.** Any scheduler that can send
  an authenticated request works. Both of these are equivalent:

  ```bash
  curl -X POST https://<host>/api/worker/tick \
    -H "Authorization: Bearer $WORKER_TICK_SECRET"

  curl https://<host>/api/worker/tick \
    -H "Authorization: Bearer $WORKER_TICK_SECRET"
  ```

  A five-minute interval is a reasonable starting point.

- **Move the project to a Vercel plan that allows frequent crons**, then change
  the `schedule` field accordingly.

Ticks are idempotent and lease-guarded, so running several schedulers at once is
safe: each tick claims only unleased work, and a duplicate tick finds nothing to
do rather than double-executing a run.

## Where validation actually happens

**SoftwareFactory does not run a managed project's test suite.** A serverless
function cannot check out a repository and run an arbitrary project's lint,
typecheck, tests, and build within its limits, and pretending otherwise would
make every "validated" claim false.

Instead the worker:

1. asks the provider for a structured set of complete file contents,
2. validates that proposal server-side,
3. commits it to an isolated branch and opens a **draft** pull request,
4. reads the repository's **real** GitHub check runs for that commit, and
5. feeds genuine failures back for a bounded repair attempt.

So the tests that gate a run are the ones the target repository really runs. A
repository with no CI is reported as having no validation evidence rather than
being treated as passing.

## Steps

| Step | What it does | Failure kind on error |
| --- | --- | --- |
| `resolve_repository` | project → primary connection → active installation → selected repository → default branch → base SHA | `repository_conflict` |
| `load_context` | retrieves repository memory and the files the task actually needs | `github_error` |
| `request_provider` | creates a background provider run with the bounded prompt | `authorization`, `provider_*` |
| `await_provider` | polls the provider; returns to the queue while it works | `provider_outage` |
| `review_diff` | scope, protected paths, secret scan, recalculated risk | `protected_resource`, `secret_detected`, `validation_failed` |
| `apply_changes` | creates `factory/<run-id>-<slug>` and commits each file with its expected SHA | `repository_conflict` |
| `open_pull_request` | opens a draft pull request with run evidence | `github_error` |
| `observe_ci` | reads real check runs; drives the bounded repair loop | `ci_failure` |
| `complete` | records the normalized result | — |

## Retry and repair, and the difference between them

- **Retry** covers transient infrastructure failure: provider outage, provider
  or GitHub rate limiting, and worker timeout. `finish_agent_run` requeues with
  a backoff and counts an attempt against `max_attempts`.
- **Repair** covers real validation failure: CI reported a genuine failure, and
  the worker gets one bounded chance per configured attempt to diagnose and fix
  it, with the actual failure text supplied.
- **Policy failures never retry.** A protected-path touch, a detected secret, an
  authorization failure, or an out-of-scope diff ends the run. These need an
  owner decision, not another attempt.

## Cancellation

`request_run_cancellation` cancels a queued run immediately. A leased run is
marked `cancelling`; the worker observes it before its next step and stops
before any further external effect, so a cancelled run never opens a pull
request it had not already opened. History is preserved in both cases.

## Two independent interlocks

These are deliberately separate, and neither can substitute for the other:

| Interlock | Scope | Default | Who can change it |
| --- | --- | --- | --- |
| `organization_settings.execution_enabled` | Whether an **owner-submitted command** may reach a worker. Work always ends at a draft pull request. | OFF | Organization owner |
| `organizations.autonomy_kill_switch_active` | Whether **autonomous** action is possible at all. | Locked ON by a database check constraint | Nobody; a future migration only |

Turning commanded execution on does not enable autonomous approval, merge,
deployment, or rollback. None of those executors exist.

## What the provider is trusted with

Nothing. A provider adapter returns a proposal, and that proposal is untrusted
input:

- Output is parsed against a strict schema, not read as prose.
- An `update` must carry the exact blob SHA the worker was given, so a stale
  edit cannot silently overwrite newer work.
- Every path is checked against the protected-resource classifier.
- Content is secret-scanned before any commit.
- Risk is recalculated from what was actually proposed; unexpected escalation
  stops the run instead of downgrading itself to fit the plan.
- Provider reasoning is never persisted or shown. Run events carry concise
  labels, paths, and counts.

## Owner configuration

| Capability | Required value | Until then |
| --- | --- | --- |
| Codex worker | server-only `OPENAI_API_KEY` | Provider reports **Not Connected**; no run starts |
| Worker scheduling | server-only `WORKER_TICK_SECRET` (or Vercel's `CRON_SECRET`), plus a scheduler running more often than daily | Queued runs are never claimed, or advance only once per day |
| Commanded execution | `execution_enabled` ON, by an owner | Commands are planned and persisted only |
| Deployment visibility | server-only `VERCEL_TOKEN` | Deployment metrics report unavailable, not zero |
