import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { buildLaunchPlan } from "@/lib/graph/launch-plan";
import { budgetForTemplate, findTemplate } from "@/lib/graph/templates";
import { ANALYSIS_TEMPLATE_BY_COMMAND_TYPE } from "@/lib/orchestration/analysis-launch";
import { WORKER_SUPPORTED_EXECUTORS } from "@/lib/worker/executor-support";

/**
 * Every command type maps to a template the subscription graph worker can
 * actually drain. A template with an executor outside the worker's declared
 * support would be created and then never claimed — planned forever — which
 * is exactly the untruthful "waiting for a worker" state this feature
 * removes.
 */
describe("the analysis template map", () => {
  const commandTypes = [
    "fix_bug", "build_feature", "audit", "test",
    "mobile", "security", "performance", "other",
  ] as const;

  it("covers every command type the composer can submit", () => {
    for (const commandType of commandTypes) {
      expect(ANALYSIS_TEMPLATE_BY_COMMAND_TYPE[commandType], commandType).toBeTruthy();
    }
  });

  it("maps only to registered templates that compile with worker-supported executors", () => {
    const supported = new Set<string>(WORKER_SUPPORTED_EXECUTORS);
    for (const [commandType, templateKey] of Object.entries(ANALYSIS_TEMPLATE_BY_COMMAND_TYPE)) {
      const template = findTemplate(templateKey);
      expect(template, `${commandType} -> ${templateKey}`).not.toBeNull();
      const built = buildLaunchPlan(template!, budgetForTemplate(template!));
      expect(built.ok, `${templateKey} must compile`).toBe(true);
      if (!built.ok) continue;
      for (const node of built.plan.nodes) {
        const executor = (node as { executor?: string }).executor;
        expect(
          executor !== undefined && supported.has(executor),
          `${templateKey} node executor ${String(executor)} must be one of ${[...supported].join(", ")}`,
        ).toBe(true);
      }
    }
  });

  /**
   * The hosted-apply scope `analysis-launch-commit` feeds this checked-in
   * fixture to launch_command_analysis_graph when the browser doorway cannot
   * be observed. The fixture must therefore be byte-for-byte what the code
   * would send today; regenerate with
   * `npx tsx scripts/emit-analysis-plan.mts other supabase/fixtures/production_readiness.launch-plan.json`
   * whenever the template or compiler changes.
   */
  it("keeps the checked-in production_readiness launch fixture identical to a fresh compile", () => {
    const fixture = JSON.parse(readFileSync(
      resolve(import.meta.dirname, "../../supabase/fixtures/production_readiness.launch-plan.json"),
      "utf8",
    )) as Record<string, unknown>;
    const template = findTemplate("production_readiness");
    expect(template).not.toBeNull();
    const built = buildLaunchPlan(template!, budgetForTemplate(template!));
    expect(built.ok).toBe(true);
    if (!built.ok) return;
    expect(fixture).toEqual({
      topology: built.plan.topology,
      topologyReasons: built.plan.topologyReasons,
      riskLevel: built.plan.riskLevel,
      requiresOwnerApproval: built.plan.requiresOwnerApproval,
      nodes: built.plan.nodes,
      edges: built.plan.edges,
      budget: built.plan.budget,
    });
  });
});
