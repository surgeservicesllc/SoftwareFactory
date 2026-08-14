# Phase 1C completion — zero-token Codex execution

Audit date: 2026-08-14
Audited tree: `63677a4` (`origin/main`)
Cost rule in force: SoftwareFactory must operate without purchasing, funding, or consuming
per-token AI API credit. An architecture that requires a paid AI API call is rejected rather
than configured.

## 1. The paid dependency, traced end to end

The published worker cannot start without an OpenAI **API** key, and its one model call is
billed per token. This is not a fallback or an optional path — it is the only path.

| # | Location | What it does | Billed? |
| --- | --- | --- | --- |
| 1 | `lib/worker/env.ts:26` | `OPENAI_API_KEY: z.string().min(20)` — a **required** field of the worker configuration schema | Gate: the worker exits on a configuration error without it |
| 2 | `lib/worker/env.ts:115` | Surfaces it as `configuration.openAiApiKey` | — |
| 3 | `scripts/worker.mts:35` | `CodexSdkAdapter.create(configuration.openAiApiKey)` | — |
| 4 | `lib/worker/codex.ts:273-279` | `new Codex(codexClientOptions(key, workspace))` with `apiKey` set | **Yes** — every Codex turn is API-metered |
| 5 | `lib/worker/preflight.ts:97-104` | `GET https://api.openai.com/v1/models/{model}` with `Authorization: Bearer` | No tokens, but requires a funded API account |
| 6 | `lib/worker/preflight.ts:123-132` | `POST https://api.openai.com/v1/responses` | **Yes** — a real billed completion |
| 7 | `.github/workflows/codex-worker.yml:52,58,73` | Injects `secrets.SOFTWAREFACTORY_OPENAI_API_KEY` into three steps | — |

This is also the recorded cause of the only live acceptance attempt failing: the configured
project returned `credit_balance_exhausted`. The architecture made a funded API balance a
precondition for any Phase 1C run at all.

## 2. The zero-token path exists, and the SDK already supports it

Verified against the installed package rather than from memory
(`node_modules/@openai/codex-sdk`, version `0.147.0`):

- `CodexOptions.apiKey` is **optional** — `dist/index.d.ts:221` declares `apiKey?: string`.
- The SDK does not talk to the API directly. Its README states it "wraps the `codex` CLI from
  `@openai/codex`. It spawns the CLI and exchanges JSONL events over stdin/stdout", and
  `dist/index.js:513-514` constructs `CodexExec(codexPathOverride, env, config)`.
- Authentication therefore resolves the way the **CLI** resolves it: from `CODEX_HOME/auth.json`,
  written by `codex login`. A ChatGPT subscription login authenticates against the owner's
  existing plan; `codex login --api-key` is the billed alternative.

So the zero-token architecture is not a workaround — it is the SDK's default. Constructing
`new Codex()` without `apiKey`, against a `CODEX_HOME` that holds a subscription `auth.json`,
runs Codex on the owner's existing entitlement with no API metering.

One detail blocks it today: `lib/worker/codex.ts:75-81` points `CODEX_HOME` at a **fresh,
empty** per-run directory (`workspace.runDirectory/codex-home`). That isolation is correct and
worth keeping, but it means there is no `auth.json` to find, so removing the API key without
seeding that directory would leave the worker unauthenticated rather than zero-token.

## 3. Goal scorecard

