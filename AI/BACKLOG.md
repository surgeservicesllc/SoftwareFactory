# Backlog

Last triaged: 2026-08-13

Checked Phase 1C items mean implemented in the local tree, not hosted or Connected. A live check is checked only when exact provider evidence exists.

## Phase 1D autonomous-loop decision controls (execution-inert)

- [x] Complete the nine-action control model (plan, code, test, repair, review, approve, merge, deploy, rollback) at both an organization and a project scope.
- [x] Resolve the two scopes most-restrictive-wins, with the envelope (kill switch, emergency stop, release freeze, missing executor) overriding both.
- [x] Hold the same rule in the database as `public.resolved_autonomy_controls`, `security invoker` so it cannot cross a tenant boundary.
- [x] Classify risk from the actual diff, and block a change that classified higher than it was declared.
- [x] Define the GREEN gate set and the enhanced set YELLOW and RED add on top; treat a missing result as a blocker and keep `not_connected` distinct from `not_run`.
- [x] Add deterministic Review, QA and Security agents whose blocking findings stop progression.
- [x] Return `APPROVED_AUTOMATICALLY` / `OWNER_APPROVAL_REQUIRED` / `NOT_APPROVED`, evaluated after the gates, with an absolute no-self-approval rule.
- [x] Sequence the twelve pipeline stages and halt at the first block.
- [x] Show all nine actions in the interface, with the reason each is off.
- [x] Prove the interlocks against real PostgreSQL and demonstrate the loop end-to-end including the blocked stages.
- [ ] Apply execution-inert Phase 1D migration `130006` only after the hosted ledger is reconciled. It relaxes nothing and grants no authority by itself. **Owner-gated.**
- [ ] **BLOCKED — enabling any automatic action.** RED under `policies/RISK_CLASSIFICATION.md`; needs a separate owner-approved migration after sustained non-production evidence.
- [ ] **BLOCKED — auto-merge.** `AGENTS.md` forbids introducing the workflow in this line of phases.
- [ ] **BLOCKED — deploy execution and preview validation.** No Vercel API connection; `VERCEL_TOKEN` unset.
- [ ] **BLOCKED — rollback execution.** No adapter; `policies/AUTO_ROLLBACK.md` disables it.
- [ ] **BLOCKED — autonomous Codex code and repair execution.** The manual Phase 1C worker is a local candidate and remains **Not Connected**; it is not an autonomous executor.
- [x] Backlog Autopilot **selection**: orders eligible P0–P3 work by priority then lower risk, holds work behind unmet or unknown dependencies, refuses work above the ceiling, and does not pick up new work while a project is degraded, critical or paused. Every exclusion is returned with its reason.
- [x] Revalidate CI, risk, reviews and conflicts against the current head before a merge would be attempted, and never infer branch protection as satisfied. A push after approval invalidates the approval; a push after verification invalidates the gates.
- [x] Plan the response to a failure in the decision layer rather than leaving the ordering to whichever caller drives Phase 1E: freeze first (it only removes authority), rollback fail-closed, bounded repair, escalation for anything left.
- [x] **Never auto-reverse a destructive migration.** A release containing one resolves to owner-only, outranking controls, ceiling and approval.
- [x] Bound retries per stage, with exponential backoff, escalation rather than a further retry once the budget is spent, and no retry at all for a permanent failure.
- [x] Deployment tracking **read** adapter with the real provider contract. It reports **Not Connected** with a reason while no token is configured, and exposes no create, promote, or rollback path.
- [ ] **BLOCKED — Backlog Autopilot execution.** Selection is done; starting the selected work needs `auto_plan` enabled and a worker.

## Phase 1C local implementation

