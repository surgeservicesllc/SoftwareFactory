import { writeFileSync } from "node:fs";

import { buildLaunchPlan } from "@/lib/graph/launch-plan";
import { budgetForTemplate, findTemplate } from "@/lib/graph/templates";
import { ANALYSIS_TEMPLATE_BY_COMMAND_TYPE } from "@/lib/orchestration/analysis-launch";

/**
 * Emits the exact launch plan the Run analysis doorway sends for one command
 * type, as JSON, so a hosted-apply scope can commit the identical launch when
 * the browser path cannot be observed. The fixture this writes is pinned by
 * tests/unit/analysis-launch.test.ts against a fresh compile, so it cannot
 * drift from the code that normally builds it.
 *
 * Usage: npx tsx scripts/emit-analysis-plan.mts <command_type> <out_file>
 */

const commandType = process.argv[2]?.trim();
const outFile = process.argv[3]?.trim();
if (!commandType || !outFile) {
  throw new Error("Usage: tsx scripts/emit-analysis-plan.mts <command_type> <out_file>");
}
const templateKey = ANALYSIS_TEMPLATE_BY_COMMAND_TYPE[commandType];
if (!templateKey) throw new Error(`No analysis template maps command type \`${commandType}\`.`);
const template = findTemplate(templateKey);
if (!template) throw new Error(`The analysis template \`${templateKey}\` is not registered.`);
const built = buildLaunchPlan(template, budgetForTemplate(template));
if (!built.ok) throw new Error(`The template \`${templateKey}\` did not compile.`);

// Exactly the fields launch_command_analysis_graph receives — the goal is
// deliberately absent because the database reads the command's own prompt.
const payload = {
  topology: built.plan.topology,
  topologyReasons: built.plan.topologyReasons,
  riskLevel: built.plan.riskLevel,
  requiresOwnerApproval: built.plan.requiresOwnerApproval,
  nodes: built.plan.nodes,
  edges: built.plan.edges,
  budget: built.plan.budget,
};
writeFileSync(outFile, `${JSON.stringify(payload, null, 2)}\n`);
process.stdout.write(
  `${templateKey}: topology ${built.plan.topology}, risk ${built.plan.riskLevel}, `
  + `requiresOwnerApproval ${String(built.plan.requiresOwnerApproval)}, `
  + `${built.plan.nodes.length} nodes, ${built.plan.edges.length} edges -> ${outFile}\n`,
);
