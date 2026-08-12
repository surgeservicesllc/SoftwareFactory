# Handoff

Last updated: 2026-08-12

## Mission and boundary

Finish Phase 1B end to end. The hardened implementation, hosted migration chain through `009`, linked schema lint, and final code/browser/secret gates are in place, but hosted authenticated tenant behavior and the real production acceptance journey are incomplete. Do not describe GitHub as Connected or Phase 1B as complete yet.

Do not begin Phase 1C Codex, Phase 1D autonomy, or Phase 2 Claude. Auto approve, merge, deploy, and rollback remain OFF.

## Current evidence

- Supabase project `qpuofpmagrmyamahqwxw` is `ACTIVE_HEALTHY`.
- Hosted migrations `001`, `002`, `003`, `004`, `005`, `007`, `008`, and `009` are applied; local/remote history matches.
- Linked public-schema lint with warning level/fail-on-error reports no schema errors (`[]`). Hosted catalog verification returned 22/22 RLS, 22/22 FORCE RLS, 43 policies, and 22 row-secret guards; the linked migration list separately confirms eight expected migrations through `009`. Authenticated cross-tenant/RPC behavior remains pending.
- Migration `009` serializes sync by external installation ID, re-resolves the authoritative installation binding after upsert, and makes the synchronized GitHub default branch authoritative for project links. Repository full-name authorization now uses literal normalized comparison, and the standard editor's protected-path classifier covers control-plane, API, provider/server, Auth, data, deployment, environment, infrastructure, and security-sensitive subject paths.
- GitHub App `Surge SoftwareFactory` (`surge-softwarefactory`, App ID `4573846`) exists with expected permissions/events, and server-only values are configured in Vercel.
- GitHub permissions/events/environment values are configured. No real installation/callback/repository/file/draft-PR acceptance run has passed; the provider webhook endpoint still appears blank/inactive and no signed delivery is verified. Status remains **Not Connected**.
- Final hardened-tree gates: lint and typecheck pass; full Vitest passes 16 files/146 tests; integration passes 6 files/88 tests; build passes 34 pages/routes; Playwright passes 12/12 across desktop/tablet/mobile with accessibility, browser-error, and overflow checks; secret/client scans pass with no credential patterns or built-client privileged server names.
- Exact Phase 1B Vercel deployment, hosted authenticated RLS behavior, and live provider acceptance remain.
- Vercel project is `surgeservices-projects/softwarefactory` (`prj_pAsrhftaVWI4SyaqstgRVSWHJkdD`), stable alias `https://softwarefactory-tan.vercel.app`.

## Immediate sequence

1. Verify hosted cross-tenant/anonymous denial, privileged RPC authorization, audit immutability/redaction, and a real authenticated application session (catalog RLS/FORCE RLS is already green).
2. Commit/push the exact validated tree to `main` and deploy that commit to the exact Vercel project.
3. Record commit, deployment ID/state, stable-alias identity, and smoke results.
4. Complete production Supabase Auth/onboarding.
5. Configure/verify the blank/inactive GitHub webhook endpoint, install the App through SoftwareFactory, sync repositories, link the project, inspect live repository state, create one safe controlled draft PR, observe webhook/audit reconciliation, and test disconnect/loss paths.
6. Update this memory/scorecard with exact evidence; only then issue the Phase 1B completion report.

## Safe operating notes

- Never print or commit App private key/client/state/webhook secrets, OAuth/installation tokens, service role, or DB credentials.
- Use service role only in the narrow server-only webhook/privileged RPC boundary; it does not prove RLS.
- Verify CLI identity and project ref before every linked database command. Never reset hosted production.
- The standard file-change route must keep the expanded protected-resource classes blocked, repository matching literal, synchronized default branch authoritative, expected SHA required, isolated branch enforced, and PR draft-only.
- Preserve **Demo Data** and **Not Connected** language whenever live evidence is absent.
- Do not add GitHub administration/workflow/deployment permissions or CI deploy credentials.

## Completion checklist

- [x] Hosted migration history and linked schema lint green.
- [ ] Hosted authenticated RLS/RPC/audit behavior green (catalog gate is green).
- [x] Local lint/typecheck/full Vitest/build and E2E/responsive/accessibility gates green on the hardened tree.
- [x] Final secret/client scan green on the hardened tree.
- [ ] Exact commit pushed to `main` and exact production deployment recorded.
- [ ] Real Supabase authenticated session verified.
- [ ] Real GitHub install/callback/sync/project/read/edit/draft-PR/webhook/audit/disconnect workflow verified.
- [ ] Failure/revocation/rate-limit/stale-SHA/protected-path states verified.
- [ ] Documentation/current state/backlog/handoff/scorecard reflect final evidence.
