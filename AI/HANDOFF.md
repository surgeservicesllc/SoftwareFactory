# Handoff

Last updated: 2026-08-13

## Mission and boundary

Finish Phase 1B end to end. Migration `026` is hosted with a zero-mismatch ACL matrix, and `surgeservicesllc@gmail.com` completed owner Auth/onboarding. Latest installation `153442281` is scoped and App-JWT verified, but production callback failed on a nonexistent endpoint; the bounded local fix is unpublished. GitHub/webhook remain **Not Connected**. Do not begin Phase 1C or Phase 2, and keep all automatic actions OFF.

## Current repository work

- Callback browser failures return to Connections with bounded safe messages; JSON consumers retain no-store structured errors.
- GitHub-returned browser URLs are constrained to HTTPS `github.com` origins; binary/invalid UTF-8 reads fail safely; pull-list tokens request only necessary permissions.
- Revoked/insufficient-permission token failures are persisted best-effort as connection loss without treating rate limits as revocation.
- Connections/dashboard truthfully distinguish Supabase from GitHub **Not Connected** and remove hard-coded onboarding identity.
- Ordinary file changes reuse one idempotency key while an intent is unchanged. A protected path requires exact, short-lived, owner-only RED approval evidence before provider execution; likely secrets remain blocked, and the route still creates only an isolated draft PR.
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
- `surgeservicesllc@gmail.com` is confirmed/authenticated; SoftwareFactory organization/workspace onboarding and owner membership succeeded. No GitHub connection/project has been verified.
- Latest provider installation `153442281` exists on `surgeservicesllc`, is App-JWT verified, and selects only `surgeservicesllc/SoftwareFactory`. Current production callback failed because it used nonexistent `GET /user/installations/{id}`. The local unpublished patch uses bounded documented `GET /user/installations` plus exact-ID lookup.
- The GitHub webhook is **Not Connected**: a GitHub App JWT validates App `4573846`, but `/app/hook/config` returns 404 and the UI does not retain activation. No valid signed delivery is verified.
- Verified application release recorded 2026-08-13: commit `edaaf625c497380611b80092526926b1457e15a0`, tree `7379e8bed2712048573d25d3247b0c5db0bfc5c4`, author/committer `surgeservicesllc@gmail.com`; CI run `31694775758` passed both jobs.
- Current production `dpl_BbcaKQVC6Nh7YQo4rJH6VwTaqm77` is READY at `https://softwarefactory-nd3orq8r6-surgeservices-projects.vercel.app` and the stable alias, sourced from `main` `3434387`. It does not contain the callback fix.
- Current local evidence: `npm run check` passes lint/typecheck, 54 files/398 tests, and a 38-route build.
- Exact Vercel project `surgeservices-projects/softwarefactory` is linked and encrypted environment names are present; secret values were not recorded.

## Immediate sequence

1. Publish and verify the bounded callback fix, then retry installation `153442281` from the authenticated owner workspace.
2. Complete two-tenant/anonymous/RPC acceptance and the provider connection/sync/project/read/draft-PR/disconnect journey.
3. Make GitHub retain the active webhook and complete signed webhook lifecycle acceptance.
4. Update memory/scorecard with exact evidence; only then report Phase 1B complete.

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
- [x] Current local lint/typecheck, 54 files/398 tests, and 38-route build pass.
- [x] Local and exact production E2E/responsive/accessibility pass 48/48; production focused signed-out race passes 30/30.
- [x] Source/rebuilt-static secret/client gates pass; production ten-asset privileged-marker scan passes.
- [x] Application release `edaaf62` is published, CI passes, and matching READY production deployment `dpl_FwjzBywZTadQPTRZtB4Esd9QBKTQ` is verified. Later documentation-only successors retain this runtime evidence unless application code changes.
- [x] Migrations `011`-`026` are hosted and post-apply dry-run/lint/ACL checks pass.
- [ ] Real Supabase authenticated/two-tenant/anonymous/RPC behavior passes.
- [ ] Real GitHub callback/sync/project/read/edit/draft-PR/webhook/audit/disconnect journey passes.
- [ ] Failure/revocation/rate-limit/stale-SHA/protected approval/expiry/lease/idempotency/recovery/out-of-order/terminal states pass.
- [ ] Documentation and scorecard reflect final evidence without claiming Phase 1C.
