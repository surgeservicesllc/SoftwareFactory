# Quality scorecard

Last reviewed: 2026-08-12  
Technical gate decision: **Pass for the Phase 1A foundation**  
Completion decision: **Pending the owner-facing final implementation report and root requirement audit**

Statuses are based on current command/runtime evidence, not the absence of a known failure. Vercel UI hosting is verified; Supabase, GitHub, AI-provider, and deployment/rollback automation connectivity remain **Not Connected**.

| Area | Evidence | Status |
| --- | --- | --- |
| Scope | Required routes, controls, memory/policies, schema, tests, docs, environment template, and CI are present; final root requirement-by-requirement audit/report remains | Pending final audit/report |
| Lint | `npm run lint` within `npm run check` | Pass |
| Type safety | `npm run typecheck` within `npm run check` | Pass |
| Unit tests | `npm run test:unit -- --reporter=verbose`: 2 files, 24 tests | Pass |
| Integration tests | `npm run test:integration -- --reporter=verbose`: 3 files, 57 tests | Pass |
| Full Vitest | `npm test` within `npm run check`: 5 files, 81 tests | Pass |
| E2E tests | `npm run test:e2e`: 12/12 tests across desktop, tablet, and mobile Chromium projects | Pass |
| Production build | `npm run build` within `npm run check`: compiled, typechecked, generated 17 routes; clean of prior filesystem-tracing warnings | Pass |
| Production UI deployment | Vercel project `prj_pAsrhftaVWI4SyaqstgRVSWHJkdD`, deployment `dpl_Fi7jEzWFbtW3vrXDGuEodPumTuJ7` READY, stable alias HTTP 200 with expected title | Pass for UI hosting; automation **Not Connected** |
| Accessibility | Playwright/axe found no serious or critical automated violations at all three tested viewport classes; semantic navigation tests passed | Pass within automated Phase 1A scope |
| Responsive UI | 1440×900 desktop, 834×1112 tablet, and Pixel 5 mobile navigation/render/overflow checks | Pass |
| Loading/error/empty states | App Router loading/error/not-found files and explicit empty/disconnected states present; primary routes compile and navigate | Pass for foundation |
| Secret safety | Repository credential-pattern scan and `.next/static` privileged-variable-name scan found no matches; only `.env.example` exists | Pass |
| RLS | Three migrations parsed/applied in ephemeral PGlite; catalog confirmed RLS+FORCE RLS on all 18 public tables; tenant/default/approval/audit/sensitive-data smoke paths passed | Pass in local verification scope; hosted Supabase not connected |
| Auditability | Migration workflow smoke emitted organization, project, command, task, approval, and required state-transition events | Pass in local verification scope |
| Truthful state | Source/UI/E2E use **Demo Data**, **Not Connected**, and queued-without-execution language | Pass |
| Automation safety | Defaults unit tests pass; RED approval transition is blocked before owner approval; CI is read-only with no merge/deploy steps | Pass |

## Evidence record

```text
Tree reviewed: working tree on main, after Phase 1A implementation
Review date: 2026-08-12
Local runtime: Node v20.19.0 / npm 10.8.2
Target runtime: Node >=22 in package.json and Node 22.x in CI

npm run check:
  PASS — lint, typecheck, 5 Vitest files / 81 tests, production build / 17 routes
npm run test:unit -- --reporter=verbose:
  PASS — 2 files / 24 tests
npm run test:integration -- --reporter=verbose:
  PASS — 3 files / 57 tests
npm run test:e2e:
  PASS — 12/12; desktop 1440x900, tablet 834x1112, Pixel 5 mobile

secret review:
  PASS — no common live-token/private-key patterns in repository files
  PASS — no privileged server environment names in .next/static
  PASS — only .env.example exists

RLS and workflow review:
  PASS (local scope) — 3 ordered migrations parsed with pglast and applied to
  ephemeral PostgreSQL-compatible PGlite with stub auth schema; all 18 public
  tables report RLS and FORCE RLS; safe defaults, GREEN queueing, RED approval
  gate, sensitive-key rejection, and audit events passed.
  LIMIT — not applied to a linked hosted Supabase project; pgcrypto extension
  creation was skipped in PGlite because the test runtime lacks extensions.

warnings:
  Local Node 20 emits the Supabase future-support deprecation warning.
  Vitest emits a future Vite native config-loader ESM warning.

production UI deployment:
  PASS — team/project surgeservices-projects/softwarefactory
  project ID prj_pAsrhftaVWI4SyaqstgRVSWHJkdD
  deployment ID dpl_Fi7jEzWFbtW3vrXDGuEodPumTuJ7 / state READY
  stable alias https://softwarefactory-tan.vercel.app returned HTTP 200 with
  title "SoftwareFactory — AI Engineering Control Plane" on 2026-08-12
  inspector https://vercel.com/surgeservices-projects/softwarefactory/Fi7jEzWFbtW3vrXDGuEodPumTuJ7
  LIMIT — this proves UI hosting/availability, not an in-product Vercel connection,
  repository linkage, automated deployment, post-deploy monitoring, or rollback.
```

## Release-blocking invariants

- Any exposed secret, cross-tenant access, disabled RLS, or unapproved RED action is an immediate failure.
- A UI-only control without server enforcement does not satisfy a safety requirement.
- A schema-presence test alone does not prove RLS; the local catalog/workflow smoke evidence above supplements static contract tests, while a hosted Supabase rerun remains Phase 1B work.
- A passing page render proves only the recorded UI availability check, not control-plane provider connectivity. Supabase, GitHub, AI providers, and Vercel deployment/rollback automation remain **Not Connected**.
- Demo data that can be mistaken for live production information is a failure.
- A future material change invalidates affected evidence and requires this scorecard to be rerun and updated.