- [x] Add command type, bounded acceptance criteria, deterministic risk assessment, stable idempotency, connected-project filtering, and truthful queued/delayed/RED-blocked responses.
- [x] Resolve repository binding only from the authenticated active tenant and persist exact connection, installation, repository IDs, default branch, and current base SHA.
- [x] Fix provider, model, logical role, budgets, draft-PR workflow, and plan server-side; independently enforce the same boundary in SQL.
- [x] Add provider-neutral logical roles including architect and performance while keeping agent, provider, model, project, and account identities separate.
- [x] Add durable task dependencies, worker status, run leases/heartbeats/attempts/cancellation/retryability, append-only events/artifacts/validations, and bounded terminal reports/activity.
- [x] Add RLS/FORCE RLS, ownership constraints, indexes, secret checks, explicit table/function grants, caller-member safe projections, and service-role-only worker RPCs.
- [x] Preserve hosted-source `130001` and move additive/narrowing Phase 1C provider compatibility into forward migration `130007`.
- [x] Split Phase 1C enum additions into migration `130008` so PostgreSQL commits new enum values before execution migration `130009` uses them.
- [x] Add migration `130010` with an idempotent provider-neutral eleven-role roster for existing/future organizations, rebind factory-created role references, reconcile provider-table ACLs, and keep provider/model on execution runs rather than logical identities.
- [x] Add migration `130011` for canonical same-project dependency submission, deterministic derived acceptance criteria, idempotent dependency replay, and cumulative turn/input/output budgets across retries.
- [x] Harden database command submission to organization owners, include acceptance criteria in SQL risk parity, map general work to Orchestrator, and serialize concurrent work by logical agent.
- [x] Harden immutable artifact replay, draft-PR projection, bounded retry/recovery states, remote recovery revalidation, stale-lease/cancellation terminalization, and structured success/failure/cancellation reports.
- [x] Require a bounded `SOFTWAREFACTORY_REQUIRED_CHECKS` allowlist and verify exact CI names, complete returned check sets, stable repeated success evidence, and unchanged draft-PR base/head before reporting CI passed.
- [x] Add supported `@openai/codex-sdk` server-side adapter with isolated `CODEX_HOME`, bounded turns/tokens/time, structured output, workspace-write sandbox, approval `never`, network disabled, and web search disabled.
- [x] Add exact-base-SHA Git workspace preparation, `factory/*` branches, short-lived repository-ID-scoped App tokens, explicit owner commit identity, and safe branch recovery.
- [x] Add pinned-container dependency bootstrap and network-none deterministic diff/lint/typecheck/test/build validation with bounded output and one repair attempt.
- [x] Add path containment, forbidden path, symlink, binary, secret, protected-resource, file-count, per-file-size, and aggregate-size enforcement.
- [x] Add draft-PR-only publication, existing-draft recovery, exact-head CI observation, and durable result evidence with no merge/deploy authority.
- [x] Add GitHub Actions one-shot worker on opaque repository dispatch and a five-minute recovery schedule with read-only workflow token permissions; omit branch-selectable manual dispatch from the secret-bearing workflow.
- [x] Add tenant-safe agent/task/run/report detail APIs, worker status, run cancellation/retry, and production-data consoles for Dashboard, Bot Manager, Backlog, Agents, Runs, and Reports.
- [x] Keep Autonomous Mode OFF, global kill switch ON, RED non-executable, and auto approve/merge/deploy/rollback OFF.

## Phase 1C verification and protected release blockers

