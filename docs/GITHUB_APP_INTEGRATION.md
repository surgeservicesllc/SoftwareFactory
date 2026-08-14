# Production GitHub App integration

## Current provider status

Candidate App `4582606` (`surge-softwarefactory-next`) is the live Phase 1B owner repository/webhook path. It is installed as `153479019`, connection `85591f43-dd4e-46d2-8a1b-0f036b32639f`, for exactly `surgeservicesllc/SoftwareFactory`. Project `b1f23696-437e-4d89-b55f-d7a949980e8f`, signed webhook processing, repository/file reads, and prior draft-only write acceptance pass.

Primary App `4573846` and installation `153445938` remain the rollback path. Its webhook defect remains tracked under GitHub Support ticket [#4660724](https://support.github.com/ticket/personal/0/4660724).

The connected GitHub repository is a prerequisite for Phase 1C, not proof of a connected Codex worker. Hosted ledger reconciliation and the forward chain through `130014` are complete, the reviewed worker is published, the prior verified production baseline before this update passed CI/Vercel, and six non-OpenAI worker secrets remain configured. The current routing/UI update and local `130015` still need their own gates/publication/approval/hosted evidence. The exposed OpenAI key and activation variable are absent. A real claim/heartbeat/provider thread failed safely before repository mutation; no-claim diagnostic `31748582858` then identified `credit_balance_exhausted`. The failed run's base is now stale, so acceptance requires funded-provider proof and a new current-base command. OpenAI/Codex remains **Not Connected**.

## Registered Apps

| Field | Primary rollback | Candidate live owner path |
| --- | --- | --- |
| Owner | `surgeservicesllc` | `surgeservicesllc` |
| App | `Surge SoftwareFactory` | `Surge SoftwareFactory Next` |
| Slug | `surge-softwarefactory` | `surge-softwarefactory-next` |
| App ID | `4573846` | `4582606` |
| Callback | `https://softwarefactory-tan.vercel.app/api/github/install/callback` | Same exact callback |
| Webhook | Defective/blank after reload; Support `#4660724` | `https://softwarefactory-tan.vercel.app/api/github/webhooks`, signed delivery verified |
| Installation | `153445938` | `153479019` |
| Repository scope | Exactly `surgeservicesllc/SoftwareFactory` | Exactly `surgeservicesllc/SoftwareFactory` |

Primary and candidate identity, OAuth, private key, state secret, and webhook secret remain cryptographically isolated. Installation state binds slot/App ID; token minting follows persisted installation App ID; webhook verification rejects signing-App/persisted-App mismatch.

## App permissions

The Apps retain the Phase 1B permission set:

| Permission | Access | Phase 1C use |
| --- | --- | --- |
| Metadata | Read | Repository/installation identity |
| Contents | Read/write | Opaque repository dispatch authorization, fetch, isolated factory branch push |
| Pull requests | Read/write | Create/recover only an open draft PR |
| Checks | Read | Exact-head CI observation |
| Commit statuses | Read | Provider status evidence |
| Actions | Read | Existing visibility; worker check observation uses checks API |
| Workflows | None | Worker cannot modify workflow files or workflow permissions |

Organization/account administration, secrets, deployments, environments, members, and branch-protection write permissions remain absent. Do not widen them for Phase 1C.

## Phase 1B routes retained

The installation, callback, sync, disconnect, handoff, repository read, file-change, and signed webhook routes remain as previously verified. Every route checks the authenticated active tenant and exact installation/repository before minting a short-lived token. Phase 1B file changes create only a `softwarefactory/*` branch and draft PR.

## Phase 1C command dispatch

After `submit_command` commits one durable GREEN/YELLOW run, the Next.js server mints a short-lived installation token scoped to the exact repository ID with `contents: write` and `metadata: read`, then sends:

```text
POST /repos/{owner}/{repo}/dispatches
event_type: softwarefactory_phase1c_command
client_payload: { command_id: <opaque UUID> }
```

The payload contains no prompt, repository name, branch, user, token, provider key, or execution configuration. Dispatch is only a wake-up signal. The worker must claim the command from Supabase and revalidate all durable identity/risk/lease data. Dispatch failure is recorded as delayed; a scheduled worker wake can recover it.

## Worker workflow activation

`.github/workflows/codex-worker.yml` is triggered only by the opaque repository dispatch or a five-minute recovery schedule. Branch-selectable manual workflow dispatch is intentionally absent from this secret-bearing workflow. The job has a final fail-closed gate:

```text
vars.SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED == 'true'
```

If repository Actions variable `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` is missing or not exactly `true`, every trigger skips the worker job. It is currently absent/OFF. Keep it absent/false through migration work, secret setup, publication, ordinary CI, and matching Vercel verification. Setting it to `true` is a protected RED activation that requires exact owner approval for the bounded acceptance window; restore it to absent/false afterward unless continued operation is separately approved.

The workflow token has only contents read. Checkout and Node setup actions are pinned to exact commit SHAs, checkout uses `persist-credentials: false`, locked dependencies install with scripts ignored, and the exact Docker digest is preloaded before secrets are injected. A successful invocation claims at most one durable run.

## GitHub Actions protected secrets

GitHub does not allow Actions secret names beginning with `GITHUB_`. Configure exactly these repository secret names only after owner approval:

- `SOFTWAREFACTORY_SUPABASE_URL`
- `SOFTWAREFACTORY_SUPABASE_SERVICE_ROLE_KEY`
- `SOFTWAREFACTORY_CODEX_AUTH_JSON`
- `SOFTWAREFACTORY_GITHUB_APP_ID`
- `SOFTWAREFACTORY_GITHUB_APP_PRIVATE_KEY_BASE64`
- `SOFTWAREFACTORY_GITHUB_CANDIDATE_APP_ID`
- `SOFTWAREFACTORY_GITHUB_CANDIDATE_APP_PRIVATE_KEY_BASE64`

The worker step maps the last four to runtime `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY_BASE64`, `GITHUB_CANDIDATE_APP_ID`, and `GITHUB_CANDIDATE_APP_PRIVATE_KEY_BASE64`. Values must never appear in source, workflow logs, issues, screenshots, artifacts, model prompts/output, or Supabase rows.

The six Supabase/GitHub App secret names are verified configured without reading their values. `SOFTWAREFACTORY_OPENAI_API_KEY` was removed after its value was exposed and is now permanently absent rather than pending replacement: Phase 1C authenticates Codex with the owner's ChatGPT subscription and has no paid-API path to restore it to. `SOFTWAREFACTORY_CODEX_AUTH_JSON` replaces it. Configuration alone is not connectivity; the worker remains **Not Connected** until a live run proves it.

## Required CI check contract

The workflow passes this exact public runtime policy:

```text
SOFTWAREFACTORY_REQUIRED_CHECKS=Lint, typecheck, test, and build|Browser and accessibility tests
```

The pipe-delimited value must parse to 1-20 unique names, each at most 300 characters. Both names exactly match the job display names in `.github/workflows/ci.yml`; a CI job rename requires a reviewed update to this contract and its tests.

For the exact draft-PR head SHA, the publisher requires the full returned check set rather than accepting a truncated page. Every observed check must be completed with an acceptable conclusion (`success`, `neutral`, or `skipped`), every required name must be present with exact `success`, and at least one required success must exist. It observes the identical passing fingerprint twice, then refetches and revalidates the exact PR number, base, head branch, and head SHA. Missing, renamed, incomplete, unstable, non-success, truncated, or changed-PR evidence fails or times out; it never passes inconclusively.

## Installation-token scopes inside the worker

For a claimed run, the worker signs a short App JWT for the App ID stored in the durable repository binding and requests an installation token restricted to the single external repository ID with:

- `metadata: read`
- `contents: write`
- `pull_requests: write`
- `checks: read`
- `statuses: read`
- `actions: read`

It cannot request workflows, administration, secrets, environments, deployments, or branch protection. The token is never stored in Supabase, passed to Codex, or printed. Git commands receive it only through a per-command extra header whose value is redacted.

## Exact repository and branch boundary

The database claim includes App ID, installation ID, external repository ID, owner/name, default branch, and exact base SHA derived from the active project connection. The worker:

1. constructs only `https://github.com/{owner}/{name}.git` from validated coordinates;
2. calls `ls-remote` for the expected default branch and compares the exact SHA;
3. fetches the exact commit and fails if it differs;
4. creates/resumes only `factory/<run-uuid>-<slug>`;
5. verifies remote URL, branch marker, remote branch SHA, and ancestry during recovery; and
6. configures author and committer as `surgeservicesllc <surgeservicesllc@gmail.com>`.

A moved default branch produces a stale-base failure and requires a newly planned command. The worker never rebases onto a different SHA silently.

## Draft pull request and CI boundary

After deterministic validation and policy scan pass, the worker records one coherent branch/commit pair, commits, pushes its isolated branch, and requests a PR with:

- base equal to the synchronized default branch;
- head equal to the exact factory branch;
- `draft: true`;
- `maintainer_can_modify: false`; and
- a body that identifies the run, logical agent/provider/model, risk, and the no-merge/no-deploy boundary.

If PR creation has an ambiguous response, the worker searches for an existing open draft with the exact owner/branch/base/head SHA and recovers it instead of creating another. The database artifact and `pull_requests` projection must agree on organization/project/repository/run/base/head/URL/number. Exact replay is accepted; partial/conflicting branch, commit, or PR evidence is rejected. Before resuming, the workspace/publisher revalidates the remote branch SHA and exact PR identity. A non-draft, closed, wrong-head, or wrong-base result is rejected.

The worker polls the complete check set for the exact commit SHA using the required-check contract above. Missing/incomplete/unstable checks until the deadline are timed out, never passed. One bounded repair may update the existing draft PR, after which the exact new head and PR identity are observed again.

## Phase 1C acceptance checklist

- [x] Local command/orchestration, SDK worker, workspace, validation, policy scan, publisher, workflow, schema, APIs, UI, and tests are implemented.
- [x] Local Phase 1C migrations are split into `130007` provider compatibility, `130008` enums, `130009` execution, `130010` logical roster/recovery/report hardening, and `130011` dependencies/cumulative budgets.
- [x] Prior verified baseline gates are retained in `AI/QUALITY_SCORECARD.md`; they are not current-update evidence.
- [ ] Run the complete final gate set for the current routing/UI update with fresh counts before publication.
- [x] Obtain exact owner RED approvals for the hosted ledger repair, forward migrations through `130014`, protected secret configuration, workflow publication/activation, and one bounded live GREEN attempt.
- [x] Ledger-repair only catalog-proven schema-present `028`/`130001`-`130005`, then apply and verify the forward-only chain `130006` -> `130014` on exact project `qpuofpmagrmyamahqwxw` without replaying `130004` or down-migrating.
- [x] Configure six non-OpenAI `SOFTWAREFACTORY_*` secrets without exposing values. The exposed OpenAI key was removed; a fresh funded replacement remains pending.
- [x] Verify `SOFTWAREFACTORY_REQUIRED_CHECKS` exactly matches both CI job names.
- [x] Preserve the prior verified production baseline before this update: commit `0c662a24393f682073e6002c5aff9339292226d8`, passing CI run `31749352644`, and READY deployment `dpl_FJKMapsyLB4hQPDsaykUo1cVUQp7`, all while activation was absent/OFF. The current routing/UI update needs its own publication evidence.
- [x] Exercise the exact activation gate for the approved first attempt and return it to absent/OFF after job admission.
- [x] Submit the first real GREEN owner command and observe a fresh claim, heartbeat, lease, and provider thread. It failed safely before repository mutation.
- [ ] After provider funding and a passing no-claim diagnostic, submit a new narrow GREEN owner command bound to current `main` and record command/task/run/agent/lease/thread IDs. Do not retry the stale failed run.
- [ ] Verify exact base SHA, coherent factory branch/commit/PR projection, commit identity, open draft PR, validation, changed paths, usage, structured report/activity, stable exact required checks, and final PR base/head.
- [ ] Verify no default-branch write, PR approval/merge, deployment, rollback, workflow/provider administration, RED execution, or secret disclosure.
- [ ] Exercise dispatch failure/scheduled recovery, stale SHA, cancellation, lease expiry, provider failure/rate limit, validation/CI failure/timeout, retry, protected path, secret, binary/symlink, and oversized change denial.
- [ ] Return activation to absent/false after acceptance unless continued operation is separately approved; disable immediately if containment is required and preserve durable evidence.

## Troubleshooting

- **Workflow job skipped:** confirm the protected Actions variable is exactly `true`. Missing/false is the intended safe default.
- **Worker Not Connected:** require reconciled history, hosted `130006`-`130014`, valid protected configuration, published workflow, an enabled approved window, and a successful end-to-end run. A workflow file, failed provider attempt, transient heartbeat, or completed idle one-shot registration is insufficient.
- **Dispatch delayed:** the command remains durable; inspect bounded dispatch evidence and let the scheduled wake claim it after provider recovery.
- **GitHub not configured:** verify the claimed App ID has its matching protected App ID/private-key pair without printing values.
- **Stale base SHA:** submit a new command so planning captures the current branch SHA; never force/rebase silently.
- **PR invalid:** require open + draft + exact head/base; close/contain ambiguous unsafe artifacts manually.
- **CI timeout:** verify exact required names still match CI, check enumeration is complete, and PR base/head stayed exact; keep the run failed/inconclusive and the PR draft; do not merge.
- **Secret/protected-path rejection:** remove secret material or obtain exact approved paths where eligible; never weaken the scanner. RED remains non-executable.
- **Primary webhook defect:** preserve installation `153445938` and Support ticket `#4660724`; candidate success does not relabel the primary webhook.
