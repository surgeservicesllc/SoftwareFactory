# Handoff

Last updated: 2026-08-13

## Mission and boundary

Finish the remaining Phase 1B acceptance gaps. Migration `026` is hosted with a zero-mismatch ACL matrix, `surgeservicesllc@gmail.com` completed owner Auth/onboarding, and installation `153445938` is connected to exactly `surgeservicesllc/SoftwareFactory`. The live owner connection/project/read/draft-write/audit path passes. The provider webhook remains **Not Connected**, and the live second-tenant/failure matrix remains incomplete. Do not begin Phase 1C or Phase 2, and keep Autonomous Mode OFF, the global kill switch ON, and all automatic actions OFF.

## Current repository work

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

## Migration boundary

Hosted Supabase is current through `026`, with local and remote history matching:

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

Post-`026` dry run and lint are clean. The exact hosted ACL matrix has zero mismatches: `service_role` has only SELECT/INSERT/UPDATE on the four GitHub ingress tables and no table privileges on the other 19.

## Evidence

- Supabase project `qpuofpmagrmyamahqwxw` is linked; hosted history is current through `026`, local=remote, dry run/lint are clean, and prior evidence records 23/23 RLS+FORCE, 32 policies/zero policyless, 22 secret guards, and false tested raw authenticated/browser grants.
- Exact post-`026` ACL mismatch count is zero. `service_role` has SELECT/INSERT/UPDATE on four GitHub ingress tables and no table privileges on the other 19.
- `surgeservicesllc@gmail.com` is confirmed/authenticated; SoftwareFactory organization/workspace onboarding and owner membership succeeded. This is the only actual user/email authorized for live acceptance; no second live tenant was created.
- Provider installation `153445938` is connected to `surgeservicesllc` and selects exactly `surgeservicesllc/SoftwareFactory`. Connection `d17c63a9-d995-481e-98ce-b737efb32ce5` and project `b1f23696-437e-4d89-b55f-d7a949980e8f` pass callback, sync, branches/commits/checks/PRs/tree/README reads, and immutable Activity verification.
- The GitHub webhook is **Not Connected**: a GitHub App JWT validates App `4573846`, but documented `PATCH /app/hook/config` returns `404`; the owner UI reports update success but reloads blank/inactive. The fresh secret is stored only in Sensitive Production/Preview, invalid signatures return `401`/no-store, and no valid signed delivery is verified.
- Verified application release recorded 2026-08-13: commit `0bd048565a9e002848c5553ccbe43ab0e217780e`, tree `82f62ff725133c98ea4792c1bfe5dd03d7f222c0`, author/committer `surgeservicesllc <surgeservicesllc@gmail.com>`; CI run `31704289754` passed both jobs.
- Current production `dpl_AEirYPnCrKemJjiFX7bKGc7626jX` is READY at `https://softwarefactory-fa4gc8jfm-surgeservices-projects.vercel.app` and the stable alias, sourced from exact `main` application commit `0bd048565a9e002848c5553ccbe43ab0e217780e` after the webhook-secret rotation. Production Playwright passes 48/48, nine JavaScript assets contain zero forbidden markers, and recent logs contain zero errors.
- `GITHUB_COMMIT_IDENTITY_NAME` and `GITHUB_COMMIT_IDENTITY_EMAIL` are configured server-only in Vercel Production and Preview for the approved public identity. Ordinary draft PR `#6` (commit `e789303`) and owner-approved protected RED draft PR `#7` (commit `6a808de`) are open, draft, unmerged, and use `surgeservicesllc <surgeservicesllc@gmail.com>` as both author and committer.
- Earlier App-bot-attributed acceptance PRs `#4` and `#5` were closed unmerged and their isolated branches were deleted. A fake generic password assignment was rejected before any PR; the Activity view shows connection, project, ordinary change, protected approval, provider-boundary, and draft-PR events.
- The temporary downloaded App PEM and ignored provider-verification helper scripts were deleted after use; no credential/helper artifact remains in the repository checkout.
- Current local evidence: `npm run check` passes lint/typecheck, 54 files/408 tests, and a 38-route build.
- Exact Vercel project `surgeservices-projects/softwarefactory` is linked and encrypted environment names are present; secret values were not recorded.

## Immediate sequence

1. Make GitHub retain the active webhook and complete valid signed-delivery/lifecycle acceptance; invalid signatures already fail closed.
2. Complete the live two-tenant/anonymous/RPC matrix. Only one actual user/email is currently authorized, so local behavioral tests are supporting—not substitute—evidence.
3. Exercise remaining stale-SHA, idempotency/recovery, protected denial/expiry, wrong-tenant, revoked/permission/rate-limit, lifecycle ordering, disconnect/loss, and history-preservation cases.
4. Report Phase 1B complete only after those gaps close; otherwise preserve the exact Connected/Not Connected distinctions above.

## Safe operating notes

- Never print or commit App private keys, client/state/webhook secrets, OAuth/installation tokens, service role, or database credentials.
- Service role is limited to narrow provider-ingress/terminal evidence boundaries and never proves RLS.
- Verify CLI identity and project ref before every linked database command. Never reset hosted production.
- Preserve **Demo Data** and **Not Connected** language when live evidence is absent.
- Keep default-branch writes, non-draft PRs, merge, deploy, rollback, workflow/administration writes, and autonomous execution unavailable.
- `main` is currently unprotected and the published release commit is unsigned; changing branch protection or signature requirements is a separate protected owner-review action.
- Unexpected `theagoras.com` aliases require owner review before any retain/remove routing action; do not mutate protected routing without exact approval.

## Completion checklist

- [x] Hosted migration history is current through `026`; local=remote, dry run/lint are clean, and prior RLS/catalog/browser-grant checks pass.
- [x] Migration `026` is hosted; exact ACL mismatch count is zero, with four intended `service_role` ingress tables and no table privileges on the other 19.
- [x] Current local lint/typecheck, 54 files/408 tests, and 38-route build pass.
- [x] Local and exact production E2E/responsive/accessibility pass 48/48; production focused signed-out race passes 30/30.
- [x] Source/rebuilt-static secret/client gates pass; production ten-asset privileged-marker scan passes.
- [x] Application release `0bd0485` is published, CI `31704289754` passes both jobs, and matching READY production deployment `dpl_AEirYPnCrKemJjiFX7bKGc7626jX` is verified. Later documentation-only successors retain this runtime evidence unless application code changes.
- [x] Migrations `011`-`026` are hosted and post-apply dry-run/lint/ACL checks pass.
- [ ] Real Supabase two-tenant/anonymous/RPC behavior passes; the sole owner session passes, and local tests cover the unexecuted second-tenant boundary.
- [x] Real GitHub callback/sync/project/read/edit/ordinary-plus-protected-draft-PR/audit journey passes for the owner connection.
- [x] Exact deployment commit identity is configured server-side in Production/Preview and live draft commits prove matching author and committer without App-bot fallback.
- [ ] Real active webhook, valid signed delivery, and disconnect/loss journey pass.
- [ ] Failure/revocation/rate-limit/stale-SHA/protected approval/expiry/lease/idempotency/recovery/out-of-order/terminal states pass.
- [ ] Documentation and scorecard reflect final evidence without claiming Phase 1C.
