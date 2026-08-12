# Handoff

Last updated: 2026-08-12

## Mission and boundary

Finish Phase 1B end to end. The fail-closed GitHub/Supabase hardening increment passes local gates, is published to GitHub, passes CI, and is verified on an exact-tree production deployment. It is not promoted to hosted Supabase and the live provider journey is incomplete. GitHub remains **Not Connected**. Do not begin Phase 1C or Phase 2, and do not enable Phase 1D execution. Auto approve, merge, deploy, and rollback remain OFF.

## Current repository work

- Callback browser failures return to Connections with bounded safe messages; JSON consumers retain no-store structured errors.
- GitHub-returned browser URLs are constrained to HTTPS `github.com` origins; binary/invalid UTF-8 reads fail safely; pull-list tokens request only necessary permissions.
- Revoked/insufficient-permission token failures are persisted best-effort as connection loss without treating rate limits as revocation.
- Connections/dashboard truthfully distinguish Supabase from GitHub **Not Connected** and remove hard-coded onboarding identity.
- The standard editor blocks expanded security/provider/automation/dependency/infrastructure paths and reuses one idempotency key while an intent is unchanged.
- If GitHub created an isolated branch, commit, and draft PR but database completion was ambiguous, the route can recover the same request from bounded provider evidence.
- Webhook schemas retain provider timestamps. Installation/repository transitions reject stale/out-of-order state, preserve terminal deletion, and require an explicit newer repository restore that remains unselected pending access sync.

## Migration boundary

Hosted Supabase is applied only through `010`. Local migrations `011`-`019` are not hosted:

- `011`: initial direct mutation closure and `github_pat_` detection.
- `012`: actor-attributed terminal change audit.
- `013`: bounded service-role repository-grant reconciliation.
- `014`: exact linked-project repository/default-branch propagation with audit.
- `015`: existing-draft-PR completion recovery.
- `016`: terminal/provider-time installation lifecycle.
- `017`: remaining direct connection/project/link/change-request write closure plus authenticated exact-binding reservation RPC.
- `018`: provider-time repository lifecycle and terminal delete/explicit restore handling.
- `019`: minimal service-role execute on the SECURITY DEFINER sensitive-JSON CHECK wrapper; recursive/text helpers remain inaccessible.

This complete authorization/audit/provider-ingress chain requires exact current owner approval before production application. After apply, verify the hosted ledger, linked lint, RLS/FORCE RLS, table/function/helper grants, caller/tenant/resource checks, immutable/redacted activity, provider-ingress CHECK evaluation, out-of-order/terminal transitions, recovery/idempotency, and application health.

## Evidence

- Supabase project `qpuofpmagrmyamahqwxw` was last verified `ACTIVE_HEALTHY`; hosted ledger ends at `010`.
- Last successful linked public-schema lint ends at `009`; a later CLI attempt received account `403`.
- Provider installation `153286187` exists on `surgeservicesllc`, restricted to only `surgeservicesllc/SoftwareFactory`. It has not completed the authenticated SoftwareFactory callback/tenant journey.
- The GitHub webhook is **Not Connected**: no active hook and valid signed production delivery have been verified.
- Application commit `427190d050796e3f5ff5cf6154adc2c34e2e5694`, authored `NewWorldVenture`, is on GitHub `main`; CI run `31649243266` passed 2/2.
- The automatic Git-triggered deployment `dpl_H6SvxkXj3LKiLoCjZ1PWarQs3umq` was blocked by Vercel Hobby commit-author access. The supported detached, tracked-files-only, owner-authenticated deployment `dpl_9oqg94scmdn5X86r7yyrgmsVtmBu` is READY Production and stores the exact application SHA in `softwarefactoryGitCommitSha` metadata.
- Deployment URL `https://softwarefactory-i3pm08bpx-surgeservices-projects.vercel.app` and stable alias `https://softwarefactory-tan.vercel.app` pass production validation: five public routes 200 with expected title, representative authenticated APIs 401, removed `/api/files` 404, Playwright 12/12, nine deployed JavaScript assets clean, and recent error/HTTP-500 logs zero.
- Current tree: lint/typecheck pass; full Vitest passes 38 files/263 tests (unit 23/145, integration 15/118); full-chain RLS behavior passes 5/5 through migration `019`; production build passes with 34 routes.
- Current coverage passes 38 files/263 tests: 66.08% statements, 65.13% branches, 58.62% functions, and 67.16% lines; required risk/constants thresholds pass.
- Current Playwright passes 12/12 across desktop/tablet/mobile including axe checks after relocating an ignored stale OneDrive coverage cache.
- Source/client secret gates pass: no credential/private-key marker in tracked or untracked non-fixture source; only explicit fake detector fixtures in `github-repository-grants` and `github-rls-behavior` matched; rebuilt `.next/static` contains no privileged environment name, key marker, or `service_role` marker.

## Immediate sequence

1. Obtain exact owner approval for hosted migrations `011`-`019` and webhook activation; apply/verify only the exact production targets.
2. Complete production Auth confirmation/sign-in/onboarding and two-tenant/anonymous/RPC acceptance.
3. Complete authenticated GitHub callback, sync, project link, live reads, one safe draft PR, idempotent/recovery/failure cases, signed webhook lifecycle cases, and disconnect/loss.
4. Update memory/scorecard with exact evidence; only then report Phase 1B complete.

## Safe operating notes

- Never print or commit App private keys, client/state/webhook secrets, OAuth/installation tokens, service role, or database credentials.
- Service role is limited to narrow provider-ingress/terminal evidence boundaries and never proves RLS.
- Verify CLI identity and project ref before every linked database command. Never reset hosted production.
- Preserve **Demo Data** and **Not Connected** language when live evidence is absent.
- Keep default-branch writes, non-draft PRs, merge, deploy, rollback, workflow/administration writes, and autonomous execution unavailable.

## Completion checklist

- [x] Hosted migration history through `010`; last clean linked lint through `009` only.
- [x] Local hardening migrations `011`-`019` and application/tests exist in the working tree.
- [x] Current-tree lint/typecheck/full Vitest/migration-chain RLS/build gates pass and exact results are recorded.
- [x] Current-tree coverage and E2E/responsive/accessibility gates pass and exact results are recorded.
- [x] Current-tree secret/client gate passes and its exact result is recorded.
- [x] Application tree is pushed, CI passes 2/2, and provider metadata resolves the READY production deployment to its exact SHA.
- [ ] Migrations `011`-`019` are explicitly owner-approved, hosted, and fully verified.
- [ ] Real Supabase authenticated/two-tenant/anonymous/RPC behavior passes.
- [ ] Real GitHub callback/sync/project/read/edit/draft-PR/webhook/audit/disconnect journey passes.
- [ ] Failure/revocation/rate-limit/stale-SHA/protected-path/idempotency/recovery/out-of-order/terminal states pass.
- [ ] Documentation and scorecard reflect final evidence without claiming Phase 1C.
