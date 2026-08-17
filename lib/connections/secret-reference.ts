import "server-only";

/**
 * Resolves a connection's `secret_reference` URI to the secret material it
 * points at — server-side only, and only for stores this deployment actually
 * has a client for.
 *
 * A `secret_reference` is metadata: `env://VERCEL_TOKEN_TEAM_A` names where
 * the secret lives, never what it is. This module is the one place that
 * dereferences the name, so the rule "a connection row is not a credential
 * store" survives the round trip: rows carry references, this resolver runs
 * on the server, and the value never travels anywhere the reference was
 * visible.
 *
 * Unsupported schemes refuse by name instead of pretending. The reference
 * vocabulary admits `vault://`, `secret-manager://` and `supabase-vault://`,
 * but no client for those stores exists in this deployment yet — resolving
 * them to "not configured" would misreport a missing integration as a missing
 * secret.
 */

const ENVIRONMENT_NAME = /^[A-Z][A-Z0-9_]{0,127}$/;

export type SecretResolution =
  | { readonly status: "resolved"; readonly value: string }
  | { readonly status: "unavailable"; readonly reason: string }
  | { readonly status: "unsupported"; readonly reason: string }
  | { readonly status: "invalid"; readonly reason: string };

export function resolveSecretReference(reference: string): SecretResolution {
  if (reference.startsWith("env://")) {
    const name = reference.slice("env://".length);
    if (!ENVIRONMENT_NAME.test(name)) {
      return {
        status: "invalid",
        reason: "The environment reference does not name a valid environment variable.",
      };
    }
    const value = process.env[name];
    if (!value) {
      return {
        status: "unavailable",
        reason: `The referenced environment variable ${name} is not set in this deployment.`,
      };
    }
    return { status: "resolved", value };
  }

  for (const scheme of ["vault://", "secret-manager://", "supabase-vault://"]) {
    if (reference.startsWith(scheme)) {
      return {
        status: "unsupported",
        reason: `No ${scheme.replace("://", "")} client exists in this deployment; the reference cannot be dereferenced here.`,
      };
    }
  }

  return {
    status: "invalid",
    reason: "The secret reference uses a scheme this resolver does not recognise.",
  };
}
