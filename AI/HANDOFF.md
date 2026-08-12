# Handoff

Last updated: 2026-08-12

## Mission and boundary

Finish Phase 1B end to end. The hardened implementation, hosted migration chain through `009`, linked schema lint, final code/browser/secret gates, READY Vercel deployment, and repository-scoped provider installation are in place. Hosted authenticated tenant behavior, the in-product GitHub callback/connection, webhook delivery, and remaining production acceptance are incomplete. Do not describe GitHub as Connected or Phase 1B as complete yet.

Do not begin Phase 1C Codex, Phase 1D autonomy, or Phase 2 Claude. Auto approve, merge, deploy, and rollback remain OFF.

An execution-inert Phase 1D observation scaffold now exists by explicit request. It does not begin execution autonomy: migration `010` is hosted, Autonomous Mode is constrained OFF, the global kill switch is ON, only hypothetical GREEN inputs may be evaluated, automatic actions are OFF, and the worker is **Not Connected**.

## Current evidence

- Supabase project `qpuofpmagrmyamahqwxw` is `ACTIVE_HEALTHY`.
- Hosted migrations `001`, `002`, `003`, `004`, `005`, `007`, `008`, `009`, and `010` are applied; the hosted ledger includes `010`.
- Migration `010` was applied transactionally after `unsafe_project_rows=0`. Hosted checks show kill-switch default true, both constraints validated, zero organizations with the switch OFF, zero unsafe projects, authenticated controls-RPC execute, and anonymous execute denied.
- The last successful linked public-schema lint reported no errors (`[]`) through `009`. A post-`010` CLI lint attempt was blocked by a Supabase CLI account `403`; do not infer a post-`010` lint result. Broader authenticated cross-tenant/RPC behavior remains pending.
- Migration `009` serializes sync by external installation ID, re-resolves the authoritative installation binding after upsert, and makes the synchronized GitHub default branch authoritative for project links. Repository full-name authorization now uses literal normalized comparison, and the standard editor's protected-path classifier covers control-plane, API, provider/server, Auth, data, deployment, environment, infrastructure, and security-sensitive subject paths.
- GitHub App `Surge SoftwareFactory` (`surge-softwarefactory`, App ID `4573846`) exists with expected permissions/events. Installation `153286187` is installed on `surgeservicesllc` with only `surgeservicesllc/SoftwareFactory` selected.
- The sole remaining GitHub App key has public fingerprint `SHA256:myJc9wk9wLOrLLSykdd3AL5nIDN948lBxP+Ee7GHYBg=`; the corresponding protected Vercel value was rotated and promoted. No private key material belongs in repository memory.
- The provider installation does not yet have an authenticated SoftwareFactory owner callback, tenant connection record, repository sync, project/file/draft-PR acceptance run, or signed webhook delivery. The provider General form is blank/inactive and App-authenticated hook configuration returns `404` with no hook object. In-product status remains **Not Connected**.
- Final current-tree gates: lint and typecheck pass; full Vitest passes 157 tests; integration passes 6 files/88 tests; build passes 34 pages/routes; Playwright passes 12/12 across desktop/tablet/mobile with accessibility, browser-error, and overflow checks; secret/client scans pass with no credential patterns or built-client privileged server names.
- Vercel deployment `dpl_436vwUxUAuypnRmCstgptQa2qfve` is READY/Current at `https://softwarefactory-tan.vercel.app` from exact runtime source commit `3dfdbf35daeff7a79e09a41e5070e521b23d83f9`; stable-production Playwright passed 12/12. Hosted authenticated RLS behavior and remaining provider acceptance still require evidence.
- Phase 1D scaffold adds the pure prerequisite evaluator, truthful static controls, same-origin tenant/owner controls API hardening, and hosted locked observation controls. No action executor exists.
- Vercel project is `surgeservices-projects/softwarefactory` (`prj_pAsrhftaVWI4SyaqstgRVSWHJkdD`), stable alias `https://softwarefactory-tan.vercel.app`.

## Immediate sequence

1. Verify hosted cross-tenant/anonymous denial, privileged RPC authorization, audit immutability/redaction, and a real authenticated application session (catalog RLS/FORCE RLS is already green).
2. Preserve runtime provenance: deployment `dpl_436vwUxUAuypnRmCstgptQa2qfve` is from `3dfdbf35daeff7a79e09a41e5070e521b23d83f9`; the following evidence-only documentation commit does not change application behavior.
3. Complete production Supabase Auth/onboarding.
4. Complete the authenticated owner callback for existing provider installation `153286187`, persist/sync the tenant connection, link the project, inspect live repository state, create one safe controlled draft PR, and test disconnect/loss paths.
5. Configure/verify the blank/inactive GitHub webhook endpoint (App-authenticated configuration currently returns `404`/no hook object), then observe signed webhook/audit reconciliation.
6. Update this memory/scorecard with exact evidence; only then issue the Phase 1B completion report.
7. Restore authorized Supabase CLI access and rerun linked lint after `010`; preserve the verified locked kill switch, GREEN/OFF constraints, RPC grants, and absence of action executors.

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
