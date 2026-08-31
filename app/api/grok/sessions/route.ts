import { randomUUID } from "node:crypto";

import { z } from "zod";

import { buildGrokChiefOfStaffPlan } from "@/lib/factory/chief-of-staff";
import {
  buildCanonicalFullLifecyclePlan,
  resolveCanonicalFullLifecycleReleaseIdentity,
} from "@/lib/graph/canonical-full-lifecycle";
import {
  appendGrokAssistantPlan,
  appendGrokUserMessage,
  createGrokSession,
  GrokStoreDatabaseError,
  grokSessionTitle,
  listGrokSessionRows,
  loadConfiguredGrokAgents,
  mapGrokSessionDetail,
  mapGrokSessionList,
  plannedGraphLink,
  readGrokBundle,
  readGrokProject,
  recordGrokEvent,
  storedGrokPlan,
} from "@/lib/grok/session-store";
import { GitHubApiError } from "@/lib/github/client";
import { GitHubConfigurationError } from "@/lib/github/config";
import { githubRouteErrorResponse } from "@/lib/github/errors";
import { createSupabaseGitHubWebhookClient } from "@/lib/github/service-role";
import { findSensitiveData } from "@/lib/security/sensitive-data";
import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

const requestSchema = z.object({
  projectId: z.string().uuid(),
  // Preserve the exact message. The planner performs its own normalized,
  // bounded parse, while the transcript keeps what the owner actually sent.
  prompt: z.string().min(1).max(4_000).refine((value) => value.trim().length > 0),
  idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/).optional(),
}).strict();

const listQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
}).strict();

function ownerRequired() {
  return jsonNoStore(
    { error: { code: "owner_required", message: "Only an organization owner can use Grok Bot." } },
    { status: 403 },
  );
}

