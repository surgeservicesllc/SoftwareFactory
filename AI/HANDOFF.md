# Handoff

Last updated: 2026-08-12

## Mission and boundary

Finish Phase 1B end to end. The post-review hardening is pushed and deployed: active-organization enforcement across GitHub routes, truthful live connection/project/file state, a live tenant Activity stream, removal of the local HTTP writer, stronger provider response/secret/path validation, actor-attributed terminal change evidence, and signed-webhook repository-grant reconciliation. Hosted Supabase remains through `010`. Hosted migrations `011`-`013`, authenticated tenant behavior, the in-product GitHub callback/connection, webhook delivery, and remaining production acceptance are incomplete. Do not describe GitHub as Connected or Phase 1B as complete yet.

Do not begin Phase 1C Codex, Phase 1D autonomy, or Phase 2 Claude. Auto approve, merge, deploy, and rollback remain OFF.

An execution-inert Phase 1D observation scaffold now exists by explicit request. It does not begin execution autonomy: migration `010` is hosted, Autonomous Mode is constrained OFF, the global kill switch is ON, only hypothetical GREEN inputs may be evaluated, automatic actions are OFF, and the worker is **Not Connected**.

## Current evidence

- Supabase project `qpuofpmagrmyamahqwxw` is `ACTIVE_HEALTHY`.
- Hosted migrations `001`, `002`, `003`, `004`, `005`, `007`, `008`, `009`, and `010` are applied; the hosted ledger includes `010`.
- Local migrations `011`, `012`, and `013` are present but not hosted. They close direct authenticated connection/member mutations, align `github_pat_` detection, add completed/failed change-request audit evidence with a known actor, and add service-role-only repository-grant reconciliation. Their production application is a protected authorization/audit change requiring exact owner approval.
- Migration `010` was applied transactionally after `unsafe_project_rows=0`. Hosted checks show kill-switch default true, both constraints validated, zero organizations with the switch OFF, zero unsafe projects, authenticated controls-RPC execute, and anonymous execute denied.
- The last successful linked public-schema lint reported no errors (`[]`) through `009`. A post-`010` CLI lint attempt was blocked by a Supabase CLI account `403`; do not infer a post-`010` lint result. Broader authenticated cross-tenant/RPC behavior remains pending.
- Migration `009` serializes sync by external installation ID, re-resolves the authoritative installation binding after upsert, and makes the synchronized GitHub default branch authoritative for project links. Repository full-name authorization now uses literal normalized comparison, and the standard editor's protected-path classifier covers control-plane, API, provider/server, Auth, data, deployment, environment, infrastructure, and security-sensitive subject paths.
- GitHub App `Surge SoftwareFactory` (`surge-softwarefactory`, App ID `4573846`) exists with expected permissions/events. Installation `153286187` is installed on `surgeservicesllc` with only `surgeservicesllc/SoftwareFactory` selected.
- The sole remaining GitHub App key has public fingerprint `SHA256:myJc9wk9wLOrLLSykdd3AL5nIDN948lBxP+Ee7GHYBg=`; the corresponding protected Vercel value was rotated and promoted. No private key material belongs in repository memory.
- The provider installation does not yet have an authenticated SoftwareFactory owner callback, tenant connection record, repository sync, project/file/draft-PR acceptance run, or signed webhook delivery. The provider General form is blank/inactive and App-authenticated hook configuration returns `404` with no hook object. In-product status remains **Not Connected**.
- Current local hardening gates pass: the lint/typecheck/test phases of `npm run check` passed with 24 files/205 tests; its build phase hit only a stale OneDrive `.next` cache `EPERM`, then standalone `npm run build` passed 34 routes after recoverable cache relocation. Final coverage passed 25 files/208 tests; the focused `013` chain passed 3 files/44 tests; local Playwright passed 12/12; only the synthetic `github_pat_` fixture matched the secret scan and `.next/static` contained no server-secret markers.
- Implementation commit `e0ca6e7fe62234817e24273fb8ba3f6a12ffd278` is pushed to `origin/main`. Owner-authored empty deployment marker `7bd9d30e67bf018aba32f28d235d4a2f1232d65c` is current `main`, preserves the implementation authorship, and changes no application files.
- Vercel deployment `dpl_9i5hybTpGK6ZDufRuKWKT7Ys2gzY` is READY at `softwarefactory-fbho4i38o-surgeservices-projects.vercel.app` and current at `https://softwarefactory-tan.vercel.app`; it builds the exact `e0ca6e7` application tree through marker `7bd9d30`. Stable-production Playwright passed 12/12. `/`, `/activity`, and `/connections` return 200; unauthenticated `/api/activity` returns 401; removed `/api/files` returns 404.
- Direct deployment from `e0ca6e7` was blocked because Vercel Hobby requires the private-repository commit author to be a project member. The owner-authored empty marker supplied eligible deployment authorship without rewriting or replacing the implementation commit.
- Phase 1D scaffold adds the pure prerequisite evaluator, truthful static controls, same-origin tenant/owner controls API hardening, and hosted locked observation controls. No action executor exists.
- Vercel project is `surgeservices-projects/softwarefactory` (`prj_pAsrhftaVWI4SyaqstgRVSWHJkdD`), stable alias `https://softwarefactory-tan.vercel.app`.

