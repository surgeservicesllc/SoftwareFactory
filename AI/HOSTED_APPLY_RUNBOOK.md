# Applying the unhosted migrations

Written 2026-08-14, after verifying the whole chain on a real PostgreSQL 16 cluster.
Rebased 2026-08-16 on an owner-measured hosted position (see the section directly below).

**The current total is 19**, named in the list below. The repository total is 114 migration
files. Those two numbers no longer stand in the old relationship, and the reason matters: the
hosted ledger is **not a contiguous prefix** of the local files. It has gaps in the middle and
rows well past them. Any sentence of the form "everything after `X` is outstanding" is therefore
false, and every apply decision made from one has been wrong.
(The guard test derives the repository total from the migration directory, checks that each
version named below is a real file, and checks that the probe in
`.github/workflows/apply-hosted-migrations.yml` asks about exactly this set — so the list and the
probe cannot drift apart.)

## The ledger, measured — 2026-08-18 05:40Z, run `32103778884` (`scope=probe`, read-only)

This supersedes every count and every high-water mark stated below it. The run mutated nothing:
the three apply steps were skipped by their `if:` conditions, and the log shows it.

**Absent from the hosted ledger — 19 versions:**

| Version | Migration | Marker object the probe asks about |
|---|---|---|
| `20260814002500` | provider_credential_vault | table `provider_credentials` |
| `20260814002600` | store_provider_credential | function `store_provider_credential` |
| `20260815000200` | phase2e_portfolio_scheduling | table `scheduling_decisions` |
| `20260815000300` | phase2e_portfolio_scheduler | function `portfolio_capacity_verdict` |
| `20260815000400` | phase2e_project_scoped_agents | body of `plan_phase1c_task_and_run` |
| `20260815000500` | phase2e_breaker_aware_scheduling | function `breaker_cooldown_seconds` |
| `20260815000600` | phase2e_portfolio_visibility | function `portfolio_scheduling_queue` |
| `20260815000800` | report_per_project_view | body of `generate_operations_report` |
| `20260815000900` | guard_project_deletion | function `refuse_project_deletion` |
| `20260815001000` | cross_project_dependencies | function `declare_cross_project_dependency` |
| `20260815001100` | connection_routing_decisions | table `connection_routing_decisions` |
| `20260815001200` | improvement_ledger | table `improvement_ledger` |
| `20260815001300` | improvement_measurement | function `capture_improvement_baseline` |
| `20260815001400` | factory_self_audit | function `audit_factory_health` |
| `20260815001500` | factory_detectors | function `detect_factory_improvements` |
| `20260815001600` | detector_intake | function `propose_improvements_from_detections` |
| `20260816000100` | ai_accounts_auth_broker | table `ai_accounts` |
| `20260816000200` | ai_account_verification | function `list_ai_accounts_for_verification` |
| `20260816000300` | resume_ai_auth_session | function `find_open_ai_auth_session` |

