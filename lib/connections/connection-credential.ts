import "server-only";

import { evaluateConnectionIdentity } from "@/lib/connections/routable-candidates";
import { resolveSecretReference } from "@/lib/connections/secret-reference";
import type { ConnectionCapability } from "@/lib/connections/identity-router";

/**
 * Resolves the credential for one project and one capability through the
 * Identity Router — the general form of the binding every provider shares.
 *
 * The shape is always the same three steps: route the capability to exactly
 * one authorized connection (or a named refusal), read that connection's
 * `secret_reference`, dereference it server-side. Provider-specific wrappers
 * (`deployment-credential`, `database-credential`) exist so call sites name
 * what they are asking for, but none of them may shortcut a step — that is
 * how "which account" stops being ambient.
 *
 * The result carries the secret only on `resolved`, and everything else in
 * the result is safe to log: connection ids, refusal reasons, account labels.
 */

type TenantClient = Parameters<typeof evaluateConnectionIdentity>[0];

export type ConnectionCredentialResolution =
  | {
      readonly outcome: "resolved";
      readonly token: string;
      readonly connectionId: string;
      readonly accountLabel: string | null;
    }
  | { readonly outcome: "legacy"; readonly reason: string }
  | { readonly outcome: "refused"; readonly reason: string }
  | { readonly outcome: "unavailable"; readonly reason: string }
  | { readonly outcome: "error"; readonly reason: string };

export async function resolveConnectionCredential(
  client: TenantClient,
  projectId: string,
  capability: ConnectionCapability,
): Promise<ConnectionCredentialResolution> {
  const identity = await evaluateConnectionIdentity(client, projectId, capability);
  if (identity.mode === "error") {
    return { outcome: "error", reason: identity.message };
  }
  if (identity.mode === "legacy") {
    return { outcome: "legacy", reason: identity.reason };
  }
  if (identity.result.outcome === "REFUSED") {
    return {
      outcome: "refused",
      reason: `The identity router refused to choose a connection: ${identity.result.reason}`,
    };
  }

  const selected = identity.result;
  const reference = await client
    .from("connections")
    .select("secret_reference")
    .eq("id", selected.connectionId);
  if (reference.error) {
    return { outcome: "error", reason: "The connection registry could not be read." };
  }
  const row = ((reference.data ?? []) as { secret_reference: string | null }[])[0];
  if (!row?.secret_reference) {
    return {
      outcome: "unavailable",
      reason: "The routed connection carries no secret reference to resolve.",
    };
  }

  const secret = resolveSecretReference(row.secret_reference);
  if (secret.status !== "resolved") {
    return { outcome: "unavailable", reason: secret.reason };
  }

  return {
    outcome: "resolved",
    token: secret.value,
    connectionId: selected.connectionId,
    accountLabel: selected.accountLabel,
  };
}

/**
 * The database form of the same binding, for work against a project's own
 * Supabase (or other database) connection: `database.read` for queries,
 * `database.migrate` for schema changes. Nothing in the tree operates on an
 * external project database yet; this is the doorway such a module must use,
 * so that when one arrives, "which database" is already a routed, audited
 * decision rather than a new ambient variable.
 */
export function resolveDatabaseCredential(
  client: TenantClient,
  projectId: string,
  operation: "read" | "migrate",
): Promise<ConnectionCredentialResolution> {
  return resolveConnectionCredential(
    client,
    projectId,
    operation === "migrate" ? "database.migrate" : "database.read",
  );
}
