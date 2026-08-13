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

The database prerequisite is complete: `130001` was catalog-proven and ledger-reconciled without replay, and the forward chain through `130014` is hosted. Do not rerun that historical DDL. Local `130015` restores the original 128-character assignment/run model bound, adds four no-secret constraints covering catalogue model/display-name, assignment model, and routing policy-version/selected-model text, adds bounded run-detail routing evidence, and revokes authenticated raw routing-decision/event reads while retaining tenant-scoped model-catalogue reads; it remains unhosted pending fresh exact RED approval and is not provider connectivity.

Two owner actions remain before outbound advisory execution:

1. Configure a supported server-side credential without exposing it. The prior OpenAI key is compromised, its worker secret is absent, and no successful provider execution credential is verified.
2. Enable outbound execution in Settings. It defaults OFF, and enabling it requires typing `ENABLE PROVIDER EXECUTION`. A configured credential is not by itself consent to spend money.

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
- At hosted `130014`, `provider_model_configurations`, `provider_routing_decisions`, and `provider_run_events` carry RLS and FORCE RLS with tenant-member direct SELECT grants and no authenticated direct write grants. `provider_agent_assignments` has no authenticated direct SELECT; its browser surface uses a bounded caller-member function. Local/unhosted `130015` adds four database no-secret checks covering catalogue model/display-name, assignment model, and routing policy-version/selected-model text, removes direct authenticated SELECT from routing decisions/events, and deliberately retains model-configuration SELECT for Settings; bounded run detail becomes the browser routing-evidence path. The rolling application fails closed on credential-shaped pre-`130015` catalogue scalars and rejects credential-shaped default-model/model/display-name values before serialization or RPC. Mutations go through owner/admin SECURITY DEFINER functions that revalidate the tenant binding.

## Current status

The provider layer is published and its `130001` schema is hosted in the reconciled production chain through `130014`. Both providers remain **Not Connected**: organization execution is OFF and no successful advisory provider health/run is verified. While that switch is OFF, provider status returns a local **Disabled** snapshot and makes no outbound health call; live model discovery also makes no outbound call, and only an owner/admin may request it after the switch is deliberately enabled. The exposed OpenAI key was removed from GitHub Actions and must not be restored; the no-claim worker diagnostic proved exact-model lookup but its bounded Responses call returned `credit_balance_exhausted`, which is failure evidence rather than connectivity. Local `130015` is unapplied: its complete scope widens the assignment/run model checks from 120 to the original 128-character catalogue/API bound while retaining other semantics, adds four no-secret constraints covering catalogue model/display-name, assignment model, and routing policy-version/selected-model text, adds a capped/allowlisted routing-detail projection with absent/null rolling compatibility, revokes authenticated raw routing-decision/event SELECT, and retains model-configuration SELECT. Fresh approval and post-apply validation must cover all six changed/added constraints, valid and credential-shaped scalar cases, both ACL revokes, the retained grant, and the bounded function. See `AI/CURRENT_STATE.md` for the authoritative status.
