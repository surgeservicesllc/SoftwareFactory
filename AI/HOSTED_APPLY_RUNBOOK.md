# Applying the unhosted migrations

Written 2026-08-14, after verifying the whole chain on a real PostgreSQL 16 cluster.

This exists because the owner actions were previously described loosely — including by me, as
"three unhosted migrations", which undercounted.

**The current total is 29**, listed across the tables below: seven in "What is actually
unhosted" (row 6 bundles two migrations), eight in "Added 2026-08-14", one in "Added later
the same day", and six in "Added 2026-08-15". One of them has a
materially different approval requirement from the others. The repository total is 70 migration
files; the hosted ledger ends at `20260813001400`, so everything after it is in this document.

These two numbers have gone stale three times, because several agents add migrations in parallel
and none of them is reading this paragraph. `tests/integration/hosted-runbook-counts.test.ts` now
derives both from the migration directory and fails when they drift, so the next person to add a
migration is told to update this sentence rather than discovering later that it lied. The tables
below are not machine-checked and can still fall behind the totals.

> ## Measured against hosted, 2026-08-14 21:00Z — this section supersedes the table below
>
> This runbook told its reader to re-list rather than trust its documented position. That was
> right, and doing so found the position had moved. Read this first.
>
> **The ledger holds 45 rows and ends at `20260814000200`, not `20260813001400`.** The repository
> holds 57 migrations, so **twelve** are unapplied, not six. Nothing in the ledger is missing from
> the repository.
>
> **Migration 1 below is already applied.** `20260813001500_expose_bounded_run_routing.sql` is in
> the ledger *and* its `public.get_agent_run_detail(uuid, uuid)` exists in hosted, so this is a
> real apply rather than an orphaned ledger row. Its frozen identity still matches — 13,121 bytes,
> SHA-256 `3e1bea8f5dab912d…`. **Do not seek fresh RED approval for it; it is done.**
> `20260813001600_autonomy_decision_audit.sql` is likewise applied.
>
> The twelve genuinely unapplied, in apply order:
>
> | # | Migration |
> | --- | --- |
> | 1 | `20260813001550_serialize_concurrent_operations_writes.sql` |
> | 2 | `20260813001700_link_promoted_repair_task.sql` |
> | 3 | `20260814000210_phase2c_resource_persistence.sql` |
> | 4 | `20260814000220_declare_model_strength_and_context.sql` |
> | 5 | `20260814000300_agentos_isolation_model.sql` |
> | 6 | `20260814000310_declare_model_characteristics.sql` |
> | 7 | `20260814000400_agentos_inbox.sql` |
> | 8 | `20260814000500_agentos_templates_and_chains.sql` |
> | 9 | `20260814000600_agentos_compound_engineer_template.sql` |
> | 10 | `20260814000700_agentos_goals.sql` |
> | 11 | `20260814000800_agentos_triggers_and_automations.sql` |
> | 12 | `20260814002200_graph_anchors.sql` |
>
> Two of these — `20260813001550` and `20260813001700` — sort **below** the ledger's high-water
> mark. They were skipped rather than deferred, so `supabase db push` may not pick them up on its
> own; check that it does before assuming it did.
>
> Items 3, 4 and 6 were renumbered while resolving version collisions between concurrent
> workstreams. Item 6 additionally resolves a duplicate that existed on `main`, where
> `agentos_isolation_model` and `declare_model_characteristics` both claimed `20260814000300` and
> one of them could therefore never have been applied.
>
> **An agent cannot apply any of this.** Writing to hosted Supabase is refused by the Claude Code
> auto-mode classifier, which is the correct guard for a RED action against production. Verifying
> the position above was read-only and was allowed.

## What was believed unhosted when this runbook was written

The hosted ledger is current through `130014` = `20260813001400_resolve_emergency_stop.sql`.
Everything after that point is unhosted:

