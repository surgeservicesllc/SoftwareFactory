import "server-only";

import {
  resolveConnectionCredential,
  type ConnectionCredentialResolution,
} from "@/lib/connections/connection-credential";
import type { evaluateConnectionIdentity } from "@/lib/connections/routable-candidates";

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
 */

type TenantClient = Parameters<typeof evaluateConnectionIdentity>[0];

export type DeploymentCredentialResolution = ConnectionCredentialResolution;

export function resolveDeploymentCredential(
  client: TenantClient,
  projectId: string,
  target: "preview" | "production",
): Promise<DeploymentCredentialResolution> {
  return resolveConnectionCredential(
    client,
    projectId,
    target === "production" ? "deploy.production" : "deploy.preview",
  );
}
