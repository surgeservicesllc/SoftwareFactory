# Applying the unhosted migrations

Written 2026-08-14, after verifying the whole chain on a real PostgreSQL 16 cluster.

This exists because the owner actions were previously described loosely — including by me, as
"three unhosted migrations", which undercounted. There are **six**, and one of them has a
materially different approval requirement from the others.

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

## Not covered here

- **A funded provider key and a registered Phase 1C worker.** Neither exists in any verified
  environment. Any key pasted into a chat transcript is compromised on arrival and must be rotated
  before use, not installed.
- **Vercel Deployment Protection.** Both `*.vercel.app` hosts still return `302` to
  `vercel.com/sso-api`, verified 2026-08-14. See `AI/PRODUCTION_OBSERVATION_EVIDENCE.md` — the
  monitoring consequence is smaller than it first appears, because `https://www.theagoras.com`
  returns `200` and is externally observable.
