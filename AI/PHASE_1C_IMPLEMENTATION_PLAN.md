# Phase 1C implementation plan

Date: 2026-08-13

Status: local implementation candidate with final local gates green; protected promotion and live acceptance pending

## Objective

Connect an authenticated owner command to a supported server-side Codex worker that produces a bounded, reviewable draft pull request with durable evidence:

`Owner command -> deterministic plan -> durable run -> Codex -> isolated workspace -> validation -> draft PR -> CI -> SoftwareFactory result`

Phase 1C does not authorize RED execution, default-branch writes, pull-request approval/merge, production deployment, rollback, provider administration, or Autonomous Mode. The global kill switch remains ON and every automatic action remains OFF.

## Implementation matrix

| Area | Local implementation | Live/hosted state |
| --- | --- | --- |
| Auth/tenant/repository binding | Active-organization owner/member boundaries; connected project only; immutable repository/installation IDs and exact base SHA resolved server-side | Existing owner GitHub path live; Phase 1C hosted path pending |
| Command composer/API | Type, acceptance criteria, requested risk, stable idempotency, same-origin, secret scan, fixed plan, truthful RED/delayed status | Local only |
| Risk/plan enforcement | Owner-only submission; type/prompt/criteria/request maximum; SQL independently raises risk and fixes provider/model/role/budget/workflow | Migrations `130007`/`130008` unhosted |
| Durable orchestration | Command/task/run, dependencies, provider-neutral logical agent, one active lease per agent, heartbeat, cancellation, bounded retry, result | Migrations `130006`/`130007`/`130008` unhosted |
| Logical workforce | Idempotent eleven-role roster for existing/future organizations; provider-account identity stays separate; user-created agents/explicit assignments are preserved | Migration `130008` unhosted |
| Worker evidence | Append-only events/artifacts/validations, coherent branch/commit/draft-PR recovery, stale-lease terminalization, structured bounded reports, safe projections | Migrations `130007`/`130008` unhosted |
| Codex provider | Pinned `@openai/codex-sdk` `0.147.0`, model `gpt-5.3-codex`, bounded sandboxed session | API key/real call **Not Connected** |
| Durable worker | Persistent/one-shot Node runner with service-role claim/heartbeat/cancel/result contract | Workflow exists locally; no heartbeat |
| Git workspace | Repository-ID token, exact base-SHA verification, isolated `factory/*` branch, safe recovery | Local tests only |
| Validation | Pinned Docker image, restricted dependency bootstrap, network-none diff/lint/typecheck/test/build, one repair | Local tests only; live runner pending |
| Policy scan | Containment, forbidden paths, symlink/binary/secret/protected/file/size caps | Local tests only |
| Publication/CI | Commit owner identity, isolated push, create/recover exact draft PR, exact-head check polling against the required-check allowlist | No live Phase 1C PR/CI |
| UI/APIs | Dashboard/Bot Manager worker truth; Agents/Backlog/Runs/Reports detail; cancel/retry/status | Local only; hosted/E2E pending |
| Workflow wake-up | Opaque repository dispatch plus five-minute scheduled recovery; branch-selectable manual dispatch is omitted; final job gate requires `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED=true` | Local workflow; secrets/activation pending |
| Autonomous safety | RED rejected; merge/deploy absent; kill switch/autonomous controls unchanged | Retained hosted safety through `027`/migration `010` |

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

1. Keep `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` absent or false and preserve the final reconciled local evidence: supported bundled Node `24.19.0`; `npm run check` PASS (lint, strict typecheck, 97 test files/959 tests, production build with 62/62 page-data entries); coverage 72.37/66.79/68.80/74.13; Playwright/axe 117/117; production dependency audit 0; disabled-worker smoke safe exit; high-confidence source/static secret-value scans clean; clean diff check except line-ending notices; and focused migration/API security audits with no remaining P0/P1 blocker. Rerun affected gates after any code/schema/workflow change.
2. Review migrations, worker, workflow, and UI/API diff against all policies and verify no privilege or autonomous authority widened.
3. Obtain one exact owner RED approval that names the exact Supabase project/migrations, the seven Actions secret names, the reviewed workflow publication, the bounded GREEN acceptance command, risks, expiry, validation, and containment/rollback plan.
4. Reauthenticate Supabase CLI as `surgeservicesllc@gmail.com`, reconfirm `qpuofpmagrmyamahqwxw`, compare migration history, dry-run/lint, apply `028` -> `130001` -> `130002` -> `130003` -> `130004` -> `130005` -> `130006` -> `130007` -> `130008`, and verify hosted RLS/FORCE RLS/policies/ACLs/functions/triggers, provider execution default OFF, owner boundaries, neutral roster, coherent recovery/reporting, secret checks, and caller-session behavior.
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
