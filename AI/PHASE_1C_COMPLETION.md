# Phase 1C completion — zero AI API token cost

Status vocabulary: **PASS** (proven by evidence), **PARTIAL** (built, not proven
live), **FAIL** (built and wrong), **BLOCKED** (stopped on a named prerequisite).

## The cost rule, and what it actually forbids

SoftwareFactory must run without funded OpenAI or Anthropic API accounts and
without per-token charges. That is now enforced in code by
`lib/worker/cost-policy.ts` rather than left to configuration.

One distinction has to stay sharp, because collapsing it would make this
document dishonest:

- **A metered API call** bills per token against an API account. This is what
  the policy forbids, and what SoftwareFactory must never require.
- **A subscription-authenticated Codex session** is a flat product entitlement.
  It is not free — someone pays for the subscription — but SoftwareFactory is
  not the thing buying tokens, and its cost does not scale with the work done.

The claim made here is the second one only: **SoftwareFactory itself purchases
no AI tokens.** No claim is made that the Codex subscription is free.

## Requirement-by-requirement

| # | Requirement | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Bot Manager command persists | **PASS** | `submit_command` is hosted and exercised; Phase 1E promotion writes through it |
| 2 | Deterministic orchestrator resolves project/repo/base SHA | **PASS** | `buildHandoffPackage` refuses anything but a full 40-character SHA resolved from the live repository |
| 3 | Task, acceptance criteria and risk without a paid LLM | **PASS** | `classifyCommand` and `acceptanceCriteriaFor` are pure rules; 26 tests, including stability of repeated classification |
| 4 | Task handed to Codex without purchasing tokens | **PARTIAL** | The package and its rendering exist and are tested. The unattended trigger is the open boundary — see below |
| 5 | Run state persists | **PASS** | Phase 1C run tables and state machine are hosted |
| 6 | Repository instructions supplied | **PASS** | `contextFiles` defaults to `AGENTS.md`, `AI/PROJECT_CONTEXT.md`, `AI/ARCHITECTURE.md` |
| 7 | Work occurs in isolation | **PASS** | `GitWorkspaceManager` prepares an isolated checkout per run; `lib/graph/fan-out.ts` proves the allocation rules |
| 8 | Real code modification | **BLOCKED** | Needs a live execution, which needs the boundary in #4 |
| 9 | Tests/lint/typecheck/build run | **PASS** | `DeterministicValidator` runs them in a pinned container; the same four commands are the package's `validationCommands` |
| 10 | Failures captured and repairable | **PASS** | Phase 1E promotion path, bounded retries |
| 11 | Diff/secret/protected-resource checks | **PASS** | `lib/worker/policy-scan.ts` |
| 12 | `factory/<run-id>-<slug>` branch | **PASS** (naming) / **BLOCKED** (live) | `branchNameFor` matches the worker's enforced contract, tested |
| 13 | Real commit pushed | **BLOCKED** | Follows #8 |
| 14 | Real draft PR | **BLOCKED** | Follows #8 |
| 15 | Real GitHub CI observed | **PASS** (mechanism) | Required check names verified to match the job names real runs produce |
| 16 | Events and results recorded | **PASS** | Worker store writes run events and structured results |
| 17 | Cancellation/failure/retry | **PASS** | `WorkerCancellationError`, deadline handling, bounded retries |
| 18 | RED protected actions stop | **PASS** | `buildHandoffPackage` refuses to package RED at all |
| 19 | RLS/project isolation | **PASS** | Every exposed table carries RLS and FORCE RLS; 100 tables asserted |
| 20 | AI API token cost $0 | **PASS** | Policy refuses metered mechanisms by default; violation is an error, not a downgrade |

## The one real boundary

**Requirement 4 is where the honest limitation sits.**

The wired execution path uses `@openai/codex-sdk`, which authenticates with an
API key and bills per token. Under the cost rule that path is refused: with
`PAID_AI_API_CALLS_ALLOWED` unset, `assessExecution("METERED_API")` returns
`allowed: false` and `assertExecutionAllowed` throws.

What replaces it is a **handoff**: SoftwareFactory assembles a complete work
package — repository, base SHA, request, acceptance criteria, allowed and
forbidden actions, validation commands, required context files, expected result
shape — and renders it as text an executor can act on without a parser.

What is **not** proven is unattended invocation of a subscription-authenticated
Codex session from GitHub Actions. I did not find a supported mechanism for
that, and I am not going to assert one exists to close a row in this table. The
options, stated plainly:

1. **Owner-triggered execution.** A person opens a Codex session, pastes the
   rendered package, and the work proceeds under the subscription. Zero tokens
   purchased by SoftwareFactory. This works today.
2. **A self-hosted runner already signed in to Codex.** Unattended, still no
   metered API. Not configured, and not something an agent can set up.
3. **Metered API.** Correct behaviour, forbidden by the cost rule.

Option 1 is real completion of the pipeline with a human trigger at one step.
Calling that "fully unattended" would be false, so this document does not.

## What a live canary needs

A GREEN canary — "create a Phase 1C canary documentation file and open a draft
pull request" — classifies GREEN, packages cleanly, and produces the branch name
`factory/<run-id>-create-a-phase-1c-canary-documentatio`. Everything up to
execution is testable now. The canary cannot complete until the boundary above
is chosen, and the anchors it must produce — branch, commit, draft PR, CI — are
exactly the ones that cannot be simulated.

## Owner action

1. Decide the execution boundary: owner-triggered handoff (works now) or a
   self-hosted Codex-authenticated runner (unattended, needs setup).
2. Apply the twelve unhosted migrations — see `AI/HOSTED_APPLY_RUNBOOK.md`,
   which now leads with the measured ledger position.
3. Leave `PAID_AI_API_CALLS_ALLOWED` unset. Setting it to `true` is the only way
   to switch metered billing on, and nothing in the codebase does that for you.

## 1D readiness

Not started, and deliberately not begun.
