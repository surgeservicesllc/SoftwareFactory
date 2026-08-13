# Handoff

Last updated: 2026-08-13

## Mission and boundary

Finish the remaining Phase 1B adverse/tenant/rollback observations without disturbing the verified candidate cutover. Hosted migration `027`, main release `799d2cea189b6860a03987ae75c25765f9ac4aca`, candidate App `4582606`, installation `153479019`, connection `85591f43-dd4e-46d2-8a1b-0f036b32639f`, post-sync signed webhook processing, and the owner-approved atomic handoff of project `b1f23696-437e-4d89-b55f-d7a949980e8f` are live. Candidate-backed file read and draft-only PR `#8` write acceptance passed and was cleaned up without merging. Primary installation `153445938` remains active as rollback, and Support ticket `#4660724` remains OPEN for its separate webhook defect. Do not begin Phase 1C or Phase 2, and keep Autonomous Mode OFF, the global kill switch ON, and all automatic actions OFF.

## Current repository work

- The deployed tree supports isolated `primary` and `candidate` GitHub App configurations. Candidate configuration is all-or-nothing and must not reuse App identity, OAuth credentials, private key, state secret, or webhook secret.
- Install state binds slot plus App ID; callback selects and verifies that exact App; repository token minting follows the persisted installation `app_id`; webhook verification accepts configured signing secrets but rejects App-ID/installation provenance mismatches.
- Connections can start the candidate install and show App identity. The owner-only `HANDOFF GITHUB PROJECT` path requires two distinct active installations, the same provider account and immutable external repository, selected/enabled repositories, no pending change reservation, no conflicting active link, and a processed signed webhook delivery for the first target.
- Hosted migration `027` performs the rebind atomically, preserves project UUID and existing history, appends immutable exact-tuple RED approval/execution evidence, serializes against new reservations and cross-App duplicate links, and permits an explicit evidence-bound reverse handoff while both installations remain active. The live candidate handoff passed.

- Callback browser failures return to Connections with bounded safe messages; JSON consumers retain no-store structured errors.
- GitHub-returned browser URLs are constrained to HTTPS `github.com` origins; binary/invalid UTF-8 reads fail safely; pull-list tokens request only necessary permissions.
- Revoked/insufficient-permission token failures are persisted best-effort as connection loss without treating rate limits as revocation.
- Connections/dashboard remove hard-coded onboarding identity, show **Not Connected** when live GitHub evidence is absent, and show the current owner installation from real tenant state.
- Ordinary file changes reuse one idempotency key while an intent is unchanged. A protected path requires exact, short-lived, owner-only RED approval evidence before provider execution; likely secrets remain blocked, and the route still creates only an isolated draft PR.
- The deployed write boundary requires a strictly validated server-only deployment commit identity before authorization or persistence and sends it as both GitHub author and committer. Missing/invalid configuration fails before database/provider effects; the values never enter browser responses, Supabase rows, or logs. Production/Preview configuration and live ordinary/protected attribution both pass.
- Five-minute reservations are reclaimable only for the original exact intent before any provider execution/evidence. Entering the persisted provider boundary permanently blocks lease reclamation.
- If GitHub created an isolated branch, commit, and draft PR but database completion was ambiguous, the route can recover the same request from bounded provider evidence.
- Webhook schemas retain provider timestamps. Installation/repository transitions reject stale/out-of-order state, preserve terminal deletion, and require an explicit newer repository restore that remains unselected pending access sync.
- Project/change authorization, project-picker matching, and webhook attribution use the immutable tenant-scoped repository UUID, not a mutable repository name. Active project linking is transaction-serialized and relinking is allowed only after archival. Projects renders provider sync/branch/commit/PR/check detail, including detail-fetched mergeability, per-PR head-SHA checks, and created/updated times.
- Browser tenant lists come from caller-bound bounded RPC projections; authenticated raw Activity/webhook reads are revoked behind `list_activity`; commands enforce same-origin; global CSP/security headers restrict browser resource loads.
- Generic non-placeholder secret assignments are blocked. Protected approval snapshots are bound to exact reservations and revalidated before the write-scoped GitHub token is minted.
- A server-verified signed-out hint lets the dashboard skip protected browser fetches; exact production passes the focused browser-error race 30/30 and full Playwright 48/48.

## Phase 1E production operations

The production-operations control plane is implemented in source and in migration `028`. **Migration `028` is not applied to hosted Supabase**, and no monitor has observed a real production target, so every Phase 1E surface reports **Not Connected** or **Unknown** today.

What it does: monitors production through one bounded HTTPS-probe adapter, derives project health with a stored reason, opens and deduplicates SEV1–SEV4 incidents, freezes autonomous releases automatically on SEV1/SEV2, resolves Last Known Good only from a validated deployment, evaluates rollback fail-closed, diagnoses deterministically, creates bounded repair work, orchestrates ten durable event types idempotently, gates resolution on real restoration evidence, and reports daily.

What it deliberately does not do, and why:

- **No rollback execution.** No deployment provider adapter exists, `policies/AUTO_ROLLBACK.md` disables automatic rollback, and migration `010` pins `auto_rollback` off. Every rollback decision records `EXECUTOR_NOT_CONNECTED`. No database or data migration is ever reversed.
- **No repair execution.** Phase 1C is Not Connected, so repair work is created and left unassigned.
- **No deployment, merge, or scheduled monitoring.** Checks are owner-triggered; authorizing a scheduler identity must not widen `service_role`.

