import "server-only";

import { evaluateConnectionIdentity } from "@/lib/connections/routable-candidates";
import { resolveSecretReference } from "@/lib/connections/secret-reference";
import type { ConnectionCapability } from "@/lib/connections/identity-router";

/**
 * Resolves the deployment credential for one project and target through the
 * Identity Router — the Phase 2D binding that makes multiple Vercel accounts
 * structurally possible.
 *
 * Before this, `lib/deploy/vercel.ts` read one process-wide `VERCEL_TOKEN`,
 * making one account the structural maximum. Now a project with a
 * capability-labelled deploy mapping gets the token of *its* routed
 * connection, so two projects mapped to two Vercel connections read two
 * different accounts. A project with only legacy mappings is reported as
 * such, and the caller keeps the ambient-token behavior it had before —
 * exactly the legacy-transparency rule the command seam follows.
 *
 * The result never carries the secret and the reference in the same field
 * set a surface would render: `token` is for the adapter's Authorization
 * header, everything else is safe to log.
 */

type TenantClient = Parameters<typeof evaluateConnectionIdentity>[0];

export type DeploymentCredentialResolution =
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

export async function resolveDeploymentCredential(
  client: TenantClient,
  projectId: string,
  target: "preview" | "production",
): Promise<DeploymentCredentialResolution> {
  const capability: ConnectionCapability =
    target === "production" ? "deploy.production" : "deploy.preview";

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
      reason: `The identity router refused to choose a deployment connection: ${identity.result.reason}`,
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
