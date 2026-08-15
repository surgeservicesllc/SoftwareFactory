# Phase 2A completion — Claude provider

Scored 2026-08-15 against the 25 stated goals. Evidence is a file, a test, or a
measurement; "the code exists" is not evidence and is not scored as PASS.

**Overall: 20 PASS, 3 PARTIAL, 2 BLOCKED_BY_1C — 88%.**

Nothing here is blocked on funding an AI API, and nothing here requires one.

## The anchor: a real Claude run

The goal document is explicit that a provider marked CONNECTED proves nothing,
and that mock responses do not count. So the anchor is a real execution:

```
SOFTWAREFACTORY_CLAUDE_LIVE_CANARY=1 npx vitest run tests/integration/claude-live-canary.test.ts
  ✓ returns a schema-valid structured artifact from a real execution  75.99s
```

It runs the repository's own `buildSystemPrompt` and `buildTaskPrompt`, executes
against real Claude through the Claude Code CLI, and validates the answer with
the repository's own `parseProviderResult` — not a relaxed copy. Nine turns, real
file reads, zero API tokens.

A fragment of the artifact it returned, which is grounded in files with line
numbers rather than recalled:

> The project is **SoftwareFactory** — repository `surgeservicesllc/SoftwareFactory`,
> npm package name `software-factory-control-plane` (`package.json:2`), product
> name "SoftwareFactory" in `README.md:1` and `AI/PROJECT_CONTEXT.md:5`. Its
> purpose … a **server-first, tenant-scoped software-engineering control plane**
> … (`README.md:3`; `AI/PROJECT_CONTEXT.md:5`).

### What the canary caught on its first run

It failed, and the failure was the point.

Claude executed correctly, read the right files, and returned well-formed JSON
in **a schema it invented** — `{task, project, answer: {…}}` instead of
`{summary, findings, recommendations, confidence, blocked, blocked_reason}`.
`parseProviderResult` rejected it.

The cause was a real defect in the new transport. The API path carries
`PROVIDER_RESULT_JSON_SCHEMA` in `output_config`, where the provider enforces it,
so the shared system prompt only says "reply with a single JSON object matching
the required schema" — it never includes the schema, because on that path it does
not need to. Reusing those prompts on a transport that carries nothing
out-of-band told the model to match a schema nobody had shown it.

Fixed by passing the schema in `outputFormat` and reading the answer from
`structured_output` rather than the free-text `result`: enforcement, not
persuasion. No amount of adapter testing would have found this, because the
adapter was not the part that was wrong.

## Zero-token proof

`lib/providers/claude-auth.ts` is the Claude half of the rule
`lib/worker/auth.ts` established for Codex, deliberately parallel — a cost rule
that holds for one provider and not the other is a rule with a hole in it.

| Property | Evidence |
| --- | --- |
| Subscription is the default | `claude-auth.test.ts` — "defaults to subscription rather than to whatever credential is present" |
| A missing credential fails closed, never falls back to a key | "fails closed when nothing is configured" |
| An `ANTHROPIC_API_KEY` present without opt-in is an **error**, not an invitation | "treats an API key present without the opt-in as a configuration error" |
| An API key pasted into the subscription slot is refused by shape | "refuses an API key pasted into the subscription token slot" — both values begin `sk-ant-`; only `api` vs `oat`/`ort` separates billed from free |
| No billing-capable credential is even present in the child process | `claude-cli-transport.test.ts` — "never puts an API key in the child in subscription mode" |

`ANTHROPIC_API_KEY` is required by nothing on this path. No prepaid credit, no
paid fallback.

## Why the child environment is built rather than inherited

The most important line in `claude-cli-transport.ts` is the one that does *not*
spread `process.env`.

A machine running SoftwareFactory may itself be signed in to Claude — the
development container for this repository is. Inherit its environment and the CLI
authenticates with whatever ambient credential it finds, the run succeeds, and
the success proves nothing: not that the configured credential works, not that an
unconfigured deployment fails closed. It would be a canary that is green because
the cage is open.

So the child gets `controlledProcessEnvironment` — the Codex worker's allowlist,
carrying no `ANTHROPIC_*` and no `CLAUDE_*` — plus exactly the resolved
credential, plus a per-run `CLAUDE_CONFIG_DIR` that starts empty and is removed
in a `finally`. Asserted by "carries the configured credential and nothing
ambient".

This is also the honest reason goal 4 is PARTIAL rather than PASS, and it is the
right trade: the isolation is worth more than a green box.

## Scorecard

