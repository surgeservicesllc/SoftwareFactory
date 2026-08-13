# Vercel setup

Hosting project: `surgeservices-projects/softwarefactory` (`prj_pAsrhftaVWI4SyaqstgRVSWHJkdD`). Stable alias: [https://softwarefactory-tan.vercel.app](https://softwarefactory-tan.vercel.app).

The local release checkout is linked to this exact Vercel project, and the required encrypted environment-variable names are present without exposing their values. The release snapshot below proves the public hosting boundary for one exact commit; it does not prove authenticated Supabase or GitHub acceptance.

A signed-out dashboard follow-up currently exists only in the local checkout. It passes `npm run check` at 53 files/394 tests, current coverage, local Playwright 48/48, and a focused 30/30 browser-error regression, but it is not part of the deployment recorded below and needs new exact CI/deployment evidence before promotion.

Vercel hosts the Next.js application and server routes. The in-product Vercel deployment/rollback adapter remains **Not Connected**; CI has no deploy or merge credentials.

## Verified release evidence recorded 2026-08-13

- GitHub `main` commit `7d22de665813d119488b4a26b0cd4084070b3eaa` has tree `9ede78e7d5c4f28269a0a11dc1a4e381c53a3772`; both author and committer are `surgeservicesllc@gmail.com`.
- GitHub Actions run `31692336607` passed both `Lint, typecheck, test, and build` and `Browser and accessibility tests`.
- Production deployment `dpl_6Aiygdb9r1B4PCUefLahBKgadAHb` was verified READY for that exact commit at `https://softwarefactory-3yg1d1bsf-surgeservices-projects.vercel.app` and served at the stable alias.
- Production Playwright passed 48/48 across desktop, tablet, and mobile, including axe checks.
- Production security headers were present; protected unauthenticated API requests were denied; an invalid webhook request returned 401; all nine JavaScript assets were free of privileged markers; and the recent deployment-log review found no errors.
- Production Supabase URL, publishable key, and service-role key are configured in the exact Vercel project.
- GitHub App server-only variable names are configured for Production and Preview. The protected private key was rotated to the App's sole remaining key (public fingerprint `SHA256:myJc9wk9wLOrLLSykdd3AL5nIDN948lBxP+Ee7GHYBg=`).
- GitHub provider installation `153286187` exists on `surgeservicesllc`, restricted to only `surgeservicesllc/SoftwareFactory`. The authenticated in-product callback/tenant connection remains pending, and the provider webhook remains blank/inactive with App-authenticated hook configuration returning `404`/no hook object.
- Preview Supabase variables are not independently verified.
- The live authenticated GitHub acceptance journey is still required before Phase 1B can be called complete.

This evidence is bound to the exact commit/deployment above. It proves the public release scope only; it does not prove hosted migrations `011`-`025`, authenticated tenant isolation, the in-product GitHub connection, or webhook acceptance. A later release requires a new exact evidence record.

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
- GitHub private key/client/webhook/state secrets remain server-only.
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
