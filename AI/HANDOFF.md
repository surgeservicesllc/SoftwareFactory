# Handoff

Last updated: 2026-08-13

## Mission and boundary

Finish verification and protected release of the reconciled Phase 1E/Phase 2A/Phase 1C implementation without overstating live status. Phase 1E operations and synthetic journeys, the Phase 2A provider layer, universal bot fabric, public marketing site, and separated route groups are published on `main`; Phase 1C remains a local candidate. Hosted post-`027` schema objects exist, but the Supabase migration ledger has exactly 26 rows through `027`; duplicate applied version `130002` and five unrecorded applied versions make a normal push unsafe. Phase 1C migrations remain absent. No production monitor or synthetic-journey observation, bot/provider credential/live request, or Codex run is verified; both execution switches are OFF/unverified. Phase 1E monitoring/rollback/repair, Phase 2A provider execution, bot-provider readiness, and Phase 1C Codex execution remain **Not Connected**.

## Phase 1D state for the next agent

The autonomous-loop **decision layer** is complete and lives in `lib/autonomy/`. It decides; it
never executes.

- `controls.ts` — nine automatic actions at two scopes, resolved most-restrictive-wins. Read the
  envelope from `public.resolved_autonomy_controls(project_id)` rather than assuming it.
- `diff-risk.ts` — classifies a real diff. Do not reintroduce caller-declared risk as the only
  input; the whole point is that the thing being judged does not supply its own verdict.
- `gates.ts`, `agents.ts`, `approval.ts`, `pipeline.ts` — the gate sets, the three reviewing
  agents, the approval tri-state, and the twelve-stage machine.

Rules that must survive any future change:

1. **Approval never outranks verification.** Owner approval is evaluated after the gates. If you
   find yourself moving that check earlier, stop.
2. **No self-approval, at any risk level, including for an owner.**
3. **A missing gate result is a blocker, never a pass.**
4. **Blocked stages are named, not skipped.** `MERGE_EXECUTOR_NOT_CONNECTED`,
   `DEPLOY_EXECUTOR_NOT_CONNECTED` and `CODEX_WORKER_NOT_CONNECTED` are asserted in
   `tests/integration/phase1d-loop-journey.behavior.test.ts`. If you connect an executor, those
   assertions are supposed to fail — update them deliberately, and do not weaken them to
   "either blocked or not".
5. **The Phase 1D control migration relaxes nothing.** Enabling any automatic action is a RED action
   requiring an owner-approved migration. Do not do it as a side effect of anything else.

The Phase 1D control migration is not applied to hosted Supabase. Until it is promoted under an
exact owner-approved, uniquely versioned migration chain, the nine-action model exists in source
and local behavioral tests only. Applying that execution-inert decision schema does not authorize
or execute an automatic action.

Manual Phase 1C execution may handle only authenticated owner-submitted GREEN/YELLOW commands. RED remains non-executable. Autonomous Mode is OFF, the global kill switch is ON, and auto approve/merge/deploy/rollback are OFF. The worker ends at an open draft PR plus observed CI; it never writes the default branch or performs delivery.

## Current repository work

Phase 2A is a separate advisory path. It can route a bounded task to an official Anthropic/OpenAI adapter and store a structured analysis artifact only after hosted schema, server credential, provider health, and explicit organization enablement exist. It cannot access a Git workspace or authorize a repository, approval, merge, deployment, rollback, or Phase 1C/1D switch.

## Repository identity

- Exact GitHub repository: `surgeservicesllc/SoftwareFactory`.
- Exact live owner: `surgeservicesllc@gmail.com`.
- Every commit author and committer: `surgeservicesllc <surgeservicesllc@gmail.com>`.
- Existing connected candidate App path: App `4582606`, installation `153479019`, connection `85591f43-dd4e-46d2-8a1b-0f036b32639f`, project `b1f23696-437e-4d89-b55f-d7a949980e8f`.
- Primary installation `153445938` remains rollback; Support `#4660724` remains the webhook defect record.

## Phase 1E production operations

The production-operations control plane is implemented in source and in migration `028`. **Migration `028` is not applied to hosted Supabase**, and no monitor has observed a real production target, so every Phase 1E surface reports **Not Connected** or **Unknown** today.

What it does: monitors production through one bounded HTTPS-probe adapter, derives project health with a stored reason, opens and deduplicates SEV1–SEV4 incidents, freezes autonomous releases automatically on SEV1/SEV2, resolves Last Known Good only from a validated deployment, evaluates rollback fail-closed, diagnoses deterministically, creates bounded repair work, orchestrates ten durable event types idempotently, gates resolution on real restoration evidence, and reports daily.

What it deliberately does not do, and why:

