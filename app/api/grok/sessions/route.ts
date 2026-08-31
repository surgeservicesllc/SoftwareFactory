import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  buildGrokChiefOfStaffPlan,
  GROK_PLAN_VERSION,
} from "@/lib/factory/chief-of-staff";
import {
  buildCanonicalFullLifecyclePlan,
  resolveCanonicalFullLifecycleReleaseIdentity,
} from "@/lib/graph/canonical-full-lifecycle";
import {
  GrokContextInputError,
  normalizeGrokContext,
  summarizeGrokContextForPlanning,
} from "@/lib/grok/context";
import {
  appendGrokAssistantPlan,
  appendGrokUserMessage,
  createGrokSession,
  GrokStoreDatabaseError,
  grokSpecialistRosterIdempotencyKey,
  grokSessionTitle,
  listGrokSessionRows,
  loadConfiguredGrokAgents,
  mapGrokSessionDetail,
  mapGrokSessionList,
  plannedGraphLink,
  readGrokBundle,
  readGrokProject,
  recordGrokContextEnvelope,
  recordGrokPlanningFailure,
  recordGrokEvent,
  recordGrokSpecialistRoster,
  storedGrokPlanningFailure,
  storedGrokPlan,
} from "@/lib/grok/session-store";
import {
  buildGrokProviderAdmissions,
  buildGrokReadOnlyIntentAdmissions,
  GrokProviderAdmissionError,
} from "@/lib/grok/provider-admission";
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
  context: z.array(z.unknown()).max(10).default([]),
  idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/).optional(),
}).strict();

const listQuerySchema = z.object({
  projectId: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  beforeCreatedAt: z.string().datetime({ offset: true }).optional(),
  beforeId: z.string().uuid().optional(),
}).strict().refine(
  (value) => (value.beforeCreatedAt === undefined) === (value.beforeId === undefined),
  { message: "A complete Grok session cursor is required." },
);

function ownerRequired() {
  return jsonNoStore(
    { error: { code: "owner_required", message: "Only an organization owner can use Grok Bot." } },
    { status: 403 },
  );
}