Legend: **PASS** (implemented and evidenced) · **PARTIAL** · **FAIL** · **BLOCKED**
(cannot be completed without external owner action).

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Real Bot Manager command persists | **PASS** | `submit_command` RPC; durable command row observed in the recorded live attempt |
| 2 | Project/repo/installation/base SHA resolve server-side | **PASS** | Worker job carries `repository.owner/name`, `baseBranch`, `baseSha`; resolved before dispatch, never browser-supplied |
| 3 | Task/risk/acceptance criteria created without paid LLM calls | **PASS** | `WorkerJob.acceptanceCriteria` and `job.risk` are set deterministically by the command layer; no model call participates |
| 4 | Existing authenticated Codex execution invoked without API-token billing | **BLOCKED** — built, not proven | Implemented in `lib/worker/auth.ts` + `lib/worker/codex.ts`. Blocked only on the owner-supplied subscription credential (§5); no code gap remains |
| 5 | Run is durable and survives browser refresh | **PASS** | Durable run rows with claim/heartbeat/attempt state; run `f4594556…` survived its own worker failure |
| 6 | Worker receives repo instructions and task context | **PASS** | `taskPrompt` (`lib/worker/codex.ts:215-236`) passes role, risk, repo, base SHA, acceptance criteria, and instructs reading `AGENTS.md` |
| 7 | Code work is isolated | **PASS** | Disposable Git workspace, `sandboxMode: "workspace-write"`, `networkAccessEnabled: false`, `approvalPolicy: "never"`, `inherit: "none"` shell policy |
| 8 | Real change occurs | **BLOCKED** | Depends on 4. No successful live run has produced a file change |
| 9 | Real lint/typecheck/tests/build run | **PASS** as implemented | `DeterministicValidator` runs them in a pinned Docker sandbox, independently of anything Codex claims |
| 10 | Failures use bounded repair | **PASS** | Bounded attempts with escalation; Phase 1E `create_repair_attempt` capped at three |
| 11 | Diff/secret/protected-resource checks run deterministically | **PASS** | `hasLikelySecret`/`redactText` on all model output; protected-path RED gate requires an owner phrase; `lib/autonomy/diff-risk.ts` classifies the real diff |
| 12 | `factory/<run-id>-<slug>` branch created | **PASS** as implemented | `GitWorkspaceManager`; never a direct main write |
| 13 | Real commit pushed | **BLOCKED** | Depends on 4 |
| 14 | Real draft PR created, never direct-push main | **PASS** as implemented, **BLOCKED** live | `GitHubDraftPublisher` is draft-only by construction; no live PR has been produced |
| 15 | Real CI observed | **PASS** as implemented | `SOFTWAREFACTORY_REQUIRED_CHECKS` names both required jobs; the publisher reads real check runs |
| 16 | Runs/events/results display truthfully | **PASS** | Surfaces report **Not Connected**; the failed run is shown failed, not hidden |
| 17 | Cancel/failure/retry work | **PASS** | Abort signal plumbed through `runStreamed`; stale-base rejection (`stale_base_sha`) proved on the recorded run |
| 18 | RED protected actions stop | **PASS** | Owner-phrase gate; `AGENTS.md` RED rule; Phase 1D classifier marks authority-widening RED |
| 19 | RLS/project isolation passes | **PASS** | RLS + FORCE RLS on every exposed table; owner/unrelated/anonymous denial covered by integration tests |
| 20 | No paid AI-token dependency exists in the execution path | **PASS** | All seven call sites in §1 removed. `tests/integration/phase1c-worker-workflow.contract.test.ts` asserts no step receives a paid key; `tests/unit/worker-codex-auth.test.ts` asserts the billed mode cannot be selected implicitly |

**Score: 16 PASS · 0 FAIL · 4 BLOCKED (all four on one owner action).**

Requirement 20 is closed. Requirements 4, 8, 13, and 14-live now share a single blocker that is
not a code gap: the owner-supplied subscription credential (§5). Everything else in the loop —
persistence, isolation, validation, publishing, CI observation, RLS, truthful state — is built.

## 4. Architecture decision

Phase 1C moves to **subscription-authenticated Codex execution**, with the paid API key removed
from the required path rather than left as a fallback.

- `OPENAI_API_KEY` stops being a required worker configuration field.
- The worker seeds the per-run `CODEX_HOME` with owner-supplied subscription credentials, keeping
  the existing per-run isolation.
- `new Codex()` is constructed **without** `apiKey`, so no API metering can occur.
- Preflight stops calling `api.openai.com` entirely in subscription mode. It verifies the pinned
  CLI and the presence of usable auth material — not a billed completion.
- A billed API key remains reachable only behind an explicit, non-default opt-in, so it can never
  be selected silently. Absent auth fails closed with a named reason rather than falling back to
  a paid call.

Deterministic orchestration is already the rule and does not change: no model call turns a
command into a task, sets risk, writes acceptance criteria, validates, or decides publication.

## 4a. What was removed, and what enforces it

All seven paid call sites from §1 are gone. The enforcement is structural rather than advisory —
each of these is a thing the system *cannot* do, not a thing it is asked not to do.