function storeFailure(error: unknown, code: string, message: string) {
  if (error instanceof GrokStoreDatabaseError) return databaseErrorResponse(error.databaseError);
  const boundary = supabaseBoundaryErrorResponse(error);
  if (boundary) return boundary;
  return jsonNoStore({ error: { code, message } }, { status: 500 });
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = listQuerySchema.safeParse({
      projectId: url.searchParams.get("projectId") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_grok_query", message: "The Grok session query is invalid." } },
        { status: 400 },
      );
    }
    const context = await requireActiveOrganization();
    if (context.activeOrganization.role !== "owner") return ownerRequired();
    const rows = await listGrokSessionRows(
      context.client,
      context.activeOrganization.id,
      parsed.data.projectId ?? null,
      parsed.data.limit,
    );
    return jsonNoStore({ sessions: mapGrokSessionList(rows) });
  } catch (error) {
    return storeFailure(error, "grok_sessions_unavailable", "Grok sessions could not be loaded.");
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const parsed = requestSchema.safeParse(await readBoundedJson(request, 20 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_grok_request", message: "Provide one bounded prompt and projectId." } },
        { status: 400 },
      );
    }
    const sensitive = findSensitiveData(parsed.data.prompt);
    if (sensitive) {
      return jsonNoStore(
        {
          error: {
            code: "sensitive_data_rejected",
            message: "Remove credentials or secret values and submit references only.",
          },
        },
        { status: 400 },
      );
    }

    const context = await requireActiveOrganization();
    if (context.activeOrganization.role !== "owner") return ownerRequired();
    const project = await readGrokProject(
      context.client,
      context.activeOrganization.id,
      parsed.data.projectId,
    );
    if (!project || project.status === "archived") {
      return jsonNoStore(
        {
          error: {
            code: "grok_project_not_ready",
            message: "Grok Bot requires this tenant's active project with an exact repository and default branch.",
          },
        },
        { status: 409 },
      );
    }

    const idempotencyKey = parsed.data.idempotencyKey ?? `grok:${randomUUID()}`;
    const session = await createGrokSession(context.client, {
      organizationId: context.activeOrganization.id,
      projectId: project.projectId,
      title: grokSessionTitle(parsed.data.prompt),
      idempotencyKey,
    });
    const userMessage = await appendGrokUserMessage(context.client, {
      organizationId: context.activeOrganization.id,
      sessionId: session.id,
      prompt: parsed.data.prompt,
      idempotencyKey,
    });

    let bundle = await readGrokBundle(context.client, context.activeOrganization.id, session.id);
    let plan = storedGrokPlan(bundle);
    if (plan && (
      plan.project.projectId !== project.projectId
      || plan.intent.prompt !== parsed.data.prompt.trim()
      || plan.graphLaunch.goal !== parsed.data.prompt.trim()
    )) {
      return jsonNoStore(
        {
          error: {
            code: "grok_idempotency_conflict",
            message: "The idempotency key is already bound to a different Grok plan.",
          },
        },
        { status: 409 },
      );
    }

    const serviceClient = createSupabaseGitHubWebhookClient();
    let assistantMessage = bundle.messages.find(
      (message) => message.sequence_no === 2 && message.role === "assistant",
    ) ?? null;
    if (!plan) {
      const plannerProject = {
        projectId: project.projectId,
        name: project.name,
        repositoryFullName: project.repositoryFullName,
        defaultBranch: project.defaultBranch,
        productionUrl: project.productionUrl,
      };
      const result = buildGrokChiefOfStaffPlan({
        prompt: parsed.data.prompt,
        project: plannerProject,
        agents: await loadConfiguredGrokAgents(
          context.client,
          context.activeOrganization.id,
          project.projectId,
        ),
      });
      if (!result.ok) {
        return jsonNoStore(
          {
            sessionId: session.id,
            error: {
              code: result.error.code,
              message: result.error.message,
              details: result.error.details,
            },
          },
          { status: 409 },
        );
      }
      plan = result.plan;
      assistantMessage = await appendGrokAssistantPlan(serviceClient, {
        organizationId: context.activeOrganization.id,
        sessionId: session.id,
        userMessageId: userMessage.id,
        idempotencyKey,
        plan,
      });
    }
    if (!assistantMessage) {
      throw new Error("A durable Grok plan exists without its assistant message.");
    }
    await recordGrokEvent(serviceClient, {
      organizationId: context.activeOrganization.id,
      sessionId: session.id,
      eventType: "session.planned",
      correlationId: session.id,
      payload: {
        schemaVersion: 1,
        detail: "The deterministic chief-of-staff plan was recorded; execution has not started.",
        planMessageId: assistantMessage.id,
        plannerVersion: plan.planner.version,
        taskCount: plan.dag.tasks.length,
      },
      // Both durable messages emitted their own message.appended events first.
      expectedSequence: 3,
      messageId: assistantMessage.id,
      taskLinkId: null,
    });

    bundle = await readGrokBundle(context.client, context.activeOrganization.id, session.id);
    if (!plannedGraphLink(bundle)) {
      /*
       * The provider-labelled Grok DAG remains routing intent. Executing it as
       * a custom graph would let the worker silently reinterpret its provider,
       * model, and configured-agent assignments. Launch only the already
       * enforced canonical Full Lifecycle v2 plan, then pause it atomically at
       * the database boundary. No worker is dispatched from this route.
       */
      const canonical = buildCanonicalFullLifecyclePlan(parsed.data.prompt);
      if (!canonical.ok) {
        return jsonNoStore(
          {
            sessionId: session.id,
            error: {
              code: canonical.code,
              message: canonical.message,
              details: canonical.details,
            },
          },
          { status: canonical.status },
        );
      }
      const release = await resolveCanonicalFullLifecycleReleaseIdentity(
        context.client,
        context.activeOrganization.id,
        project.projectId,
      );
      if (!release.ok) {
        if (release.databaseError) return databaseErrorResponse(release.databaseError);
        return jsonNoStore(
          { error: { code: release.code, message: release.message } },
          { status: release.status },
        );
      }
      const { error: launchError } = await serviceClient.rpc(
        "launch_grok_full_lifecycle_as_server",
        {
          p_organization_id: context.activeOrganization.id,
          p_requested_by: context.user.id,
          p_project_id: project.projectId,
          p_session_id: session.id,
          p_message_id: assistantMessage.id,
          p_idempotency_key: idempotencyKey,
          p_goal: canonical.plan.goal,
          p_topology: canonical.plan.topology,
          p_topology_reasons: canonical.plan.topologyReasons,
          p_risk_level: canonical.plan.riskLevel,
          p_requires_owner_approval: canonical.plan.requiresOwnerApproval,
          p_nodes: canonical.plan.nodes,
          p_edges: canonical.plan.edges,
          p_budget: canonical.plan.budget,
          p_github_repository_id: release.target.repository_id,
          p_base_branch: release.target.base_branch,
          p_base_sha: release.baseSha,
          p_required_check_names: release.requiredChecks,
        },
      );
      if (launchError) return databaseErrorResponse(launchError);
      bundle = await readGrokBundle(context.client, context.activeOrganization.id, session.id);
    }
    const detail = await mapGrokSessionDetail(
      context.client,
      context.activeOrganization.id,
      project.name,
      bundle,
    );
    return jsonNoStore({
      ...detail,
      workerWoken: false,
      executionStarted: false,
      execution: {
        state: "paused",
        bridge: "full_lifecycle_v2",
        message: "The canonical release graph is durable and paused. No worker was dispatched.",
      },
    }, { status: 202 });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof GitHubApiError || error instanceof GitHubConfigurationError) {
      return githubRouteErrorResponse(error);
    }
    return storeFailure(error, "grok_session_failed", "The Grok session could not be planned safely.");
  }
}
