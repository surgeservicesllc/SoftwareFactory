# Current state

Last reviewed: 2026-08-12  
Phase: 1A — control-plane foundation  
Overall status: **Production UI deployed; final implementation report pending**

This file records current repository evidence. “Implemented” below means the foundation exists in the repository; it does not imply a live provider connection or autonomous worker.

## Implemented application foundation

- Next.js 16.3.0, React 19.2, TypeScript strict mode, App Router, and Tailwind CSS 4.
- A responsive dark command-center shell with Dashboard, Projects, Bot Manager, Files, Agents, Backlog, Runs, Reports, Connections, Activity, and Settings destinations.
- Dashboard, backlog, activity, run, and Daily CEO Report views use clearly marked **Demo Data**. Live project and agent counts remain zero.
- Project contract/form covers repository, branch, production URL, GitHub/Vercel/Supabase connection state, health, autonomous risk, and automation controls without installing a personal project. Creation remains unavailable until authenticated Supabase persistence is connected.
- Bot Manager validates bounded commands, rejects likely secrets, authenticates the caller, and delegates transactional command/task/audit persistence to Supabase. RED requests enter `awaiting_approval`; every response says execution did not start because no worker is connected.
- The Files interface provides an allowlisted SoftwareFactory repository tree, content search, open, Markdown edit/preview, save feedback, keyboard save, file-switch/window-close unsaved-change protection, and a labeled history placeholder. Local writes default disabled and are allowed only when `SOFTWAREFACTORY_ENABLE_LOCAL_FILE_WRITES=true` in a trusted single-user local process.
- Nine seeded agent role definitions and six provider-neutral connection types are present. Agents are explicitly roles, not provider accounts; all six in-product provider connections remain **Not Connected**.
- Project autonomy settings default to GREEN/OFF. The Settings surface is labeled local policy preview; an authenticated server endpoint and database workflow enforce project control updates and RED owner gates when Supabase is connected.
- Loading, error, not-found, empty, and disconnected states exist; automated browser checks cover navigation, viewport overflow, browser errors, and serious/critical accessibility findings.
- The Phase 1A UI is deployed to the verified Vercel project `surgeservices-projects/softwarefactory` (`prj_pAsrhftaVWI4SyaqstgRVSWHJkdD`). Production deployment `dpl_Fi7jEzWFbtW3vrXDGuEodPumTuJ7` is READY at `https://softwarefactory-tan.vercel.app`.

## Data and security foundation

- Three ordered Supabase migrations define organizations/membership, profiles, projects, connections, project connections, agents, commands, tasks, agent runs, pull requests, deployments, test runs, incidents, reports, policies, approvals, and activity events.
- Connection records use opaque secret references and database checks reject credential-shaped metadata/common token forms. Phase 1A request handlers use authenticated user JWTs, RLS, and reviewed `SECURITY DEFINER` RPCs—not the service-role key.
- Important project, connection, autonomous-control, command/task, agent-run, pull-request, deployment, rollback/incident, report/policy, and approval transitions have audit-event foundations.
- CI uses a locked install and Node 22, runs lint/typecheck/Vitest/build plus Playwright desktop/tablet/mobile accessibility tests, has read-only repository permission, does not persist checkout credentials, and does not merge or deploy.
- Repository memory, risk/automation policies, operating documentation, environment template, and private vulnerability-reporting guidance are present.

## Integration status

| Provider/capability | Status | Meaning |
| --- | --- | --- |
| GitHub repository automation | **Not Connected** | No verified GitHub App installation, webhook ingestion, PR mutation, or merge execution. |
| Vercel UI hosting | Verified deployment | Project `surgeservices-projects/softwarefactory` (`prj_pAsrhftaVWI4SyaqstgRVSWHJkdD`); production deployment `dpl_Fi7jEzWFbtW3vrXDGuEodPumTuJ7` is READY; stable alias returned HTTP 200 with the expected SoftwareFactory title. |
| Vercel control-plane connection and deployment/rollback automation | **Not Connected** | The live UI deployment does not provide an in-product provider adapter, verified repository linkage/continuous deployment, deploy executor, post-deploy validator, or rollback executor. |
| Supabase hosted runtime | **Not Connected** | Schema/workflows were verified locally; no linked hosted project, authenticated application session, or hosted health/read/write path was verified. |
| OpenAI worker execution | **Not Connected** | Commands are never shown as executed by a model. |
| Anthropic worker execution | **Not Connected** | Commands are never shown as executed by a model. |
| Autonomous production execution | Disabled | Out of scope for Phase 1A. |
| Auto approve/merge/deploy/rollback | OFF by default | Visible controls and database settings do not create an executor. |

## Verification evidence

All evidence below is from 2026-08-12 against the current working tree unless noted.

| Gate | Evidence | Result |
| --- | --- | --- |
| Core quality | `npm run check` (`lint`, `typecheck`, Vitest, production build) | Pass; 5 Vitest files/81 tests passed and all 17 routes built. |
| Unit/integration | `npm test`; `npm run test:integration -- --reporter=verbose` | Pass; 81 total tests and 57 integration tests. |
| Browser/responsive/accessibility | `npm run test:e2e` | Pass; 12/12 across desktop 1440×900, tablet 834×1112, and Pixel 5 mobile; includes navigation, overflow, browser-error, and axe serious/critical checks. |
| Production UI availability | Vercel project/deployment identity plus live alias request | Pass for UI deployment; `dpl_Fi7jEzWFbtW3vrXDGuEodPumTuJ7` is READY and `https://softwarefactory-tan.vercel.app` returned HTTP 200 with the expected application title on 2026-08-12. |
| Secret review | Common live-token/private-key pattern scan of repository files plus privileged-variable-name scan of `.next/static` | Pass; no credential-pattern files and no privileged server variable names in built client assets. Only `.env.example` is present. |
| RLS/migrations | pglast parse plus ephemeral PostgreSQL-compatible PGlite apply/catalog and workflow smoke tests | Pass within local test scope; 3 migrations parsed/applied, all 18 public tables have RLS and FORCE RLS, tenant workflow/default/RED approval/audit/sensitive-key behavior passed. Not yet applied to a hosted Supabase project. |

## Known limitations and warnings

- The local verification shell used Node 20.19.0 and emitted Supabase's Node 20 deprecation warning. `package.json`, CI, documentation, and the intended Vercel runtime target Node 22 or newer.
- No live control-plane provider connection, durable queue/worker, GitHub App, deployment automation, deployment validator, or rollback executor exists. Vercel currently hosts only the verified Phase 1A UI.
- Settings controls are a local policy preview unless invoked through a configured authenticated Supabase project workflow.
- Project creation remains a disabled foundation form until authenticated persistence is connected.
- File history is a labeled placeholder. Local file saving is intentionally disabled outside a trusted local environment.
- RLS/workflow behavior was exercised in an ephemeral PostgreSQL-compatible environment, not a linked hosted Supabase project; `pgcrypto` extension creation was skipped only in PGlite because that runtime does not package extensions.

## Completion handoff

The final implementation report must retain these limitations and list completed functionality, exact verification results, outstanding work, and recommended Phase 1B priorities. Removing a **Demo Data** or **Not Connected** label requires new live-source and failure-path evidence.
