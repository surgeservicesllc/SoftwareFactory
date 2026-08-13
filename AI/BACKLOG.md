# Backlog

Last triaged: 2026-08-13

Checked items have repository/provider evidence only. The owner repository connection is live, but checked items do not make the webhook Connected or Phase 1B complete.

## Phase 1D autonomous-loop controls

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
- [ ] Apply hosted migration `20260813000500`. It relaxes nothing, so it grants no authority by itself. **Owner-gated.**
- [ ] **BLOCKED — enabling any automatic action.** RED under `policies/RISK_CLASSIFICATION.md`; needs a separate owner-approved migration after sustained non-production evidence.
- [ ] **BLOCKED — auto-merge.** `AGENTS.md` forbids introducing the workflow in this line of phases.
- [ ] **BLOCKED — deploy execution and preview validation.** No Vercel API connection; `VERCEL_TOKEN` unset.
- [ ] **BLOCKED — rollback execution.** No adapter; `policies/AUTO_ROLLBACK.md` disables it.
- [ ] **BLOCKED — Codex code and repair execution.** Phase 1C not started.
- [x] Backlog Autopilot **selection**: orders eligible P0–P3 work by priority then lower risk, holds work behind unmet or unknown dependencies, refuses work above the ceiling, and does not pick up new work while a project is degraded, critical or paused. Every exclusion is returned with its reason.
- [x] Revalidate CI, risk, reviews and conflicts against the current head before a merge would be attempted, and never infer branch protection as satisfied. A push after approval invalidates the approval; a push after verification invalidates the gates.
- [x] Plan the response to a failure in the decision layer rather than leaving the ordering to whichever caller drives Phase 1E: freeze first (it only removes authority), rollback fail-closed, bounded repair, escalation for anything left.
- [x] **Never auto-reverse a destructive migration.** A release containing one resolves to owner-only, outranking controls, ceiling and approval.
- [x] Bound retries per stage, with exponential backoff, escalation rather than a further retry once the budget is spent, and no retry at all for a permanent failure.
- [x] Deployment tracking **read** adapter with the real provider contract. It reports **Not Connected** with a reason while no token is configured, and exposes no create, promote, or rollback path.
- [ ] **BLOCKED — Backlog Autopilot execution.** Selection is done; starting the selected work needs `auto_plan` enabled and a worker.

## Phase 1B implementation

- [x] Supabase Auth/onboarding, active organization, tenant-scoped APIs, RLS/FORCE RLS foundations, and immutable Activity reads.
- [x] GitHub App install/callback state/nonce/user/App verification, ephemeral user-token revocation, and short-lived repository/permission-scoped installation tokens.
- [x] Tenant-authorized repository/branch/commit/PR/check/tree/file reads and live Connections/Projects/Files/dashboard surfaces.
- [x] Signed, bounded, schema-validated, delivery-idempotent, redacted webhook ingress.
- [x] Transactional project linking and isolated branch + expected-SHA commit + open draft-PR-only file changes.
- [x] Remove the local HTTP writer and block broad protected/security-sensitive repository paths.
- [x] Add callback redirect errors, strict GitHub web URL validation, connection-loss persistence, truthful disconnected UI, and stable same-intent browser idempotency.
- [x] Add and host migrations `011`-`025` for direct-write closure, terminal/audited change evidence, repository-grant reconciliation, linked-project metadata propagation, draft-PR completion recovery, provider-time installation/repository ordering, terminal deletion, exact-binding change reservation, the minimal service-role sensitive-JSON CHECK-helper grant, safe tenant/Activity list projections, stable repository UUID binding and relink locking, owner-approved protected RED draft changes with approval/token/lease integrity, generic secret-assignment detection, and bounded GitHub activity details.
- [x] Enforce same-origin command mutations and global CSP/security headers; suppress external repository Markdown image loads.
- [x] Restore live Projects sync/visibility, branch protection/SHA, commit/PR timestamps and authors, mergeability, default-branch checks, and per-PR head-SHA checks.
- [x] Keep Autonomous Mode OFF, global kill switch ON, auto approve/merge/deploy/rollback OFF, and Codex/Claude **Not Connected**.
- [x] Register owner-only candidate App `4582606` (`surge-softwarefactory-next`) with the exact callback, a retained active exact webhook URL, least-privilege Phase 1B permissions/events, and distinct Sensitive Production/Preview candidate variable names. This is provider/configuration evidence, not an installation or connection.
- [x] Deploy the isolated dual-App configuration/state/token/webhook boundaries and host owner-only atomic reversible project handoff migration `027`, including fresh processed target-installation delivery provenance, immutable exact RED approval/execution evidence, and cross-App serialization.

## Phase 1B release blockers