**Present in the hosted ledger:** every other local version, including the whole
`20260817` range — `000100` through `001100`. So the run-review controls, the owner-operated
safety controls, `20260817000700_bot_assignment_configuration` (the Assign Bots wizard's
configuration columns and `assign_bots_to_project`), the custom pipeline templates and the
per-posting model/effort override are **applied on production**.
`20260818000100_removable_accounts_keep_usage_evidence` (drops the usage table's
account cascade so `remove_ai_account` stops dying against the append-only
trigger — probe run 32188102707's 42501) was applied by `scope=broker-functions`
run `32191182958` and verified by probe run `32191381794` (the rolled-back
removal returned `t`). `20260818000200_seed_standard_model_catalogue` (the per-organization
standard model catalogue) was applied by run `32199155823` and measured by
probe run `32199285229` — both organizations hold 8 enabled model
configurations, and a rolled-back `set_agent_provider_assignment` as the
impersonated owner succeeded. `20260819000100_graph_worker_execution` (the
graph executor's service-role claim/persist boundary: `claim_planned_graph`,
`record_node_state_as_worker`, `record_graph_artifact_as_worker`,
`complete_graph_run_as_worker` — all create-or-replace plus grants,
idempotent) was applied by `scope=broker-functions` run `32208528984` and
exercised by the first two real worker dispatches (runs `32208699123`,
`32208975669` — claims, parallel dispatch, containment, and honest FAILED
closes all recorded on production). Its bounded re-claim revision (applied by
run `32209731806`) was then production-proven by worker run `32209893742`:
both failed-only graphs were re-claimed to their three-run cap, and every
node failed on a real provider answer — a session limit — which exposed that
capacity refusals were spending convergence attempts. The current revision
therefore closes capacity-voided runs as CANCELLED (retryable, uncounted,
with a total-run ceiling of 10), and `20260819000200_replant_exhausted_graph`
re-plants one copy of the owner's exhausted first-day readiness graph (fixed
id, so replays are no-ops forever) for the capacity-aware worker to claim
after the limit resets. Worker run `32211229999` then production-verified
the capacity semantics end to end: the re-planted graph was claimed, every
refusal was classified, the run closed CANCELLED, and the drain stopped —
the graph keeps its chances. `20260819000300_tolerant_fan_in` adds the
per-node `tolerates_partial_inputs` bit (guarded ALTER) and re-declares
`create_graph_from_plan` to persist it, so declared fan-ins run with
whatever inputs completed and state their own incompleteness. All of these
re-apply through the same replay-safe `scope=broker-functions` path.
Earlier revisions of this
document and of `todo.md` said the opposite; that claim was drawn from the ledger's old
high-water mark and is withdrawn.

**And the ledger still understates the schema.** The same run's object probe returned 19 of 19
present, among them `scheduling_decisions`, `provider_capacity_limits`,
`projects.engineering_priority`, `projects.strategic_focus` and
`set_project_engineering_priority` — all owned by `20260815000200`, which has no ledger row. That
is unledgered DDL: live schema with no history behind it.

### What follows from that

- The gap is, at least in part, **bookkeeping rather than missing schema**. Where the probe shows
  a marker present, the correct action is `migration repair --status applied <version>` — record
  the history that is already true. Re-running the file would be the wrong move.
- Where the probe shows a marker **absent**, that file genuinely has not run and applying it is
  real DDL against production.
- The probe now reports one row per absent version with a `present` boolean, so it distinguishes
  "absent" from "never asked". The older query printed only what existed, which is why the two
  cases looked alike.
- **Nobody has run the mutating scopes on the strength of this measurement.** Only `scope=probe`
  was run. `AGENTS.md` puts RED actions behind explicit owner approval in Phase 1, and the
  approval section below requires a fresh exact approval per apply — so the repair-versus-apply
  decision above is written down for the owner, not acted on.

### The next run, for whoever executes it

1. `scope=probe` again — it now covers all 19 and prints `f` for anything truly missing.
2. For each version whose marker came back `t`: `migration repair --status applied <version>`.
3. For each version whose marker came back `f`: apply that file, then record it.


> ## Probe before you apply — 2026-08-17 20:5xZ (supersedes every count below as a basis for action)
>
> **The ledger understates the live schema, and every apply decision made from
> it alone has been wrong.** Two runs settled this:
>
> - Run `32068091179` applied the `20260815` range the ledger called
>   outstanding, and stopped at the second file: the enum labels and
>   `organizations.maximum_concurrent_runs` already existed. Nothing was
>   damaged — the failing statement was an `ALTER TABLE`, which is atomic — but
>   the premise was false.
> - Run `32068262957` ran the new read-only `scope=probe` and printed what
>   actually exists. Of the objects the project controls need, **13 of 19 were
>   already live** while the ledger listed their whole range as unapplied.
>
> The method that works is therefore: **`scope=probe` first, apply only what it
> reports missing, and record each file as it lands.** Run `32068584897` did
> exactly that for the six genuinely absent objects — `archive_project`,
> `unarchive_project`, `update_agent_run_review`, `delete_agent_run`, and the
> two `agent_runs.review_*` columns — and a confirming probe (`32068654691`)
> shows 19 of 19 present.
>
> A full `db push` still cannot be used: it refuses outright, because local
> files sort before the remote's last migration. That refusal is the CLI
> protecting production, not a problem to route around with `--include-all`.
>
> The counts in the sections below remain a true description of the *ledger*.
> They are not a description of the database, and should not be used to decide
> what to apply.

