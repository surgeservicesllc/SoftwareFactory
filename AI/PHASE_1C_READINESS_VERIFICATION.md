# Phase 1C — what is verified ready, and what cannot be

Verified 2026-08-14 against the real toolchain in this environment, not against
memory or documentation.

Phase 1C has **never completed a live run**, so nothing here claims it works end
to end. What this records is narrower and still useful: the parts of the first
live run that can be checked *before* a credential exists have been checked, so
the first funded attempt does not fail on something that was knowable in
advance.

## Verified by execution

| Check | Method | Result |
| --- | --- | --- |
| Codex SDK pinned and installed | `package.json` + `node_modules/@openai/` | `@openai/codex-sdk` at `0.147.0`, with the `codex` and `codex-linux-x64` binaries present |
| Codex CLI starts | `npx --no-install codex --version` | exit 0 |
| Codex CLI version matches the preflight's exact expectation | compared against `EXPECTED_CODEX_VERSION` in `lib/worker/preflight.ts` | prints `codex-cli 0.147.0`, matches exactly |
| `codex exec` subcommand exists | `npx --no-install codex exec --help` | exit 0 |
| Required-check names parse correctly | `lib/worker/env.ts` splits on `\|` | The first check name contains commas (`Lint, typecheck, test, and build`); pipe-splitting preserves them |
| Required-check names match reality | compared against CI job names observed on real runs | Exact match for both `Lint, typecheck, test, and build` and `Browser and accessibility tests` |
| Phase 1C suites pass | `phase1c-worker-workflow.contract`, `phase1c-migration.contract`, `worker-foundation` | 58 tests pass |

The version check is the one worth calling out. `verifyWorkerProviderAccess`
compares the CLI version by **exact string equality** and fails closed on any
difference, before it ever contacts OpenAI. Had the pinned CLI printed anything
else — a build suffix, a bare number — the first funded run would have died at
`codex_cli_version_mismatch` with a credential already spent on nothing. It
matches.

## What cannot be verified without the owner

These are not oversights; each needs something an agent cannot create.

- **A funded `OPENAI_API_KEY`.** The previous key was exposed and removed from
  Actions secrets. Any key pasted into a transcript is compromised on arrival
  and must be rotated rather than installed. Until one exists,
  `npm run worker:preflight` fails at `missing_api_key`, which is correct.
- **The live owner-command-to-draft-PR journey.** No `factory/*` branch, commit,
  or draft PR has ever been produced by the worker. This is the single piece of
  evidence Phase 1C's own completion rule says nothing else can substitute for.
- **Hosted migrations.** Twelve remain unapplied; see
  `AI/HOSTED_APPLY_RUNBOOK.md`, which now leads with the measured ledger
  position. Writing to hosted Supabase is refused by the Claude Code auto-mode
  classifier — the correct guard for a RED action against production.
- **A registered worker with a live heartbeat.** The workflow is gated behind
  `vars.SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED == 'true'`, which is an owner
  setting.

## The order that wastes the least

1. Rotate and fund an OpenAI key; set `SOFTWAREFACTORY_OPENAI_API_KEY`.
2. Dispatch `softwarefactory_phase1c_preflight`. This runs the bounded
   non-storing probe and **claims no run**, so a credit or access problem
   surfaces without consuming a durable attempt.
3. Only if that passes, apply the hosted migrations per the runbook.
4. Set `SOFTWAREFACTORY_PHASE1C_WORKER_ENABLED` and submit one GREEN command.

Steps 1 and 2 are deliberately before 3: a preflight failure is cheap and
reversible, while a hosted migration is neither.