- **No rollback execution.** No deployment provider adapter exists, `policies/AUTO_ROLLBACK.md` disables automatic rollback, and migration `010` pins `auto_rollback` off. Every rollback decision records `EXECUTOR_NOT_CONNECTED`. No database or data migration is ever reversed.
- **No repair execution.** Phase 1C is Not Connected, so repair work is created and left unassigned.
- **No deployment, merge, or scheduled monitoring.** Checks are owner-triggered; authorizing a scheduler identity must not widen `service_role`.

Invariants a future change must not break: `service_role` gains no new table privileges; the four append-only evidence tables stay append-only; `production_monitors_enabled_requires_connection` stays in place so an unconnected monitor cannot be enabled; `rollback_operations_failure_escalates` stays in place so a failed rollback cannot be silent; `incidents_resolution_requires_cause` stays in place so a green deployment cannot close an incident; and `EXECUTOR_NOT_CONNECTED` stays unconditional in `autonomous_release_allowed`.

Released to `main` as merge commit `b243e1ddf9ce8155c4440c56d7b846ccc3d74ce0`; CI run `31731632715` passed both jobs against that commit.

Next Phase 1E steps: apply hosted `028` and `130002` as part of the exact pending chain after reauthenticating the Supabase CLI, configure an owner-authorized monitor target, and record the first real detection-to-resolution journey.

## Implemented boundaries and migration state

### Hosted Phase 1B and published Phase 1E migrations

- `011`: initial direct mutation closure and `github_pat_` detection.
- `012`: actor-attributed terminal change audit.
- `013`: bounded service-role repository-grant reconciliation.
- `014`: exact linked-project repository/default-branch propagation with audit.
- `015`: existing-draft-PR completion recovery.
- `016`: terminal/provider-time installation lifecycle.
- `017`: remaining direct connection/project/link/change-request write closure plus authenticated exact-binding reservation RPC.
- `018`: provider-time repository lifecycle and terminal delete/explicit restore handling.
- `019`: minimal service-role execute on the SECURITY DEFINER sensitive-JSON CHECK wrapper; recursive/text helpers remain inaccessible.
- `020`: remove authenticated base-table SELECT for agents/commands/tasks/runs/reports and add caller-member safe list RPCs.
- `021`: persist stable GitHub repository UUID bindings for projects/change authorization.
- `022`: immutable owner-only RED protected-change approval plus five-minute pre-provider reservation lease/reclaim boundary.
- `023`: bounded verified GitHub activity details with stable repository-to-project attribution.
- `024`: raw Activity/webhook direct-read closure plus caller-member bounded `list_activity`.
- `025`: generic secret-assignment detection, protected approval/reservation/token-order integrity, and serialized stable repository relinking.
- `026`: revoke all `service_role` public-table privileges, then restore only SELECT/INSERT/UPDATE on the four GitHub ingress tables.
- `027`: hosted; immutable owner RED approval/single-use execution, exact candidate signed-delivery provenance/freshness, cross-App repository serialization, atomic history-preserving project handoff, and evidence-bound reverse handoff.
- `028`: **not hosted.** Phase 1E production operations: ten RLS/FORCE-RLS tables, additive SEV1–SEV4 incident evidence, owner-scoped operations workflows, append-only evidence triggers, and zero new `service_role` table privileges.
- `130002`: **not hosted.** Phase 1E synthetic journeys: per-project journey definitions whose step safety and profile coverage are CHECK constraints, so an unsafe journey cannot be stored even if the route is bypassed.

### Published Phase 2A and local Phase 1C candidate

- Command route/composer: connected-project selection, command type, acceptance criteria, stable idempotency, deterministic risk, exact base SHA, fixed plan, opaque dispatch, dispatch evidence, truthful RED/delayed states.
- Orchestration: provider `openai`, model `gpt-5.3-codex`, role mapping, 45-minute/four-turn/token/one-repair/15-minute-CI budgets, and fixed inspect-to-report draft-PR workflow.
- Provider layer already on main: official Anthropic/OpenAI adapters, health/model discovery, routing, bounded fallback, independent review, owner execution controls, advisory run persistence, and provider settings/run surfaces; migration `130001` remains unhosted and execution remains OFF/Not Connected.
- Schema: `130006` enum-only commit; `130007` command/task/run fields, dependencies, workers, leases, events, artifacts, validations, reports/activity, RLS/FORCE RLS, exact grants, safe list/detail/status, cancellation/retry, service-role worker RPCs, authoritative SQL risk/configuration, and RED blocks; `130008` provider-neutral roster, owner-only submission, criteria-aware risk parity, agent serialization, provider-table ACL reconciliation, coherent artifact/retry/recovery, stale-lease/cancellation terminalization, structured reports, and bounded projections.
- Worker: supported `@openai/codex-sdk`, isolated `CODEX_HOME`, controlled environment, exact repository/base-SHA workspace, `factory/*` branch, bounded Codex, pinned Docker validation, protected-path/secret scan, commit/push, draft-PR recovery, exact-head CI observation, bounded repair, redacted persistence.
- Workflow: `.github/workflows/codex-worker.yml` runs one claim on opaque repository dispatch or every five minutes for recovery; branch-selectable manual dispatch is intentionally absent, workflow token permission is contents read, actions are commit-SHA pinned, checkout credentials are not persisted, and the job remains skipped unless the activation variable is literal `true`.
- UI/APIs: bounded list/detail/status for Agents, Backlog, Runs, Reports, Dashboard, and Bot Manager; cancellation and eligible retry; worker status is heartbeat-derived rather than configuration-derived.

