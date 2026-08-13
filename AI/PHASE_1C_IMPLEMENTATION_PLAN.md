# Phase 1C implementation plan

Date: 2026-08-13

Status: local implementation candidate, three commits ahead of `main` and unpublished; protected reconciliation, promotion, configuration, and live acceptance pending

## Objective

Connect an authenticated owner command to a supported server-side Codex worker that produces a bounded, reviewable draft pull request with durable evidence:

`Owner command -> deterministic plan -> durable run -> Codex -> isolated workspace -> validation -> draft PR -> CI -> SoftwareFactory result`

Phase 1C does not authorize RED execution, default-branch writes, pull-request approval/merge, production deployment, rollback, provider administration, or Autonomous Mode. The global kill switch remains ON and every automatic action remains OFF.

## Implementation matrix

| Area | Local implementation | Live/hosted state |
| --- | --- | --- |
| Auth/tenant/repository binding | Active-organization owner/member boundaries; connected project only; immutable repository/installation IDs and exact base SHA resolved server-side | Existing owner GitHub path live; Phase 1C hosted path pending |
| Command composer/API | Type, acceptance criteria, requested risk, stable idempotency, same-origin, secret scan, fixed plan, truthful RED/delayed status | Local only |
| Risk/plan enforcement | Owner-only submission; type/prompt/criteria/request maximum; SQL independently raises risk and fixes provider/model/role/budget/workflow | Compatibility `130007`, enums `130008`, execution `130009`, roster `130010`, and dependency/budget hardening `130011` are unhosted |
| Durable orchestration | Command/task/run, canonical same-project dependencies, provider-neutral logical agent, one active lease per agent, heartbeat, cancellation, cumulative retry budgets, result | Migrations `130009`-`130011` unhosted |
| Logical workforce | Idempotent eleven-role roster for existing/future organizations; provider-account identity stays separate; user-created agents/explicit assignments are preserved | Migration `130010` unhosted |
| Worker evidence | Append-only events/artifacts/validations, coherent branch/commit/draft-PR recovery, stale-lease terminalization, structured bounded reports, safe projections | Migrations `130009`-`130011` unhosted |
| Codex provider | Pinned `@openai/codex-sdk` `0.147.0`, model `gpt-5.3-codex`, bounded sandboxed session | API key/real call **Not Connected** |
| Durable worker | Persistent/one-shot Node runner with service-role claim/heartbeat/cancel/result contract | Workflow exists locally; no heartbeat |
| Git workspace | Repository-ID token, exact base-SHA verification, isolated `factory/*` branch, safe recovery | Local tests only |
| Validation | Pinned Docker image, restricted dependency bootstrap, network-none diff/lint/typecheck/test/build, one repair | Local tests only; live runner pending |
| Policy scan | Containment, forbidden paths, symlink/binary/secret/protected/file/size caps | Local tests only |
| Publication/CI | Commit owner identity, isolated push, create/recover exact draft PR, exact-head check polling against the required-check allowlist | No live Phase 1C PR/CI |
| UI/APIs | Dashboard/Bot Manager worker truth; Agents/Backlog/Runs/Reports detail; cancel/retry/status | Local only; hosted/E2E pending |
| Workflow wake-up | Opaque repository dispatch plus five-minute scheduled recovery; branch-selectable manual dispatch is omitted; final job gate requires `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED=true` | Local unpublished workflow; repository has zero secrets/variables and only CI on `main` |
| Autonomous safety | RED rejected; merge/deploy absent; kill switch/autonomous controls unchanged | Phase 1D source is on `main`; its decision-only `130006` is unhosted, global kill remains ON, and all nine actions remain OFF |

## Fixed execution envelope

- Provider: `openai`.
- Model: `gpt-5.3-codex` unless a separately reviewed server configuration changes the exact model string; SQL currently requires this exact model.
- Maximum duration: 45 minutes.
- Maximum Codex turns: 4.
- Maximum input/output tokens: 200,000 / 50,000.
- Maximum repair attempts: 1.
- CI observation timeout: 15 minutes.
- Maximum changed files: 200.
- Maximum individual changed file: 2 MiB.
- Maximum aggregate changed content: 10 MiB.
- Outcome: open draft pull request only.

## Protected release sequence