- [x] Frozen Node `24.19.0` candidate passes lint/typecheck, 109 test files/1,169 tests, production build with 74 page/route entries, coverage 75.06/69.97/72.60/76.66, Playwright/axe 117/117, focused migration suites 8 files/104 tests, production dependency audit 0, and safe disabled-worker smoke.
- [ ] Refresh current-tree coverage before protected publication; high-confidence source/static secret-value scans pass, with only allowlisted credential-reference labels present in the client bundle and no credential values.
- [ ] Run the consolidated lint/typecheck/test/build, coverage, browser/accessibility, audit, worker-smoke, migration-chain, secret/static, and severity gates on the exact reconciled Phase 2A/1C tree.
- [ ] Review the final diff for unrelated edits and confirm tracked files contain no credentials, private keys, service-role tokens, generated workspace state, or local environment files.
- [ ] Obtain exact owner RED approval for the protected sequence: ledger-repair only catalog-proven schema-present `028`/`130001`-`130005` without rerunning DDL; apply absent `130006`-`130011`; configure the seven Actions secrets; publish while activation remains OFF; then activate and execute one bounded live GREEN command. Applying `130006` does not enable Phase 1D.
- [ ] Reauthenticate Supabase CLI as `surgeservicesllc@gmail.com`, verify exact project ref `qpuofpmagrmyamahqwxw`, compare migration history, run linked dry run/lint, and stop on any identity/history mismatch.
- [ ] Reconcile exact hosted catalog/source hashes and repair only migration-history rows for schema-present `028`/`130001`-`130005`. Re-list and dry-run; then apply only proven-absent `130006`-`130011`. Never use a normal `db push` before this repair.
- [ ] Exercise real authenticated owner, cross-tenant, and anonymous member/detail/cancel/retry/status RPC behavior. Service role is not a valid user-under-test.
- [ ] Configure protected repository secrets `SOFTWAREFACTORY_SUPABASE_URL`, `SOFTWAREFACTORY_SUPABASE_SERVICE_ROLE_KEY`, `SOFTWAREFACTORY_OPENAI_API_KEY`, `SOFTWAREFACTORY_GITHUB_APP_ID`, `SOFTWAREFACTORY_GITHUB_APP_PRIVATE_KEY_BASE64`, `SOFTWAREFACTORY_GITHUB_CANDIDATE_APP_ID`, and `SOFTWAREFACTORY_GITHUB_CANDIDATE_APP_PRIVATE_KEY_BASE64` without printing values.
- [ ] Verify `SOFTWAREFACTORY_REQUIRED_CHECKS` equals `Lint, typecheck, test, and build|Browser and accessibility tests`, and confirm those exact names still match `.github/workflows/ci.yml` before publication/activation.
- [ ] Keep repository Actions variable `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` absent/false through migration, secret configuration, publication, normal CI, and Vercel verification; prove repository-dispatch and schedule triggers skip.
- [ ] Only after all prior gates, set the variable to `true` under exact owner RED approval, run the bounded acceptance, then return it to absent/false unless continuing authority is separately approved.
- [ ] Publish the exact reviewed tree to the repository default branch with author/committer `surgeservicesllc <surgeservicesllc@gmail.com>` and verify normal CI plus the matching READY Vercel deployment.
- [ ] Confirm the worker status changes from **Not Connected** only after a fresh real heartbeat and returns safely to stale/Not Connected when heartbeat evidence expires.
- [ ] Submit one safe manual GREEN owner command against `surgeservicesllc/SoftwareFactory` and record the real command/task/run/agent IDs, Codex thread, base SHA, `factory/*` branch, commit, open draft PR, validation, exact-head CI, usage, report, and activity evidence.
- [ ] Verify the live run did not change the default branch, approve or merge the PR, deploy, rollback, modify workflows/provider settings, or execute RED work.
- [ ] Exercise cancellation, stale base SHA, dispatch failure/recovery schedule, lease expiry/reclaim, provider rate limit/unavailable, failed validation, CI failure/timeout, one retry, idempotent PR recovery, protected path denial, and likely-secret denial.
- [ ] Update `AI/CURRENT_STATE.md`, `AI/HANDOFF.md`, and `AI/QUALITY_SCORECARD.md` with exact live evidence before calling OpenAI/Codex Connected or Phase 1C complete.

## Phase 1B retained acceptance gaps

- [ ] Complete the live second-tenant/anonymous/RPC matrix.
- [ ] Verify evidence-bound reverse handoff before retiring primary installation `153445938`.
- [ ] Verify explicit disconnect/loss behavior and preserved history.
- [ ] Complete remaining stale-SHA, permission/revocation, rate-limit, lifecycle-ordering, terminal delete/restore, and ambiguous-recovery provider cases.
- [ ] Keep Support ticket `#4660724` as the primary App webhook defect record until resolved.

