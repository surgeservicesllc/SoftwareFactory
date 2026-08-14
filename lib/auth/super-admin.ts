import "server-only";

/**
 * Super administrators, identified by email address.
 *
 * `SUPER_ADMIN_EMAILS` (server-only, comma-separated) is the source of truth.
 * `DEFAULT_SUPER_ADMIN_EMAILS` is the documented fallback so a deployment that
 * has not set the variable still has a reachable administrator rather than
 * none at all. Setting the variable replaces the default outright — it does
 * not extend it — so an operator can hand the role over without a code change.
 *
 * The address is a claim, not proof. A super administrator is only recognized
 * when Supabase reports the address as confirmed: if unconfirmed addresses
 * counted, anyone who signed up as a listed address before its real owner did
 * would inherit full access. That coupling is the reason `emailConfirmed` is a
 * required argument here rather than an optional check at the call site.
 */
export const DEFAULT_SUPER_ADMIN_EMAILS = ["daniel.hughen@gmail.com"] as const;

function normalize(email: string): string {
  return email.trim().toLowerCase();
}

/** The configured super-administrator addresses, normalized. */
export function superAdminEmails(): readonly string[] {
  const configured = process.env.SUPER_ADMIN_EMAILS;
  if (!configured) return DEFAULT_SUPER_ADMIN_EMAILS.map(normalize);

  const parsed = configured
    .split(",")
    .map(normalize)
    .filter((entry) => entry.length > 0);

  // An empty or whitespace-only variable is a configuration mistake, not an
  // instruction to lock everyone out. Fall back rather than strand the tenant.
  return parsed.length > 0 ? parsed : DEFAULT_SUPER_ADMIN_EMAILS.map(normalize);
}

/**
 * Whether a verified identity holds the super-administrator role.
 *
 * `emailConfirmed` must come from the provider (`user.email_confirmed_at`),
 * never from a form field or a cookie.
 */
export function isSuperAdmin(
  email: string | null | undefined,
  emailConfirmed: boolean,
): boolean {
  if (!email || !emailConfirmed) return false;
  return superAdminEmails().includes(normalize(email));
}