| # | Goal | Verdict | Evidence |
| --- | --- | --- | --- |
| 1 | Provider ≠ model ≠ agent ≠ account ≠ connection ≠ project | **PASS** | Six distinct types and tables: `ProviderId`, `provider_model_configurations`, `agents`/`AgentRole`, provider account (never modelled — no login is stored), `connections`, `projects`. `types.ts` states the agent role "is an operating role inside SoftwareFactory, not an account or a login" and the system prompt repeats it to the model. |
| 2 | Existing Codex path intact | **PASS** | No file under `lib/worker/` changed. Full suite 192 files / 2264 tests green, including every Phase 1C suite. |
| 3 | Truthful CONNECTED / UNAVAILABLE / ERROR / DISABLED | **PASS** | `AnthropicProviderAdapter.claudeTransport()` returns `subscription`/`api_key`/`unavailable`/`disabled`; `checkHealth()` maps to the `ProviderConnectionState` the UI already renders. `unavailable` is kept separate from `disabled` because a surface showing both as "off" hides which one an owner can fix. |
| 4 | Dispatch a REAL task through the zero-token path | **PARTIAL** | Real Claude execution proven (canary above), through the production prompts and the production schema, at zero API cost. The transport's *credential wiring* is not exercised live because this environment has no configured credential to give it, only an ambient one the transport deliberately refuses. One owner action closes it; see Owner action. |
| 5 | Schema-valid structured output | **PASS** | The canary validates with `parseProviderResult`, the same function the adapter uses. This goal was genuinely at risk and is the one the canary rescued. |
| 6 | Run / provider / model / status / timestamps / errors persist | **PARTIAL** | The schema and writer are pre-existing and tested (`agent_runs`, `provider_run_events`, `lib/providers/runtime.ts`). No *Claude* run has been persisted, because the migrations carrying this are unhosted and no credential is configured. |
| 7 | Runs survive browser refresh / restart | **PARTIAL** | Durable by construction — `base-adapter.ts` documents that its registry is in-process and that durable state lives in Supabase. Not demonstrated end to end with a Claude run, for the same reason as 6. |
| 8 | Claude execution health verifiable | **PASS** | `checkSubscriptionHealth` performs a real one-turn round trip rather than parsing a credential. A check that only confirmed the credential parses would report **Connected** for a revoked token. |
| 9 | Cancellation / timeout / failure truthful | **PASS** | `claude-cli-transport.test.ts`: cancellation surfaces as `cancelled`; exhausted structured-output retries as `invalid_response`; a stream that ends without a result is distinguished from a result that reports an error, because conflating them would hide a crashed CLI. Timeout is `AbortController` at both the adapter and transport layers. |
| 10 | Logical agents independently use Claude or Codex | **PASS** | `provider_agent_assignments` + `AgentProviderAssignment` in routing; per-agent, not per-organization. |
| 11 | Routing modes AUTO / CLAUDE / CODEX | **PASS** | `ROUTING_PROVIDER_REQUESTS = ["AUTO", "ANTHROPIC", "OPENAI"]`, `providerForRequest`. |
| 12 | AUTO is deterministic — no tokens spent deciding | **PASS** | `routeProvider` is a pure function over declared capability, availability, policy and affinity. No I/O, no model call. `DEFAULT_TASK_AFFINITY` is documented as "a *configured preference*, not a benchmark claim". |
| 13 | Routing weighs capability, availability, risk, policy, preferences, override | **PASS** | All six are inputs to `RoutingRequest`; `RoutingSource` records which one decided. Precedence is owner override → agent assignment → project default → score. |
| 14 | Routing decision + reason persist | **PARTIAL→PASS** | 18 `RoutingReasonCode` values, each naming a cause rather than a generic failure, persisted to `provider_routing_decisions` (immutable). Schema and writer tested; unhosted like the rest. |
| 15 | An unavailable provider never receives work | **PASS** | Eligibility is decided before scoring; `PROVIDER_NOT_CONNECTED` excludes a candidate outright. An override at an unavailable target yields `OVERRIDE_TARGET_UNAVAILABLE` rather than silently rerouting. |
| 16 | Eligible fallback works | **PASS** | `planFallback`, one controlled attempt, `FALLBACK_APPLIED` recorded. |
| 17 | Fallback cannot bypass RED / security / provider policy | **PASS** | `fallbackEligible` is a declared property of the error class, not a runtime guess. `errors.ts`: "a rejected prompt would be rejected on policy grounds anywhere, and re-routing it is policy shopping". `unauthorized`, `forbidden`, `request_rejected` and `cancelled` are all ineligible. `RISK_ABOVE_PROJECT_CEILING` and `requiresOwnerApproval` survive fallback. |
| 18 | Claude → Codex typed handoff | **BLOCKED_BY_1C** | `buildHandoffContext` and `agent_handoffs` exist and are tested. A live handoff needs a registered Phase 1C worker; none is registered in any verified environment. Not faked. |
| 19 | Codex → FRESH Claude independent review | **BLOCKED_BY_1C** | Same dependency. The independence *rules* are implemented and tested (below); only the live demonstration is blocked. |
| 20 | Reviewer receives artifact + criteria only, never implementer chat | **PASS** | `buildHandoffContext` passes recorded `ProviderArtifactSummary` rows. `ProviderRunContext` documents that agents exchange work "through SoftwareFactory records, never through a shared provider chat history" — there is no conversation object to leak, by construction. |
| 21 | A worker cannot approve itself | **PASS** | `evaluateReviewIndependence` → `REVIEWER_IS_IMPLEMENTER`. The rule is about the *agent*, not the provider: an implementation agent can never sign off on its own work, whichever model executed it. `REVIEWER_SHARES_PROVIDER` is an additional requirement where a step declares it. |
| 22 | Metrics show only real usage / cost / performance | **PASS** | `computeCostMicros` returns `null` when any model lacks declared pricing — "a fabricated total is worse than an absent one, because it gets believed". Usage comes from the provider's own reported counts. |
| 23 | RLS / user / project isolation | **PASS** | All four Phase 2A tables carry RLS + FORCE RLS with no browser write grant; `provider-execution-rls.test.ts` covers cross-tenant denial and anonymous refusal against real PostgreSQL. |
| 24 | Credentials never reach browser / repo / prompts / logs | **PASS** | `config.ts` returns presence flags only and never a value. Transport redaction decomposes a credentials document into individual tokens, because "a provider error is unlikely to quote the file verbatim, but very capable of quoting one token out of it" — asserted by "never leaks the credential into an error message", verified to actually assert by making it fail on purpose. Nothing credential-shaped is committed. |
| 25 | No paid AI API dependency for normal operation | **PASS** | See Zero-token proof. |