## Phase 1E production operations

Implemented and locally verified against the migrated schema. Nothing here is live production evidence.

- [x] Add migration `028` with ten RLS/FORCE-RLS operations tables, additive SEV1–SEV4 incident columns, owner-scoped SECURITY DEFINER workflows, and zero new `service_role` table privileges.
- [x] Build provider-neutral monitoring with one connected HTTPS-probe adapter, an explicit Not Connected reason and unblocking condition for every other provider, and a CHECK constraint preventing an unconnected monitor from being enabled.
- [x] Derive `healthy/degraded/critical/unknown/paused` health from real signals with append-only history and a stored reason; resolve absence of evidence to UNKNOWN.
- [x] Create and deduplicate SEV1–SEV4 incidents automatically with upward-only severity escalation and full evidence columns.
- [x] Freeze autonomous releases automatically on SEV1/SEV2; add owner-only resume with acknowledgement, an organization-wide emergency stop, and an owner-only reversal of that stop that never silently lifts a per-project freeze.
- [x] Resolve Last Known Good only from a validated deployment; evaluate rollback fail-closed; escalate a failed rollback to SEV1 with owner attention by constraint.
- [x] Add a deterministic Production Investigator returning cause, cited evidence, subsystem, confidence, action, and risk without intermediate reasoning.
- [x] Create bounded repair work capped at three attempts with escalation, refusing RED and above-ceiling work so the risk policy is not bypassed.
- [x] Add a durable, idempotent operations event queue covering all ten event types with bounded attempts and dead-lettering.
- [x] Gate incident resolution on restoration, a passing same-project validation, root cause, corrective action, and prevention for SEV1/SEV2.
- [x] Add the Operations console, per-project production detail, the daily operations report, and the immutable operations audit trail.
- [x] Pass lint, typecheck, 82 files/819 tests, a clean build, and Playwright 117/117 including axe.
- [ ] Apply hosted migrations `028` and `130002` as part of the exact pending chain to `qpuofpmagrmyamahqwxw` after reauthenticating the Supabase CLI as `surgeservicesllc@gmail.com`.
- [ ] Configure an owner-authorized production monitor target and record the first real observation, detection, and resolution.
- [x] Persist per-project synthetic journey definitions with database-enforced step safety and profile coverage, execute read steps through the bounded probe, and record declared writes as skipped.
- [ ] Authorize a scheduler identity for continuous monitoring without widening `service_role`.
- [ ] Connect Vercel deployment status, error-rate/latency telemetry, database liveness, and job/integration signals.
- [ ] Resolve the residual probe limitation: a public hostname that resolves to a private address at DNS time is not detected.

## Deferred

- Phase 1C live Codex/OpenAI worker execution: **Not Connected** until protected promotion and live acceptance.
- Phase 1D execution/autonomy beyond the inert observation scaffold: OFF.
- Phase 2A provider execution: source is on `main`, but migration/credentials/live calls are absent and the owner switch remains OFF; **Not Connected**.
- Auto approval, merge, deployment, and rollback: OFF with no executor.
- Phase 1E rollback and repair **execution**: deferred behind a provider adapter, the `AUTO_ROLLBACK.md` drills, and an owner-approved migration relaxing the migration-`010` constraint. Phase 1E records the decision; it never performs the action.

## Phase 2A provider layer integration

