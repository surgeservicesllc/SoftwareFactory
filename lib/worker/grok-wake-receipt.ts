import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

export const GROK_WAKE_PROTOCOL_VERSION = 1 as const;
export const GROK_GRAPH_WORKER_CAPABILITY_VERSION = 1 as const;

const receiptSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  project_id: z.string().uuid(),
  session_id: z.string().uuid(),
  graph_id: z.string().uuid(),
  graph_run_id: z.string().uuid(),
  wake_intent_id: z.string().uuid(),
  control_revision: z.coerce.number().int().positive(),
  worker_id: z.string().min(3).max(160),
  protocol_version: z.literal(GROK_WAKE_PROTOCOL_VERSION),
  capability_version: z.literal(GROK_GRAPH_WORKER_CAPABILITY_VERSION),
  acknowledged_at: z.string().datetime({ offset: true }),
}).strict();

export type GrokWakeReceipt = z.infer<typeof receiptSchema>;

/**
 * Prove that an initial Grok claim did not require an opaque Resume identity.
 * This deliberately returns no intent id: a worker may only learn that id
 * from the exact repository_dispatch payload created for the Resume.
 */
export async function assertNoGrokWakePayloadRequired(
  client: Pick<SupabaseClient, "rpc">,
  input: Readonly<{
    workerId: string;
    graphId: string;
    graphRunId: string;
  }>,
): Promise<void> {
  const { data, error } = await client.rpc(
    "assert_no_grok_graph_wake_payload_required_as_worker",
    {
      p_worker_id: input.workerId,
      p_graph_id: input.graphId,
      p_graph_run_id: input.graphRunId,
      p_protocol_version: GROK_WAKE_PROTOCOL_VERSION,
      p_capability_version: GROK_GRAPH_WORKER_CAPABILITY_VERSION,
    },
  );
  if (error || data !== true) {
    throw new Error(
      `Checking the exact Grok graph wake payload failed: ${error?.message ?? "unexpected database response"}`,
    );
  }
}

/**
 * Persist the exact post-claim receipt before any provider node can start.
 * The database rechecks the current Resume, accepted dispatch, graph run,
 * worker identity, protocol, and capability version in one transaction.
 */
export async function acknowledgeGrokGraphWake(
  client: Pick<SupabaseClient, "rpc">,
  input: Readonly<{
    workerId: string;
    wakeIntentId: string;
    controlRevision: number;
    graphId: string;
    graphRunId: string;
  }>,
): Promise<GrokWakeReceipt> {
  const { data, error } = await client.rpc("acknowledge_grok_graph_wake_as_worker", {
    p_worker_id: input.workerId,
    p_wake_intent_id: input.wakeIntentId,
    p_control_revision: input.controlRevision,
    p_graph_id: input.graphId,
    p_graph_run_id: input.graphRunId,
    p_protocol_version: GROK_WAKE_PROTOCOL_VERSION,
    p_capability_version: GROK_GRAPH_WORKER_CAPABILITY_VERSION,
  });
  if (error) {
    throw new Error(`Acknowledging the exact Grok graph wake failed: ${error.message ?? "unknown error"}`);
  }
  const parsed = receiptSchema.safeParse(data);
  if (!parsed.success
      || parsed.data.worker_id !== input.workerId
      || parsed.data.wake_intent_id !== input.wakeIntentId
      || parsed.data.control_revision !== input.controlRevision
      || parsed.data.graph_id !== input.graphId
      || parsed.data.graph_run_id !== input.graphRunId) {
    throw new Error("The exact Grok graph wake receipt was malformed or mismatched.");
  }
  return parsed.data;
}