| # | Migration | What it does | Approval |
| --- | --- | --- | --- |
| 1 | `20260813001500_expose_bounded_run_routing.sql` | Widens assignment/run model checks 120→128, adds four no-secret constraints, bounded routing projection, revokes raw routing reads | **Fresh exact RED approval required.** Frozen at 13,121 bytes, SHA-256 `3E1BEA…3DD1A13`. Verify that identity before applying. |
| 2 | `20260813001550_serialize_concurrent_operations_writes.sql` | Fixes two real races found on real PostgreSQL: duplicate incident fingerprint, colliding rollback attempt | Ordinary forward migration |
| 3 | `20260813001600_autonomy_decision_audit.sql` | Append-only `autonomy_decisions` | Ordinary forward migration |
| 4 | `20260813001700_link_promoted_repair_task.sql` | `link_repair_promotion`, owner-only | Ordinary forward migration |
| 5 | `20260814000100_phase2c_resource_persistence.sql` | `resource_breakers`, `resource_breaker_events`, `resource_assignments` | Ordinary forward migration |
| 6 | `20260814000200_declare_model_strength_and_context.sql` + `20260814000250_declare_model_characteristics.sql` | Owner-declared model strength/context, and the function that sets them | Ordinary forward migration |
| 7 | `20260814001100_harden_github_connection_loss.sql` | Redefines `mark_github_connection_lost` so a revocation clears a stale suspension marker instead of reporting the wrong reason, a terminally deleted installation is recorded rather than aborting the call, and a connection with no installation row stops writing a null entity id | Ordinary forward migration. `create or replace` on one function; no table, constraint, or grant change |

Migration 1 is not mine and I have not verified its frozen identity — only that it applies. Treat
its approval requirement as still standing.

## Verification already done, so you are not applying blind

Run on a real PostgreSQL 16 cluster (not PGlite, which is single-connection and cannot show
ordering or concurrency problems):

| Check | Result |
| --- | --- |
| The whole chain applies in order from empty | **Pass** (48 files at the time of that run; 56 now — the later eight are covered in "Added 2026-08-14") |
| A baseline built to exactly `20260813001400`, then the six applied in order | **Pass, each individually reported** |
| RLS + FORCE RLS on every public table after apply | **Pass — 0 missing of 63** |
| `service_role` table privileges after apply | **Pass — exactly the four GitHub ingress tables** |
| `autonomous_release_allowed` still returns `EXECUTOR_NOT_CONNECTED` unconditionally | **Pass** |
| The three new Phase 2C tables carry RLS and FORCE RLS | **Pass** |
| `link_repair_promotion` present and `SECURITY DEFINER` | **Pass** |

Re-verified 2026-08-14 on a fresh PostgreSQL 16.13 cluster with migration 7 included:

| Check | Result |
| --- | --- |
| All 57 migrations apply in order from empty | **Pass** |
| RLS + FORCE RLS on every public table | **Pass — 0 missing of 83** |
| `service_role` table privileges | **Pass — exactly the four GitHub ingress tables, SELECT/INSERT/UPDATE only, no DELETE** |
| Both Phase 1D interlock constraints still present | **Pass** |
| Migration 7 behavior: suspended installation + revocation | **Pass — status `error`, `suspended_at` cleared, prior state preserved as activity evidence** |
| Migration 7 behavior: terminally deleted installation | **Pass — records the loss, returns true, leaves `deleted`/`deleted_at` untouched** |

What this does **not** prove: that the hosted ledger rows match what the catalogue says, or that
hosted-only objects behave identically. The ledger on that project was reconciled by hand once
already, so re-list before applying rather than trusting the documented position.

## Rehearsal on real PostgreSQL 16, 2026-08-14 23:2x UTC

The exact owner scenario was rehearsed end to end on a real PostgreSQL 16.13 cluster with a real ledger, after the version-collision fix. PGlite cannot do this: it has no `supabase_migrations.schema_migrations`, so it cannot show a ledger failure at all — which is precisely the failure mode that matters here.

| Step | Result |
| --- | --- |
| Baseline built to exactly `20260813001400` | **41 ledger rows**, matching the documented hosted position |
| The unhosted migrations applied in filename order, each recorded | **All applied**, ledger ends at 57 |
| Whole chain from empty, as a separate check | **All 57 applied**, 57 ledger rows |

Post-apply verification against that cluster:

| Check | Result |
| --- | --- |
| Public tables | 83 |
| Tables without RLS + FORCE RLS | **none** |
| `service_role` table privileges | exactly `github_change_requests`, `github_installations`, `github_repositories`, `github_webhook_deliveries` |
| `anon` write grants | **none** |
| SECURITY DEFINER functions | 172, **none** without a pinned `search_path` |
| SECURITY DEFINER executable by `anon` | exactly `subscribe_to_newsletter` |
| `autonomous_release_allowed` present | yes |

### Added later the same day

| Migration | What it adds | Verified by |
|---|---|---|
| `20260814002300_guard_resource_assignment_candidates` | A `jsonb_has_sensitive_keys` check on `resource_assignments.candidates` | Applied on the real cluster above; the guard was exercised directly against realistic payloads |