## Critical protected configuration

GitHub Actions does not permit secret names beginning `GITHUB_`. The reviewed workflow expects these repository secrets:

- `SOFTWAREFACTORY_SUPABASE_URL`
- `SOFTWAREFACTORY_SUPABASE_SERVICE_ROLE_KEY`
- `SOFTWAREFACTORY_OPENAI_API_KEY`
- `SOFTWAREFACTORY_GITHUB_APP_ID`
- `SOFTWAREFACTORY_GITHUB_APP_PRIVATE_KEY_BASE64`
- `SOFTWAREFACTORY_GITHUB_CANDIDATE_APP_ID`
- `SOFTWAREFACTORY_GITHUB_CANDIDATE_APP_PRIVATE_KEY_BASE64`

The workflow maps the four App values to runtime `GITHUB_*` names only inside the worker step. Never print, persist, copy into source, or expose secret values. The public workflow identity is fixed to `surgeservicesllc <surgeservicesllc@gmail.com>`.

The non-secret repository Actions variable `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` must equal literal `true` or every repository-dispatch/schedule job is skipped. It is the final fail-closed activation gate, currently not verified enabled, and may change only under exact owner RED approval.

`SOFTWAREFACTORY_REQUIRED_CHECKS` must be a non-empty, unique pipe-delimited list of 1-20 exact check names. The reviewed workflow value is `Lint, typecheck, test, and build|Browser and accessibility tests`, matching `.github/workflows/ci.yml`. Before activation, verify no CI job rename drift. Missing/invalid configuration blocks worker startup; incomplete/missing/unstable checks or a changed draft PR cannot pass CI.

## Verification state

- The final reconciled tree passes supported Node `24.19.0` lint/typecheck, 97 files/959 tests, a production build with 62/62 page-data entries, coverage 72.37/66.79/68.80/74.13, Playwright/axe 117/117 across desktop/tablet/mobile, dependency audit 0, safe disabled-worker smoke, clean high-confidence source/static secret-value scans, clean diff check, and focused migration/API security audits with no remaining P0/P1 blocker.
- No hosted migration `028`/`130001` through `130008`, real Phase 1E production or synthetic-journey observation, live bot/Phase 2A provider request, production Phase 1C deployment, workflow execution with secrets, active worker heartbeat, Codex thread, factory branch, Phase 1C commit/PR, structured live report, or stable exact-head required-check result exists.

## Immediate sequence

1. Run and record fresh consolidated gates on the exact reconciled tree.
2. Review the complete diff and migration ACL/RLS/function surface. Confirm RED cannot be claimed, browser input cannot widen provider/model/role/budget/workflow, and worker evidence remains append-only.
3. Ask for one exact owner RED approval covering: apply migration `028` and migrations `130001` through `130008` to `qpuofpmagrmyamahqwxw`; configure the seven protected Actions secrets; publish while disabled; activate for one bounded live GREEN command; and disable after the window.
4. Reauthenticate Supabase as `surgeservicesllc@gmail.com`, reconfirm exact project ref/history, dry-run and lint, then apply `028` -> `130001` -> `130002` -> `130003` -> `130004` -> `130005` -> `130006` -> `130007` -> `130008`. Stop on identity/history/catalog mismatch; never reset hosted production.
5. Verify hosted RLS/FORCE RLS, policies, table/function ACLs, safe projections, service-role RPCs, secret checks, triggers, append-only evidence, owner/cross-tenant/anonymous behavior, and rollback containment.
6. Configure GitHub Actions secrets without rendering their values. Confirm activation remains absent/false and required-check names match CI. Publish the exact reviewed commit, then verify regular CI and matching Vercel deployment while every worker trigger skips.
7. Under the same exact protected approval, set `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED=true`; do not introduce or use a branch-selectable manual workflow dispatch.
8. Submit one narrowly scoped GREEN owner command so the approved default-branch repository dispatch starts the worker (with the schedule only as durable recovery). Observe the active heartbeat during the one-shot run and follow command -> task -> neutral logical agent -> run/recovery -> Codex thread -> validation -> factory branch/commit -> open draft PR -> stable exact-head required checks -> structured report/activity.
9. Restore activation to absent/false after acceptance unless continuing authority was separately approved.
10. Prove no default-branch write, approval, merge, deployment, rollback, workflow/provider-setting mutation, secret disclosure, or RED execution occurred.
11. Update repository memory with exact IDs and evidence before changing OpenAI/Codex from **Not Connected**.

