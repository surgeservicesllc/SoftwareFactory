# Owner actions — the one list that unparks the backlog

Written at the 2026-08-31 close-out (task: "complete the backlog, close out
everything and make it 100% production ready"). Every backlog row a session
can complete alone is complete; every row still open waits on one of the
actions below. Each entry says exactly what to do and which capability it
lights up. The backlog rows themselves remain the authoritative record —
this is the reading order.

## 1. Five-minute wins (a key or a click, no decision needed)

1. **Confirm your own login.** Supabase Dashboard → Authentication → Users
   → `Daniel.Hughen@gmail.com` → Confirm email. No confirmation email can
   arrive while the project has no custom SMTP, and the super-administrator
   role requires a confirmed address. Unlocks: `/solutions/admin` and the
   signed-in navigation verification row.
2. **`JSEARCH_RAPIDAPI_KEY`** (Vercel env, Production + Preview): create a
   free RapidAPI account, subscribe to JSearch's free tier, copy the app
   key, set, redeploy. Unlocks: inline LinkedIn/Indeed results in JobSearch.
3. **`SUPER_ADMIN_EMAILS`** (Vercel env): only if the role should not use
   the repository default list.

## 2. Email, and everything queued behind it

4. **`RESEND_API_KEY` + `JOB_ALERT_EMAIL_FROM` + `CRON_SECRET`** (Vercel
   env): a Resend account and a verified sender. Unlocks: job-alert email
   delivery, the CRM's transactional notices send path (ADR-217 — composing
   already works; this is the send), dunning reminders, portal invitations,
   and "send a filed document to a customer". This one key unparks more
   rows than any other single action.

## 3. The CRM's provider registry (one row each, ADR-207)

Each is an account you open, whose credential is filed through
`/Services/integrations` (the vault seals it server-side; nothing is pasted
into code). Until then each capability ships labelled **Not Connected**:

5. **SMS** (e.g. Twilio) — notice delivery by text.
6. **Card/ACH processing** — charging a customer's card, and with it the
   ADR-218 autopay execution (the mandate machinery is built and gated).
7. **Mapping/geocoding** — the route optimiser's remaining half
   (coordinates for `crm_properties`; the dispatcher's sequencer already
   works without it).
8. **Accounting sync** (Intuit) — the live QuickBooks API sync (the
   journal EXPORT already works without it).
9. **GPS telemetry**, **telephony**, **reviews** — their dashboard rows.
10. **An AI provider** — free-form drafting in the Services copilot
    (computed answers already work without it).

## 4. Decisions (choose; nothing to build)

11. **Branch protection on `main`**: enable required checks and verified
    signatures, or record that it stays open. Currently unprotected.
12. **`theagoras.com` aliases + Vercel Deployment Protection**: the
    `*.vercel.app` hosts are behind SSO, so `www.theagoras.com` is the only
    public path; removing aliases takes the site offline, and while
    Protection is on no external monitor can watch the deployment URLs.
13. **Marketing-site indexing** before pointing the domain.
14. **Usage-observation retention** (append-only rows accumulate
    ~300/account/day).
15. **Phase 2A per-token adapters** vs the zero-token-cost rule (defaulted
    OFF; decide exempt-as-advisory, remove, or re-base).
16. **The learning edge** (derived planning constraints): its own backlog
    section requires an ADR and explicit owner direction before code,
    because a wrong derived constraint narrows every later plan silently.

## 5. Separately-authorized releases (RED / protected; each needs an
##    explicit owner authorization naming action, target, evidence, rollback)

17. **Grok completion chain**: apply migrations 009/010 through
    `grok-bot-completion-migrations.yml` in its documented order (fresh
    probe → claim-admission-fence → specialist-admission-planning → verify).
18. **The legacy 00150/00200/00300 chain** and the **17-version ledger
    reconciliation** (start at `20260815000200`) — per
    `AI/HOSTED_APPLY_RUNBOOK.md`, never inferred from a prefix.
19. **Unattended recurring billing** (a timer that raises real invoices —
    RED by classification; the generator is built and idempotent).
20. **Auto-merge / deploy execution / rollback execution / any automatic
    action** — each forbidden this phase by AGENTS.md and the policies
    directory until separately authorized.
21. **`SOFTWAREFACTORY_CODEX_AUTH_JSON`** (repository secret from
    `codex login`) — the one remaining blocker on Phase 1C's live
    requirements. Do not fund an OpenAI API account.
22. **`VERCEL_TOKEN`** — deploy status observation for Phase 1E monitoring.

## 6. Live-production observation (evidence only production can mint)

23. A real worker heartbeat; a live provider-backed run through an admitted
    claim; signed-in production acceptance journeys; a monitor target's
    first real observation; GitHub Support ticket `#4660724` (App webhook
    defect) until resolved.

Everything else in `AI/BACKLOG.md` is either done or records design intent
beside the gate above that owns it.