| Guarantee | How it is enforced |
| --- | --- |
| The worker starts without any paid key | `OPENAI_API_KEY` is no longer a field of the worker configuration schema |
| A turn cannot be API-metered | `codexClientOptions` omits `apiKey` entirely in subscription mode. The SDK then falls back to the CLI's own auth, which is the seeded `auth.json` |
| Billing cannot be selected implicitly | An `OPENAI_API_KEY` present without `SOFTWAREFACTORY_CODEX_AUTH_MODE=api_key` is a **refused configuration**, not an invitation. A key left over from an earlier setup cannot quietly resume spending |
| A missing credential cannot fall back to billing | Resolution fails closed with `SUBSCRIPTION_CREDENTIAL_MISSING`. There is no fallback path, because a fallback that spends money is the failure this rule exists to prevent |
| An api-key `auth.json` cannot masquerade as a subscription one | `codex login --api-key` writes an `auth.json` too, and the CLI would obey it. The credential is parsed and rejected with `SUBSCRIPTION_CREDENTIAL_IS_API_KEY` if it carries a key at the top level or nested inside `tokens` |
| Preflight cannot bill | Subscription mode returns after the local CLI check and makes no request to `api.openai.com`. A preflight that called the API to prove a zero-token configuration would defeat what it was checking |
| The deployed workflow cannot bill | A contract test asserts no step receives `OPENAI_API_KEY`, `ANTHROPIC_API_KEY`, or the removed secret. A run cannot bill what it was never given |

Credential handling follows the existing rules. The `auth.json` is written into the per-run
`CODEX_HOME` at mode `0600` inside a `0700` directory, is removed with the run, and its individual
token values are added to the redaction set so a provider error cannot quote one into a persisted
message.

Deterministic orchestration is unchanged and was already correct: no model call turns a command
into a task, sets risk, writes acceptance criteria, validates, or decides publication.

## 5. Owner action required

Subscription auth is credential material that only the owner can produce. It cannot be derived,
and no code change substitutes for it.

- **Service/page:** a machine with the Codex CLI installed, signed in to the ChatGPT account whose
  plan should carry this work.
- **Action:** run `codex login` and complete the browser flow, then read the resulting
  `~/.codex/auth.json`.
- **Value/type:** the full contents of that file, as a single-line JSON string. **Secret** — it
  carries OAuth tokens for the ChatGPT account.
- **Where stored:** a GitHub Actions repository secret, server-side only. It must never appear in
  browser code, logs, fixtures, database rows, or source control.
- **How verified:** the worker preflight reports the resolved authentication mode and whether
  usable credentials were found, without printing any part of their value. A successful GREEN
  canary — command → `factory/*` branch → commit → draft PR — with no `api.openai.com` request in
  the run is the acceptance proof.

**Platform limitation to flag honestly:** whether an unattended, non-interactive GitHub Actions
run may use ChatGPT-subscription credentials is a policy question about the ChatGPT plan, not a
technical one about this repository. The code path works with whatever the CLI accepts. If the
owner's plan or OpenAI's terms disallow headless subscription use, that is a genuine platform
limitation, and the honest outcome is to report Phase 1C as blocked on it rather than to restore
API billing.

## 5a. A conflict outside this phase, flagged rather than resolved

The cost rule was given for Phase 1C, and Phase 1C now satisfies it. But the rule as stated —
"SoftwareFactory must operate without purchasing, funding or consuming OpenAI/Anthropic API
tokens or prepaid AI credits" — is broader than one phase, and **Phase 2A conflicts with it**.

`lib/providers/openai-adapter.ts` and `lib/providers/anthropic-adapter.ts` make per-token API
calls, and `docs/VERCEL_SETUP.md` documents holding `ANTHROPIC_API_KEY` and/or `OPENAI_API_KEY`
in Vercel for that path. Those calls are advisory-only, produce no repository mutation, and are
gated behind an owner-controlled organization switch that defaults OFF — so nothing is being
spent today, and no live provider call has ever succeeded.

This was left in place deliberately rather than removed:

- The instruction scoped the work to Phase 1C and said not to begin other phases. Deleting
  another phase's provider layer is not the change that was asked for.
- The switch already defaults OFF, so the conflict is latent rather than active.
- Phase 2A's purpose is advisory analysis, which is a different question from zero-token
  *execution*. Whether it should also become zero-token is an architecture decision with real
  consequences, and it is the owner's to make.

**Owner decision needed:** either Phase 2A is exempt from the cost rule as an
explicitly-enabled advisory path, or it should be removed or re-based on the same
subscription-authenticated capability. Until that is answered, the honest statement is that
Phase 1C is zero-token and Phase 2A is a paid path that is currently switched off.

## 6. Not started, and deliberately

No Phase 1D or later execution authority is granted by any of this. The worker remains
draft-PR-only, and every merge, deploy, and rollback path stays blocked by name.
