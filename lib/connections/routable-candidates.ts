import "server-only";

import {
  CONNECTION_HEALTH_STATES,
  isConnectionCapability,
  routeConnectionIdentity,
  type ConnectionCapability,
  type ConnectionHealth,
  type RoutableConnection,
  type RoutingResult,
} from "@/lib/connections/identity-router";

/**
 * Loads a project's capability-labelled connection mappings and runs the
 * Identity Router over them — the 2D seam, called where work is created.
 *
 * Two deliberate properties:
 *
 * **Legacy mappings stay legal and stay visible.** A `project_connections` row
 * with a null capability predates the registry and is never routable. A
 * project with only legacy mappings is reported as `mode: "legacy"` so the
 * caller can proceed exactly as it did before Phase 2D — and say so — rather
 * than being refused for a label nobody has applied yet. The moment a project
 * labels any mapping, the router's word becomes binding for that project.
 *
 * **A read failure fails closed.** If the registry cannot be read, the answer
 * is an error, not "legacy". Degrading to the unrouted path on a database
 * error would let an outage silently bypass routing enforcement.
 */

type TenantClient = Awaited<
  ReturnType<typeof import("@/lib/supabase/tenant").requireActiveOrganization>
>["client"];

interface MappingRow {
  readonly capability: string | null;
  readonly priority: number | null;
  readonly connection_id: string;
}

interface ConnectionRow {
  readonly id: string;
  readonly provider: string;
  readonly status: string;
  readonly health: string;
  readonly external_account_label: string | null;
  readonly capabilities: unknown;
  readonly max_concurrency: number | null;
  readonly active_leases: number | null;
}

export type ConnectionIdentityEvaluation =
  | { readonly mode: "error"; readonly message: string }
  | { readonly mode: "legacy"; readonly reason: string }
  | { readonly mode: "routed"; readonly result: RoutingResult };

function toHealth(value: string): ConnectionHealth {
  // The column is CHECK-constrained to the vocabulary, so this branch exists
  // for defence in depth only. Anything unrecognisable maps to the one state
  // the router always refuses, never to an eligible one.
  return (CONNECTION_HEALTH_STATES as readonly string[]).includes(value)
    ? (value as ConnectionHealth)
    : "error";
}

function declaredCapabilities(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

export async function evaluateConnectionIdentity(
  client: TenantClient,
  projectId: string,
  capability: ConnectionCapability,
): Promise<ConnectionIdentityEvaluation> {
  const mappings = await client
    .from("project_connections")
    .select("capability, priority, connection_id")
    .eq("project_id", projectId);
  if (mappings.error) {
    return { mode: "error", message: "The connection registry could not be read." };
  }

  const rows = (mappings.data ?? []) as MappingRow[];
  const labelled = rows.filter(
    (row): row is MappingRow & { capability: string } => row.capability !== null,
  );
  if (labelled.length === 0) {
    return {
      mode: "legacy",
      reason:
        "No capability-labelled connection mappings exist for this project; "
        + "the resolved primary GitHub binding is used, as before Phase 2D.",
    };
  }

  // Candidates are the labelled mappings joined to their connection rows. The
  // join is a second scoped read rather than an embedded select so this module
  // does not depend on PostgREST foreign-key naming.
  const connections = await client
    .from("connections")
    .select(
      "id, provider, status, health, external_account_label, capabilities, max_concurrency, active_leases",
    )
    .in("id", [...new Set(labelled.map((row) => row.connection_id))]);
  if (connections.error) {
    return { mode: "error", message: "The connection registry could not be read." };
  }
  const byId = new Map(
    ((connections.data ?? []) as ConnectionRow[]).map((row) => [row.id, row]),
  );

  const candidates: RoutableConnection[] = [];
  for (const mapping of labelled) {
    const connection = byId.get(mapping.connection_id);
    if (!connection || !isConnectionCapability(mapping.capability)) continue;
    candidates.push({
      connectionId: connection.id,
      provider: connection.provider,
      accountLabel: connection.external_account_label,
      capability: mapping.capability,
      priority: mapping.priority ?? 100,
      status: connection.status,
      health: toHealth(connection.health),
      maxConcurrency: connection.max_concurrency,
      activeLeases: connection.active_leases ?? 0,
      declaredCapabilities: declaredCapabilities(connection.capabilities),
    });
  }

  return {
    mode: "routed",
    result: routeConnectionIdentity({ projectId, capability, candidates }),
  };
}