function planningFailureResponse(input: Readonly<{
  sessionId: string;
  status: "blocked";
  version: number;
  code: string;
  message: string;
}>) {
  return jsonNoStore(
    {
      sessionId: input.sessionId,
      session: {
        id: input.sessionId,
        status: input.status,
        version: input.version,
      },
      workerWoken: false,
      executionStarted: false,
      error: { code: input.code, message: input.message },
    },
    { status: 409 },
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
      beforeCreatedAt: url.searchParams.get("beforeCreatedAt") ?? undefined,
      beforeId: url.searchParams.get("beforeId") ?? undefined,
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
      parsed.data.limit + 1,
      parsed.data.beforeCreatedAt && parsed.data.beforeId
        ? { createdAt: parsed.data.beforeCreatedAt, id: parsed.data.beforeId }
        : null,
    );
    const page = rows.slice(0, parsed.data.limit);
    const last = page.at(-1);
    return jsonNoStore({
      sessions: mapGrokSessionList(page),
      nextCursor: rows.length > parsed.data.limit && last
        ? { createdAt: last.created_at, id: last.session_id }
        : null,
    });
  } catch (error) {
    return storeFailure(error, "grok_sessions_unavailable", "Grok sessions could not be loaded.");
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const parsed = requestSchema.safeParse(await readBoundedJson(request, 80 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_grok_request", message: "Provide one bounded prompt, projectId, and valid context references." } },
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
    const contextItems = normalizeGrokContext(parsed.data.context, project);
    const planningContextSummary = summarizeGrokContextForPlanning(contextItems);

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

    const serviceClient = createSupabaseGitHubWebhookClient();
    let bundle = await readGrokBundle(context.client, context.activeOrganization.id, session.id);
    const persistInitialContext = async (current: typeof bundle) => {
      await recordGrokContextEnvelope(serviceClient, {
        organizationId: context.activeOrganization.id,
        requestedBy: context.user.id,
        projectId: project.projectId,
        sessionId: session.id,
        messageId: userMessage.id,
        items: contextItems as unknown as readonly Record<string, unknown>[],
        idempotencyKey,
        expectedEventSequence: current.next.event_sequence,
        replanRequired: false,
      });
      return readGrokBundle(context.client, context.activeOrganization.id, session.id);
    };
    const durablePlanningFailure = storedGrokPlanningFailure(bundle);
    if (durablePlanningFailure) {
      bundle = await persistInitialContext(bundle);
      return planningFailureResponse({
        sessionId: session.id,
        status: "blocked",
        version: bundle.session.version,
        code: durablePlanningFailure.code,
        message: durablePlanningFailure.message,
      });
    }
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
        contextSummary: planningContextSummary,
        agents: await loadConfiguredGrokAgents(
          context.client,
          context.activeOrganization.id,
          project.projectId,
        ),
      });
      if (!result.ok) {
        let failure: Awaited<ReturnType<typeof recordGrokPlanningFailure>>;
        try {
          failure = await recordGrokPlanningFailure(serviceClient, {
            organizationId: context.activeOrganization.id,
            sessionId: session.id,
            userMessageId: userMessage.id,
            idempotencyKey,
            code: result.error.code,
            expectedVersion: bundle.session.version,
          });
        } catch (failureError) {
          // A concurrent request or timed-out database response may have
          // committed a different planner refusal for this exact request.
          // Suppress the error only when a fresh authenticated projection
          // proves the complete immutable blocked bundle; otherwise preserve
          // the original failure.
          let replayBundle;
          try {
            replayBundle = await readGrokBundle(
              context.client,
              context.activeOrganization.id,
              session.id,
            );
          } catch {
            throw failureError;
          }
          const replayedFailure = storedGrokPlanningFailure(replayBundle);
          if (!replayedFailure) throw failureError;
          replayBundle = await persistInitialContext(replayBundle);
          return planningFailureResponse({
            sessionId: session.id,
            status: "blocked",
            version: replayBundle.session.version,
            code: replayedFailure.code,
            message: replayedFailure.message,
          });
        }
        bundle = await readGrokBundle(context.client, context.activeOrganization.id, session.id);
        bundle = await persistInitialContext(bundle);
        return planningFailureResponse({
          sessionId: failure.session.id,
          status: "blocked",
          version: bundle.session.version,
          code: result.error.code,
          message: failure.message.content,
        });
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
    const preexistingGraphLink = plannedGraphLink(bundle);
    if (plan.planner.version !== GROK_PLAN_VERSION && !preexistingGraphLink) {
      return jsonNoStore(
        {
          sessionId: session.id,
          error: {
            code: "grok_replan_required",
            message: "This saved plan predates immutable specialist admission. Start a new Grok goal before execution.",
          },
          workerWoken: false,
          executionStarted: false,
        },
        { status: 409 },
      );
    }
    const specialistRoster = plan.planner.version === GROK_PLAN_VERSION
      ? await recordGrokSpecialistRoster(serviceClient, {
          organizationId: context.activeOrganization.id,
          projectId: project.projectId,
          sessionId: session.id,
          messageId: assistantMessage.id,
          requestedBy: context.user.id,
          idempotencyKey,
          expectedEventSequence: 3,
        })
      : null;
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
        ...(specialistRoster ? {
          specialistRosterCount: specialistRoster.roster_count,
          specialistRosterSha256: specialistRoster.roster_sha256,
        } : {}),
      },
      // Both durable messages emitted their own message.appended events first;
      // current plans then record the specialist-roster admission event.
      expectedSequence: specialistRoster ? 4 : 3,
      messageId: assistantMessage.id,
      taskLinkId: null,
    });

    bundle = await readGrokBundle(context.client, context.activeOrganization.id, session.id);
    bundle = await persistInitialContext(bundle);
    if (!plannedGraphLink(bundle)) {
      if (plan.intent.kind === "deploy") {
        return jsonNoStore(
          {
            sessionId: session.id,
            error: {
              code: "grok_intent_runtime_bridge_required",
              message: `The deterministic ${plan.intent.kind} plan and specialist roster are recorded, but no intent-specific executable bridge is installed. No graph or worker was started.`,
            },
            workerWoken: false,
            executionStarted: false,
          },
          { status: 409 },
        );
      }
      if (plan.intent.kind === "research") {
        if (
          plan.graphLaunch.riskLevel !== "green"
          || plan.graphLaunch.requiresOwnerApproval
        ) {
          return jsonNoStore(
            {
              sessionId: session.id,
              error: {
                code: "grok_intent_runtime_bridge_required",
                message: "The read-only research bridge accepts only an exact GREEN plan that does not require owner approval. The higher-risk plan and specialist roster remain recorded, but no graph or worker was started.",
              },
              workerWoken: false,
              executionStarted: false,
            },
            { status: 409 },
          );
        }
        let providerAdmissions;
        try {
          providerAdmissions = buildGrokReadOnlyIntentAdmissions(
            plan,
            plan.graphLaunch.nodes,
          );
        } catch (error) {
          if (!(error instanceof GrokProviderAdmissionError)) throw error;
          return jsonNoStore(
            {
              sessionId: session.id,
              error: {
                code: "grok_provider_admission_required",
                message: error.message,
              },
            },
            { status: 409 },
          );
        }
        const { error: launchError } = await serviceClient.rpc(
          "launch_grok_read_only_research_v1_as_server",
          {
            p_organization_id: context.activeOrganization.id,
            p_requested_by: context.user.id,
            p_project_id: project.projectId,
            p_session_id: session.id,
            p_message_id: assistantMessage.id,
            p_idempotency_key: idempotencyKey,
            p_goal: plan.graphLaunch.goal,
            p_topology: plan.graphLaunch.topology,
            p_topology_reasons: plan.graphLaunch.topologyReasons,
            p_risk_level: plan.graphLaunch.riskLevel,
            p_requires_owner_approval: plan.graphLaunch.requiresOwnerApproval,
            p_nodes: plan.graphLaunch.nodes,
            p_edges: plan.graphLaunch.edges,
            p_budget: plan.graphLaunch.budget,
            p_roster_idempotency_key: grokSpecialistRosterIdempotencyKey(idempotencyKey),
            p_admissions: providerAdmissions,
          },
        );
        if (launchError) return databaseErrorResponse(launchError);
        bundle = await readGrokBundle(context.client, context.activeOrganization.id, session.id);
      } else {
      /*
       * The provider-labelled Grok DAG remains routing intent. Executing it as
       * a custom graph would let the worker silently reinterpret its provider,
       * model, and configured-agent assignments. Launch only the already
       * enforced canonical Full Lifecycle v3 plan, then pause it atomically at
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
      let providerAdmissions;
      try {
        providerAdmissions = buildGrokProviderAdmissions(plan, canonical.plan.nodes);
      } catch (error) {
        if (!(error instanceof GrokProviderAdmissionError)) throw error;
        return jsonNoStore(
          {
            sessionId: session.id,
            error: {
              code: "grok_provider_admission_required",
              message: error.message,
            },
          },
          { status: 409 },
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
        "launch_grok_full_lifecycle_v3_as_server",
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
          p_roster_idempotency_key: grokSpecialistRosterIdempotencyKey(idempotencyKey),
          p_admissions: providerAdmissions,
        },
      );
      if (launchError) return databaseErrorResponse(launchError);
      bundle = await readGrokBundle(context.client, context.activeOrganization.id, session.id);
      }
    }
    const detail = await mapGrokSessionDetail(
      context.client,
      context.activeOrganization.id,
      project.name,
      bundle,
    );
    const executionStarted = detail.session.graphRunId !== null;
    const executionState = detail.session.status;
    const graphKind = plan.intent.kind === "research"
      ? "read-only research graph"
      : "canonical release graph";
    const executionMessage = executionStarted
      ? `A durable graph run is linked and the session is ${executionState}. This request did not dispatch a worker.`
      : executionState === "paused"
        ? `The ${graphKind} is durable and paused. This request did not dispatch a worker.`
        : `The ${graphKind} is durable with status ${executionState}; no durable run evidence is linked. This request did not dispatch a worker.`;
    return jsonNoStore({
      ...detail,
      // This route never dispatches. Keep that request-scoped fact separate
      // from whether another authorized request already started a durable run.
      workerWoken: false,
      executionStarted,
      execution: {
        state: executionState,
        bridge: plan.intent.kind === "research"
          ? "read_only_research_v1"
          : "full_lifecycle_v3",
        message: executionMessage,
      },
    }, { status: 202 });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof GrokContextInputError) {
      return jsonNoStore(
        { error: { code: "invalid_grok_context", message: error.message } },
        { status: 400 },
      );
    }
    if (error instanceof GitHubApiError || error instanceof GitHubConfigurationError) {
      return githubRouteErrorResponse(error);
    }
    return storeFailure(error, "grok_session_failed", "The Grok session could not be planned safely.");
  }
}
