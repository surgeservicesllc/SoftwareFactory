import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

const requiredCheckNamesSchema = z.array(
  z.string()
    .min(1)
    .max(160)
    .refine((value) => value === value.trim())
    .refine((value) => !value.includes("|")),
).min(1).max(20).refine((value) => new Set(value).size === value.length);

export const graphExecutionTargetSchema = z.object({
  protocol_version: z.literal(1),
  graph_id: z.string().uuid(),
  organization_id: z.string().uuid(),
  project_id: z.string().uuid(),
  connection_id: z.string().uuid(),
  github_repository_id: z.string().uuid(),
  internal_installation_id: z.string().uuid(),
  external_installation_id: z.number().int().positive().safe(),
  app_id: z.number().int().positive().safe(),
  external_repository_id: z.number().int().positive().safe(),
  repository_full_name: z.string()
    .regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/)
    .max(201),
  base_branch: z.string().min(1).max(255).refine((value) => value === value.trim()),
  base_sha: z.string().regex(/^[0-9a-f]{40}$/),
  required_check_names: requiredCheckNamesSchema,
  required_checks_sha256: z.string().regex(/^[0-9a-f]{64}$/),
  target_sha256: z.string().regex(/^[0-9a-f]{64}$/),
}).strict();

export type GraphExecutionTarget = z.infer<typeof graphExecutionTargetSchema>;

export class GraphTargetError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GraphTargetError";
    this.code = code;
  }
}

/**
 * The RPC object itself is the v4 claim token. Keep every key: its canonical
 * database hash covers installation, repository, policy, and base identity,
 * and the claim transaction compares the complete JSON object byte-for-byte.
 */
export function graphExecutionTargetClaim(target: GraphExecutionTarget): GraphExecutionTarget {
  return {
    ...target,
    required_check_names: [...target.required_check_names],
  };
}

export function graphClaimTargetMismatch(
  claim: Readonly<{
    graph_id: string;
    organization_id: string;
    project_id: string;
    project_repository: string;
    base_branch?: string | null;
    base_sha?: string | null;
    required_check_names?: readonly string[] | null;
    required_checks_sha256?: string | null;
    repository_target_sha256?: string | null;
  }>,
  target: GraphExecutionTarget,
): string | null {
  const checks = claim.required_check_names ?? [];
  if (
    claim.graph_id !== target.graph_id
    || claim.organization_id !== target.organization_id
    || claim.project_id !== target.project_id
    || claim.project_repository !== target.repository_full_name
    || claim.base_branch !== target.base_branch
    || claim.base_sha !== target.base_sha
    || claim.required_checks_sha256 !== target.required_checks_sha256
    || claim.repository_target_sha256 !== target.target_sha256
    || checks.length !== target.required_check_names.length
    || checks.some((check, index) => check !== target.required_check_names[index])
  ) {
    return "The claimed graph did not preserve its exact repository installation, policy, and base identity.";
  }
  return null;
}

export class SupabaseGraphTargetResolver {
  private constructor(private readonly client: SupabaseClient) {}

  static create(options: { url: string; serviceRoleKey: string }) {
    return new SupabaseGraphTargetResolver(createClient(options.url, options.serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    }));
  }

  async resolve(targetGraphId: string): Promise<GraphExecutionTarget> {
    const { data, error } = await this.client.rpc("resolve_graph_execution_target_as_worker", {
      p_target_graph_id: targetGraphId,
      p_protocol_version: 1,
    });
    if (error) {
      throw new GraphTargetError(
        "graph_target_unavailable",
        `Resolving the exact graph repository target failed: ${error.message ?? "unknown error"}`,
      );
    }
    const parsed = graphExecutionTargetSchema.safeParse(data);
    if (!parsed.success || parsed.data.graph_id !== targetGraphId) {
      throw new GraphTargetError(
        "graph_target_invalid",
        "The exact graph repository target projection is missing or invalid.",
      );
    }
    return Object.freeze({
      ...parsed.data,
      required_check_names: [...parsed.data.required_check_names],
    });
  }
}