1. Keep `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` absent or false. The frozen local candidate on bundled Node `24.19.0` passes lint/typecheck, 109 test files/1,169 tests, build with 74 page/route entries, coverage 75.06/69.97/72.60/76.66, Playwright/axe 117/117, focused migration suites 8 files/104 tests, production dependency audit 0, and safe disabled-worker smoke. Complete final tracked-file/secret/diff review before protected publication and rerun affected gates after any change.
2. Review migrations, worker, workflow, and UI/API diff against all policies and verify no privilege or autonomous authority widened.
3. Obtain one exact owner RED approval that names the exact Supabase project/migrations, the seven Actions secret names, the reviewed workflow publication, the bounded GREEN acceptance command, risks, expiry, validation, and containment/rollback plan.
   - Required confirmation phrase for the exact Phase 1C RED matrix: `APPROVE RED PHASE1C-20260813-A THROUGH 2026-08-14 00:30 EDT`.
   - The phrase is not reusable and is invalid without the attached exact targets, source/catalog mapping, secret names (never values), execution window, validation, and containment plan.
4. Reauthenticate the currently unauthorized Supabase CLI as `surgeservicesllc@gmail.com`, reconfirm `qpuofpmagrmyamahqwxw`, compare the exact history/catalog/source hashes, and repair only the ledger for catalog-proven schema-present `028`/`130001`-`130005`; do not rerun their DDL. Re-list and dry-run, then apply only absent forward migrations `130006` -> `130007` -> `130008` -> `130009` -> `130010` -> `130011`. Verify RLS/FORCE RLS, policies, ACLs, functions/triggers, provider execution default OFF, Phase 1D interlocks, owner boundaries, canonical dependencies, neutral roster, coherent recovery/reporting, cumulative retry budgets, secret checks, and caller-session behavior.
5. Configure protected GitHub Actions secrets without displaying values:
   - `SOFTWAREFACTORY_SUPABASE_URL`
   - `SOFTWAREFACTORY_SUPABASE_SERVICE_ROLE_KEY`
   - `SOFTWAREFACTORY_OPENAI_API_KEY`
   - `SOFTWAREFACTORY_GITHUB_APP_ID`
   - `SOFTWAREFACTORY_GITHUB_APP_PRIVATE_KEY_BASE64`
   - `SOFTWAREFACTORY_GITHUB_CANDIDATE_APP_ID`
   - `SOFTWAREFACTORY_GITHUB_CANDIDATE_APP_PRIVATE_KEY_BASE64`
6. Verify `SOFTWAREFACTORY_REQUIRED_CHECKS` is exactly `Lint, typecheck, test, and build|Browser and accessibility tests`, and that both names still exactly match the job display names in `.github/workflows/ci.yml`. It must parse to 1-20 unique pipe-delimited names, each at most 300 characters.
7. Publish the exact reviewed commit with `surgeservicesllc <surgeservicesllc@gmail.com>` as author and committer while activation remains absent/false; verify regular CI and matching Vercel deployment and confirm every worker trigger still skips.
8. Under the same exact protected activation approval and bounded window, set the non-secret repository Actions variable `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` to literal `true`.
9. Do not add or use branch-selectable manual dispatch for the secret-bearing worker workflow.
10. Submit one narrowly scoped manual GREEN owner command through the authenticated UI/API, allow its opaque default-branch repository dispatch to start the one-shot worker (with the schedule only as durable recovery), observe the fresh active heartbeat during execution, and follow the exact durable IDs through a real Codex thread to a coherent draft PR and stable exact required checks.
11. Set activation back to absent/false after acceptance unless separately approved continued operation exists.
12. Verify no default-branch change, approval, merge, deployment, rollback, RED execution, provider/workflow administration, or secret disclosure occurred, then update repository memory with exact hosted/provider/run/branch/commit/PR/check/deployment evidence.

## Acceptance gates

- Repository identity is always derived from the authenticated project connection and synchronized immutable GitHub repository record.
- Dispatch data is an opaque wake-up hint; the database claim is execution authority.
- Browser input cannot lower risk or choose provider/model/role/budgets/workflow.
- A stale base SHA, lease mismatch, missing heartbeat, missing secret, missing approval, incoherent recovery artifact, missing/renamed/incomplete/unstable required check, changed draft PR, or unavailable validation runtime fails closed.
- `SOFTWAREFACTORY_REQUIRED_CHECKS` is the exact CI contract. Every required check must be present with conclusion `success`, the complete observed check set must be terminal and acceptable, the identical passing fingerprint must be observed twice, and the draft PR base/head must pass a final recheck.
- RED is non-executable in Phase 1C. Protected paths additionally need exact unexpired approved-path evidence.
- Secrets remain in protected server/worker secret storage and never enter prompts, rows, browser payloads, logs, artifacts, fixtures, or source.
- Completion requires one real owner command and real end-to-end evidence, not configuration or mocks.
