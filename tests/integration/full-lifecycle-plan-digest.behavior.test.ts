// @vitest-environment node

import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { describe, expect, it } from "vitest";

import { DEFAULT_GRAPH_BUDGET } from "@/lib/graph/budgets";
import { buildLaunchPlan } from "@/lib/graph/launch-plan";
import {
  FULL_LIFECYCLE_V2_POSTDEPLOY_PLAN_SHA256,
  FULL_LIFECYCLE_V2_PRE_TYPED_INPUT_PLAN_SHA256,
  budgetForTemplate,
  findTemplate,
} from "@/lib/graph/templates";

async function postgresJsonbDigest(value: unknown): Promise<string> {
  const db = new PGlite({ extensions: { pgcrypto } });
  try {
    const result = await db.query<{ digest: string }>(
      "select encode(sha256(convert_to($1::jsonb::text, 'UTF8')), 'hex') as digest",
      [JSON.stringify(value)],
    );
    return result.rows[0].digest;
  } finally {
    await db.close();
  }
}

describe("Full Lifecycle v2 canonical plan identity", () => {
  it("keeps the typed and immediately preceding JSON-schema digests byte-stable", async () => {
    const template = findTemplate("full_lifecycle");
    if (!template) throw new Error("full_lifecycle template is missing");

    const built = buildLaunchPlan(
      template,
      budgetForTemplate(template, DEFAULT_GRAPH_BUDGET),
    );
    if (!built.ok) throw new Error(built.errors.join("; "));

    const canonicalPlan = {
      topology: built.plan.topology,
      topologyReasons: built.plan.topologyReasons,
      riskLevel: built.plan.riskLevel,
      requiresOwnerApproval: built.plan.requiresOwnerApproval,
      nodes: built.plan.nodes,
      edges: built.plan.edges,
      budget: built.plan.budget,
    };
    expect(await postgresJsonbDigest(canonicalPlan)).toBe(
      FULL_LIFECYCLE_V2_POSTDEPLOY_PLAN_SHA256,
    );

    const priorNodes = JSON.parse(JSON.stringify(built.plan.nodes)) as Array<{
      input_schema: Record<string, unknown>;
      node_key: string;
    }>;
    for (const node of priorNodes) {
      if (node.node_key !== "goal") {
        node.input_schema = {
          $schema: "https://json-schema.org/draft/2020-12/schema",
        };
      }
    }

    expect(await postgresJsonbDigest({ ...canonicalPlan, nodes: priorNodes })).toBe(
      FULL_LIFECYCLE_V2_PRE_TYPED_INPUT_PLAN_SHA256,
    );
  });
});
