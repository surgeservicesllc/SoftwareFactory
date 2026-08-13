# Vercel setup

Hosting project: `surgeservices-projects/softwarefactory` (`prj_pAsrhftaVWI4SyaqstgRVSWHJkdD`). Stable alias: [https://softwarefactory-tan.vercel.app](https://softwarefactory-tan.vercel.app).

The local release checkout is linked to this exact Vercel project, and the required encrypted environment-variable names are present without exposing their values. The application-release evidence below proves the public hosting boundary for one exact application commit; it does not prove authenticated Supabase or GitHub acceptance.

Vercel hosts the Next.js application and server routes. The in-product Vercel deployment/rollback adapter remains **Not Connected**; CI has no deploy or merge credentials.

## Verified release evidence recorded 2026-08-13

- Application commit `0bd048565a9e002848c5553ccbe43ab0e217780e` has tree `82f62ff725133c98ea4792c1bfe5dd03d7f222c0`; both author and committer are `surgeservicesllc <surgeservicesllc@gmail.com>`.
- GitHub Actions run `31704289754` passed both `Lint, typecheck, test, and build` and `Browser and accessibility tests`.
- Current production deployment `dpl_AEirYPnCrKemJjiFX7bKGc7626jX` is READY at `https://softwarefactory-fa4gc8jfm-surgeservices-projects.vercel.app`, serves the stable alias, and is sourced from exact `main` application commit `0bd048565a9e002848c5553ccbe43ab0e217780e` after the webhook-secret rotation.
- Post-rotation production Playwright passes 48/48 across desktop, tablet, and mobile, including axe checks. Nine deployed JavaScript assets contain zero forbidden markers, recent deployment logs contain zero errors, and CI run `31704289754` is green for the exact application commit.
- Production Supabase URL, publishable key, and service-role key are configured in the exact Vercel project.
- GitHub App server-only variable names are configured. `GITHUB_COMMIT_IDENTITY_NAME` and `GITHUB_COMMIT_IDENTITY_EMAIL` are configured for both Production and Preview with the owner-approved public identity `surgeservicesllc <surgeservicesllc@gmail.com>`; no secret values are recorded.
- GitHub installation `153445938` completed the production callback and is connected to `surgeservicesllc`, restricted to exactly `surgeservicesllc/SoftwareFactory`. Live Connections, Projects, Files, and Activity reads pass.
- Ordinary draft PR `#6` and owner-approved protected RED draft PR `#7` are open, draft, and unmerged; both commits have the approved author and committer. Earlier App-bot-attributed PRs `#4` and `#5` were closed unmerged and their isolated branches were deleted.
- Primary App `4573846` remains blank/inactive under OPEN GitHub Support ticket `#4660724`. Candidate App `4582606` retains the exact active endpoint, and its distinct required `GITHUB_CANDIDATE_APP_*` names are Sensitive in Production and Preview. Production commit `0bd0485` does not read those candidate values; the App is not installed and no signed processed delivery is verified, so the webhook remains **Not Connected**.
- The temporary downloaded App PEM and ignored webhook/helper scripts used for bounded verification were deleted; no credential or helper artifact was persisted in the repository.
- Preview Supabase variables are not independently verified, and the live second-tenant caller matrix remains pending.

This evidence is bound to the exact application commit/deployment above. The locally passing dual-App/handoff tree (56 files/436 tests, 38-route build) is not committed or deployed, and migration `027` is not hosted. The live primary owner GitHub journey is verified, but it does not prove a second tenant, candidate installation, signed delivery, or handoff. Later documentation-only successors do not supersede the release evidence; the candidate application release requires a new exact evidence record.

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
