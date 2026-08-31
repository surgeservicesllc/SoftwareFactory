import { z } from "zod";

import type {
  GraphDispatchResult,
  Phase1CDispatchTarget,
} from "@/lib/orchestration/dispatch";
import { safeErrorMessage } from "@/lib/worker/redact";

const workerIdSchema = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{2,127}$/);
const commandIdSchema = z.string().uuid();

export const graphRewakeClaimSchema = z.object({
  app_id: z.number().int().positive().safe(),
  base_branch: z.string().trim().min(1).max(255),
  bridge_id: z.string().uuid(),
  command_id: z.string().uuid(),
  connection_id: z.string().uuid(),
  external_installation_id: z.number().int().positive().safe(),
  external_repository_id: z.number().int().positive().safe(),
  github_repository_id: z.string().uuid(),
  graph_id: z.string().uuid(),
  head_sha: z.string().regex(/^[0-9a-f]{40}$/),
  intent_id: z.string().uuid(),
  internal_installation_id: z.string().uuid(),
  lease_token: z.string().uuid(),
  organization_id: z.string().uuid(),
  phase1c_run_id: z.string().uuid(),
  project_id: z.string().uuid(),
  repository_full_name: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
}).strict();

export type GraphRewakeClaim = z.infer<typeof graphRewakeClaimSchema>;

type RpcError = Readonly<{ code?: string; message?: string }>;
type RpcResponse = Readonly<{ data: unknown; error: RpcError | null }>;
export type GraphRewakeRpcClient = Readonly<{
  rpc: (
    name: string,
    parameters: Record<string, unknown>,
  ) => PromiseLike<RpcResponse>;
}>;

export type GraphRewakeDispatcher = (
  target: Phase1CDispatchTarget,
  graphId: string,
) => Promise<GraphDispatchResult>;

export type GraphRewakeOutcome = Readonly<{
  state: "worker_disabled" | "not_pending" | "dispatched";
  graphId: string | null;
}>;

export class GraphRewakeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GraphRewakeError";
  }
}

function oneRow(value: unknown): unknown | null {
  if (Array.isArray(value)) {
    if (value.length > 1) {
      throw new GraphRewakeError("The graph re-wake claim returned more than one exact intent.");
    }
    return value[0] ?? null;
  }
  return value && typeof value === "object" ? value : null;
}

function rpcError(operation: string, error: RpcError): GraphRewakeError {
  return new GraphRewakeError(
    `${operation} failed: ${safeErrorMessage(error.message ?? error.code ?? "unknown database error")}`,
  );
}

function dispatchTarget(claim: GraphRewakeClaim): Phase1CDispatchTarget {
  return {
    appId: claim.app_id,
    externalInstallationId: claim.external_installation_id,
    externalRepositoryId: claim.external_repository_id,
    repositoryFullName: claim.repository_full_name,
  };
}

async function recordDelivery(
  client: GraphRewakeRpcClient,
  workerId: string,
  claim: GraphRewakeClaim,
  accepted: boolean,
  failureCode: "dispatch_failed" | "worker_disabled" | null,
) {
  const { data, error } = await client.rpc(
    "record_grok_graph_rewake_delivery_as_worker",
    {
      p_worker_id: workerId,
      p_intent_id: claim.intent_id,
      p_lease_token: claim.lease_token,
      p_graph_id: claim.graph_id,
      p_bridge_id: claim.bridge_id,
      p_phase1c_run_id: claim.phase1c_run_id,
      p_command_id: claim.command_id,
      p_accepted: accepted,
      p_failure_code: failureCode,
    },
  );
  if (error) throw rpcError("Recording the exact graph re-wake delivery", error);
  if (data !== accepted) {
    throw new GraphRewakeError("The graph re-wake delivery acknowledgement was inconsistent.");
  }
}

/**
 * Deliver the one durable graph wake created by an admitted Grok Phase 1C
 * completion. The database owns identity, replay, lease, admission, stopped-
 * graph, and fresh-worker checks. The only external payload is the opaque
 * graph UUID; the graph worker still has to win its exact protocol-v3 claim.
 */
export async function deliverPendingGrokGraphRewake(input: Readonly<{
  client: GraphRewakeRpcClient;
  workerId: string;
  commandId: string;
  graphWorkerEnabled: boolean;
  dispatch: GraphRewakeDispatcher;
}>): Promise<GraphRewakeOutcome> {
  const workerId = workerIdSchema.parse(input.workerId);
  const commandId = commandIdSchema.parse(input.commandId);

  // Do not even lease the durable intent while the independent graph-worker
  // activation gate is off. A later authorized exact replay can deliver it.
  if (!input.graphWorkerEnabled) {
    return { state: "worker_disabled", graphId: null };
  }

  const { data, error } = await input.client.rpc("claim_grok_graph_rewake_as_worker", {
    p_worker_id: workerId,
    p_command_id: commandId,
    p_lease_seconds: 120,
  });
  if (error) throw rpcError("Claiming the exact graph re-wake", error);
  const raw = oneRow(data);
  if (!raw) return { state: "not_pending", graphId: null };

  const claim = graphRewakeClaimSchema.safeParse(raw);
  if (!claim.success || claim.data.command_id !== commandId) {
    throw new GraphRewakeError("The graph re-wake claim did not match the exact command identity.");
  }

  try {
    const dispatched = await input.dispatch(dispatchTarget(claim.data), claim.data.graph_id);
    if (!dispatched.dispatched) {
      await recordDelivery(input.client, workerId, claim.data, false, "worker_disabled");
      return { state: "worker_disabled", graphId: claim.data.graph_id };
    }
  } catch (error) {
    try {
      await recordDelivery(input.client, workerId, claim.data, false, "dispatch_failed");
    } catch (recordingError) {
      throw new GraphRewakeError(
        `The exact graph wake failed and its retry evidence could not be recorded: `
        + `${safeErrorMessage(recordingError)}.`,
      );
    }
    throw new GraphRewakeError(`The exact graph wake failed: ${safeErrorMessage(error)}.`);
  }

  await recordDelivery(input.client, workerId, claim.data, true, null);
  return { state: "dispatched", graphId: claim.data.graph_id };
}