`resource_assignments` already refused credential-shaped text in `agent_id`, `provider`, and `model`, and every other structured-evidence jsonb column in the schema is guarded. `candidates` — which holds those same three identifiers per candidate, plus named rejections and notes — was not. That is an inconsistency rather than a discovered leak: the column is written by the routing layer from server-computed scoring, not from user or model input. It is closed anyway because the column is browser-readable through the table's member SELECT policy, and "notes" is the kind of field a later change quietly widens.

Exercised on the real cluster: benign candidate evidence and an empty array pass; an `api_key` in the payload and a nested `access_token` are both rejected.

### The collision, demonstrated rather than asserted

Replaying the pre-fix state against a real ledger produces exactly the predicted failure:

```
ERROR:  duplicate key value violates unique constraint "schema_migrations_pkey"
DETAIL:  Key (version)=(20260814000300) already exists.
```

The first migration records its version. The second **still applies its DDL** and then fails to record — schema changed, ledger not updated, push aborted partway. That is the half-applied state this fix prevents. With the shipped versions (`20260814000250` and `20260814000300`), both are accepted.

What this rehearsal does **not** prove: that the hosted ledger's actual contents match the documented position. Re-list before applying, as the step below says. It also cannot prove hosted-only behavior — Supabase's own roles, extensions, and defaults differ from a bare cluster.

## Order of operations

1. `supabase link` the exact project `qpuofpmagrmyamahqwxw`, then `supabase migration list` and
   confirm the remote ledger really ends at `20260813001400`. If it does not, stop — the position
   this runbook assumes is wrong, and the difference matters.
2. Apply migration 1 only under its own fresh RED approval, after checking the frozen byte size and
   SHA. It is independent of 2–6; skipping it does not block them.
3. Apply 2–7 in order with `supabase db push`.
4. Re-run the post-apply checks above against hosted.

## After applying

Nothing starts executing. Every interlock is unchanged by design:

- `autonomous_release_allowed` still returns false unconditionally.
- The global kill switch stays ON and all nine automatic actions stay OFF.
- A promoted repair reaches `queued` and stops, because no Phase 1C worker is registered and no
  provider credential exists.

What *does* change is that three surfaces stop erroring and start being truthfully empty: repair
promotion, the Resource Manager console, and routing.

## Then: declare your models

Routing refuses every model until an owner declares its strength and context limit — deliberately,
because an undeclared model must not be assumed strong enough or large enough. Until you do this,
`POST /api/resources/route` correctly returns `NO_ELIGIBLE_WORKER` and names the undeclared models
separately, so the cause is visible rather than looking like a scoring bug.

- `GET /api/resources/models` lists which models are still undeclared.
- `POST /api/resources/models` declares one: `{provider, model, strengthTier, contextLimitTokens}`.
  Sending `null` for either withdraws that declaration, which stays possible on purpose — an owner
  who realises they declared the wrong tier should be able to say "I no longer claim this" rather
  than substitute another guess.

## Added 2026-08-14 — AgentOS and Phase 1D visibility

Eight further migrations are unhosted. All eight apply cleanly in order against real PostgreSQL
(PGlite) on top of everything before them, verified by the suites named beside each.

| Migration | What it adds | Verified by |
|---|---|---|
| `20260814000300_agentos_isolation_model` | 9 tables: environments, MCP connections, skills, default-deny agent grants | `agentos-isolation.behavior` |

Note: `declare_model_characteristics` was renumbered from `20260814000300` to `20260814000250` on 2026-08-14. It had collided with `agentos_isolation_model`, which two agents had independently timestamped the same. See "Version collisions" below.
| `20260814000400_agentos_inbox` | Inbox messages, one open question per run, answer/resume routines | `agentos-inbox.behavior` |
| `20260814000500_agentos_templates_and_chains` | Templates, chain steps, the two completion paths | `agentos-chains.behavior` |
| `20260814000600_agentos_compound_engineer_template` | Seeds the built-in nine-step workflow (idempotent, per organization) | `agentos-chains.behavior` |
| `20260814000700_agentos_goals` | Goals, definition of done, append-only progress, the three rails | `agentos-goals.behavior` |
| `20260814000800_agentos_triggers_and_automations` | Triggers, deliveries, cron automations | `agentos-triggers.behavior` |
| `20260814000900_agentos_safe_list_reads` | Five browser projections for the AgentOS console | `agentos-routes.contract` |
| `20260814001000_phase1d_decision_visibility` | Makes `autonomy_decisions` readable + per-project autonomy status | `phase1d-decision-visibility.behavior` |

What they do **not** do, which is what makes them safe to apply:

- No execution authority. Every AgentOS surface reports `*_RUNNER_NOT_CONNECTED`, and the goal
  spawn decision returns `maySpawn: false` unconditionally.
