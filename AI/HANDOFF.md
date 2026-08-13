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
- Supabase project `qpuofpmagrmyamahqwxw` is `ACTIVE_HEALTHY`.
- Hosted migrations `001`, `002`, `003`, `004`, `005`, `007`, `008`, `009`, and `010` are applied; the hosted ledger includes `010`.
- Local migrations `011`, `012`, and `013` are present but not hosted. They close direct authenticated connection/member mutations, align `github_pat_` detection, add completed/failed change-request audit evidence with a known actor, and add service-role-only repository-grant reconciliation. Their production application is a protected authorization/audit change requiring exact owner approval.
- Migration `010` was applied transactionally after `unsafe_project_rows=0`. Hosted checks show kill-switch default true, both constraints validated, zero organizations with the switch OFF, zero unsafe projects, authenticated controls-RPC execute, and anonymous execute denied.
- The last successful linked public-schema lint reported no errors (`[]`) through `009`. A post-`010` CLI lint attempt was blocked by a Supabase CLI account `403`; do not infer a post-`010` lint result. Broader authenticated cross-tenant/RPC behavior remains pending.
- Migration `009` serializes sync by external installation ID, re-resolves the authoritative installation binding after upsert, and makes the synchronized GitHub default branch authoritative for project links. Repository full-name authorization now uses literal normalized comparison, and the standard editor's protected-path classifier covers control-plane, API, provider/server, Auth, data, deployment, environment, infrastructure, and security-sensitive subject paths.
- GitHub App `Surge SoftwareFactory` (`surge-softwarefactory`, App ID `4573846`) exists with expected permissions/events. Installation `153286187` is installed on `surgeservicesllc` with only `surgeservicesllc/SoftwareFactory` selected.
- The sole remaining GitHub App key has public fingerprint `SHA256:myJc9wk9wLOrLLSykdd3AL5nIDN948lBxP+Ee7GHYBg=`; the corresponding protected Vercel value was rotated and promoted. No private key material belongs in repository memory.
- The provider installation does not yet have an authenticated SoftwareFactory owner callback, tenant connection record, repository sync, project/file/draft-PR acceptance run, or signed webhook delivery. The provider General form is blank/inactive and App-authenticated hook configuration returns `404` with no hook object. In-product status remains **Not Connected**.
- A GREEN interface simplification is now applied on top of that hardening: semantic design tokens with a 12px minimum type size (ADR-021), plain-language copy that keeps exact policy terms as secondary labels (ADR-022), navigation grouped by task, and a dashboard that leads with the connect-GitHub → add-project → open-files path using the `/api/projects` read the metrics already performed. It changes presentation only: no route, schema, policy, token, or provider behaviour moved, and no connection or phase status changed. On Node 22 the merged tree passes `npm run check` in one run (lint, typecheck, 40 files/289 tests, production build) and local Playwright is 48/48.
- Every surface is now wired to Supabase (ADR-023). Five read routes were added over tables that already existed but had never been read — `agents`, `tasks`, `agent_runs`, `reports`, `commands` — all through one server-only boundary that authenticates the caller, filters by the exact active organization, enumerates columns, bounds rows at 100, and returns no-store. `lib/demo-data.ts` is deleted and no surface renders **Demo Data**; an empty table now renders an empty state. This adds no hosted schema change, no credential, and no provider capability: a new workspace correctly shows empty pages, and the AI worker is still **Not Connected**.
- Two things that phase deliberately did not do. It did not set any Supabase credential: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `SUPABASE_SERVICE_ROLE_KEY` are owner-held and must stay out of source control, so local and preview environments still render signed-out states until the owner supplies them. It also did not touch hosted migrations `011`-`019`, which remain unapplied and RED.
- That work fixed two genuine WCAG AA defects that predate it and had been masked. Anchor-based primary buttons rendered white on lime at 1.21:1 because an unlayered `a { color: inherit }` outranks any `@layer components` rule regardless of specificity; element resets now live in `@layer base`. The backlog table was a horizontally scrollable region with no keyboard access; it is now a responsive list that stacks instead of scrolling. Axe had previously reported contrast as "incomplete" rather than failing, because gradient panel backgrounds made the computation indeterminate.
- Phase 1D scaffold adds the pure prerequisite evaluator, truthful static controls, same-origin tenant/owner controls API hardening, and hosted locked observation controls. No action executor exists.
- Vercel project is `surgeservices-projects/softwarefactory` (`prj_pAsrhftaVWI4SyaqstgRVSWHJkdD`), stable alias `https://softwarefactory-tan.vercel.app`.

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
- [x] Hosted migration history through `010`; linked schema lint green through `009` only.
- [x] Current-tree code/test/build/E2E/secret gates green.
- [ ] Hosted migrations `011`-`013` explicitly approved, applied, and verified.
- [ ] Hosted authenticated RLS/RPC/audit behavior green (catalog gate is green).
- [x] Local lint/typecheck/full Vitest/coverage/build and E2E/responsive/accessibility gates green on the current hardening tree, and rerun green on Node 22 after the interface simplification (48/48 Playwright).
- [ ] Redeploy and recapture production evidence for the interface simplification; the recorded deployment, production Playwright, and HTTP probes all describe release `427190d` / deployment `dpl_9oqg94scmdn5X86r7yyrgmsVtmBu`, which predates it.
- [x] Final secret/client scan green on the current hardening tree; only a synthetic credential fixture matched.
- [x] Exact implementation commit pushed to `main`; owner deployment marker, exact application tree, READY deployment, aliases, production E2E, and HTTP probes recorded.
- [ ] Real Supabase authenticated session verified.
- [ ] Real GitHub install/callback/sync/project/read/edit/draft-PR/webhook/audit/disconnect workflow verified.
- [ ] Failure/revocation/rate-limit/stale-SHA/protected-path states verified.
- [ ] Documentation/current state/backlog/handoff/scorecard reflect final evidence.