> ## Measured live, 2026-08-16 17:07Z — the first full listing (supersedes every earlier measure)
>
> Workflow run `31960618697` (`apply-hosted-migrations.yml`, `scope=broker-functions`, password-only
> pooler connection) printed the complete local-vs-remote ledger. The facts, correcting the earlier
> count-only interpretation below:
>
> - The remote ledger matches local **exactly and contiguously through `20260814002300`** — 64 rows.
> - The one remote-only row was **`20260814000200`** (the pre-split name of `000210`/`000220`/`000250`,
>   all three of which remote records) — **not** `20260814002000`; `20260814000100` was already
>   correctly recorded. The run reverted the stale `000200` row (history only, no DDL).
> - The run then surgically applied and recorded **`20260816000400`** and **`20260816000500`**
>   (both purely `create or replace function` + grants), because production Remove was failing
>   with `PGRST202` on the missing `remove_ai_account`. These two rows now sit above the
>   contiguous prefix with a gap — the position pin below stays at `20260814002300` and the
>   outstanding count keeps counting them, with this note as the reconciliation.
> - **DDL drift, unledgered:** production demonstrably runs schema from migrations that have no
>   ledger rows — the credential vault (`20260814002400`–`002600`) and the broker
>   (`20260816000100`–`000300`) all work live. Something applied their DDL without recording
>   history. A future full `db push` would therefore replay non-idempotent DDL and fail;
>   reconcile by probing each outstanding migration's objects and `migration repair --status
>   applied` the ones already live, before any full push.
>
> ## Measured against hosted, 2026-08-16 (owner SQL, count-only — detail corrected above)
>
> The owner ran, in the production project's SQL Editor:
> `select count(*), max(version) from supabase_migrations.schema_migrations;`
> → **count 65, max `20260814002300`** (screenshot evidence, 2026-08-16).
>
> **The count arithmetic confirms the `20260814002000` derivation at the bottom of this
> document.** The repository holds exactly **64** files at or before `20260814002300`; hosted
> holds **65** rows. The one extra hosted row is `20260814002000_graph_engineering` — applied
> under that version, then renamed locally to `20260814000100` — precisely the remote-only
> version that makes the Supabase integration's comparison fail on every merge and blocks
> every apply path. It is a ledger-bookkeeping problem, not missing schema: the graph
> engineering DDL is present on hosted.
>
> ### Owner order of operations (repair first, then push)
>
> ```bash
> supabase link --project-ref qpuofpmagrmyamahqwxw
> supabase migration list        # confirm: remote shows 20260814002000, not 20260814000100
> # History repair only — no DDL runs:
> supabase migration repair --status reverted 20260814002000
> supabase migration repair --status applied  20260814000100
> supabase migration list        # re-list; the comparison error should be gone
> supabase db push               # applies the 24 outstanding below, in order
> ```
>
> If `migration list` shows anything other than the predicted state, stop and re-derive —
> do not force the repair.
>
> ### The 24 outstanding, in apply order
>
> `20260814002400_connection_registry_multi_account` · `20260814002500_provider_credential_vault`
> · `20260814002600_store_provider_credential` · `20260815000100`–`20260815000600` (Phase 2E
> scheduling, six files) · `20260815000700_project_archive_operation` ·
> `20260815000800_report_per_project_view` · `20260815000900_guard_project_deletion` ·
> `20260815001000_cross_project_dependencies` · `20260815001100_connection_routing_decisions` ·
> `20260815001200_improvement_ledger` · `20260815001300_improvement_measurement` ·
> `20260815001400_factory_self_audit` · `20260815001500_factory_detectors` ·
> `20260815001600_detector_intake` · `20260816000100_ai_accounts_auth_broker`
> · `20260816000200_ai_account_verification` · `20260816000300_resume_ai_auth_session` · `20260816000400_inspect_ai_auth_sessions` · `20260816000500_remove_ai_account`
>
> Each is described, with its verifying suite, in the per-section tables below. None grants
> execution authority or new `service_role` table privileges. **Before pushing**, note the 2E
> capacity defaults (portfolio ceiling 4, 1 reserved, 2 per project, 1 per worker) take effect
> on apply — raise them first with `set_portfolio_capacity_limits` if the factory should run
> wider. After pushing, re-run the post-apply checks listed in the rehearsal section.
>
> The historical position `20260813001400` and the 2026-08-14 measurement (45 rows /
> `20260814000200`) below are retained as history; the measured position above is the one
> to trust.

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

The portfolio migrations, verified together by
`tests/integration/phase2e-portfolio-scheduling.behavior.test.ts` (two competing
projects, real claims through `claim_phase1c_run`; the suite pins the migration tail,
so it cannot pass without having applied every row below).

| Migration | What it adds | Verified by |
|---|---|---|
| `20260815000100_phase2e_scheduling_activity_types` | Five activity types. Enum values only, in their own file because PostgreSQL will not use a new enum value in the transaction that added it | applied by every suite |
| `20260815000200_phase2e_portfolio_scheduling` | Project priority/focus/pause/ceiling columns, organization ceilings and reserve, worker capacity, `provider_capacity_limits`, append-only `scheduling_decisions`, the priority and verdict functions, and the five owner controls | `phase2e-portfolio-scheduling.behavior` |
| `20260815000300_phase2e_portfolio_scheduler` | Portfolio-aware selection inside the existing claim path | `phase2e-portfolio-scheduling.behavior` |
| `20260815000400_phase2e_project_scoped_agents` | One logical agent per role per project, so two projects can run the same role at once | `phase2e-portfolio-scheduling.behavior` |
| `20260815000500_phase2e_breaker_aware_scheduling` | The cooldown rule in SQL, and selection that consults the 2C circuit breakers it already stored | `phase2e-portfolio-scheduling.behavior`, `breaker-cooldown-parity` |
| `20260815000600_phase2e_portfolio_visibility` | Three browser projections: the queue in scheduler order with reasons, portfolio capacity, per-project scheduling state | `phase2e-portfolio-scheduling.behavior` |
| `20260815000700_project_archive_operation` | `archive_project`/`unarchive_project`: owner-only, reason required, immutable events, deletes nothing; the claim path's `status = 'active'` filter is what stops new work | `phase2e-portfolio-scheduling.behavior` |
| `20260815000800_report_per_project_view` | The daily report gains a bounded per-project array (worst health first, archived included); policy version `phase1e-operations-v2` | `phase2e-portfolio-scheduling.behavior` |
| `20260815000900_guard_project_deletion` | An instructive BEFORE DELETE refusal naming the structural rule: every project's append-only activity trail already restricts deletion from its first recorded moment | `phase2e-portfolio-scheduling.behavior` |
| `20260815001000_cross_project_dependencies` | `declare_cross_project_dependency`/`release_cross_project_dependency`: owner-only, reason required, events in both projects, cycle-refusing; edges land in `task_dependencies`, which the claim gate already respects. Carries `submit_command` forward so replays ignore declared cross-project edges | `phase2e-portfolio-scheduling.behavior` |
| `20260815001100_connection_routing_decisions` | Append-only `connection_routing_decisions` + `record_connection_routing_decision`: the Identity Router's selections and refusals become durable, member-readable evidence with every rejected candidate and its named reason | `connection-registry` |
| `20260815001200_improvement_ledger` | Append-only `improvement_ledger` + four recorder functions: Phase 3's proposal/decision/implementation/evaluation lifecycle, refusing proposals without baselines, shortcuts past acceptance, re-decisions, and second evaluations | `improvement-ledger.behavior` |
| `20260815001300_improvement_measurement` | `capture_improvement_baseline` (fourteen-day telemetry window, unmeasured sources named rather than zeroed) + `evaluate_improvement_from_telemetry` (fixed direction table, derived outcome, refuses to guess when nothing compares) | `improvement-ledger.behavior` |
| `20260815001400_factory_self_audit` | `audit_factory_health`: eight telemetry domains read as evidence, each scored by a stated rule or reported unmeasured with a reason; overall score over measured domains only, with confidence and abstention | `improvement-ledger.behavior` |
| `20260815001500_factory_detectors` | `detect_factory_improvements`: five detectors with stated evidence floors — recurring fingerprints, flaky test kinds, sub-second model nodes, failing provider pairs, and a debt inventory — abstaining by name below their floors | `improvement-ledger.behavior` |
| `20260815001600_detector_intake` | `propose_improvements_from_detections`: findings become owner-decidable ledger proposals with machine-captured baselines and metric-named predictions; open questions are never re-proposed, rejections may be re-raised, and nothing is auto-accepted | `improvement-ledger.behavior` |
| `20260816000100_ai_accounts_auth_broker` | `ai_accounts` (provider sign-ins as first-class identities, no secrets stored) + `ai_auth_sessions` (the broker state machine a worker drives through the provider's real login: pending→initializing→awaiting_user→authenticated→verifying→connected, with failed/expired/revoked terminals) + nullable `bots.ai_account_id`; RLS+FORCE with no direct table access for any role, definer-function transitions, activity events throughout | `ai-accounts-auth-broker.behavior` |
| `20260816000200_ai_account_verification` | `list_ai_accounts_for_verification` + `mark_ai_account_verified`: the sweep's two hands — enumerate connected subscription accounts, record a shape-level pass as `last_verified_at` (no event; a routine pass is a timestamp, not a transition); demotion stays with `mark_ai_account_needs_reauth` | `ai-accounts-auth-broker.behavior` |
| `20260816000300_resume_ai_auth_session` | `find_open_ai_auth_session`: the open session an account already has, so a page refresh resumes the sign-in instead of superseding it (authenticated, member-checked, projection excludes the sealed code) | `ai-accounts-auth-broker.behavior` |
| `20260816000400_inspect_ai_auth_sessions` | `inspect_ai_auth_sessions`: bounded read-only session-state projection for the worker's log (status/timing/linkage, never the sealed code) — the diagnosis surface after two live runs and a watching owner disagreed about whether sessions existed | `ai-accounts-auth-broker.behavior` |
| `20260816000500_remove_ai_account` | `remove_ai_account`: stronger than disconnect — deletes the account, its credential, and its sessions; bots detach (never deleted) and read "no account attached" | `ai-accounts-auth-broker.behavior` |
| `20260816001400_project_repository_picker` | `set_project_github_repository` + `unlink_project_github_repository`: owner/admin choice of which GitHub repository an existing project connects to. Same advisory locks as handoff and the change-reservation trigger; one non-archived project per repository with the conflicting project named in the refusal; blocks while a change reservation is pending; immutable `connection.changed` activity evidence; grants to `authenticated` only | `project-repository-picker.behavior` |

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

## Added for Phase 2D

| Migration | What it does | Approval |
| --- | --- | --- |
| `20260814002400_connection_registry_multi_account.sql` | Makes the connection registry describe capability, health and capacity so more than one account per provider becomes routable. Adds `connection_capability_types` (a closed, read-only vocabulary), `connections.capabilities` / `health` / `health_checked_at` / `max_concurrency` / `active_leases`, `project_connections.capability` / `priority`, two routing indexes, and the caller-scoped `list_project_connection_identities(uuid)` projection that never exposes `secret_reference`. | Ordinary forward migration |

It authorizes nothing on its own. No connection gains a capability it was not already
exercising, no project gains a mapping, and a newly created connection is deliberately
routable for nothing until a capability is declared — `capabilities` defaults to `[]` and
`health` defaults to `offline`, so a row existing is never mistaken for a verified account.

Verified on a real PostgreSQL 16.13 cluster with the whole chain applied from empty: all 65
migrations apply in order, 0 of 103 public tables are missing RLS or FORCE RLS, `service_role`
still holds table privileges on exactly the four GitHub ingress tables, and the new vocabulary
table is readable by `authenticated` but writable by nobody through a browser.

## Check this before running `supabase db push`

**A Supabase GitHub integration is installed on this repository.** It reports a
`Supabase Preview` check on pull requests — observed on PR #80, 2026-08-15,
with conclusion `skipped` and a details link to
`https://supabase.com/dashboard/project/qpuofpmagrmyamahqwxw/settings/integrations`.