## Immediate sequence

1. Obtain exact owner approval for hosted migrations `011`-`013`, apply them to `qpuofpmagrmyamahqwxw`, and verify ledger, lint, grants, RLS, actor attribution, event immutability/redaction, repository-grant reconciliation, and application health.
2. Verify hosted cross-tenant/anonymous denial, privileged RPC authorization, audit immutability/redaction, and a real authenticated application session.
3. Complete production Supabase Auth/onboarding.
4. Complete the authenticated owner callback for existing provider installation `153286187`, persist/sync the tenant connection, link the project, inspect live repository state, create one safe controlled draft PR, and test disconnect/loss paths.
5. Configure/verify the blank/inactive GitHub webhook endpoint, then observe signed webhook/audit and newly granted repository reconciliation.
6. Update this memory/scorecard with exact evidence; only then issue the Phase 1B completion report.

## Safe operating notes

- Never print or commit App private key/client/state/webhook secrets, OAuth/installation tokens, service role, or DB credentials.
- Use service role only in the narrow server-only webhook/privileged RPC boundary; it does not prove RLS.
- Verify CLI identity and project ref before every linked database command. Never reset hosted production.
- The standard file-change route must keep the expanded protected-resource classes blocked, repository matching literal, synchronized default branch authoritative, expected SHA required, isolated branch enforced, and PR draft-only.
- Preserve **Demo Data** and **Not Connected** language whenever live evidence is absent.
- Do not add GitHub administration/workflow/deployment permissions or CI deploy credentials.

## Completion checklist

- [x] Hosted migration history through `010`; linked schema lint green through `009` only.
- [x] Current-tree code/test/build/E2E/secret gates green.
- [ ] Hosted migrations `011`-`013` explicitly approved, applied, and verified.
- [ ] Hosted authenticated RLS/RPC/audit behavior green (catalog gate is green).
- [x] Local lint/typecheck/full Vitest/coverage/build and E2E/responsive/accessibility gates green on the current hardening tree.
- [x] Final secret/client scan green on the current hardening tree; only a synthetic credential fixture matched.
- [x] Exact implementation commit pushed to `main`; owner deployment marker, exact application tree, READY deployment, aliases, production E2E, and HTTP probes recorded.
- [ ] Real Supabase authenticated session verified.
- [ ] Real GitHub install/callback/sync/project/read/edit/draft-PR/webhook/audit/disconnect workflow verified.
- [ ] Failure/revocation/rate-limit/stale-SHA/protected-path states verified.
- [ ] Documentation/current state/backlog/handoff/scorecard reflect final evidence.
