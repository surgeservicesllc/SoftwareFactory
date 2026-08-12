# Vercel setup

Hosting project: `surgeservices-projects/softwarefactory` (`prj_pAsrhftaVWI4SyaqstgRVSWHJkdD`). Stable alias: [https://softwarefactory-tan.vercel.app](https://softwarefactory-tan.vercel.app).

Vercel hosts the Next.js application and server routes. The in-product Vercel deployment/rollback adapter remains **Not Connected**; CI has no deploy or merge credentials.

## Current evidence

- The Phase 1A production UI deployment `dpl_Fi7jEzWFbtW3vrXDGuEodPumTuJ7` was previously verified READY and reachable at the stable alias.
- Production Supabase URL, publishable key, and service-role key are configured in the exact Vercel project.
- GitHub App server-only variables are configured for Production and Preview; App permissions/events are configured, but installation is absent and the GitHub provider webhook endpoint still appears blank/inactive.
- Preview Supabase variables are not independently verified.
- A production deployment of the final Phase 1B commit, its deployment ID, and its live authenticated/GitHub acceptance journey are still required before Phase 1B can be called production-ready.

Do not assume that the stable alias contains the current working tree. Record the exact commit, deployment ID, state, and smoke/acceptance evidence after promotion.

## Project configuration

1. Use only `surgeservices-projects/softwarefactory`.
2. Keep the Next.js preset and repository root aligned with this repository.
3. Use the committed lockfile and `npm run build`.
4. Target Node 22 or newer, matching `package.json` and CI.
5. Store values in Vercel encrypted/sensitive settings with deliberate Production/Preview/Development scopes.
6. Never expose privileged values through `NEXT_PUBLIC_`.
7. Verify exact callback/webhook origins after changing aliases or domains.

See [Environment variables](ENVIRONMENT_VARIABLES.md) and [GitHub App integration](GITHUB_APP_INTEGRATION.md).

## Environment isolation

- Production uses the exact hosted Supabase project described in [Supabase setup](SUPABASE_SETUP.md).
- Preview should use separate Supabase data/credentials before authenticated preview testing.
- Production secrets must not be available to untrusted fork builds.
- GitHub private key/client/webhook/state secrets remain server-only.
- `SOFTWAREFACTORY_ENABLE_LOCAL_FILE_WRITES` stays false in all hosted scopes.

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
