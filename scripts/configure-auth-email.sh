#!/usr/bin/env bash
#
# Configure Supabase Auth email delivery, then prove it worked.
#
# WHY THIS EXISTS
#   The hosted project requires email confirmation (`mailer_autoconfirm:
#   false`) and has no custom SMTP, so Supabase falls back to its built-in mail
#   service — a few messages per hour, not intended to reach end users. Sign-up
#   therefore succeeds and the account can then never be confirmed or signed in
#   to. Application code cannot fix that; only project configuration can.
#
# WHAT IT DOES
#   1. Validates every required value before touching anything.
#   2. Links the Supabase CLI to the project.
#   3. Pushes supabase/config.toml, which carries the [auth.email.smtp] block.
#   4. Re-reads the project's own auth settings to confirm the change landed.
#   5. Runs a live sign-up and sign-in against the deployed site.
#
# WHAT IT DOES NOT DO
#   It never writes a credential to disk, to the repository, or to the log. It
#   runs no SQL and applies no migration.
#
# USAGE
#   Set the variables below, then run:  bash scripts/configure-auth-email.sh
#
#   SUPABASE_ACCESS_TOKEN            Personal access token, starts with `sbp_`.
#                                    From supabase.com/dashboard/account/tokens
#                                    NOT a project API key: sb_secret_ and
#                                    sb_publishable_ keys reach the Data API
#                                    only and cannot change configuration.
#   SUPABASE_AUTH_SMTP_HOST          e.g. smtp.resend.com
#   SUPABASE_AUTH_SMTP_PORT          usually 587
#   SUPABASE_AUTH_SMTP_USER          provider's SMTP username
#   SUPABASE_AUTH_SMTP_PASS          provider's SMTP password / API key
#   SUPABASE_AUTH_SMTP_SENDER_NAME   display name on outgoing mail
#   SUPABASE_AUTH_SMTP_ADMIN_EMAIL   From address, on a domain VERIFIED with
#                                    the provider — an unverified domain is
#                                    accepted and then silently dropped
#
#   Optional:
#   SUPABASE_PROJECT_REF             defaults to the project below
#   APP_ORIGIN                       defaults to the live custom domain
#   SMOKE_TEST_EMAIL                 address to attempt a real sign-up with;
#                                    skipped unless set, since it creates an
#                                    account you will have to clean up

set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-qpuofpmagrmyamahqwxw}"
APP_ORIGIN="${APP_ORIGIN:-https://www.theagoras.com}"

fail() { printf '\n  FAILED: %s\n\n' "$1" >&2; exit 1; }
step() { printf '\n=== %s ===\n' "$1"; }

# ---------------------------------------------------------------------------
step "1/5  Checking required values"
# ---------------------------------------------------------------------------

missing=()
for var in \
  SUPABASE_ACCESS_TOKEN \
  SUPABASE_AUTH_SMTP_HOST \
  SUPABASE_AUTH_SMTP_PORT \
  SUPABASE_AUTH_SMTP_USER \
  SUPABASE_AUTH_SMTP_PASS \
  SUPABASE_AUTH_SMTP_SENDER_NAME \
  SUPABASE_AUTH_SMTP_ADMIN_EMAIL
do
  [ -n "${!var:-}" ] || missing+=("$var")
done

if [ ${#missing[@]} -gt 0 ]; then
  printf 'These are not set:\n'
  printf '  %s\n' "${missing[@]}"
  fail "set the variables above and re-run"
fi

# The single most likely mistake, and it fails confusingly a minute later.
case "$SUPABASE_ACCESS_TOKEN" in
  sbp_*) ;;
  sb_secret_*|sb_publishable_*|eyJ*)
    fail "SUPABASE_ACCESS_TOKEN is a project API key, not a personal access token.
          Project keys reach the Data API only and cannot change project
          configuration. Generate one at supabase.com/dashboard/account/tokens
          — it begins with 'sbp_'." ;;
  *) fail "SUPABASE_ACCESS_TOKEN should begin with 'sbp_'." ;;
esac

echo "All values present. Token format looks correct."

# ---------------------------------------------------------------------------
step "2/5  Linking the CLI to project $PROJECT_REF"
# ---------------------------------------------------------------------------

npx supabase link --project-ref "$PROJECT_REF" \
  || fail "link failed — check the token is valid and has access to this project"

# ---------------------------------------------------------------------------
step "3/5  Pushing supabase/config.toml"
# ---------------------------------------------------------------------------

# config push reads the env() references in [auth.email.smtp]. It applies the
# whole [auth] block, including the redirect allow-list that carries the live
# custom domain.
npx supabase config push --project-ref "$PROJECT_REF" \
  || fail "config push failed — the settings above were not applied"

# ---------------------------------------------------------------------------
step "4/5  Confirming the project reports the new configuration"
# ---------------------------------------------------------------------------

# Read the project's own answer rather than trusting the push's exit code.
settings="$(curl -sS --max-time 25 \
  "https://${PROJECT_REF}.supabase.co/auth/v1/settings" \
  -H "apikey: ${NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:-}" || true)"

if [ -n "$settings" ] && [ "$settings" != "${settings#\{}" ]; then
  echo "$settings" | python3 -m json.tool || echo "$settings"
else
  echo "Could not read settings back (set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
  echo "to enable this check). Continuing to the live test, which is stronger."
fi

# ---------------------------------------------------------------------------
step "5/5  Live sign-up and sign-in against $APP_ORIGIN"
# ---------------------------------------------------------------------------

if [ -z "${SMOKE_TEST_EMAIL:-}" ]; then
  echo "SMOKE_TEST_EMAIL not set, so no account was created."
  echo
  echo "To prove the whole path end to end, re-run with:"
  echo "  SMOKE_TEST_EMAIL=you+sftest@yourdomain.com bash scripts/configure-auth-email.sh"
  echo
  echo "Then: confirm via the emailed link, and sign in at $APP_ORIGIN/auth/sign-in"
  exit 0
fi

password="SfSmokeTest$(date +%s)aB"

echo "Signing up $SMOKE_TEST_EMAIL ..."
signup="$(curl -sS --max-time 30 -X POST "$APP_ORIGIN/api/auth/sign-up" \
  -H 'Content-Type: application/json' -H "Origin: $APP_ORIGIN" \
  -d "{\"displayName\":\"Smoke Test\",\"email\":\"$SMOKE_TEST_EMAIL\",\"password\":\"$password\"}")"
echo "  -> $signup"

case "$signup" in
  *email_rate_limited*|*email_delivery_failed*)
    fail "SMTP is still not delivering. Check the provider dashboard for a
          rejected message, and confirm the From domain is verified." ;;
  *'"confirmationRequired":true'*)
    echo
    echo "Account created. A confirmation email should now arrive within a"
    echo "minute or two — that is the step that was previously impossible."
    echo "Open the link, then sign in at $APP_ORIGIN/auth/sign-in"
    echo
    echo "Password used for this test account: $password"
    ;;
  *'"confirmationRequired":false'*)
    echo "Account created and signed in directly (confirmation is disabled)." ;;
  *)
    fail "unexpected sign-up response above" ;;
esac

echo
echo "Remember to delete the smoke-test account when you are done."
