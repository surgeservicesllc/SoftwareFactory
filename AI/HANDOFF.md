# Handoff

Last updated: 2026-08-13

## Mission and boundary

Finish the Phase 1C provider-startup recovery and live acceptance without overstating status. The protected Supabase ledger reconciliation and forward-only chain through `130014` are complete on exact project `qpuofpmagrmyamahqwxw`; linked lint and focused runtime/catalog/ACL checks pass. Phase 1C is published on `main` at `7f504255fc9db3a67da936e112825252dc668670`; CI run `31745504157` passed both required jobs and Vercel deployment `dpl_AnVz76EfgBa9RpsrFYWiWNresvbv` is READY. All seven Actions secrets are configured. The first owner-approved live GREEN command was claimed, but Codex provider startup failed before any file change, commit, branch push, or pull request. Durable run `f4594556-6f72-4763-a480-6993939e3651` is failed after attempt 1 of 2 and is retryable. Activation is absent/OFF. A local unpublished recovery patch adds fail-closed preflight and structured terminal-error preservation. No successful Phase 1C run or draft PR exists, so Phase 1C remains **Not Connected**. All automatic actions remain OFF and the global kill switch remains ON.

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

Phase 1D migration `20260813000600_phase1d_autonomy_controls.sql` is applied to hosted Supabase as part of the owner-approved, ledger-reconciled forward chain through `130014`. Hosted resolution confirms all nine actions OFF and the global kill switch ON. Applying that execution-inert decision schema did not authorize or execute an automatic action.

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

The production-operations control plane is implemented in source and migration `028`. Its schema effect and reconciled ledger row are present on hosted Supabase, but no monitor has observed a real production target, so every Phase 1E surface reports **Not Connected** or **Unknown** today.

What it does: monitors production through one bounded HTTPS-probe adapter, derives project health with a stored reason, opens and deduplicates SEV1–SEV4 incidents, freezes autonomous releases automatically on SEV1/SEV2, resolves Last Known Good only from a validated deployment, evaluates rollback fail-closed, diagnoses deterministically, creates bounded repair work, orchestrates ten durable event types idempotently, gates resolution on real restoration evidence, and reports daily.

What it deliberately does not do, and why:

- **No rollback execution.** No deployment provider adapter exists, `policies/AUTO_ROLLBACK.md` disables automatic rollback, and migration `010` pins `auto_rollback` off. Every rollback decision records `EXECUTOR_NOT_CONNECTED`. No database or data migration is ever reversed.
- **No repair execution.** Phase 1C is Not Connected, so repair work is created and left unassigned.
- **No deployment, merge, or scheduled monitoring.** Checks are owner-triggered; authorizing a scheduler identity must not widen `service_role`.

Invariants a future change must not break: `service_role` gains no new table privileges; the four append-only evidence tables stay append-only; `production_monitors_enabled_requires_connection` stays in place so an unconnected monitor cannot be enabled; `rollback_operations_failure_escalates` stays in place so a failed rollback cannot be silent; `incidents_resolution_requires_cause` stays in place so a green deployment cannot close an incident; and `EXECUTOR_NOT_CONNECTED` stays unconditional in `autonomous_release_allowed`.

Released to `main` as merge commit `b243e1ddf9ce8155c4440c56d7b846ccc3d74ce0`; CI run `31731632715` passed both jobs against that commit.

Next Phase 1E steps: configure an owner-authorized monitor target and record the first real detection-to-resolution journey. Hosted ledger reconciliation is complete and must not be replayed.

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
- `028` and canonical `130001`-`130005`: schema effects and reconciled ledger rows are present. Their DDL was not rerun; preserve the completed history-only repair evidence.

### Published Phase 2A/Phase 1C and local recovery candidate