That matters because this runbook tells you to apply migrations by hand. If the
integration is configured to apply migrations on merge to the production branch,
some or all of the migrations listed above may already be applied by the time
you read this, and a manual `db push` would be operating on a stale picture of
the ledger.

What is actually known, and what is not:

- **Known:** the integration is installed and posts checks on this repository.
- **Known:** the preview check was `skipped` on a pull request that changed
  `supabase/migrations/`, which is consistent with branch previews being off.
- **Not known:** whether merge-to-`main` apply is enabled. No credential in the
  agent environment can read the integration's settings or the hosted ledger.

So the first step of "Order of operations" above — re-list the remote ledger
before trusting any documented position — is not optional caution here. Open
the integrations page linked above, confirm what the integration is set to do
on merge, and only then decide whether a manual push is needed at all.

## The ledger drift blocking every apply, and the exact fix

The Supabase integration's config-parse failure is fixed. It now reaches the
migration comparison and fails there instead, on every merge to `main`:

```
Remote migration versions not found in local migrations directory.
```

That message names no version, so here is the derivation.

Supabase's ledger keys on the **numeric version prefix** only. A migration
renamed in a way that changes that prefix, *after* it was applied, leaves the
old version in the remote ledger with no local file to match — which is exactly
this error. Seven migration renames exist in this repository's history; six kept
a prefix that still exists locally and are harmless. One did not:

| Renamed from | Renamed to | Old prefix still present locally? |
| --- | --- | --- |
| `20260814002000_graph_engineering.sql` | `20260814000100_graph_engineering.sql` | **No** |

`AI/HANDOFF.md` records that `graph_engineering` "was already hosted and could
not move". If it was applied while still named `20260814002000`, the remote
ledger holds `20260814002000`, no local file carries that prefix, and the
comparison fails exactly as observed.

**This is a derivation, not a measurement.** No credential in the agent
environment can read the remote ledger, so confirm before acting:

```bash
supabase link --project-ref qpuofpmagrmyamahqwxw
supabase migration list          # remote column should show 20260814002000
```

If it is there and `20260814000100` is not, the schema effect is already
present and must not be re-run. Repair history only:

```bash
supabase migration repair --status reverted 20260814002000
supabase migration repair --status applied  20260814000100
supabase migration list          # re-list before trusting the result
```

If `migration list` shows something else, stop and re-derive — the table above
is the only candidate this analysis produced, not a guarantee that it is the
only one.

Until this clears, **no migration reaches hosted by any path**: the integration
fails at comparison, and a manual `db push` would be working from the same
mismatched ledger.