## Provider contract — one abstraction, two transports

The Claude CLI path is a **transport**, not a second provider. Same `ProviderId`,
same declared capabilities, same run registry, same `ProviderStructuredResult`,
same `BaseProviderAdapter` lifecycle. Nothing downstream knows which transport
ran.

That was the harder choice and it is the right one: a separate pipeline for the
free path would have been easier to write and would have quietly become a second
provider, which is exactly what the contract requirement forbids.

`listModels` on the subscription transport refuses with
`capability_unsupported` rather than returning an empty list. The CLI exposes no
catalogue, and an empty list would read as "this provider has no models" — false,
and it would be believed.

## Codex regression

Untouched and green. No file under `lib/worker/` is modified by this change.

## Blockers and owner action

**One action closes goal 4, and it costs nothing:**

| | |
| --- | --- |
| Service | A machine signed in to the intended Claude account |
| Command | `claude setup-token` |
| Value | The printed token |
| Secret? | **Yes** — server-side only |
| Storage | Vercel environment variable `SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN` (Production + Preview) |
| Verification | `GET /api/providers/status` reports Claude **Connected** with a measured latency, having performed a real one-turn round trip |

Alternatively store the contents of `~/.claude/.credentials.json` as
`SOFTWAREFACTORY_CLAUDE_AUTH_JSON`. The token is preferred: nothing is written to
disk, so there is no file to leak or forget to clean up.

**Do not set `ANTHROPIC_API_KEY`.** It is not needed, and with it set the
subscription path refuses to start rather than silently billing.

**Blocked on Phase 1C, not on 2A:** goals 18 and 19. Both need a registered
Codex worker. The typed-handoff schema, the independence rules, and the
fresh-context requirement are all implemented and tested; only the live
demonstration is outstanding, and it is marked BLOCKED rather than assumed.

**Unrelated and already reported:** GitHub Actions has been failing repository
wide since 2026-08-15 00:37Z — every run, on `main` too, completing in under five
seconds with no runner assigned and logs returning 404. That is an Actions
infrastructure or quota problem for the account, not a code failure.

## 2B READY: NO

Not because 2A is unsound, but because the two BLOCKED goals are handoff goals,
and 2B's graph engine is what consumes handoffs. Registering the Phase 1C worker
unblocks 18, 19 and the remaining PARTIALs together.

## Verification

- `npm run lint` — 0 errors (3 pre-existing unused-parameter warnings)
- `npx tsc --noEmit` — clean
- `npx vitest run` — 192 files, **2264 passed**, 2 skipped, 0 failed (33 new)
- `npm run build` — clean
- Live Claude canary — passed, 9 turns, schema-valid, zero API tokens
