# Vercel setup

Hosting project: `surgeservices-projects/softwarefactory` (`prj_pAsrhftaVWI4SyaqstgRVSWHJkdD`). Stable alias: [https://softwarefactory-tan.vercel.app](https://softwarefactory-tan.vercel.app).

Vercel serves the Next.js UI and bounded request-time APIs. It is not the Phase 1C Codex worker. A Vercel request may authenticate/persist a command and send an opaque repository dispatch, but it must never clone a repository, run Codex, wait for CI, or retain a worker lease.

## Existing production evidence

The prior verified production baseline before this update was commit `0c662a24393f682073e6002c5aff9339292226d8`; audited deployment `dpl_FJKMapsyLB4hQPDsaykUo1cVUQp7` was READY and contains the published Phase 1C recovery path. The current routing/UI update is not covered by that evidence. Vercel readiness is hosting evidence, not provider or Codex connectivity.

The exact Vercel project stores the existing Supabase/GitHub application values server-side and the explicit commit identity `surgeservicesllc <surgeservicesllc@gmail.com>`. No secret values are recorded here.

## Phase 1C application responsibilities

The deployed Phase 1C application uses Vercel to:

- render connected-project command UI and real task/run/report/detail views;
- authenticate, enforce same origin and active tenant, classify risk, resolve exact repository/base SHA, and persist a durable run;
- request an opaque GitHub repository dispatch after database commit;
- record dispatch success/delay and show truthful status; and
- read bounded heartbeat/result projections from Supabase.

For Phase 1C, Vercel does not hold any Codex credential, execute `scripts/worker.mts`, store a workspace, run Docker, push a branch, create a PR directly, or wait through Codex/CI execution. Those actions belong to the protected GitHub Actions worker. Phase 1C no longer has a paid-API credential at all: the worker authenticates Codex with the owner's ChatGPT subscription through `SOFTWAREFACTORY_CODEX_AUTH_JSON`, which lives only in GitHub Actions.

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

## Phase 1C publication evidence and acceptance checklist

The prior verified production baseline before this update is published: commit `0c662a24393f682073e6002c5aff9339292226d8`, CI run `31749352644`, and READY deployment `dpl_FJKMapsyLB4hQPDsaykUo1cVUQp7`. Hosted Supabase is current through `130014`; local `130015` and the rolling-compatible routing/UI update are not part of that deployment. Before the remaining live acceptance:

- run and record the complete current-update gate set, CI, and deployment with fresh counts; do not reuse the prior baseline's test or coverage figures;
- preserve the verified hosted ledger and schema through `130014`; any new migration needs new exact approval and forward-only containment;
- apply local `130015` only under fresh exact RED approval and verify both 120-to-128 model-constraint restorations, all four no-secret constraints for catalogue/assignment/routing scalars, valid and credential-shaped scalar cases, the bounded run-detail projection, both authenticated raw-table SELECT revokes, retained model-catalogue SELECT, and direct-denial behavior; the application accepts missing routing evidence and fails closed on credential-shaped pre-migration catalogue rows during rollout;
- keep the compromised OpenAI secret absent; six non-OpenAI GitHub Actions secrets remain configured without exposing values, and only a fresh funded replacement may restore the seventh;
- `SOFTWAREFACTORY_REQUIRED_CHECKS` remains exactly `Lint, typecheck, test, and build|Browser and accessibility tests` and matches both CI job display names;
- repository Actions variable `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` remains absent/false so every worker trigger skips during publication and deployment;
- every exact release commit uses `surgeservicesllc <surgeservicesllc@gmail.com>` as author and committer; and
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
- Do not add any AI provider key to Vercel for Phase 1C. Phase 1C has no paid-API path, and its subscription credential belongs only in GitHub Actions.
- Do not add merge, deploy, rollback, or worker execution to Vercel request handlers.
- Do not call the Vercel deployment/rollback adapter Connected because the UI is hosted.
- A READY deployment, configured name, queued command, or completed idle one-shot invocation is not a live Codex worker; require a fresh active heartbeat during a real end-to-end run.
