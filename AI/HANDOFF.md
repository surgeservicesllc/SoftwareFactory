# Handoff

Last updated: 2026-08-13

## Mission and boundary

Finish Phase 1B end to end. The fail-closed GitHub/Supabase hardening snapshot is published to GitHub `main` and deployed to the exact Vercel production project. A signed-out dashboard follow-up is locally validated but not yet published/deployed. The schema is not promoted to hosted Supabase and the authenticated provider journey has not passed. GitHub remains **Not Connected**. Do not begin Phase 1C or Phase 2, and do not enable Phase 1D execution. Auto approve, merge, deploy, and rollback remain OFF.

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
- The local follow-up supplies a server-verified signed-out hint to the dashboard so signed-out rendering skips protected browser fetches; it passes `npm run check` at 53 files/394 tests, current coverage, local Playwright 48/48, and the focused browser-error regression 30/30, but is not in the `7d22de6` production snapshot.

## Migration boundary

Hosted Supabase is applied only through `010`. Repository migrations `011`-`025` are not hosted:

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

This complete authorization/audit/provider-ingress chain requires exact current owner approval before production application. After apply, verify the hosted ledger, linked lint, RLS/FORCE RLS, table/function/helper grants, caller/tenant/resource checks, base-table column secrecy and safe projections, stable repository binding, approval/lease invariants, immutable/bounded/redacted activity, provider-ingress CHECK evaluation, out-of-order/terminal transitions, recovery/idempotency, and application health.

## Evidence

- Supabase project `qpuofpmagrmyamahqwxw` was last verified `ACTIVE_HEALTHY`; hosted ledger ends at `010`.
- Supabase CLI is authorized as `surgeservicesllc@gmail.com`, exact project `qpuofpmagrmyamahqwxw` is linked, hosted ledger ends at `010`, linked database lint is clean, and a complete `011`-`025` dry run succeeds without applying a pending migration.
- Personal provider installation `153286187` exists on `surgeservicesllc`, restricted to only `surgeservicesllc/SoftwareFactory`. It has not completed the authenticated SoftwareFactory callback/tenant journey.
- The GitHub webhook is **Not Connected**: no active hook and valid signed production delivery have been verified.
- Published release evidence recorded 2026-08-13: `origin/main` commit `7d22de665813d119488b4a26b0cd4084070b3eaa`, tree `9ede78e7d5c4f28269a0a11dc1a4e381c53a3772`, author/committer `surgeservicesllc@gmail.com`; CI run `31692336607` passed both jobs.
- Exact Vercel deployment `dpl_6Aiygdb9r1B4PCUefLahBKgadAHb` is READY at `https://softwarefactory-3yg1d1bsf-surgeservices-projects.vercel.app` and serves `https://softwarefactory-tan.vercel.app`. Production Playwright passes 48/48; security headers, API denials, invalid-webhook 401, nine-JavaScript-asset marker scan, and recent-error review pass.
- Current local evidence on Node 22.23.1: `npm run check` passes lint, typecheck, 53 files/394 tests, and a production build with 38 routes (`/` dynamic); current coverage and local Playwright 48/48 pass; the focused signed-out browser-error regression passes 30/30 repeated runs.
- Current-tree evidence: the dedicated integration suite passed 21 files/163 tests; coverage passed 53 files/394 tests at 70.36% statements, 71.34% branches, 62.58% functions, and 71.37% lines; local production-server Playwright passed 48/48 across desktop/tablet/mobile with axe checks. Current source/rebuilt-static scanning found zero high-confidence non-fixture credential candidates, zero privileged/static marker matches across 27 artifacts, zero tracked key/container files, and only `.env.example` present.
- Exact Vercel project `surgeservices-projects/softwarefactory` is linked and encrypted environment names are present; secret values were not recorded.

## Immediate sequence

1. Final-gate, publish, and deploy the signed-out dashboard follow-up; bind new CI/Vercel evidence to its exact commit.
2. Obtain exact owner approval for hosted migrations `011`-`025` and webhook activation; apply/verify only the exact production targets.
3. Complete production Auth confirmation/sign-in/onboarding and two-tenant/anonymous/RPC acceptance.
4. Complete authenticated GitHub callback, sync, project link, live reads, one safe draft PR, idempotent/recovery/failure cases, signed webhook lifecycle cases, and disconnect/loss.
5. Update memory/scorecard with exact evidence; only then report Phase 1B complete.

## Safe operating notes

- Never print or commit App private keys, client/state/webhook secrets, OAuth/installation tokens, service role, or database credentials.
- Service role is limited to narrow provider-ingress/terminal evidence boundaries and never proves RLS.
- Verify CLI identity and project ref before every linked database command. Never reset hosted production.
- Preserve **Demo Data** and **Not Connected** language when live evidence is absent.
- Keep default-branch writes, non-draft PRs, merge, deploy, rollback, workflow/administration writes, and autonomous execution unavailable.
- `main` is currently unprotected and the published release commit is unsigned; changing branch protection or signature requirements is a separate protected owner-review action.
- Unexpected `theagoras.com` aliases require owner review before any retain/remove routing action; do not mutate protected routing without exact approval.

## Completion checklist

- [x] Hosted migration history through `010`; exact linked database lint is clean.
- [x] Hardening migrations `011`-`025` and application/tests exist in the published repository release.
- [x] Current-tree lint/typecheck, 53 files/394 tests, migration chain through `025`, and 38-route production build (`/` dynamic) pass.
- [x] Published snapshot production-server E2E/responsive/accessibility passes 48/48; local follow-up focused signed-out regression passes 30/30.
- [x] Full local production-server E2E passes 48/48 for the follow-up.
- [x] Source/rebuilt-static secret/client gates pass for the local follow-up.
- [ ] Local follow-up is pushed, CI passes, and a matching production deployment is verified; prior snapshot `7d22de6` remains verified production.
- [ ] Migrations `011`-`025` are explicitly owner-approved, hosted, and fully verified.
- [ ] Real Supabase authenticated/two-tenant/anonymous/RPC behavior passes.
- [ ] Real GitHub callback/sync/project/read/edit/draft-PR/webhook/audit/disconnect journey passes.
- [ ] Failure/revocation/rate-limit/stale-SHA/protected approval/expiry/lease/idempotency/recovery/out-of-order/terminal states pass.
- [ ] Documentation and scorecard reflect final evidence without claiming Phase 1C.
