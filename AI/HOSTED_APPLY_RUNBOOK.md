# Applying the unhosted migrations

Written 2026-08-14, after verifying the whole chain on a real PostgreSQL 16 cluster.

This exists because the owner actions were previously described loosely — including by me, as
"three unhosted migrations", which undercounted. There are **six**, and one of them has a
materially different approval requirement from the others.

## What is actually unhosted

The hosted ledger is current through `130014` = `20260813001400_resolve_emergency_stop.sql`.
Everything after that point is unhosted:

| # | Migration | What it does | Approval |
| --- | --- | --- | --- |
| 1 | `20260813001500_expose_bounded_run_routing.sql` | Widens assignment/run model checks 120→128, adds four no-secret constraints, bounded routing projection, revokes raw routing reads | **Fresh exact RED approval required.** Frozen at 13,121 bytes, SHA-256 `3E1BEA…3DD1A13`. Verify that identity before applying. |
| 2 | `20260813001550_serialize_concurrent_operations_writes.sql` | Fixes two real races found on real PostgreSQL: duplicate incident fingerprint, colliding rollback attempt | Ordinary forward migration |
| 3 | `20260813001600_autonomy_decision_audit.sql` | Append-only `autonomy_decisions` | Ordinary forward migration |
| 4 | `20260813001700_link_promoted_repair_task.sql` | `link_repair_promotion`, owner-only | Ordinary forward migration |
| 5 | `20260814000100_phase2c_resource_persistence.sql` | `resource_breakers`, `resource_breaker_events`, `resource_assignments` | Ordinary forward migration |
| 6 | `20260814000300_declare_model_characteristics.sql` + `20260814000200_declare_model_strength_and_context.sql` | Owner-declared model strength/context, and the function that sets them | Ordinary forward migration |

Migration 1 is not mine and I have not verified its frozen identity — only that it applies. Treat
its approval requirement as still standing.

## Verification already done, so you are not applying blind

Run on a real PostgreSQL 16 cluster (not PGlite, which is single-connection and cannot show
ordering or concurrency problems):

| Check | Result |
| --- | --- |
| All 48 migrations apply in order from empty | **Pass** |
| A baseline built to exactly `20260813001400`, then the six applied in order | **Pass, each individually reported** |
| RLS + FORCE RLS on every public table after apply | **Pass — 0 missing of 63** |
| `service_role` table privileges after apply | **Pass — exactly the four GitHub ingress tables** |
| `autonomous_release_allowed` still returns `EXECUTOR_NOT_CONNECTED` unconditionally | **Pass** |
| The three new Phase 2C tables carry RLS and FORCE RLS | **Pass** |
| `link_repair_promotion` present and `SECURITY DEFINER` | **Pass** |

What this does **not** prove: that the hosted ledger rows match what the catalogue says, or that
hosted-only objects behave identically. The ledger on that project was reconciled by hand once
already, so re-list before applying rather than trusting the documented position.

## Order of operations

1. `supabase link` the exact project `qpuofpmagrmyamahqwxw`, then `supabase migration list` and
   confirm the remote ledger really ends at `20260813001400`. If it does not, stop — the position
   this runbook assumes is wrong, and the difference matters.
2. Apply migration 1 only under its own fresh RED approval, after checking the frozen byte size and
   SHA. It is independent of 2–6; skipping it does not block them.
3. Apply 2–6 in order with `supabase db push`.
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

## Not covered here

- **A funded provider key and a registered Phase 1C worker.** Neither exists in any verified
  environment. Any key pasted into a chat transcript is compromised on arrival and must be rotated
  before use, not installed.
- **Vercel Deployment Protection.** Both `*.vercel.app` hosts still return `302` to
  `vercel.com/sso-api`, verified 2026-08-14. See `AI/PRODUCTION_OBSERVATION_EVIDENCE.md` — the
  monitoring consequence is smaller than it first appears, because `https://www.theagoras.com`
  returns `200` and is externally observable.
