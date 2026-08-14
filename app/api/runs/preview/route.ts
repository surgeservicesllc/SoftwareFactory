import { z } from "zod";

import { routeProvider, ROUTING_PROVIDER_REQUESTS } from "@/lib/providers/routing";
import { loadProjectRoutingContext } from "@/lib/providers/service";
import {
  PROVIDER_TASK_KINDS,
  isAgentRole,
  type AgentRole,
  type ProviderId,
} from "@/lib/providers/types";
import {
  ApiRequestError,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

const previewSchema = z
  .object({
    projectId: z.string().uuid(),
    agentId: z.string().uuid().nullable().default(null),
    taskKind: z.enum(PROVIDER_TASK_KINDS),
    requestedProvider: z.enum(ROUTING_PROVIDER_REQUESTS).default("AUTO"),
    riskLevel: z.enum(["GREEN", "YELLOW", "RED"]).default("GREEN"),
  })
  .strict();

/**
 * Show which provider and model a task would be routed to, and why, without
 * contacting a provider or recording a run. Nothing here spends money or
 * creates evidence; it is a read of the routing engine's decision.
 */
export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);

    const parsed = previewSchema.safeParse(await readBoundedJson(request));
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_preview_request",
            message: "The routing preview request is invalid.",
            fields: z.flattenError(parsed.error).fieldErrors,
          },
        },
        { status: 400 },
      );
    }

    const { client, activeOrganization } = await requireActiveOrganization();
    const context = await loadProjectRoutingContext(
      client,
      activeOrganization.id,
      parsed.data.projectId,
    );
    if (!context) {
      return jsonNoStore(
        { error: { code: "project_not_found", message: "The project is not available." } },
        { status: 404 },
      );
    }

    let agentAssignment: {
      agentId: string;
      agentRole: AgentRole;
      provider: ProviderId | null;
      model: string | null;
    } | null = null;

    if (parsed.data.agentId) {
      const { data, error } = await client.rpc("get_provider_agent_assignment", {
        p_agent_id: parsed.data.agentId,
        p_organization_id: activeOrganization.id,
      });
      if (error) throw error;

      const result = Array.isArray(data) ? data[0] : data;
      if (result) {
        const row = result as {
          id: string;
          role: string;
          provider: string | null;
          model: string | null;
        };
        if (!isAgentRole(row.role)) {
          return jsonNoStore(
            { error: { code: "agent_not_found", message: "The agent is not available." } },
            { status: 404 },
          );
        }
        agentAssignment = {
          agentId: row.id,
          agentRole: row.role,
          provider: row.provider === "anthropic" || row.provider === "openai" ? row.provider : null,
          model: row.model,
        };
      } else {
        return jsonNoStore(
          { error: { code: "agent_not_found", message: "The agent is not available." } },
          { status: 404 },
        );
      }
    }

    const decision = routeProvider({
      taskKind: parsed.data.taskKind,
      riskLevel: parsed.data.riskLevel,
      requestedProvider: parsed.data.requestedProvider,
      policy: context.policy,
      agentAssignment,
      availability: context.availability,
    });

    return jsonNoStore({
      executionEnabled: context.executionEnabled,
      decision: {
        decision: decision.decision,
        provider: decision.provider,
        model: decision.model,
        source: decision.source,
        policyVersion: decision.policyVersion,
        requiresOwnerApproval: decision.requiresOwnerApproval,
        requiredCapabilities: decision.requiredCapabilities,
        reasons: decision.reasons,
        candidates: decision.candidates,
      },
      note: "This is a routing preview. No provider was contacted and no run was recorded.",
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;

    return jsonNoStore(
      { error: { code: "internal_error", message: "The routing preview failed safely." } },
      { status: 500 },
    );
  }
}
