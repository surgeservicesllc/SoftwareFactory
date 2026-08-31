import { z } from "zod";

import { checkGraphLaunch } from "@/lib/billing/entitlements";
import { buildCustomTemplate, parseStoredDefinition } from "@/lib/graph/custom-templates";
import { dispatchGraphWorker } from "@/lib/orchestration/dispatch";
import {
  buildCanonicalFullLifecyclePlan,
  resolveCanonicalFullLifecycleReleaseIdentity,
} from "@/lib/graph/canonical-full-lifecycle";
import { buildLaunchPlan } from "@/lib/graph/launch-plan";
import {
  FULL_LIFECYCLE_TEMPLATE_KEY,
  FULL_LIFECYCLE_TEMPLATE_VERSION,
  phase1CTargetSchema,
} from "@/lib/graph/phase1c-gate-bridge";
import { budgetForTemplate, findTemplate, type GraphTemplate } from "@/lib/graph/templates";
import { GitHubApiError } from "@/lib/github/client";
import { GitHubConfigurationError } from "@/lib/github/config";
import { githubRouteErrorResponse } from "@/lib/github/errors";
import { createSupabaseGitHubWebhookClient } from "@/lib/github/service-role";
import {
  invalidRequest,
  operationsContext,
  operationsFailure,
  requireManager,
} from "@/lib/operations/route";
import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { containsLikelySecret } from "@/lib/server/sensitive-data";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

/**
 * Launch a graph from a template.
 *
 * This route is the join Phase 2B was missing. The engine, the schema and the
 * SECURITY DEFINER write boundary all existed and nothing called
 * `create_graph_from_plan`, so no graph could reach the database — the console
 * rendered a design-time preview and stopped there.
 *
 * ## It creates, it does not execute
 *
 * `create_graph_from_plan` writes the graph and its nodes and edges, and
 * this route deliberately starts nothing itself. Execution belongs to the
 * graph executor worker (`scripts/graph-worker.mts`, migration
 * `20260819000100`): it claims recorded graphs, creates the run, and drives
 * the nodes through the subscription transport when it is dispatched.
 * Creating the plan is this route's honest boundary; the claim is the
 * worker's.
 *
 * ## Why it must be an authenticated session
 *
 * Every function in the write boundary is granted to `authenticated` and to
 * nobody else — `service_role` holds **zero** execute grants on it. That is
 * deliberate, and it means this cannot be done from a server key or a
 * background job: the graph is written as a member of the organization, under
 * RLS, with `auth.uid()` recorded as its author. A design where a server key
 * could fabricate a graph would make "who asked for this work" unanswerable.
 *
 * Manager authority rather than plain membership, because a graph commits a
 * budget and names the agents that will spend it.
 */

