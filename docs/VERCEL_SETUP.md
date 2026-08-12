# Vercel setup

UI hosting status: **Verified production deployment**. Deployment automation status in Phase 1A: **Not Connected**. The repository CI workflow validates code but does not deploy, merge, or receive production write credentials.

## Verified production UI

Verified on 2026-08-12:

- Team/project: `surgeservices-projects/softwarefactory`
- Project ID: `prj_pAsrhftaVWI4SyaqstgRVSWHJkdD`
- Production deployment ID: `dpl_Fi7jEzWFbtW3vrXDGuEodPumTuJ7`
- Deployment state: `READY`
- Stable alias: [https://softwarefactory-tan.vercel.app](https://softwarefactory-tan.vercel.app)
- Inspector: [Vercel deployment inspector](https://vercel.com/surgeservices-projects/softwarefactory/Fi7jEzWFbtW3vrXDGuEodPumTuJ7)
- Availability check: HTTP 200 with title `SoftwareFactory — AI Engineering Control Plane`

This verifies the Vercel project identity and the deployed UI. It does not verify an in-product Vercel connection, Git repository/continuous-deployment linkage, deployment API executor, complete post-deploy observation policy, or rollback integration. Those capabilities remain **Not Connected**.

## Project configuration

1. Use the verified `surgeservices-projects/softwarefactory` project through an owner-controlled session; verify repository linkage separately before enabling continuous deployment.
2. Keep the Next.js framework preset and repository root aligned with the deployed source.
3. Keep `npm ci`/the lockfile as the dependency source of truth and `npm run build` as the production build.
4. Set environment variables using Vercel's encrypted settings, scoped separately to Development, Preview, and Production.
5. Do not put privileged values in `NEXT_PUBLIC_` variables.
6. Require owner-controlled production environment protection before live automation is considered.

See [Environment variables](ENVIRONMENT_VARIABLES.md) for the public/server boundary.

## Environment isolation

- Preview should use non-production Supabase/provider credentials and data.
- Production secrets must not be available to untrusted pull-request builds.
- Prefer separate Supabase projects for preview/staging and production.
- Limit provider tokens to the exact team/project and operations required.

## Validation

Before a manual production promotion:

- lint, typecheck, tests, and build pass for the exact commit;
- migrations were reviewed and verified separately;
- risk/protected-resource approvals are satisfied;
- preview rendering and primary responsive flows pass;
- demo/disconnected states remain truthful; and
- rollback/containment and observation plans exist.

A READY Vercel build plus the HTTP/title smoke check proves the UI deployment recorded above is reachable. It is not the complete health, observation, integration, or rollback evidence required by `policies/POST_DEPLOY_VALIDATION.md` for future automated delivery.

## Phase 1A restrictions

- Do not add `VERCEL_TOKEN` to pull-request CI.
- Do not add deploy hooks, production `vercel --prod`, auto-merge, or automated rollback to `.github/workflows/ci.yml`.
- The UI may be described as deployed/READY using the exact evidence above. Keep the in-product Vercel connection and deployment/rollback automation labeled **Not Connected** until their separate identity, repository, permission, execution, and validation paths are verified.
