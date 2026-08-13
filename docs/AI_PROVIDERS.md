# AI providers

How SoftwareFactory routes work to Claude or OpenAI, what a provider run may
and may not do, and what an owner has to configure.

## The separation that matters

```text
Organization -> Project -> Task -> Logical agent -> Routing decision
                                              |
                                              v
                              Provider -> Model -> Connection -> Provider account
                                              |
                                              v
                                       Agent run (auditable)
```

A **logical agent** is a role: Product Manager, Architect, Backend Engineer,
Security Reviewer. A **provider** is Anthropic or OpenAI. A **model** is an
identifier that provider serves. None of these is a provider account, and no
account label ever names a project or an agent.

## What a Phase 2A run does

A run sends a bounded, structured task description to a provider and stores a
schema-validated artifact: a summary, findings with severities,
recommendations, a confidence level, and an explicit blocked flag.

A run has **no** repository, merge, deployment, or approval authority. Applying
a recommendation is a separate owner action through the existing branch,
commit, and draft-pull-request flow.

## Configuration

All values are server-only. Absence is never an error: a provider with no
credential reports **Not Configured**.

| Variable | Provider | Notes |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | Anthropic | Server-side API key. No consumer login or browser session is used. |
| `ANTHROPIC_DEFAULT_MODEL` | Anthropic | Optional. Defaults to `claude-opus-5`. |
| `ANTHROPIC_BASE_URL` | Anthropic | Optional. HTTPS only outside local development. |
| `ANTHROPIC_PROVIDER_DISABLED` | Anthropic | Set to `true` to switch the provider off. |
| `OPENAI_API_KEY` | OpenAI | Server-side API key. |
| `OPENAI_DEFAULT_MODEL` | OpenAI | **Required.** There is no built-in default. |
| `OPENAI_BASE_URL` | OpenAI | Optional. HTTPS only outside local development. |
| `OPENAI_PROVIDER_DISABLED` | OpenAI | Set to `true` to switch the provider off. |
| `AI_PROVIDER_TIMEOUT_MS` | Both | 5000-600000, default 120000. |

**Why OpenAI has no default model.** This repository has no verified OpenAI
model catalogue, and a guessed identifier would produce confident 404s at run
time. The owner picks a real one: Settings runs live discovery against the
account and records the chosen entry. Anthropic ships a default because
`claude-opus-5` is a current, documented identifier.

Two further owner steps are required before anything runs:

1. Apply `20260813000100_provider_execution_layer.sql` only after `20260812002800_phase1e_production_operations.sql`, as the second file in the reviewed `028` -> `130001` through `130008` pending chain.
2. Enable outbound execution in Settings. It defaults OFF, and enabling it
   requires typing `ENABLE PROVIDER EXECUTION`. A configured credential is not
   by itself consent to spend money.

## Routing

Precedence, strongest first:

1. **Owner request** - the caller explicitly named `ANTHROPIC` or `OPENAI`.
2. **Agent assignment** - the agent is bound to a provider and model.
3. **Project default** - the project's preferred provider.
4. **Automatic score** - reliability, latency, declared cost, and configured
   task affinity.

Two rules sit above all of that and cannot be overridden:

- A provider that does not declare a required capability is never selected.
- A provider that is not `connected` is never selected.

If an explicit request names an unavailable provider, the decision is
`NO_PROVIDER_AVAILABLE` with reason `OVERRIDE_TARGET_UNAVAILABLE`. It is not
quietly re-routed. Every decision records structured reasons and every
candidate's score, and Runs shows them under "Why this provider?".

Task affinity is a **configured preference**, not a benchmark claim: planning
and review lean Anthropic, implementation proposals lean OpenAI. It only
breaks ties between providers that are already eligible, and an explicit
assignment or project default outranks it entirely.

## Fallback

A second attempt happens only when **all** of these hold:

- the project policy allows fallback;
- the primary failure class is declared fallback eligible;
- a different provider independently satisfies every capability, policy, and
  availability rule.

| Failure | Fallback eligible |
| --- | --- |
| `rate_limited`, `timeout`, `upstream_unavailable`, `invalid_response` | Yes |
| `not_configured`, `disabled`, `model_not_found`, `capability_unsupported` | Yes |
| `unauthorized`, `forbidden` | **No** - a broken credential must reach the owner |
| `request_rejected` | **No** - re-routing a refused request is policy shopping |
| `cancelled` | **No** - the cancellation was intentional |

There is at most one fallback attempt. The origin provider and the reason are
recorded on the run and shown in the UI. Fallback never widens the allowed
provider set, never changes the risk tier, and never substitutes for an
independent reviewer.

## Multi-agent workflow

The default delivery chain is plan, implementation proposal, independent
review, QA assessment. Steps exchange typed artifacts through SoftwareFactory
records; they do not share a provider chat history, and each step receives only
the artifacts its dependencies produced.

The independent-review rule is enforced in code: the agent that produced an
implementation can never satisfy its review, whichever provider executed
either one. The security-review step additionally requires a different
provider, so author and reviewer do not share one model's blind spots.

## Security

- Credentials live only in server-side environment settings. No function
  returns, logs, or serializes a credential value; the UI shows variable names.
- Provider output is untrusted. It is schema validated before it is recorded,
  and a response that does not validate is an `invalid_response` failure rather
  than a partially trusted record.
- Run instructions are secret-scanned before they leave the server.
- Run traces store redacted summaries, never prompts, responses, or
  credentials, and the database rejects an event message containing a likely
  secret.
- All three provider tables carry RLS and FORCE RLS with member-select
  policies. Authenticated roles have no direct write grant; writes go through
  owner/admin SECURITY DEFINER functions that revalidate the tenant binding.

## Current status

The provider layer is published on `main` at
`b1060b83a0698a83e202aafdf9792886cf60a8b3`, but both providers remain **Not
Connected**: no credential or successful provider health/run is verified,
organization execution defaults OFF, and `20260813000100_provider_execution_layer.sql`
is not hosted. See `AI/CURRENT_STATE.md` for the authoritative status.
