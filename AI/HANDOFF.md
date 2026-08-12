# Handoff

Last updated: 2026-08-12

## Mission and boundary

Continue Phase 1A as a trustworthy control-plane foundation. Do not implement or imply unrestricted production execution. The UI is deployed on Vercel, but all in-product provider integrations remain **Not Connected** until verified end to end; seeded metrics and examples are **Demo Data**.

## Before changing anything

1. Read `AGENTS.md` and every AI/policy file it lists.
2. Inspect `git status` and preserve unrelated work.
3. Read the relevant bundled Next.js 16.3 documentation in `node_modules/next/dist/docs/`.
4. Compare `AI/CURRENT_STATE.md` and `AI/BACKLOG.md` with authoritative files and tests.
5. Identify the risk tier and protected resources touched by the proposed change.

## Current workstream

- The Phase 1A foundation is a release candidate. Technical gates pass; the root requirement audit and owner-facing final implementation report are the remaining completion handoff.
- Repository memory, governance policies, setup/operations documentation, environment-variable guidance, and a CI quality-gate workflow have been established.
- Current verification evidence is recorded in `AI/CURRENT_STATE.md` and `AI/QUALITY_SCORECARD.md`: 81 Vitest tests, 12 Playwright tests across desktop/tablet/mobile, production build, secret scan, and local RLS/workflow verification pass.
- Vercel project `surgeservices-projects/softwarefactory` (`prj_pAsrhftaVWI4SyaqstgRVSWHJkdD`) hosts READY production deployment `dpl_Fi7jEzWFbtW3vrXDGuEodPumTuJ7` at `https://softwarefactory-tan.vercel.app`; its inspector is `https://vercel.com/surgeservices-projects/softwarefactory/Fi7jEzWFbtW3vrXDGuEodPumTuJ7`.
- There is no verified live GitHub App, in-product Vercel connection/deployment automation, Supabase hosted runtime, or AI worker execution.

## Safe operating notes

- Keep auto approve, auto merge, auto deploy, and auto rollback OFF by default.
- Persisting a command does not mean a worker ran it.
- Never expose privileged values through `NEXT_PUBLIC_`, client modules, logs, fixtures, screenshots, or database rows.
- RLS must remain enabled and tenant-scoped. Test cross-tenant denial, not only happy-path access.
- Do not add deploy or merge permissions to `.github/workflows/ci.yml`.

## Handoff checklist for the next material change

- [ ] Scope and acceptance criteria identified.
- [ ] Risk tier and protected-resource contact recorded.
- [ ] Relevant framework and policy documentation read.
- [ ] Tests added/updated at the correct layer.
- [ ] Lint, typecheck, tests, and build run as appropriate.
- [ ] Demo/live labels and connection states remain truthful.
- [ ] `AI/CURRENT_STATE.md`, `AI/BACKLOG.md`, `AI/DECISIONS.md`, and `AI/QUALITY_SCORECARD.md` updated if affected.

## Completion handoff requirements

The Phase 1A implementation report must list completed functionality, exact test commands/results, known limitations, outstanding work, and recommended Phase 1B work. It must also include evidence of secret review, RLS review, and primary responsive-layout testing.