Invariants a future change must not break: `service_role` gains no new table privileges; the four append-only evidence tables stay append-only; `production_monitors_enabled_requires_connection` stays in place so an unconnected monitor cannot be enabled; `rollback_operations_failure_escalates` stays in place so a failed rollback cannot be silent; `incidents_resolution_requires_cause` stays in place so a green deployment cannot close an incident; and `EXECUTOR_NOT_CONNECTED` stays unconditional in `autonomous_release_allowed`.

Next Phase 1E steps: apply hosted `028` after reauthenticating the Supabase CLI, configure an owner-authorized monitor target, and record the first real detection-to-resolution journey.

## Migration boundary

Hosted Supabase is current through `027`; its history matched the repository before the additive `027` promotion:

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

The verified pre-`027` dry run/lint and exact hosted ACL matrix remain recorded: `service_role` had only SELECT/INSERT/UPDATE on the four GitHub ingress tables and no table privileges on the other 19. Migration `027` adds two explicitly RLS/FORCE-RLS evidence tables with narrow owner SELECT and no browser mutation grants; its live owner handoff path passed.

## Evidence

- Supabase project `qpuofpmagrmyamahqwxw` is current through hosted migration `027`. Pre-`027` history matching, dry run/lint, 23/23 RLS+FORCE, 32 policies/zero policyless, 22 secret guards, and false raw authenticated/browser grants remain the verified baseline; `027` adds two RLS/FORCE-RLS immutable evidence tables and its live owner handoff path passed. The earlier wrong/unauthorized CLI profile was not used for mutation.
- Exact post-`026` ACL mismatch count is zero. `service_role` has SELECT/INSERT/UPDATE on four GitHub ingress tables and no table privileges on the other 19.
- `surgeservicesllc@gmail.com` is confirmed/authenticated; SoftwareFactory organization/workspace onboarding and owner membership succeeded. This is the only actual user/email authorized for live acceptance; no second live tenant was created.
- Candidate App `4582606` (`surge-softwarefactory-next`) is installed as `153479019` for exactly `surgeservicesllc/SoftwareFactory`. Connection `85591f43-dd4e-46d2-8a1b-0f036b32639f` and project `b1f23696-437e-4d89-b55f-d7a949980e8f` pass callback, sync, signed webhook, atomic handoff, branches/commits/checks/PRs/tree/file reads, and immutable Activity verification.
- Candidate-signed Activity rows show a post-sync processed delivery, push delivery, and streamed check statuses for installation `153479019`. Invalid webhook signatures return `401` with private/no-store behavior.
- Primary App `4573846` still reloads blank/inactive under OPEN Support ticket [#4660724](https://support.github.com/ticket/personal/0/4660724). Installation `153445938` remains active as rollback; candidate success does not relabel the primary webhook.
- Verified application release recorded 2026-08-13: commit `799d2cea189b6860a03987ae75c25765f9ac4aca`, tree `a7731dc5626f1d014a446e94e989a1ac3f4f72a1`, author/committer `surgeservicesllc <surgeservicesllc@gmail.com>`; CI run `31716263910` passed both jobs.
- Current production `dpl_853oYWK122qrTHhqtqDhsEYJkKaQ` is READY at `https://softwarefactory-7kfx3u1ey-surgeservices-projects.vercel.app` and the stable alias, sourced from exact main release `799d2cea189b6860a03987ae75c25765f9ac4aca`. Production Playwright passes 48/48, 13/13 public routes return `200`, invalid webhook handling returns `401` private/no-store, 30-minute logs contain zero errors/fatal/5xx, and 20 JavaScript assets are clean.
- `GITHUB_COMMIT_IDENTITY_NAME` and `GITHUB_COMMIT_IDENTITY_EMAIL` are configured server-only in Vercel Production and Preview for the approved public identity. Ordinary draft PR `#6` (commit `e789303`) and owner-approved protected RED draft PR `#7` (commit `6a808de`) are open, draft, unmerged, and use `surgeservicesllc <surgeservicesllc@gmail.com>` as both author and committer.
- Candidate-backed acceptance PR `#8` used App bot `surge-softwarefactory-next` as PR author and `surgeservicesllc <surgeservicesllc@gmail.com>` as commit author/committer on `204ed79e712cd262a7d631cda0febc7231f042be`. CI `31716958685` and Vercel Preview passed; the PR remained draft, was never merged, was closed with verification evidence, and its branch was deleted. Earlier App-bot-attributed PRs `#4` and `#5` were also closed unmerged with branches deleted.
- The temporary downloaded App PEM and ignored provider-verification helper scripts were deleted after use; no credential/helper artifact remains in the repository checkout.
- Cutover-tree `npm run check` passed lint/typecheck, 56 files/436 tests, and a 38-route build; current main CI independently passed the full quality/build and browser/accessibility jobs.
- Exact Vercel project `surgeservices-projects/softwarefactory` is linked and encrypted environment names are present; secret values were not recorded.

## Immediate sequence

1. Keep primary installation `153445938` active during the observation window and execute the evidence-bound reverse-handoff check before any retirement decision.
2. Complete the live two-tenant/anonymous/RPC and remaining failure/disconnect/lifecycle matrix, including stale SHA, approval expiry, revoked/insufficient permission, rate limits, ordering, terminal deletion/restore, idempotency, and ambiguous recovery.
3. Report Phase 1B complete only after those gaps close; otherwise preserve the exact candidate Connected, primary-webhook impaired, and later-phase Not Connected distinctions above.

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
- [x] Phase 1E control plane passes lint, typecheck, 62 files/538 tests, a 60-entry build, and Playwright 51/51 including axe, with the end-to-end journey and failed-rollback escalation proven against the migrated schema.
- [ ] Hosted migration `028` is applied and a real production target is observed before any Phase 1E surface claims live monitoring.
