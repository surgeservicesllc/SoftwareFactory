# AI accounts and the auth broker

Written 2026-08-16, alongside migration `20260816000100_ai_accounts_auth_broker`
(merged to `main` in PR #136, squash commit `859ceed`). This is the reference
for how a provider subscription becomes a working bot without the owner ever
copying a command, opening a terminal, or pasting a token anywhere but the
provider's own page and this app.

## The shape of the system

Three records, one worker, one page:

- **`ai_accounts`** — one row per provider sign-in. Identity and lifecycle
  only: provider, auth method (`subscription` or `api_key`), display name,
  status (`pending / connected / needs_reauth / disconnected / revoked`),
  `last_verified_at`, sanitized `last_error`. It stores **no credential** —
  only `credential_purpose`, the name of the vault slot the credential is
  sealed under. One account per (organization, purpose).
- **`ai_auth_sessions`** — the broker: the state a worker drives while running
  the provider's real login on the owner's behalf.
- **`provider_credentials`** — the vault (pre-existing). The broker's finish
  line writes here: `sealSecret(token, {organizationId, purpose})`, AES-256-GCM
  under `SOFTWAREFACTORY_CREDENTIAL_KEY`, which lives outside the database.
- **The auth-broker worker** — `.github/workflows/auth-broker.yml` running
  `scripts/auth-broker.mts` → `lib/worker/auth-broker.ts`. Claims sessions
  through service-role definer functions and runs the provider CLI headlessly.
- **The page** — `components/ai-account-connect.tsx`, which renders only what
  the session row says, polling `GET /api/ai-accounts/sessions/[id]` every 3s.

## The sign-in lifecycle

```
pending ──claim──▶ initializing ──login URL──▶ awaiting_user
   │                                               │ (person signs in at the
   │                                               │  provider, pastes the
   │                                               ▼  confirmation code HERE)
   │                                          authenticated
   │                                               │ worker reads sealed code,
   │                                               ▼ feeds it to the CLI
   │                                           verifying
   │                                               │ token minted + checked
   │                                               ▼
   └──────── failed / expired / revoked        connected
```

Every transition is a `security definer` function (owner-side callable by
`authenticated`, worker-side by `service_role`) that also writes an
`ai_account.changed` activity event. There is no direct table access for any
role, including `service_role` — the functions are the whole surface.

Key properties:

- The person's confirmation code crosses the database **only sealed**, bound
  to `ai_auth_relay:<sessionId>` — it can never be opened against another
  session, and its colon means it can never be a vault purpose.
- `complete_ai_auth_session` flips the session, seals the credential into the
  vault, and marks the account connected **in one function**, so no crash
  order leaves "connected" without a credential.
- One open session per account (partial unique index); opening another
  revokes the first. Cancel revokes the session and touches nothing else;
  disconnect deletes the vault credential and keeps the account for
  Reconnect.
- Worker liveness is a `heartbeat_at` the UI can read; a stall is shown as a
  stall, with the manual command flow one click away.

## Unbounded accounts (owner requirement, 2026-08-16)

There is **no hard-coded maximum** of accounts or bots. `claude` is slot 1,
`claude_2` slot 2, `claude_47` slot 47 — `lib/ai-accounts/purposes.ts` is the
single definition. Connect fills the lowest free slot;
`SOFTWAREFACTORY_MAX_AI_ACCOUNTS_PER_PROVIDER` (default 100) is the only
ceiling and it is configuration, not code. Each slot seals under its own
purpose and surfaces as its own suffixed variable
(`SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN_47`) through the overlay bridge,
which discovers stored purposes via `list_provider_credential_purposes`
(names only) and falls back to the pre-slot static list against a hosted
database that predates the migration.

## Provider reality

- **Claude** — `claude setup-token` is the only supported way to mint a
  subscription credential, and it is broker-drivable: probed headlessly
  (CLI 2.1.233, fake TTY via `script -qec`, isolated `CLAUDE_CONFIG_DIR`),
  it prints its OAuth authorize URL and waits for a pasted code. The worker
  runs a 500-column pty so the URL is not line-wrapped, strips ANSI, and
  matches `https://…` and later `sk-ant-…`.
- **Codex** — `codex login` completes over a **localhost callback** in the
  same machine's browser, which no headless relay can satisfy. The broker
  refuses Codex sessions with a named reason; the Codex button keeps the
  connect-command flow (the operator's machine runs the login) until a
  relay-capable path exists.

## Worker setup (go-live checklist, owner actions)

1. Apply migration `20260816000100` to hosted Supabase — it is one of the
   outstanding set in `AI/HOSTED_APPLY_RUNBOOK.md` (currently 20, ending at
   this migration).
2. Add **`SOFTWAREFACTORY_CREDENTIAL_KEY`** to the repository's Actions
   secrets (same value the Vercel deployment uses — the worker must open
   relay codes and seal credentials with the same key).
3. Set repository **variable** `SOFTWAREFACTORY_AUTH_BROKER_ENABLED=true`
   (Settings → Secrets and variables → Actions → Variables). The workflow is
   default-OFF by design.
4. Existing secrets the workflow reuses: `SOFTWAREFACTORY_SUPABASE_URL`,
   `SOFTWAREFACTORY_SUPABASE_SERVICE_ROLE_KEY`.

The worker wakes on `repository_dispatch` (`softwarefactory_auth_broker`,
sent best-effort when someone clicks Connect), on a 5-minute cron (throttled
by GitHub on quiet repositories), and manually via `workflow_dispatch`.

## Troubleshooting

| Symptom | Meaning | Fix |
| --- | --- | --- |
| "Waiting for a factory worker" never advances | Workflow disabled, or no runner picked it up | Check the go-live variable; run the workflow manually from the Actions tab |
| Session fails with "Only Claude accounts can be signed in by the worker" | A Codex session reached the broker | Expected — use the Codex button's command flow |
| Sign-in fails citing a withheld provider message | The provider's error contained a token shape; the database refused to store it | Start again; check the Actions run log (tokens are never printed there either) |
| Account shows "Needs sign-in again" | The verification path demoted it (`mark_ai_account_needs_reauth`) | Click Reconnect — the same broker flow against that account |
| Credential stored but bot not Ready | Overlay bridge cannot see the purpose | Hosted DB may predate `list_provider_credential_purposes`; base slots still work via the fallback; apply the migration |
| "The sign-in ran out of time" | 15-minute session TTL passed (30-minute schema ceiling) | Start again; the expired session is inert |

## What is deliberately not claimed

The broker is **Not Connected** live until the three owner actions above are
done. Nothing in the console pretends otherwise: the connect flow reports
worker staleness honestly, and `AI/QUALITY_SCORECARD.md` records the
boundary. Per-bot queue/runtime/log tracking beyond assignments remains
project-scoped (`agent_runs`); binding `bots.ai_account_id` into worker
execution is recorded follow-up work in `todo.md`.