const launchSchema = z
  .object({
    projectId: z.string().uuid(),
    templateKey: z.string().trim().min(1).max(64),
    // Optional only for rolling compatibility with the older template-planning
    // dialog. The Factory launch control always supplies a real user goal;
    // when this field is present it, rather than the template summary, is the
    // graph's durable goal and the context every worker node receives.
    goal: z.string().trim().min(1).max(4_000).optional(),
  })
  .strict();

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);

    // Four thousand Unicode characters can occupy sixteen thousand UTF-8
    // bytes. Bound both the semantic field and the transport envelope.
    const parsed = launchSchema.safeParse(await readBoundedJson(request, 20 * 1024));
    if (!parsed.success) {
      return invalidRequest("Provide a projectId and a templateKey.");
    }

    const context = await operationsContext();
    const forbidden = requireManager(context);
    if (forbidden) return forbidden;

    // The plan's monthly launch allowance. Checked before any compile work:
    // a refusal must cost nothing and name the number it enforced.
    const launchLimit = await checkGraphLaunch(context.client, context.activeOrganization.id);
    if (!launchLimit.allowed) {
      return jsonNoStore(
        {
          error: {
            code: launchLimit.code,
            message: launchLimit.message,
            plan: launchLimit.planKey,
            limit: launchLimit.limit,
            current: launchLimit.current,
          },
        },
        { status: 402 },
      );
    }

    // Built-in templates come from code; custom ones from the organization's
    // graph_templates rows, rebuilt through the same builder so both launch
    // through the identical compile path.
    let template: GraphTemplate | null = findTemplate(parsed.data.templateKey) ?? null;
    if (!template) {
      const { data: customRow, error: customError } = await context.client
        .from("graph_templates")
        .select("slug,name,description,definition,is_archived")
        .eq("organization_id", context.activeOrganization.id)
        .eq("slug", parsed.data.templateKey)
        .eq("is_archived", false)
        .maybeSingle();
      if (customError) return databaseErrorResponse(customError);
      if (customRow) {
        const input = parseStoredDefinition(
          customRow.slug,
          customRow.name,
          customRow.description ?? "",
          customRow.definition,
        );
        if (!input) {
          return invalidRequest(
            `The custom template \`${parsed.data.templateKey}\` has a stored definition this route cannot build.`,
          );
        }
        template = buildCustomTemplate(input);
      }
    }

    if (!template) {
      // Named rather than generic: a caller sending an unknown key has a typo
      // or a stale client, and "not found" alone distinguishes neither.
      return invalidRequest(
        `No graph template is registered under \`${parsed.data.templateKey}\`.`,
      );
    }

    // The ten-step release lifecycle begins with the person's actual goal.
    // Falling back to the template's summary would create a valid-looking
    // Requirement step that nobody requested. Non-release template callers
    // retain rolling compatibility.
    if (template.key === FULL_LIFECYCLE_TEMPLATE_KEY && parsed.data.goal === undefined) {
      return invalidRequest("Describe the concrete goal for this Full Lifecycle run.");
    }

    const goal = parsed.data.goal ?? template.summary;
    if (containsLikelySecret(goal)) {
      return invalidRequest("The graph goal cannot contain credentials or likely secret values.");
    }

    /*
     * The budget this template runs under, not the default.
     *
     * `budgetForTemplate` is the default with the template's own overrides
     * applied. Passing the bare default here would record a ninety-minute
     * ceiling for a graph that declared it needs a hundred and fifty — the
     * guard would pass, and production would stop the run as overspending.
     */
    const isReleaseLifecycle = template.key === FULL_LIFECYCLE_TEMPLATE_KEY;
    const built = isReleaseLifecycle
      ? buildCanonicalFullLifecyclePlan(goal)
      : buildLaunchPlan({ ...template, summary: goal }, budgetForTemplate(template));
    if (!built.ok) {
      const canonicalFailure = "code" in built ? built : null;
      // The compiler refused. That is a real answer about the template, not a
      // server fault, so it reaches the caller intact.
      return jsonNoStore(
        {
          error: {
            code: canonicalFailure?.code ?? "template_does_not_compile",
            message: canonicalFailure
              ? canonicalFailure.message
              : "The template could not be compiled into a graph.",
            details: canonicalFailure?.details ?? ("errors" in built ? built.errors : undefined),
          },
        },
        { status: canonicalFailure?.status ?? 422 },
      );
    }

    const plan = built.plan;

    let releaseTarget: z.infer<typeof phase1CTargetSchema> | null = null;
    let releaseBaseSha: string | null = null;
    let releaseRequiredChecks: readonly string[] | null = null;
    if (isReleaseLifecycle) {
      if (context.activeOrganization.role !== "owner") {
        return jsonNoStore(
          {
            error: {
              code: "owner_required",
              message: "Only the organization owner can launch a Full Lifecycle release graph.",
            },
          },
          { status: 403 },
        );
      }
      const release = await resolveCanonicalFullLifecycleReleaseIdentity(
        context.client,
        context.activeOrganization.id,
        parsed.data.projectId,
      );
      if (!release.ok) {
        if (release.databaseError) return databaseErrorResponse(release.databaseError);
        return jsonNoStore(
          { error: { code: release.code, message: release.message } },
          { status: release.status },
        );
      }
      releaseTarget = release.target;
      releaseBaseSha = release.baseSha;
      releaseRequiredChecks = release.requiredChecks;
    }

    const commonPlanArguments = {
      p_organization_id: context.activeOrganization.id,
      p_project_id: parsed.data.projectId,
      p_goal: plan.goal,
      p_topology: plan.topology,
      p_topology_reasons: plan.topologyReasons,
      p_risk_level: plan.riskLevel,
      p_requires_owner_approval: plan.requiresOwnerApproval,
      p_nodes: plan.nodes,
      p_edges: plan.edges,
      p_budget: plan.budget,
    };
    const { data, error } = isReleaseLifecycle && releaseTarget && releaseBaseSha && releaseRequiredChecks
      ? await createSupabaseGitHubWebhookClient().rpc("create_graph_from_plan_with_release_identity_as_server", {
        ...commonPlanArguments,
        p_requested_by: context.user.id,
        p_template_key: FULL_LIFECYCLE_TEMPLATE_KEY,
        p_template_version: FULL_LIFECYCLE_TEMPLATE_VERSION,
        p_github_repository_id: releaseTarget.repository_id,
        p_base_branch: releaseTarget.base_branch,
        p_base_sha: releaseBaseSha,
        p_required_check_names: releaseRequiredChecks,
      })
      : await context.client.rpc("create_graph_from_plan", commonPlanArguments);
    if (error) return databaseErrorResponse(error);

    /*
     * Best effort: wake the graph worker through the project's own verified
     * GitHub binding — the same wake the command routes fire. This route used
     * to record the graph and stop, which was honest but left the Launch
     * button planning work nothing would run: the scheduled drain is off by
     * default, so the owner's first full_lifecycle launch sat PLANNED until a
     * manual dispatch. The whole wake sits inside the try, binding lookup
     * included, so the launch's answer never depends on it — a wake that
     * cannot happen leaves the graph planned until a separately enabled exact
     * target dispatch, reported rather than hidden.
     */
    let workerWoken = false;
    try {
      let dispatchBinding = releaseTarget;
      if (!dispatchBinding) {
        const fallbackTarget = await context.client.rpc("resolve_phase1c_command_target", {
          p_organization_id: context.activeOrganization.id,
          p_project_id: parsed.data.projectId,
        }).single();
        const resolvedFallback = fallbackTarget.error
          ? null
          : phase1CTargetSchema.safeParse(fallbackTarget.data);
        dispatchBinding = resolvedFallback?.success ? resolvedFallback.data : null;
      }
      if (dispatchBinding?.repository_full_name) {
        const dispatchResult = await dispatchGraphWorker(
          {
            appId: dispatchBinding.app_id,
            externalInstallationId: dispatchBinding.external_installation_id,
            externalRepositoryId: dispatchBinding.external_repository_id,
            repositoryFullName: dispatchBinding.repository_full_name,
          },
          String(data),
        );
        workerWoken = dispatchResult.dispatched;
      }
    } catch {
      workerWoken = false;
    }

    return jsonNoStore({
      graphId: data,
      template: { key: template.key, name: template.name, version: template.version },
      topology: plan.topology,
      nodeCount: plan.nodes.length,
      edgeCount: plan.edges.length,
      maxParallelism: plan.compiled.maxParallelism,
      requiresOwnerApproval: plan.requiresOwnerApproval,
      releaseIdentity: isReleaseLifecycle && releaseTarget && releaseBaseSha
        ? {
          baseBranch: releaseTarget.base_branch,
          baseSha: releaseBaseSha,
          repository: releaseTarget.repository_full_name,
        }
        : null,
      // Said plainly, because a created graph looks like a started one to anyone
      // who does not know the difference.
      state: "PLANNED",
      workerWoken,
      note: workerWoken
        ? "The graph is recorded and the executor worker has been woken to claim it."
        : "The graph is recorded, but the executor is Not Connected or its verified "
          + "GitHub binding could not dispatch. It stays planned; manual and scheduled "
          + "events cannot bypass the global worker gate.",
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof GitHubApiError || error instanceof GitHubConfigurationError) {
      return githubRouteErrorResponse(error);
    }
    return operationsFailure(error, "graph_launch_failed", "The graph could not be created.");
  }
}
