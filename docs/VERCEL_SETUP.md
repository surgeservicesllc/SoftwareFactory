# Vercel setup

Hosting project: `surgeservices-projects/softwarefactory` (`prj_pAsrhftaVWI4SyaqstgRVSWHJkdD`). Stable alias: [https://softwarefactory-tan.vercel.app](https://softwarefactory-tan.vercel.app).

The local release checkout is linked to this exact Vercel project, and the required encrypted environment-variable names are present without exposing their values. The application-release evidence below proves the public hosting boundary for one exact application commit; it does not prove authenticated Supabase or GitHub acceptance.

Vercel hosts the Next.js application and server routes. The in-product Vercel deployment/rollback adapter remains **Not Connected**; CI has no deploy or merge credentials.

## Verified release evidence recorded 2026-08-13

- Application commit `799d2cea189b6860a03987ae75c25765f9ac4aca` has tree `a7731dc5626f1d014a446e94e989a1ac3f4f72a1`; both author and committer are `surgeservicesllc <surgeservicesllc@gmail.com>`.
- GitHub Actions run `31716263910` passed both `Lint, typecheck, test, and build` and `Browser and accessibility tests`.
- Production deployment `dpl_853oYWK122qrTHhqtqDhsEYJkKaQ` is READY at `https://softwarefactory-7kfx3u1ey-surgeservices-projects.vercel.app`, serves the stable alias, and is sourced from exact main commit `799d2cea189b6860a03987ae75c25765f9ac4aca`.
- Production Playwright passes 48/48; 13/13 public routes return `200`; invalid webhook requests return `401` private/no-store; 30-minute logs contain zero errors/fatal/5xx; and 20 deployed JavaScript assets are clean.
- Production Supabase URL, publishable key, and service-role key are configured in the exact Vercel project.
- GitHub App server-only variable names are configured. `GITHUB_COMMIT_IDENTITY_NAME` and `GITHUB_COMMIT_IDENTITY_EMAIL` are configured for both Production and Preview with the owner-approved public identity `surgeservicesllc <surgeservicesllc@gmail.com>`; no secret values are recorded.
- Candidate installation `153479019` and connection `85591f43-dd4e-46d2-8a1b-0f036b32639f` are connected to exactly `surgeservicesllc/SoftwareFactory`; live webhook, handoff, Connections, Projects, Files, draft-write, and Activity paths pass. Primary `153445938` remains active rollback.
- Ordinary draft PR `#6` and owner-approved protected RED draft PR `#7` are open, draft, and unmerged; both commits have the approved author and committer. Earlier App-bot-attributed PRs `#4` and `#5` were closed unmerged and their isolated branches were deleted.
- Primary App `4573846` remains blank/inactive under OPEN GitHub Support ticket `#4660724`. Candidate App `4582606` is deployed, installed, and has exact processed signed webhook evidence; its distinct `GITHUB_CANDIDATE_APP_*` names remain Sensitive in Production and Preview.
- The temporary downloaded App PEM and ignored webhook/helper scripts used for bounded verification were deleted; no credential or helper artifact was persisted in the repository.
- Preview Supabase variables are not independently verified, and the live second-tenant caller matrix remains pending.

This evidence is bound to the exact application commit/deployment above. Hosted migration `027`, candidate installation `153479019`, signed delivery, handoff, reads, and clean draft-only PR `#8` acceptance pass. It does not prove the pending second-tenant, reverse-handoff, or adverse lifecycle/disconnect matrix. Later documentation-only successors do not supersede this runtime evidence.

## Project configuration

1. Use only `surgeservices-projects/softwarefactory`.
2. Keep the Next.js preset and repository root aligned with this repository.
3. Use the committed lockfile and `npm run build`.
4. Target Node 22 or newer, matching `package.json` and CI.
5. Store values in Vercel encrypted/sensitive settings with deliberate Production/Preview/Development scopes.
6. Never expose privileged values through `NEXT_PUBLIC_`.
7. Verify exact callback/webhook origins after changing aliases or domains.
8. Keep `.vercelignore` fail-closed so local dependencies, build caches, test artifacts, CLI metadata, environment files, and private-key files are never uploaded as deployment source.

See [Environment variables](ENVIRONMENT_VARIABLES.md) and [GitHub App integration](GITHUB_APP_INTEGRATION.md).

## Environment isolation

- Production uses the exact hosted Supabase project described in [Supabase setup](SUPABASE_SETUP.md).
- Preview should use separate Supabase data/credentials before authenticated preview testing.
- Production secrets must not be available to untrusted fork builds.
- Primary and candidate GitHub private-key/client/webhook/state secrets remain server-only, separately keyed, and environment-scoped. Candidate settings must be absent or complete and may not reuse primary credentials.
- No local-repository write switch or HTTP file-write route is deployed.

## Manual production promotion

Before deploying:

- lint, typecheck, full Vitest, production build, and applicable E2E pass for the exact tree;
- local and hosted migrations/lint/RLS checks pass;
- tracked files/client bundle are scanned for secrets;
- GitHub App callback/webhook values match the stable production origin;
- safe error/empty/disconnected states remain truthful; and
- rollback/containment and observation plans exist.

After deploying:

1. Record exact commit and Vercel deployment ID/state.
2. Confirm the stable alias resolves to that deployment and returns the expected title.
3. Exercise unauthenticated protections and Supabase sign-in/onboarding.
4. Complete the GitHub production acceptance checklist.
5. Confirm no secret appears in responses, logs, or client assets.
6. Observe provider failures and safe **Not Connected** behavior.

A Vercel READY state proves build/hosting readiness only. It does not prove Supabase tenant isolation, GitHub installation/webhooks, file-to-draft-PR behavior, post-deploy observation, or rollback automation.

## Restrictions

- Do not add `VERCEL_TOKEN`, provider secrets, or production database credentials to pull-request CI.
- Do not add auto-deploy, auto-merge, or rollback steps to `.github/workflows/ci.yml`.
- Do not describe the in-product Vercel adapter as connected because the UI is hosted on Vercel.
