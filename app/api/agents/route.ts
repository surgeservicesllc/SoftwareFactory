import { z } from "zod";

import { describeProviders, findWorkerProvider, isSupportedModel } from "@/lib/providers/registry";
import { databaseErrorResponse, jsonNoStore, readBoundedJson } from "@/lib/server/http";
import {
  embedded,
  forbidden,
  invalidRequest,
  isOrganizationManager,
  rows,
  withTenant,
} from "@/lib/server/tenant-route";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

const updateSchema = z
  .object({
    agentId: z.string().uuid(),
    enabled: z.boolean().optional(),
    provider: z.string().trim().min(1).max(64).nullable().optional(),
    model: z.string().trim().min(1).max(120).nullable().optional(),
    projectId: z.string().uuid().nullable().optional(),
  })
  .strict();

type AgentRow = {
  id: string;
  name: string;
  role: string;
  description: string | null;
  status: string;
  provider: string | null;
  model: string | null;
  capabilities: unknown;
  enabled: boolean;
  project_id: string | null;
  total_runs: number;
  succeeded_runs: number;
  failed_runs: number;
  last_run_at: string | null;
  projects: unknown;
};

type ActiveRunRow = { id: string; agent_id: string; status: string; step: string | null };

export async function GET() {
  return withTenant(
    async ({ activeOrganization, client }) => {
      const { data, error } = await client
        .from("agents")
        .select(
          "id,name,role,description,status,provider,model,capabilities,enabled,project_id,"
            + "total_runs,succeeded_runs,failed_runs,last_run_at,projects(name)",
        )
        .eq("organization_id", activeOrganization.id)
        .order("role", { ascending: true })
        .limit(200);
      if (error) return databaseErrorResponse(error);

      const agentRows = rows<AgentRow>(data);
      const agentIds = agentRows.map((agent) => agent.id);
      const { data: activeRuns } = agentIds.length
        ? await client
          .from("agent_runs")
          .select("id,agent_id,status,step")
          .eq("organization_id", activeOrganization.id)
          .in("agent_id", agentIds)
          .in("status", ["queued", "running", "validating", "cancelling"])
        : { data: [] };

      const currentRunByAgent = new Map(
        rows<ActiveRunRow>(activeRuns).map((run) => [run.agent_id, run]),
      );

      return jsonNoStore({
        activeOrganizationId: activeOrganization.id,
        canManage: isOrganizationManager(activeOrganization),
        providers: describeProviders(),
        agents: agentRows.map((agent) => {
          const currentRun = currentRunByAgent.get(agent.id);
          const project = embedded<{ name: string }>(agent.projects);
          const provider = agent.provider ? findWorkerProvider(agent.provider) : null;
          return {
            id: agent.id,
            name: agent.name,
            role: agent.role,
            description: agent.description,
            status: agent.status,
            enabled: agent.enabled,
            capabilities: Array.isArray(agent.capabilities) ? agent.capabilities : [],
            provider: agent.provider,
            providerLabel: provider?.label ?? null,
            providerConnected: provider ? provider.isConfigured() : false,
            model: agent.model,
            assignment: agent.project_id ? { id: agent.project_id, name: project?.name ?? "Project" } : null,
            currentRun: currentRun ? { id: currentRun.id, status: currentRun.status, step: currentRun.step } : null,
            metrics: {
              totalRuns: agent.total_runs,
              succeededRuns: agent.succeeded_runs,
              failedRuns: agent.failed_runs,
              successRate:
                agent.total_runs > 0 ? Math.round((agent.succeeded_runs / agent.total_runs) * 100) : null,
            },
            lastRunAt: agent.last_run_at,
          };
        }),
      });
    },
    { code: "agents_unavailable", message: "Agents could not be loaded." },
  );
}

/** Seeds the built-in logical agent roster for the active organization. */
export async function POST(request: Request) {
  return withTenant(
    async ({ activeOrganization, client }) => {
      assertSameOriginRequest(request);
      if (!isOrganizationManager(activeOrganization)) {
        return forbidden("Organization owner or administrator access is required to create agents.");
      }

      const { data, error } = await client.rpc("ensure_default_agents", {
        p_organization_id: activeOrganization.id,
      });
      if (error) return databaseErrorResponse(error);

      return jsonNoStore({ created: data ?? 0 }, { status: 201 });
    },
    { code: "agent_seed_failed", message: "The agent roster could not be created." },
  );
}

export async function PATCH(request: Request) {
  return withTenant(
    async ({ activeOrganization, client }) => {
      assertSameOriginRequest(request);
      if (!isOrganizationManager(activeOrganization)) {
        return forbidden("Organization owner or administrator access is required to change an agent.");
      }

      const parsed = updateSchema.safeParse(await readBoundedJson(request, 8 * 1024));
      if (!parsed.success) {
        return invalidRequest("invalid_agent_update", "The agent update is invalid.");
      }

      // A provider/model pair must exist in the registry, so an agent can never
      // be pointed at a vendor or model this build cannot actually call.
      if (parsed.data.provider && !findWorkerProvider(parsed.data.provider)) {
        return invalidRequest(
          "unsupported_provider",
          "That provider has no adapter in this build.",
        );
      }
      if (parsed.data.provider && parsed.data.model
        && !isSupportedModel(parsed.data.provider, parsed.data.model)) {
        return invalidRequest("unsupported_model", "That model is not available for the chosen provider.");
      }

      const update: Record<string, unknown> = {};
      if (parsed.data.enabled !== undefined) update.enabled = parsed.data.enabled;
      if (parsed.data.provider !== undefined) update.provider = parsed.data.provider;
      if (parsed.data.model !== undefined) update.model = parsed.data.model;
      if (parsed.data.projectId !== undefined) update.project_id = parsed.data.projectId;
      if (Object.keys(update).length === 0) {
        return invalidRequest("empty_agent_update", "No agent fields were supplied.");
      }

      const { data, error } = await client
        .from("agents")
        .update(update)
        .eq("id", parsed.data.agentId)
        .eq("organization_id", activeOrganization.id)
        .select("id,name,enabled,provider,model,project_id")
        .maybeSingle();
      if (error) return databaseErrorResponse(error);
      if (!data) {
        return jsonNoStore(
          { error: { code: "agent_not_found", message: "The agent was not found." } },
          { status: 404 },
        );
      }

      return jsonNoStore({
        agent: {
          id: data.id,
          name: data.name,
          enabled: data.enabled,
          provider: data.provider,
          model: data.model,
          projectId: data.project_id,
        },
      });
    },
    { code: "agent_update_failed", message: "The agent could not be updated." },
  );
}
