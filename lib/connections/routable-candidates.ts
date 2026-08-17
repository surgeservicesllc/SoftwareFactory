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
 *
 * **Capacity is counted live, never read from a stored counter.** A stored
 * `active_leases` number is structurally unable to be honest: a lease that
 * expires without a status transition fires no trigger, so the counter cannot
 * decay. The claim path already counts running-with-unexpired-lease from
 * `agent_runs` for exactly this reason (`portfolio_capacity_verdict`), and the
 * router must see the same number the scheduler enforces or the two will
 * disagree about a full connection.
 *
 * **Two declared ceilings reconcile as strictest-wins.** The registry declares
 * `connections.max_concurrency` (Phase 2D) and the scheduler declares
 * connection-specific rows in `provider_capacity_limits` (Phase 2E). Both are
 * owner statements about the same connection; when they differ, the router
 * honours the tighter one rather than picking a favourite store.
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
  const connectionIds = [...new Set(labelled.map((row) => row.connection_id))];
  const connections = await client
    .from("connections")
    .select(
      "id, provider, status, health, external_account_label, capabilities, max_concurrency",
    )
    .in("id", connectionIds);
  if (connections.error) {
    return { mode: "error", message: "The connection registry could not be read." };
  }
  const byId = new Map(
    ((connections.data ?? []) as ConnectionRow[]).map((row) => [row.id, row]),
  );

  // The live in-flight count the scheduler itself enforces against: running
  // runs whose lease has not expired. Same definition as
  // portfolio_capacity_verdict, so router and scheduler cannot disagree.
  const running = await client
    .from("agent_runs")
    .select("connection_id")
    .in("connection_id", connectionIds)
    .eq("status", "running")
    .gt("lease_expires_at", new Date().toISOString());
  if (running.error) {
    return { mode: "error", message: "The connection registry could not be read." };
  }
  const liveLeases = new Map<string, number>();
  for (const row of (running.data ?? []) as { connection_id: string | null }[]) {
    if (!row.connection_id) continue;
    liveLeases.set(row.connection_id, (liveLeases.get(row.connection_id) ?? 0) + 1);
  }

  // Connection-specific scheduler ceilings; provider-wide rows (null
  // connection_id) stay the claim path's business and are excluded by the
  // id filter.
  const schedulerLimits = await client
    .from("provider_capacity_limits")
    .select("connection_id, maximum_concurrent_runs")
    .in("connection_id", connectionIds);
  if (schedulerLimits.error) {
    return { mode: "error", message: "The connection registry could not be read." };
  }
  const limitByConnection = new Map<string, number>();
  for (const row of (schedulerLimits.data ?? []) as {
    connection_id: string | null;
    maximum_concurrent_runs: number | null;
  }[]) {
    if (row.connection_id && typeof row.maximum_concurrent_runs === "number") {
      limitByConnection.set(row.connection_id, row.maximum_concurrent_runs);
    }
  }

  const candidates: RoutableConnection[] = [];
  for (const mapping of labelled) {
    const connection = byId.get(mapping.connection_id);
    if (!connection || !isConnectionCapability(mapping.capability)) continue;
    const declaredCeiling = connection.max_concurrency;
    const schedulerCeiling = limitByConnection.get(connection.id) ?? null;
    candidates.push({
      connectionId: connection.id,
      provider: connection.provider,
      accountLabel: connection.external_account_label,
      capability: mapping.capability,
      priority: mapping.priority ?? 100,
      status: connection.status,
      health: toHealth(connection.health),
      maxConcurrency:
        declaredCeiling === null ? schedulerCeiling
        : schedulerCeiling === null ? declaredCeiling
        : Math.min(declaredCeiling, schedulerCeiling),
      activeLeases: liveLeases.get(connection.id) ?? 0,
      declaredCapabilities: declaredCapabilities(connection.capabilities),
    });
  }

  return {
    mode: "routed",
    result: routeConnectionIdentity({ projectId, capability, candidates }),
  };
}
