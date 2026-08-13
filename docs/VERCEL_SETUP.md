# Vercel setup

Hosting project: `surgeservices-projects/softwarefactory` (`prj_pAsrhftaVWI4SyaqstgRVSWHJkdD`). Stable alias: [https://softwarefactory-tan.vercel.app](https://softwarefactory-tan.vercel.app).

Vercel serves the Next.js UI and bounded request-time APIs. It is not the Phase 1C Codex worker. A Vercel request may authenticate/persist a command and send an opaque repository dispatch, but it must never clone a repository, run Codex, wait for CI, or retain a worker lease.

## Existing production evidence

Production serves remote `main` commit `62b5c5a`; latest audited READY deployment is `dpl_4ukaw6y622L6ST99XB9GVpty2cAd`. The unpublished local Phase 1C candidate is not deployed. Vercel readiness is hosting evidence, not provider or Codex connectivity.

The exact Vercel project stores the existing Supabase/GitHub application values server-side and the explicit commit identity `surgeservicesllc <surgeservicesllc@gmail.com>`. No secret values are recorded here.

## Phase 1C application responsibilities

After the reviewed tree is deployed, Vercel will:

- render connected-project command UI and real task/run/report/detail views;
- authenticate, enforce same origin and active tenant, classify risk, resolve exact repository/base SHA, and persist a durable run;
- request an opaque GitHub repository dispatch after database commit;
- record dispatch success/delay and show truthful status; and
- read bounded heartbeat/result projections from Supabase.

For Phase 1C, Vercel does not use the worker's `OPENAI_API_KEY`, execute `scripts/worker.mts`, store a workspace, run Docker, push a branch, create a PR directly, or wait through Codex/CI execution. Those actions belong to the protected GitHub Actions worker.

## Phase 2A application responsibilities

Phase 2A advisory provider calls do execute inside authenticated bounded server routes. Vercel may therefore hold `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY` plus provider model/timeout configuration strictly for that separate path. Migration `130001` must be hosted, the provider must pass live health/model discovery, and the owner-controlled organization switch must be enabled before a call. Provider output is schema-validated advisory data; the route has no Git workspace or delivery authority.

## Project configuration

1. Use only `surgeservices-projects/softwarefactory`.
2. Keep repository root, Next.js preset, Node 22+, lockfile, and build command aligned with source.
3. Store application secrets in encrypted/sensitive environment scopes; never use `NEXT_PUBLIC_` for privileged values.
4. Keep Preview data/credentials isolated before authenticated preview tests.
5. Keep `.vercelignore` fail closed for environment/key files, dependencies, caches, CLI metadata, test artifacts, and generated worker workspaces.
6. Confirm callback/webhook origins after any alias/domain change.
7. Do not add worker provider/service-role/App private keys to client code, public environment, or build output.

## Phase 1C publication checklist

Before deploying the local Phase 1C tree:

- the frozen candidate passes on Node `24.19.0` with 109 files/1,169 tests, 74 page/route build entries, coverage 75.06/69.97/72.60/76.66, Playwright/axe 117/117, focused migration suites 8 files/104 tests, dependency audit 0, and safe disabled-worker smoke;
- exact owner approval covers ledger repair of schema-present `028`/`130001`-`130005` and application/verification of absent `130006`-`130011` on `qpuofpmagrmyamahqwxw` before the UI depends on them;
- the seven protected GitHub Actions secrets are configured under exact approval without exposing values;
- `SOFTWAREFACTORY_REQUIRED_CHECKS` remains exactly `Lint, typecheck, test, and build|Browser and accessibility tests` and matches both CI job display names;
- repository Actions variable `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` remains absent/false so every worker trigger skips during publication and deployment;
- the exact commit uses `surgeservicesllc <surgeservicesllc@gmail.com>` as author and committer; and
- rollback/containment keeps the worker disabled if deployment/database/provider evidence diverges.

After deploying:

1. Record exact commit/tree and Vercel deployment ID.
2. Confirm stable alias, page title, security headers, static asset secret scan, and public routes.
3. Exercise Auth/onboarding/active organization and member/cross-tenant/anonymous boundaries.
4. Verify command creation, worker status, detail/cancel/retry APIs, and truthful **Not Connected** status before a heartbeat.
5. Confirm ordinary CI and E2E/axe for the exact deployed tree.
6. Only after the exact deployment and ordinary CI are verified, set `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED=true` for the separately approved bounded acceptance window, submit one narrow GREEN command through the authenticated UI/API so the default-branch repository dispatch starts the worker, then restore activation to absent/false unless continued operation is separately approved. Do not add or use a branch-selectable manual workflow dispatch.
7. Verify Vercel logs/responses/client assets contain no service-role/OpenAI/App credential or raw model/provider error.

## Restrictions

- Do not place GitHub Actions worker secrets in Vercel unless the application separately requires the same value for its existing Phase 1B server routes.
- Do not add `OPENAI_API_KEY` to Vercel for Phase 1C; add it only for an explicitly configured Phase 2A advisory provider and keep the worker credential separately scoped in GitHub Actions.
- Do not add merge, deploy, rollback, or worker execution to Vercel request handlers.
- Do not call the Vercel deployment/rollback adapter Connected because the UI is hosted.
- A READY deployment, configured name, queued command, or completed idle one-shot invocation is not a live Codex worker; require a fresh active heartbeat during a real end-to-end run.