- Command route/composer: connected-project selection, command type, acceptance criteria, stable idempotency, deterministic risk, exact base SHA, fixed plan, opaque dispatch, dispatch evidence, truthful RED/delayed states.
- Orchestration: provider `openai`, model `gpt-5.3-codex`, role mapping, 45-minute/four-turn/token/one-repair/15-minute-CI budgets, and fixed inspect-to-report draft-PR workflow.
- Provider layer already on `main`: official Anthropic/OpenAI adapters, health/model discovery, routing, bounded fallback, independent review, owner execution controls, advisory run persistence, and provider settings/run surfaces; `130001` schema and its reconciled ledger row are hosted, while advisory execution remains OFF/**Not Connected**.
- Schema: `130006` Phase 1D decision-only interlocks; `130007` provider compatibility; `130008` enum-only commit; `130009` core command/task/run/worker/evidence/RLS/RPC schema; `130010` provider-neutral roster, owner/risk/ACL/recovery/report hardening; and `130011` canonical dependencies, derived criteria, idempotent replay, and cumulative retry budgets. All are hosted; `130012`-`130014` are forward-only containment/lint/emergency-stop corrections. Only `130007`-`130013` contain Phase 1C changes.
- Worker: supported `@openai/codex-sdk`, isolated `CODEX_HOME`, controlled environment, exact repository/base-SHA workspace, `factory/*` branch, bounded Codex, pinned Docker validation, protected-path/secret scan, commit/push, draft-PR recovery, exact-head CI observation, bounded repair, redacted persistence.
- Workflow: `.github/workflows/codex-worker.yml` runs one claim on opaque repository dispatch or every five minutes for recovery; branch-selectable manual dispatch is intentionally absent, workflow token permission is contents read, actions are commit-SHA pinned, checkout credentials are not persisted, and the job remains skipped unless the activation variable is literal `true`.
- Recovery patch, still local/unpublished: before every claim, verify the installed Codex CLI is the reviewed `0.147.0` and perform a non-billable exact-model lookup using only the OpenAI secret. The distinct repository-dispatch event `softwarefactory_phase1c_preflight` additionally requests one bounded, non-stored response, then skips Docker preload and durable claim. The Codex adapter retains the redacted structured `turn.failed`/error message if the event iterator subsequently exits with a generic CLI trailer.
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

The non-secret repository Actions variable `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` must equal literal `true` or every repository-dispatch/schedule job is skipped. It is the final fail-closed activation gate. It was enabled only long enough for the first approved acceptance claim and is now absent/OFF; any further activation remains bounded by the exact owner approval.

`SOFTWAREFACTORY_REQUIRED_CHECKS` must be a non-empty, unique pipe-delimited list of 1-20 exact check names. The reviewed workflow value is `Lint, typecheck, test, and build|Browser and accessibility tests`, matching `.github/workflows/ci.yml`. Before activation, verify no CI job rename drift. Missing/invalid configuration blocks worker startup; incomplete/missing/unstable checks or a changed draft PR cannot pass CI.

## Verification state

- The frozen local candidate passes supported Node `24.19.0` lint/typecheck, 109 files/1,169 tests, production build with 74 page/route entries, coverage 75.06/69.97/72.60/76.66, Playwright/axe 117/117, focused migration suites 8 files/104 tests, production dependency audit 0, and safe disabled-worker smoke.
- Hosted history is reconciled through `130014`; linked lint is clean; seven Actions secrets are configured; published commit `7f504255fc9db3a67da936e112825252dc668670`, CI run `31745504157`, and READY Vercel deployment `dpl_AnVz76EfgBa9RpsrFYWiWNresvbv` pass.
- First acceptance evidence: command `0c4d0ca8-1867-4d00-80cf-476401491a17`, durable run `f4594556-6f72-4763-a480-6993939e3651`, and worker Actions run `31746057998`. A real heartbeat and provider thread identifier were recorded, then Codex startup failed. Attempt 1 of 2 is durably failed and retryable. No changed file, factory branch, commit, PR, validation, or exact-head CI evidence was created. Activation is OFF.
- Provider-only diagnostics `31748115992` and `31748221738` both skipped Docker preload and durable claim. The exact model lookup passed; the bounded non-stored Responses call returned HTTP `429`. A local follow-up exposes only the machine-readable error code/type so quota can be distinguished from a transient rate limit without logging the provider message or credential. Attempt 2 remains unconsumed and activation is OFF.
- Focused/full verification and publication of the recovery patch remain pending. No production-monitor journey or successful live Phase 1C provider result exists.

## Immediate sequence

1. Finish focused tests, lint, typecheck, diff/secret review, and consolidated gates for the local recovery patch. Do not consume the remaining durable retry during code verification.
2. Publish the exact reviewed recovery commit with activation absent/OFF; verify both required CI jobs and the matching READY Vercel deployment.
3. Within the existing owner-approved window, enable the activation variable only for the distinct `softwarefactory_phase1c_preflight` repository-dispatch event. This may perform the pinned-CLI/exact-model checks and one bounded non-stored OpenAI response, but it must skip Docker preload and durable claim.
4. Return activation to absent/OFF immediately after that diagnostic job is admitted. If preflight fails or its identity/model/result is ambiguous, stop; attempt 2 must remain unconsumed.
5. Only after preflight passes, re-enable briefly and use the production Retry control for durable run `f4594556-6f72-4763-a480-6993939e3651`. This is its second and final allowed attempt.
6. After claim, return activation to absent/OFF. Observe command -> task -> neutral logical agent -> run -> Codex thread -> validation -> factory branch/commit -> open draft PR -> stable exact-head required checks -> structured report/activity.
7. Prove no default-branch write, approval, merge, deployment, rollback, workflow/provider-setting mutation, secret disclosure, or RED execution occurred.
8. Update repository memory with exact success or failure evidence before changing OpenAI/Codex from **Not Connected**.

## Safe operating notes

- Never print or commit App private keys, client/state/webhook secrets, OAuth/installation tokens, service role, or database credentials.
- Service role is limited to narrow provider-ingress/terminal evidence boundaries and never proves RLS.
- Before any new linked database command, reconfirm the authenticated release identity and exact project `qpuofpmagrmyamahqwxw`; never fall back to the previously wrong/unauthorized profile. No mutation used that profile, and hosted production must never be reset.
- Preserve **Demo Data** and **Not Connected** language when live evidence is absent.
- Keep default-branch writes, non-draft PRs, merge, deploy, rollback, workflow/administration writes, and autonomous execution unavailable.
- `main` is currently unprotected and the published release commit is unsigned; changing branch protection or signature requirements is a separate protected owner-review action.
- Unexpected `theagoras.com` aliases require owner review before any retain/remove routing action; do not mutate protected routing without exact approval.

## Completion checklist

- [x] Hosted migration history is reconciled/current through `130014`; linked lint, focused RLS/catalog/ACL/runtime checks, and live `027` owner approval/execution/rebind behavior pass.
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
