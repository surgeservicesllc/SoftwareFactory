import { z } from "zod";

import { DEFAULT_GRAPH_BUDGET } from "@/lib/graph/budgets";
import { buildCustomTemplate, parseStoredDefinition } from "@/lib/graph/custom-templates";
import { buildLaunchPlan } from "@/lib/graph/launch-plan";
import { findTemplate, type GraphTemplate } from "@/lib/graph/templates";
import {
  invalidRequest,
  operationsContext,
  operationsFailure,
  requireManager,
} from "@/lib/operations/route";
import { databaseErrorResponse, jsonNoStore, readBoundedJson } from "@/lib/server/http";
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
  })
  .strict();

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);

    const parsed = launchSchema.safeParse(await readBoundedJson(request, 4 * 1024));
    if (!parsed.success) {
      return invalidRequest("Provide a projectId and a templateKey.");
    }

    const context = await operationsContext();
    const forbidden = requireManager(context);
    if (forbidden) return forbidden;

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

    const built = buildLaunchPlan(template, DEFAULT_GRAPH_BUDGET);
    if (!built.ok) {
      // The compiler refused. That is a real answer about the template, not a
      // server fault, so it reaches the caller intact.
      return jsonNoStore(
        {
          error: {
            code: "template_does_not_compile",
            message: "The template could not be compiled into a graph.",
            details: built.errors,
          },
        },
        { status: 422 },
      );
    }

    const plan = built.plan;

    const { data, error } = await context.client.rpc("create_graph_from_plan", {
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
    });
    if (error) return databaseErrorResponse(error);

    return jsonNoStore({
      graphId: data,
      template: { key: template.key, name: template.name, version: template.version },
      topology: plan.topology,
      nodeCount: plan.nodes.length,
      edgeCount: plan.edges.length,
      maxParallelism: plan.compiled.maxParallelism,
      requiresOwnerApproval: plan.requiresOwnerApproval,
      // Said plainly, because a created graph looks like a started one to anyone
      // who does not know the difference.
      state: "PLANNED",
      note: "The graph is recorded. No node has been dispatched yet: the graph "
        + "executor worker claims recorded graphs when it runs, and until a "
        + "dispatch with the subscription credential picks this one up it stays planned.",
    });
  } catch (error) {
    return operationsFailure(error, "graph_launch_failed", "The graph could not be created.");
  }
}