- [x] Publish the Phase 2A integration on `main` at `b1060b83a0698a83e202aafdf9792886cf60a8b3`: `lib/providers/*` adapter contract, `/api/providers*` routes, `/api/runs` POST, `/api/agents` POST + `[agentId]/assignment`, `/api/runs/preview`, `ProviderSettings`/`ProviderStatusPanel`/`TaskRunLauncher`, and migration `20260813000100_provider_execution_layer.sql`. See ADR-032 and ADR-033.
- [x] Keep the hardened read path: `/api/runs` and `/api/agents` GET still use the `tenantRpcListResponse` safe-projection RPCs. The branch's versions read directly from tables and would have reverted that boundary, so only its POST handlers were taken.
- [x] Verify the three new provider tables (`provider_model_configurations`, `provider_routing_decisions`, `provider_run_events`) each enable RLS **and** FORCE RLS with tenant-scoped policies before adding them to the service-role grant matrix.
- [x] Restyle the three new provider components onto the design tokens; as merged they used sub-12px text and literal hex values, and `/settings` failed axe contrast at three viewports until fixed.
- [x] Scope the runs sensitive-column guard to the GET handler, matching the existing commands-route assertion. The POST handler records provider run input/output/errors by design; the guarantee protected is that the *list view* never projects them.
- [ ] Port the provider assignment control onto the RPC-backed `AgentsConsole`, and surface provider/model/routing on `RunsConsole`. Both need `list_agents`/`list_agent_runs` to return provider columns, which is a migration change. The branch's console tests were removed from `tests/unit/provider-surfaces.test.tsx` rather than asserted against UI this integration does not ship.
- [ ] Provider execution stays OFF until an owner enables it per organization, and no provider key is set in this repository. Outbound AI execution remains **Not Connected**.

## Universal bot fabric and public marketing site

- [x] Integrate `claude/universal-bot-interface-0caeda` into `main`: `lib/bots/*`, `/api/bots`, `/api/bot-roles`, `/api/bot-assignments`, `BotFabricConsole`, and the public marketing route group. See ADR-036 through ADR-040.
- [x] Split the app into two route groups. `app/layout.tsx` no longer renders the shell; `app/(console)/layout.tsx` supplies it, so `app/(marketing)/*` renders without console chrome. The root layout stays `robots: index:false` and the marketing group opts back in.
- [x] `/` is now the public marketing landing and the console home moved to `/solutions`. The navigation Dashboard entry, the shell logo link, and the active-route check all point at `/solutions`.
- [x] Keep **main's** console pages through the move. Git rename detection carried each `app/*/page.tsx` into `app/(console)/`, and every page was verified byte-identical to main afterwards; the branch's 17-hour-old copies were not adopted. `/solutions` serves main's current dashboard, not the branch's stale duplicate, and it lives in the console group so it keeps the app shell.
- [x] Renumber three colliding migrations. The branch's `20260812002000`/`20260812002100` collided with main's hosted `safe_tenant_list_reads` and `bind_projects_to_github_repository_ids`, and its `20260813000100` collided with the provider layer; the later synthetic-journey migration then occupied `130002`. Hosted filenames are immutable, so the unapplied branch migrations became `20260813000300_bot_fabric_activity_types`, `20260813000400_bot_fabric`, and `20260813000500_marketing_content`.
- [x] Verify security before widening the grant matrix: `bots`, `bot_roles`, `bot_assignments` each enable RLS **and** FORCE RLS with tenant-scoped policies; the eleven marketing tables get both through a `format()` loop, and public read is `revoke all` followed by `grant select` behind a `using (published)` policy.
- [x] Restyle `BotFabricConsole` and the marketing pages onto the design tokens; both arrived with sub-12px text and literal hex values.
- [x] Merge the bot fabric console into Bot Manager alongside main's live request workspace rather than replacing it.
- [ ] Ledger-reconcile schema-present `20260812002800`/`20260813000100`-`20260813000500`, then apply absent `20260813000600`-`20260813001100`. The ledger is exactly 26 rows through `027`; all repair/apply work remains RED pending exact owner approval.
- [ ] Decide whether the marketing site should be publicly indexed before the domain is pointed at it. The marketing group sets `robots: index:true` while the root layout stays `index:false`.

## Solutions page global navigation

