# Authentication runbook

How account creation and sign-in work, what is verified, and the two settings
only the project owner can change.

## Current state

Account creation is **blocked in production by a Supabase project setting**, not
by application code. Verified against the live project on 2026-08-14:

```
GET https://qpuofpmagrmyamahqwxw.supabase.co/auth/v1/settings
  disable_signup      false     signups are allowed
  mailer_autoconfirm  false     every signup requires a confirmation email
```

```
POST /auth/v1/signup
  {"code":429,"error_code":"over_email_send_rate_limit","msg":"email rate limit exceeded"}
```

Every signup needs a confirmation email, the project uses Supabase's built-in
email service, and that service's quota is tiny.

The quota does recover. A probe against the raw API during an open window
succeeded and returned `confirmation_sent_at`, so the code path itself is
sound. The very next request — seconds later, through the application — came
back `429 email_send_rate_limited`. **One signup consumes the window.** That is
the shape of the failure: not permanently broken, but unusable, and whoever
tries second gets an error through no fault of their own.

This is why step 1 below is required rather than advisory. Until it is done,
account creation works about once an hour for the whole project.

### Test accounts created while diagnosing

Two unconfirmed users were created against `sf-probe-*@gmail.com` and
`sf-e2e-*@gmail.com` addresses while proving the path works. They are inert --
unconfirmed accounts cannot sign in -- but they can be removed from
Authentication → Users. Deleting them needs the dashboard; the repository holds
no service-role key.

## The defect that actually broke sign-up

Found by walking the chain against a real Supabase, and not visible from
production because catching it needs a mailbox.

Supabase matches `emailRedirectTo` against the redirect allowlist and, on a
miss, **silently falls back to Site URL**. The allowlist entry is a bare
`/auth/callback`; every auth route appended `?next=/auth/onboarding`; so every
match missed and the emailed link resolved to

```
https://www.theagoras.com/?code=<uuid>
```

the marketing home page, carrying a code it ignores. Clicking "confirm my
email" confirmed the address and left the visitor signed out on the home page.

Fixed by keeping query strings off the callback URL. Sign-up and resend never
needed one; magic link carries its destination in a short-lived host-only
cookie instead. `tests/e2e/auth-lifecycle.spec.ts` walks the whole chain
against a local stack -- with the old code it reproduces the URL above, with
the fix it passes. **This needed no dashboard change.**

## Owner action required

Both are Supabase dashboard changes. Neither can be made from the application:
the repository holds no service-role key, management token, or CLI session.

### 1. Make confirmation emails deliverable (required)

Pick one:

- **Configure custom SMTP** — Authentication → Emails → SMTP Settings. The
  built-in sender is rate limited to a handful of messages per hour and is
  documented as unsuitable for production. This keeps email confirmation on.
- **Turn off email confirmation** — Authentication → Sign In / Providers →
  Email → disable "Confirm email". Signups then return a session immediately
  and `confirmationRequired` is false. Faster, but anyone can register an
  address they do not control.

Custom SMTP is the production answer; disabling confirmation is the quick
unblock.

### 2. Point the redirect allowlist at the production domain (required)

Authentication → URL Configuration:

- **Site URL**: `https://www.theagoras.com`
- **Redirect URLs** must include:
  - `https://www.theagoras.com/auth/callback`
  - `https://theagoras.com/auth/callback`

Supabase builds confirmation links from Site URL and **silently falls back to
it** when an `emailRedirectTo` is not on the allowlist. If only the Vercel
preview host is listed, a visitor who confirms from a theagoras.com signup
lands on a different origin, where the session cookie cannot apply to
theagoras.com.

`supabase/config.toml` in this repository already carries the correct values
and is asserted by `tests/integration/supabase-auth-routes.contract.test.ts`,
but that file configures the local CLI. The hosted project is separate and must
be changed in the dashboard.

### Verifying afterwards

```bash
curl -s https://qpuofpmagrmyamahqwxw.supabase.co/auth/v1/settings \
  -H "apikey: <publishable key>" | grep mailer_autoconfirm

curl -s -X POST https://www.theagoras.com/api/auth/sign-up \
  -H "Content-Type: application/json" -H "Origin: https://www.theagoras.com" \
  -d '{"email":"you+test@yourdomain.com","password":"a-real-strong-password-12"}'
```

A `202` with `confirmationRequired: true` means the email was accepted for
delivery. A `201` means confirmation is off and the account is usable
immediately. A `429` with `email_send_rate_limited` means step 1 is not done.

## Verified live

Confirmed against production, not inferred:

| Behaviour | Evidence |
| --- | --- |
| Sign-in reaches Supabase and rejects a bad password | `POST /api/auth/sign-in` with a wrong password on a real confirmed account returns `401 invalid_credentials` |
| An unconfirmed account gets a recovery path | The same endpoint on a genuinely unconfirmed account returns `403 email_not_confirmed` with `needsConfirmation: true`. Before this work it returned "The email address or password was not accepted" -- a false statement that left the account permanently unreachable |
| Resend is reachable and enumeration-safe | `POST /api/auth/resend-confirmation` returns `202` with the same body for an address with no account |
| The sign-up code path works | A raw-API probe during an open email window created a user and returned `confirmation_sent_at` |
| Sign-up is rate limited, not broken | The next request seconds later returned `429 over_email_send_rate_limit`; the app surfaces it as `email_send_rate_limited` with an actionable message |
| Every account-creation entry point leads to sign-up | Six marketing pages serve `/auth/sign-up` and zero legacy `/sign-in` links |

The one thing not verifiable from here is the emailed confirmation link itself,
which needs a mailbox. Everything either side of it is proven.

## The flow, end to end

1. `/auth/sign-up` posts to `/api/auth/sign-up`, which calls `signUp` with
   `emailRedirectTo` pointing at `/auth/callback?next=/auth/onboarding`.
2. With confirmation on, the response is `202 confirmationRequired`. The form
   says so and offers **Resend the confirmation email**.
3. The emailed link hits `/auth/callback`, which exchanges the code, verifies
   the user with `getUser()`, and redirects to `/auth/onboarding`.
4. Onboarding calls the audited `onboard_authenticated_organization` RPC,
   which makes the caller the owner, sets the active organization, and lands
   on `/solutions/projects`.
5. Later sign-ins go to `/api/auth/sign-in` and land on `/solutions`.

## Recovering a stuck account

An account whose confirmation email never arrived is otherwise unreachable:
sign-up will not remake it, and sign-in will not admit it. `POST
/api/auth/resend-confirmation` issues a fresh link, and the sign-in form shows
a resend button whenever the server reports `email_not_confirmed`.

That error does reveal an address is registered. The alternative is telling
someone their correct password was wrong and leaving them with nothing to try,
so the disclosure is deliberate; the resend response is identical whether or
not the account exists.

## What the application guarantees

- Sign-up, sign-in, magic link, and resend are same-origin only and never
  return a provider token or OTP.
- Failures are distinguishable: `email_send_rate_limited`,
  `email_address_invalid`, `weak_password`, `signup_disabled`,
  `email_not_confirmed`, `authentication_unavailable`. Sign-up never confirms
  that an address is already registered.
- Every account-creation call to action routes to `/auth/sign-up`, asserted
  repo-wide by `tests/integration/auth-entry-points.contract.test.ts`. Stale
  `/sign-in` values in hosted content rows are mapped forward on read.
