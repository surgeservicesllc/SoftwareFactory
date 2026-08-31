import "server-only";

import { createClient } from "@supabase/supabase-js";
import { z } from "zod";

import { isSupabaseServiceRoleCredential } from "@/lib/supabase/config";
import { getSupabasePublicEnvironment } from "@/lib/supabase/env";

type DatabaseError = Readonly<{ code?: string; message?: string }>;
type QueryResult = Readonly<{ data: unknown; error: DatabaseError | null }>;
type WakeDispatchRecorderClient = Readonly<{
  rpc: (name: string, args: Record<string, unknown>) => Readonly<{
    single: () => PromiseLike<QueryResult>;
  }>;
}>;

const dispatchAttemptSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  project_id: z.string().uuid(),
  session_id: z.string().uuid(),
  graph_id: z.string().uuid(),
  wake_intent_id: z.string().uuid(),
  control_revision: z.coerce.number().int().positive(),
  attempt_number: z.coerce.number().int().positive().max(32),
  idempotency_key: z.string().min(8).max(128),
  outcome: z.enum(["accepted", "failed"]),
  failure_code: z.string().regex(/^[A-Z][A-Z0-9_]{0,79}$/).nullable(),
  created_at: z.string().datetime({ offset: true }),
}).strict();

export type GrokWakeDispatchFailureCode =
  | "ADMISSION_STALE"
  | "GRAPH_STALE"
  | "TARGET_UNAVAILABLE"
  | "TARGET_MISMATCH"
  | "WORKER_DISABLED"
  | "DISPATCH_ERROR";

export class GrokWakeDispatchRecorderError extends Error {
  readonly databaseError?: DatabaseError;

  constructor(message: string, databaseError?: DatabaseError) {
    super(message);
    this.name = "GrokWakeDispatchRecorderError";
    this.databaseError = databaseError;
  }
}

/** A route may record transport truth only through the service-only RPC. */
export function createGrokWakeDispatchRecorderClient(): WakeDispatchRecorderClient {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!key || !isSupabaseServiceRoleCredential(key)) {
    throw new GrokWakeDispatchRecorderError(
      "The server-only Grok wake dispatch recorder is not configured.",
    );
  }
  const { url } = getSupabasePublicEnvironment();
  return createClient(url, key, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  }) as unknown as WakeDispatchRecorderClient;
}

export async function recordGrokWakeDispatch(
  input: Readonly<{
    organizationId: string;
    projectId: string;
    sessionId: string;
    graphId: string;
    wakeIntentId: string;
    controlRevision: number;
    outcome: "accepted" | "failed";
    failureCode: GrokWakeDispatchFailureCode | null;
    idempotencyKey: string;
  }>,
  rawClient?: WakeDispatchRecorderClient,
) {
  const client = rawClient ?? createGrokWakeDispatchRecorderClient();
  const { data, error } = await client.rpc("record_grok_graph_wake_dispatch_as_server", {
    p_organization_id: input.organizationId,
    p_wake_intent_id: input.wakeIntentId,
    p_control_revision: input.controlRevision,
    p_outcome: input.outcome,
    p_failure_code: input.failureCode,
    p_idempotency_key: input.idempotencyKey,
  }).single();
  if (error) {
    throw new GrokWakeDispatchRecorderError(
      "The Grok wake dispatch outcome could not be recorded.",
      error,
    );
  }
  const parsed = dispatchAttemptSchema.safeParse(data);
  if (!parsed.success
      || parsed.data.organization_id !== input.organizationId
      || parsed.data.project_id !== input.projectId
      || parsed.data.session_id !== input.sessionId
      || parsed.data.graph_id !== input.graphId
      || parsed.data.wake_intent_id !== input.wakeIntentId
      || parsed.data.control_revision !== input.controlRevision
      || parsed.data.idempotency_key !== input.idempotencyKey
      || parsed.data.outcome !== input.outcome
      || parsed.data.failure_code !== input.failureCode) {
    throw new GrokWakeDispatchRecorderError(
      "The Grok wake dispatch recorder returned mismatched evidence.",
    );
  }
  return parsed.data;
}