## Safe operating notes

- Never print or commit App private keys, client/state/webhook secrets, OAuth/installation tokens, service role, or database credentials.
- Service role is limited to narrow provider-ingress/terminal evidence boundaries and never proves RLS.
- The currently selected Supabase CLI profile is wrong/unauthorized. Do not run a new linked database command until it is reauthenticated as `surgeservicesllc@gmail.com` and project `qpuofpmagrmyamahqwxw` is reconfirmed. No mutation used the wrong profile; never reset hosted production.
- Preserve **Demo Data** and **Not Connected** language when live evidence is absent.
- Keep default-branch writes, non-draft PRs, merge, deploy, rollback, workflow/administration writes, and autonomous execution unavailable.
- `main` is currently unprotected and the published release commit is unsigned; changing branch protection or signature requirements is a separate protected owner-review action.
- Unexpected `theagoras.com` aliases require owner review before any retain/remove routing action; do not mutate protected routing without exact approval.

## Completion checklist

- [x] Hosted migration history is current through `027`; pre-`027` history matched, prior dry run/lint/RLS/catalog/browser-grant checks pass, and live `027` owner approval/execution/rebind behavior passes.
- [x] Migration `026` is hosted; exact ACL mismatch count is zero, with four intended `service_role` ingress tables and no table privileges on the other 19.
- [x] Current pre-release lint/typecheck, 56 files/436 tests, and 38-route build pass.
- [x] Local and exact production E2E/responsive/accessibility pass 48/48; production focused signed-out race passes 30/30.
- [x] Published application-release source/rebuilt-static and production privileged-marker gates pass.
- [x] Candidate cutover publication passed main CI secret-boundary tests; no secret/helper artifact was committed. Prior full source/client scan evidence remains clean.
- [x] Application release `799d2cea189b6860a03987ae75c25765f9ac4aca` is published, CI `31716263910` passes both jobs, and matching READY production deployment `dpl_853oYWK122qrTHhqtqDhsEYJkKaQ` is verified. Production Playwright 48/48, 13/13 routes, invalid webhook, log, and 20-asset checks pass.
- [x] Migrations `011`-`027` are hosted; the prior dry-run/lint/ACL baseline and live `027` behavior pass.
- [ ] Real Supabase two-tenant/anonymous/RPC behavior passes; the sole owner session passes, and local tests cover the unexecuted second-tenant boundary.
- [x] Real GitHub callback/sync/project/read/edit/ordinary-plus-protected-draft-PR/audit journey passes for the owner connection.
- [x] Exact deployment commit identity is configured server-side in Production/Preview and live draft commits prove matching author and committer without App-bot fallback.
- [x] Dual-App code is deployed, migration `027` is hosted, candidate App `4582606` is installed as `153479019`, and an exact post-sync signed delivery is processed.
- [x] Owner handoff, project/history continuity, candidate-backed reads, draft-only PR `#8`, and cleanup pass.
- [ ] Reverse observation and disconnect/loss journey pass before primary retirement.
- [ ] Failure/revocation/rate-limit/stale-SHA/protected approval/expiry/lease/idempotency/recovery/out-of-order/terminal states pass.
- [ ] Documentation and scorecard reflect final evidence without claiming Phase 1C.
- [x] Phase 1E control plane passes lint, typecheck, 82 files/819 tests, a clean build, and Playwright 117/117 including axe, with the end-to-end journey and failed-rollback escalation proven against the migrated schema.
- [ ] Hosted migration `028` is applied and a real production target is observed before any Phase 1E surface claims live monitoring.
- [x] The control plane is served under `/solutions` and verified live: twelve pages serve both navigation landmarks, every former path returns `308`, and the console stays `noindex` and out of the sitemap. See ADR-041.

## Additional Phase 1C release safeguards

- Do not infer approval for protected migrations/secrets/workflow activation from urgency, prior approval for another phase, or a generic "continue."
- Do not use service role as the user-under-test for RLS acceptance.
- Do not run `supabase db reset` against hosted production or repair/renumber migration history.
- Do not let a Vercel READY state, workflow file, configured secret name, queued command, or mocked SDK response count as a live worker.
- Keep the Phase 1B candidate/primary distinctions and remaining tenant/adverse gaps intact.
- Any new code/schema/provider/deployment change invalidates affected evidence and requires rerunning its gates.
