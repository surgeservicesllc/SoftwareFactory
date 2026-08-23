import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { buildLaunchPlan } from "@/lib/graph/launch-plan";
import { budgetForTemplate, findTemplate } from "@/lib/graph/templates";

/**
 * The one analysis template each command type launches.
 *
 * Every value here compiles only to executors the subscription graph worker
 * declares (`WORKER_SUPPORTED_EXECUTORS`), so a launched graph is always
 * claimable. Lifecycle templates such as `agentic_sdlc` and `full_lifecycle`
 * are deliberately not in this table for a different reason: a record-only
 * command entitles its author to analysis of the request, not to a build
 * lifecycle — those launch from the Workflows page under its own authority.
 */
export const ANALYSIS_TEMPLATE_BY_COMMAND_TYPE: Readonly<Record<string, string>> = {
  audit: "production_readiness",
  build_feature: "code_review",
  fix_bug: "bug_sweep",
  mobile: "mobile_audit",
  other: "production_readiness",
  performance: "performance_audit",
  security: "security_audit",
  test: "test_coverage",
};

export type AnalysisLaunchOutcome =
  | Readonly<{ launched: true; graphId: string; templateKey: string }>
  | Readonly<{ launched: false; reason: string }>;

/**
 * Launch the analysis graph a record-only Claude command is entitled to.
 *
 * The database function owns every authority decision: it re-checks
 * membership, the command's record-only Claude identity, and the one-graph-
 * per-command idempotency, and it uses the command's stored prompt as the
 * goal regardless of what this process believes. A failure here never undoes
 * the recorded command — the record is already durable — so the outcome is
 * reported, not thrown.
 */
export async function launchCommandAnalysisGraph(
  client: SupabaseClient,
  input: Readonly<{
    organizationId: string;
    projectId: string;
    commandId: string;
    commandType: string;
  }>,
): Promise<AnalysisLaunchOutcome> {
  const templateKey = ANALYSIS_TEMPLATE_BY_COMMAND_TYPE[input.commandType];
  if (!templateKey) {
    return { launched: false, reason: `No analysis template maps command type \`${input.commandType}\`.` };
  }
  const template = findTemplate(templateKey);
  if (!template) {
    return { launched: false, reason: `The analysis template \`${templateKey}\` is not registered.` };
  }
  const built = buildLaunchPlan(template, budgetForTemplate(template));
  if (!built.ok) {
    return { launched: false, reason: "The analysis template could not be compiled into a graph." };
  }

  const { data, error } = await client.rpc("launch_command_analysis_graph", {
    p_organization_id: input.organizationId,
    p_project_id: input.projectId,
    p_command_id: input.commandId,
    p_topology: built.plan.topology,
    p_topology_reasons: built.plan.topologyReasons,
    p_risk_level: built.plan.riskLevel,
    p_requires_owner_approval: built.plan.requiresOwnerApproval,
    p_nodes: built.plan.nodes,
    p_edges: built.plan.edges,
    p_budget: built.plan.budget,
  });
  if (error) {
    // The database's refusal text is policy, not a secret; the caller shows it.
    return { launched: false, reason: error.message || "The analysis graph could not be launched." };
  }
  if (typeof data !== "string" || data.length === 0) {
    return { launched: false, reason: "The analysis graph launch returned no graph identity." };
  }
  return { launched: true, graphId: data, templateKey };
}