- [x] Pass cutover-tree lint/typecheck, 56 files/436 tests, and the 38-route production build; publish main release `799d2cea189b6860a03987ae75c25765f9ac4aca`, whose CI run `31716263910` passed both jobs.
- [x] Pass current-tree coverage: statements 74.76%, branches 75.59%, functions 68.02%, lines 75.82%.
- [ ] Rerun coverage for the candidate cutover tree before publication.
- [x] Retain exact-production Playwright 48/48 across desktop/tablet/mobile including axe and focused signed-out browser-error race 30/30 from the preceding verified release; pass the current exact-commit CI browser/accessibility job.
- [x] Retain the published application-release source/client artifact scan: zero high-confidence non-fixture credential candidates, zero privileged/static marker matches across 27 artifacts, zero tracked key/container files, and only `.env.example` present.
- [ ] Rerun source, tracked-file, and rebuilt-client secret scans for the candidate cutover tree before publication.
- [x] Publish application tree `82f62ff725133c98ea4792c1bfe5dd03d7f222c0` as commit `0bd048565a9e002848c5553ccbe43ab0e217780e` with author/committer `surgeservicesllc <surgeservicesllc@gmail.com>`; CI run `31704289754` passed both jobs, and matching Vercel deployment `dpl_AEirYPnCrKemJjiFX7bKGc7626jX` is READY at its immutable URL and the stable alias.
- [x] Apply hosted migrations `011`-`026` to `qpuofpmagrmyamahqwxw`; verify pre-`027` history matched, dry run/lint were clean, and prior RLS/catalog/browser-grant checks remain recorded.
- [x] Verify the exact post-`026` ACL matrix has zero mismatches: `service_role` has only SELECT/INSERT/UPDATE on the four GitHub ingress tables and no table privileges on the other 19.
- [ ] Verify two authenticated tenants plus anonymous denial and privileged-RPC behavior using caller sessions, not service role as the user-under-test. Only one actual user/email is authorized; a live second tenant was intentionally not created, while local behavioral tests cover the boundary.
- [x] Confirm and authenticate `surgeservicesllc@gmail.com`; complete SoftwareFactory organization/workspace owner onboarding.
- [x] Publish the bounded documented `GET /user/installations` exact-ID callback fix and verify tenant persistence for installation `153445938`.
- [x] Link real connection `d17c63a9-d995-481e-98ce-b737efb32ce5` and project `b1f23696-437e-4d89-b55f-d7a949980e8f`; verify live repository sync, branches, commits, pull requests, checks, tree, and `README.md` reads.
- [x] Create ordinary draft PR `#6` and exact owner-approved protected RED draft PR `#7`; verify both remain draft/unmerged, likely-secret rejection, and immutable approval/provider/audit evidence. Earlier identity-mismatched PRs `#4`/`#5` were closed unmerged and their branches deleted.
- [ ] Complete live stale-SHA, idempotent retry, ambiguous completion recovery, unapproved/admin/expired protected denial, wrong-tenant, revoked-installation, insufficient-permission, rate-limit, and lifecycle failure acceptance. Local tests do not replace the missing provider cases.
- [x] Publish the strict server-only commit-identity boundary, configure `GITHUB_COMMIT_IDENTITY_NAME`/`GITHUB_COMMIT_IDENTITY_EMAIL` in Vercel Production and Preview, and verify both author and committer are `surgeservicesllc <surgeservicesllc@gmail.com>` on draft commits `e789303` and `6a808de`.
- [x] Commit, push, and deploy the dual-App/handoff tree; apply hosted migration `027` to project `qpuofpmagrmyamahqwxw`; and prove its live owner approval/execution/rebind path.
- [x] Install candidate App `4582606` as installation `153479019` for exactly `surgeservicesllc/SoftwareFactory`; verify callback, synchronized App/repository identity, repository/file reads, and a post-sync signed **processed** webhook delivery through connection `85591f43-dd4e-46d2-8a1b-0f036b32639f`.
- [x] Execute the exact owner-confirmed handoff from primary installation `153445938` to candidate installation `153479019`; preserve project `b1f23696-437e-4d89-b55f-d7a949980e8f` and prior history; verify immutable handoff evidence, candidate-backed reads, and draft-only write PR `#8`.
- [x] Close acceptance PR `#8` unmerged after CI `31716958685` and Vercel Preview passed; delete `softwarefactory/20260813154335-9e3952f8-f9d`; verify `main` stayed unchanged by the temporary write.
- [ ] Observe the rollback window and verify the evidence-bound reverse handoff before any primary access is retired. Primary installation `153445938` remains active.
- [x] Keep OPEN Support ticket [#4660724](https://support.github.com/ticket/personal/0/4660724) as the defect record for App `4573846`, whose single webhook still reloads blank/inactive. Candidate success does not retroactively label the primary webhook Connected.
- [ ] Verify explicit disconnect/loss state and history preservation.
- [ ] Configure/verify isolated Preview Supabase values before authenticated preview testing.
- [ ] Publish the owner-facing Phase 1B final report only after every acceptance item passes.

## Release evidence retained

- Verified application release: `799d2cea189b6860a03987ae75c25765f9ac4aca`, tree `a7731dc5626f1d014a446e94e989a1ac3f4f72a1`, CI `31716263910`, Vercel deployment `dpl_853oYWK122qrTHhqtqDhsEYJkKaQ`. Both CI jobs are green and the stable alias serves the READY deployment. Later documentation-only successors do not supersede this runtime evidence unless application code changes.
- Hosted Supabase is current through `027`. The verified pre-`027` dry-run/lint and exact four-table `service_role` ACL matrix remain recorded; live migration-`027` handoff behavior passed.
- Candidate App `4582606`, installation `153479019`, connection `85591f43-dd4e-46d2-8a1b-0f036b32639f`, processed signed webhook, project handoff, candidate reads, and clean draft-only PR `#8` acceptance pass.
- The currently selected local Supabase CLI profile is unauthorized or associated with the wrong account for a fresh recheck. It was not used for any mutation; the prior hosted-through-`026` evidence above remains recorded.
- Connected candidate installation `153479019`, scoped exactly to `surgeservicesllc/SoftwareFactory`; live connection/webhook/project/read/draft-write/audit path passes for the owner. Primary installation `153445938` remains active as rollback.
- Current READY production: `dpl_853oYWK122qrTHhqtqDhsEYJkKaQ`, immutable `https://softwarefactory-7kfx3u1ey-surgeservices-projects.vercel.app`, stable alias, source `main` application commit `799d2cea189b6860a03987ae75c25765f9ac4aca`.
- Temporary downloaded App PEM and ignored provider-verification helper scripts were deleted after use; no credential/helper artifact remains in the repository checkout.
- Last independently verified pre-hardening release: `f12814bd94001e5c9fe9637e0350e14816de8d13` on Vercel deployment `dpl_9M66dxkkNiqTTRVbC2SGqzXzkwju`, public Playwright 12/12.
- Prior local baseline before migrations `014`-`019`: 25 files/208 tests, 34-route build, local Playwright 12/12. Historical only and not proof for the current `020`-`023` tree.

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
- [ ] Apply hosted migrations `028` and `029` to `qpuofpmagrmyamahqwxw` after reauthenticating the Supabase CLI as `surgeservicesllc@gmail.com`.
- [ ] Configure an owner-authorized production monitor target and record the first real observation, detection, and resolution.
- [x] Persist per-project synthetic journey definitions with database-enforced step safety and profile coverage, execute read steps through the bounded probe, and record declared writes as skipped.
- [ ] Authorize a scheduler identity for continuous monitoring without widening `service_role`.
- [ ] Connect Vercel deployment status, error-rate/latency telemetry, database liveness, and job/integration signals.
- [ ] Resolve the residual probe limitation: a public hostname that resolves to a private address at DNS time is not detected.

## Explicitly deferred

- Phase 1C durable Codex/OpenAI worker, sandboxing, leasing, budgets, and execution: **Not Connected; do not start.**
- Phase 1D execution/autonomy beyond the inert observation scaffold: OFF.
- Phase 2 Anthropic/Claude agents: **Not Connected; do not start.**
- Auto approval, merge, deployment, and rollback: OFF with no executor.
- Phase 1E rollback and repair **execution**: deferred behind a provider adapter, the `AUTO_ROLLBACK.md` drills, and an owner-approved migration relaxing the migration-`010` constraint. Phase 1E records the decision; it never performs the action.

## Phase 2A provider layer integration

- [x] Integrate `claude/github-connection-confirm-qe3tqm` into `main`: `lib/providers/*` adapter contract, `/api/providers*` routes, `/api/runs` POST, `/api/agents` POST + `[agentId]/assignment`, `/api/runs/preview`, `ProviderSettings`/`ProviderStatusPanel`/`TaskRunLauncher`, and migration `20260813000100_provider_execution_layer.sql`. See ADR-032 and ADR-033.
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
- [x] Renumber three colliding migrations. The branch's `20260812002000`/`20260812002100` collided with main's hosted `safe_tenant_list_reads` and `bind_projects_to_github_repository_ids`, and its `20260813000100` collided with the provider layer. Hosted filenames are immutable, so the unapplied branch migrations became `20260813000200_bot_fabric_activity_types`, `20260813000300_bot_fabric`, and `20260813000400_marketing_content`.
- [x] Verify security before widening the grant matrix: `bots`, `bot_roles`, `bot_assignments` each enable RLS **and** FORCE RLS with tenant-scoped policies; the eleven marketing tables get both through a `format()` loop, and public read is `revoke all` followed by `grant select` behind a `using (published)` policy.
- [x] Restyle `BotFabricConsole` and the marketing pages onto the design tokens; both arrived with sub-12px text and literal hex values.
- [x] Merge the bot fabric console into Bot Manager alongside main's live request workspace rather than replacing it.
- [ ] Apply migrations `20260813000100`-`20260813000400` to hosted Supabase. Hosted is current through `027`; these four are unapplied and remain RED pending exact owner approval.
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
