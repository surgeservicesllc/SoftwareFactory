# Handoff

Last updated: 2026-08-13

## Mission and boundary

Phase 1C is implemented on branch `claude/softwarefactory-repo-connect-cwbdib`: the full site build-out plus the first AI engineering execution loop, ending at a human-reviewed draft pull request. Nothing about that loop is live yet. No hosted migration was applied, no provider credential exists, no worker tick has ever run, and no real run has ever executed.

Do not describe GitHub, the Codex worker, the durable tick, or any deployment capability as Connected. Do not describe Phase 1C as complete. Auto approve, merge, deploy, and rollback remain OFF and unimplemented.

Phase 2 (Claude/Anthropic execution) is out of scope and has no adapter.

## Current evidence

- Supabase project `qpuofpmagrmyamahqwxw` is `ACTIVE_HEALTHY`; the hosted ledger ends at migration `010`.
- Local migrations `011`-`016` are committed and unapplied. `014`-`016` add the Phase 1C execution enums, schema, and audited workflows.
- All 16 migrations apply in order to real PostgreSQL (pglite) in test: 26 tables, every one with RLS and FORCE RLS.
- Local gates on the current tree: lint clean, typecheck clean, 31 files / 300 tests passing, production build of 41 routes, Playwright 15/15 across desktop, tablet, and mobile including axe accessibility checks.
- The durable worker boundary is revoked from `public`, `anon`, and `authenticated` in SQL, and a contract test enforces that plus service-role confinement, same-origin coverage, tenant scoping, draft-only pull requests, and the absence of any merge, deploy, or rollback executor.
- Commanded execution defaults OFF per organization and is independent of the Phase 1D kill switch, which remains locked ON.
- GitHub App installation `153286187` still has no authenticated SoftwareFactory callback, connection record, repository sync, or observed webhook delivery.
- No `OPENAI_API_KEY`, `WORKER_TICK_SECRET`, `CRON_SECRET`, or `VERCEL_TOKEN` is configured, so those capabilities report **Not Connected** truthfully.

## Immediate sequence

1. Obtain exact owner approval for hosted migrations `011`-`016`, apply them in order to `qpuofpmagrmyamahqwxw`, then verify the ledger, lint, grants, RLS and FORCE RLS on the four new tables, worker-boundary revocations, run-event immutability, and application health.
2. Verify hosted authenticated RLS allow/deny, cross-tenant and anonymous denial, privileged-RPC authorization, and a real application session.
3. Complete production Supabase Auth and onboarding.
4. Complete the authenticated owner callback for installation `153286187`, persist and sync the connection, link the project, inspect live repository state, create one safe controlled draft PR, and test disconnect and connection-loss paths.
5. Configure and verify the blank/inactive GitHub webhook endpoint, then observe a signed delivery and its audit record.
6. Configure `OPENAI_API_KEY` and `WORKER_TICK_SECRET` as server-only values, redeploy, and confirm `/api/worker/tick` reports configured.
7. Have an owner enable commanded execution for the organization, submit one GREEN command, and observe a complete run: plan, lease, provider call, diff review, isolated branch, draft PR, real CI, and recorded result.
8. Update this memory and the scorecard with exact evidence, and only then issue any Phase 1C completion report.

Steps 1 through 7 all need owner approval, owner credentials, or provider-side configuration. None of them can be completed from the repository alone.

## Safe operating notes

- Never print or commit the App private key, client/state/webhook secrets, OAuth or installation tokens, `OPENAI_API_KEY`, `WORKER_TICK_SECRET`, the service role, or database credentials.
- Service role is confined to the signed webhook and the durable worker tick, plus two audited Phase 1B routes that call SECURITY DEFINER routines which re-validate the actor themselves. Holding it is not authorization.
- The worker never merges, deploys, or rolls back, and never writes to a default branch. Every change is an isolated `factory/*` branch and a draft pull request.
- Provider output is untrusted input: parse it against the schema, require the exact expected blob SHA for an update, check protected paths, scan for secrets, and recalculate risk before any commit.
- Validation evidence comes from the target repository's real CI. Never present a model's claim of success as validation, and never report "no CI configured" as a pass.
- Policy failures — protected resource, detected secret, authorization, out-of-scope diff — must never be retried. They need an owner decision.
- Preserve **Demo Data** and **Not Connected** language wherever live evidence is absent.
- Do not add GitHub administration, workflow, or deployment permissions, and do not add CI deploy credentials.

## Completion checklist

- [x] Phase 1C plan recorded with every area classified.
- [x] Execution schema, audited workflows, and RLS added and verified against real PostgreSQL.
- [x] Provider abstraction, Codex adapter, orchestrator, and durable run engine implemented.
- [x] Every primary page live; no seeded demo content remains in the application.
- [x] Local lint, typecheck, 300 tests, production build, and E2E/responsive/accessibility gates green.
- [x] Security boundary contract test covering service-role confinement, credential isolation, tenant scoping, and absence of any merge/deploy/rollback executor.
- [ ] Hosted migrations `011`-`016` explicitly approved, applied, and verified.
- [ ] Hosted authenticated RLS/RPC/audit behavior verified.
- [ ] Real Supabase authenticated session verified.
- [ ] Real GitHub install/callback/sync/project/read/edit/draft-PR/webhook/audit/disconnect workflow verified.
- [ ] Worker provider and tick credentials configured; one complete real run observed end to end.
- [ ] Failure, revocation, rate-limit, stale-SHA, protected-path, and cancellation states verified against live providers.
- [ ] Documentation, current state, backlog, handoff, and scorecard reflect final live evidence.