- [x] Give `/solutions` the marketing global navigation so someone arriving from the public site keeps that wayfinding. The page moved from `app/(console)/` to `app/(portal)/`, whose layout renders `SiteHeader` above `AppShell`.
- [x] Add a `--shell-top` offset to `AppShell`. Its sidebar and header are `fixed`, so without it they would have sat underneath the global navigation. The variable defaults to `0px`, leaving every other console page byte-identical in behaviour.
- [x] Rename the console navigation landmark from "Primary" to "Console". `/solutions` now carries two navigation landmarks, and two sharing an accessible name leaves screen-reader users unable to tell them apart.

## Console migrated under /solutions

- [x] Move every console page from `app/(console)/` into `app/(portal)/solutions/`, so all twelve destinations sit beneath `/solutions` and inherit the global navigation from the portal layout. `app/(console)/` is removed.
- [x] Rewrite every in-app link to the new paths, including the `next=` sign-in return parameters. API routes under `/api/**` are unchanged and were deliberately excluded from the rewrite.
- [x] Update the GitHub install return-path allowlist in `lib/github/state.ts` to `/solutions/connections`, `/solutions/projects`, and `/solutions/files`. Leaving it unchanged would have broken the connect callback, because the allowlist rejects any path not on it.
- [x] Add permanent redirects from each old console path and its subpaths, so existing links, bookmarks, and in-flight provider callbacks keep working.
- [x] Reduce `app/robots.ts` to the single `/solutions` prefix, which now covers the dashboard and every page beneath it.
- [x] Give the two mobile menu buttons distinct accessible names ("Open site navigation" and "Open console navigation"). Both shells render on every `/solutions` page, and two buttons sharing a name left screen-reader users unable to tell them apart.
- [x] Point the Projects console's "Browse files" link at `/solutions/files`. It was the one in-app link the rewrite missed; it worked only by redirect.
- [x] Restore the console's title metadata. The old `app/(console)/layout.tsx` carried a default and template that the move dropped, so every console tab rendered the marketing home page's title. The portal layout supplies them again and each page exports its own title.
- [x] Remove `/solutions` from `sitemap.ts`. It stopped being a marketing page, so the sitemap was advertising a URL that `robots.txt` disallows and the page itself serves as `noindex, nofollow`.
- [x] Use `title.absolute` rather than `title.default` on the portal layout. A layout's `default` is still run through the parent template, so `/solutions` resolved as "Control plane · AI Software Factory · AI Software Factory".
- [x] Add `tests/integration/console-routing.contract.test.ts` to hold the route tree, the redirects, and the crawler directives in agreement. The sitemap/robots assertion was mutation-checked by re-adding the entry.
- [x] Assert page titles in `tests/e2e/pages.spec.ts`. Metadata resolves through nested layouts, so a wrong title is invisible in the source of the page that shows it; both title regressions were found by reading served HTML. Mutation-checked against the doubled title.
- [x] Verify against live production: twelve `/solutions` pages serve both navigation landmarks and the shell offset, every former path returns `308` preserving query strings and subpaths, and `/solutions/projects` serves `noindex, nofollow` while the marketing home stays indexable.

## Maintenance

- [ ] Run final verification on the repository-supported Node version.
- [ ] Before any new hosted database command, reauthenticate the Supabase CLI as `surgeservicesllc@gmail.com` and reconfirm project `qpuofpmagrmyamahqwxw`; do not use the currently selected wrong/unauthorized profile.
- [x] Move Vitest configuration to native ESM (`vitest.config.mts`) to remove the prior config-loader warning.
- [ ] Expand authenticated E2E once a safe disposable live-provider fixture exists.

## Owner review - protected delivery controls

These are recorded for deliberate owner review and are not evidence that Phase 1B provider acceptance passed:

- [ ] Decide whether to enable protection/required checks and require verified signatures on `main`; the branch is currently unprotected and the published release commit is unsigned. Any settings change is a protected owner-approved action.
- [ ] Review unexpected `theagoras.com` Vercel aliases, verify ownership and routing intent, and remove or retain them only through an explicitly approved protected routing change.