- No new `service_role` table privileges, so the verified `026` ACL matrix is unchanged. The one
  function `service_role` may call is `agentos_record_trigger_delivery`, and it creates only a
  backlog task.
- No Phase 1D control is relaxed. `20260814001000` is read-only: two projections and their grants.
  A test asserts that reading the trail cannot change what the loop may do.
- Every table carries RLS and FORCE RLS with browser access limited to SELECT.

Order matters only in that `000600` needs `000500`, `000900` needs the tables before it, and
`001000` needs `20260813001600`. Applying them in filename order satisfies all three.

## Added 2026-08-15 — Phase 2E portfolio scheduling

Four further migrations, verified together by
`tests/integration/phase2e-portfolio-scheduling.behavior.test.ts` (13 tests, two competing
projects, real claims through `claim_phase1c_run`).

| Migration | What it adds | Verified by |
|---|---|---|
| `20260815000100_phase2e_scheduling_activity_types` | Five activity types. Enum values only, in their own file because PostgreSQL will not use a new enum value in the transaction that added it | applied by every suite |
| `20260815000200_phase2e_portfolio_scheduling` | Project priority/focus/pause/ceiling columns, organization ceilings and reserve, worker capacity, `provider_capacity_limits`, append-only `scheduling_decisions`, the priority and verdict functions, and the five owner controls | `phase2e-portfolio-scheduling.behavior` |
| `20260815000300_phase2e_portfolio_scheduler` | Portfolio-aware selection inside the existing claim path | `phase2e-portfolio-scheduling.behavior` |
| `20260815000400_phase2e_project_scoped_agents` | One logical agent per role per project, so two projects can run the same role at once | `phase2e-portfolio-scheduling.behavior` |
| `20260815000500_phase2e_breaker_aware_scheduling` | The cooldown rule in SQL, and selection that consults the 2C circuit breakers it already stored | `phase2e-portfolio-scheduling.behavior`, `breaker-cooldown-parity` |
| `20260815000600_phase2e_portfolio_visibility` | Three browser projections: the queue in scheduler order with reasons, portfolio capacity, per-project scheduling state | `phase2e-portfolio-scheduling.behavior` |

What they do **not** do:

- No new execution authority. `20260815000300` replaces the body of a function that already
  existed; the only new refusals are ceilings, and the only new writes are audit rows.
- No new `service_role` table privileges. Both new tables are `SELECT`-to-`authenticated` and
  nothing else, so the verified ACL matrix is unchanged.
- Nothing is cancelled to reprioritise. The emergency reserve holds a slot open by capping
  ordinary work below the ceiling, so an incident never has to interrupt a running job.

Defaults are deliberately conservative and take effect the moment these apply: a portfolio
ceiling of 4 concurrent runs, 1 of them reserved for emergencies, 2 per project, and 1 per
worker. If the factory is currently running more than that, raise the ceilings with
`set_portfolio_capacity_limits` before applying rather than after.

## Version collisions

Two migrations must never share a version prefix. Supabase's ledger keys on the numeric prefix,
not the filename, so two files at `20260814000300_*` are two applies competing for one primary key
in `supabase_migrations.schema_migrations`. The first records the version, the second collides, and
`db push` fails partway with the schema half-applied against hosted.

That state existed in this repository on 2026-08-14 and is fixed: `declare_model_characteristics`
moved to `20260814000250`, which keeps it after the `20260814000220` migration whose columns it
depends on and leaves the AgentOS chain `000300`→`001000` intact. Neither file was hosted, so the
renumber carries no ledger consequence — this was safe to fix precisely because it was caught
before the apply.

Nothing else in the suite catches this class of defect. Both files applied cleanly in isolation,
both applied cleanly in filename order under PGlite (which has no ledger), and every behavioral
test passed, because the failure lives in the ledger rather than the schema. It surfaces for the
first time during the one operation that is hardest to reverse.

`tests/integration/migration-version-uniqueness.test.ts` now asserts uniqueness, that every
filename parses, and that filename order matches version order. It has happened twice, both times
from separate agents picking the same timestamp in parallel, so it is checked rather than
remembered.

## Not covered here

- **A funded provider key and a registered Phase 1C worker.** Neither exists in any verified
  environment. Any key pasted into a chat transcript is compromised on arrival and must be rotated
  before use, not installed.
- **Vercel Deployment Protection.** Both `*.vercel.app` hosts still return `302` to
  `vercel.com/sso-api`, verified 2026-08-14. See `AI/PRODUCTION_OBSERVATION_EVIDENCE.md` — the
  monitoring consequence is smaller than it first appears, because `https://www.theagoras.com`
  returns `200` and is externally observable.
