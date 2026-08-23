// @vitest-environment node

import { describe, expect, it } from "vitest";

import { findTemplate, templateNodeContracts } from "@/lib/graph/templates";
import {
  STAGE_ARTIFACT_SCHEMAS,
  STAGE_ARTIFACT_VERSION,
  stageArtifactSchema,
  validateStageArtifact,
} from "@/lib/sdlc/artifacts";
import { SDLC_LIFECYCLE, SDLC_STAGES, type SdlcStage } from "@/lib/sdlc/lifecycle";

const requirement = {
  version: STAGE_ARTIFACT_VERSION,
  stage: "REQUIREMENT" as const,
  objective: "Let a person start a run by describing what they want.",
  scope: { included: ["the intake form"], excluded: ["billing"] },
  constraints: ["no new provider credentials"],
  acceptanceCriteria: [
    { id: "AC-1", statement: "One sentence starts a lifecycle run.", verifiedBy: "e2e" },
  ],
  assumptions: ["the project already exists"],
  integrations: ["supabase"],
  dependencies: ["graph worker"],
  risks: [{ description: "a run with no agents connected", severity: "MEDIUM" as const }],
  successMetrics: ["a run reaches DISCOVER unaided"],
  priorities: ["intake before dashboards"],
};

describe("the stage artifact contracts", () => {
  it("covers all ten stages and nothing else", () => {
    expect(Object.keys(STAGE_ARTIFACT_SCHEMAS).sort()).toEqual([...SDLC_STAGES].sort());
  });

  it("makes every package name its own stage and version", () => {
    // Both literals matter for the same reason: these are stored in
    // graph_artifacts.payload and read back by a later run, so a package has to
    // be identifiable without the row that carried it.
    for (const stage of SDLC_STAGES) {
      const result = stageArtifactSchema(stage).safeParse({});
      expect(result.success, stage).toBe(false);
      const paths = result.success
        ? []
        : result.error.issues.map((issue) => issue.path.join("."));
      expect(paths, stage).toContain("version");
      expect(paths, stage).toContain("stage");
    }
  });

  it("accepts a complete requirement package", () => {
    expect(validateStageArtifact("REQUIREMENT", requirement)).toEqual({ valid: true, issues: [] });
  });

  it("reports where a package is wrong rather than only that it is", () => {
    const { valid, issues } = validateStageArtifact("REQUIREMENT", {
      ...requirement,
      acceptanceCriteria: [],
    });
    expect(valid).toBe(false);
    expect(issues.join(" ")).toContain("acceptanceCriteria");
  });

  it("refuses a requirement with no criterion anyone could check", () => {
    // The specific thing this stops: a REQUIREMENT package of pure intent,
    // which TEST could later be held against only by agreement.
    const { valid } = validateStageArtifact("REQUIREMENT", {
      ...requirement,
      acceptanceCriteria: [{ id: "AC-1", statement: "It should feel fast.", verifiedBy: "  " }],
    });
    expect(valid).toBe(false);
  });

  it("refuses a package claiming the wrong stage", () => {
    const { valid, issues } = validateStageArtifact("DISCOVER", requirement);
    expect(valid).toBe(false);
    expect(issues.join(" ")).toContain("stage");
  });

  it("lets a monitoring package say it does not yet know", () => {
    // A system live for four minutes has a real third answer, and collapsing it
    // into true or false manufactures a result either way.
    const monitoring = {
      version: STAGE_ARTIFACT_VERSION,
      stage: "MONITOR" as const,
      window: { from: "2026-08-23T00:00:00Z", to: "2026-08-23T00:04:00Z" },
      signals: [],
      incidents: [],
      acceptanceMet: null,
      followUps: [],
    };
    expect(validateStageArtifact("MONITOR", monitoring).valid).toBe(true);
  });

  it("lets a BUILD decision name no candidate, because building chooses none", () => {
    const decision = {
      version: STAGE_ARTIFACT_VERSION,
      stage: "DECIDE" as const,
      choice: "BUILD" as const,
      candidateId: null,
      evidence: ["no package covers the tenancy model"],
      tradeOffs: ["more code to maintain"],
      integrationBoundary: "lib/sdlc",
      risks: [],
      executionStrategy: "build behind the existing graph engine",
    };
    expect(validateStageArtifact("DECIDE", decision).valid).toBe(true);
  });

  it("requires a discovery package to say where it looked, not only what it found", () => {
    // "We found nothing" and "we did not look" produce the same empty
    // candidate list, and only the first is an answer.
    const schema = stageArtifactSchema("DISCOVER");
    expect(schema.safeParse({
      version: STAGE_ARTIFACT_VERSION,
      stage: "DISCOVER",
      candidates: [],
      excluded: [],
    }).success).toBe(false);
  });
});

describe("the lifecycle template's handoffs", () => {
  const template = findTemplate("agentic_sdlc");

  it("is the shipped lifecycle", () => {
    expect(template).toBeDefined();
    expect(template!.nodes.every((node) => node.lifecycleStage !== undefined)).toBe(true);
  });

  it("names exactly one package producer per stage, inside that stage", () => {
    const producers = new Map<SdlcStage, string[]>();
    for (const node of template!.nodes) {
      if (!node.producesStagePackage) continue;
      const stage = node.lifecycleStage!;
      producers.set(stage, [...(producers.get(stage) ?? []), node.nodeId]);
    }
    for (const stage of SDLC_STAGES) {
      expect(producers.get(stage), `${stage} has no package producer`).toHaveLength(1);
    }
  });

  it("holds each producer to its own stage's contract and not the generic one", () => {
    // The regression this guards: a producer whose output schema fell back to
    // the capability default would let a stage hand prose-shaped findings to a
    // consumer expecting scores, and nothing downstream would object until an
    // agent misread it.
    const contracts = new Map(
      templateNodeContracts(template!).map((contract) => [contract.nodeId, contract]),
    );
    for (const node of template!.nodes) {
      if (!node.producesStagePackage) continue;
      const contract = contracts.get(node.nodeId);
      expect(contract, node.nodeId).toBeDefined();
      expect(contract!.outputSchema, node.nodeId)
        .toBe(stageArtifactSchema(node.lifecycleStage!));
    }
  });

  it("leaves the non-terminal nodes on their capability's shape", () => {
    const contracts = new Map(
      templateNodeContracts(template!).map((contract) => [contract.nodeId, contract]),
    );
    const observer = contracts.get("discover_internal");
    expect(observer).toBeDefined();
    // An observer reports candidates; it does not assemble the package that
    // reduces them, and holding it to that contract would describe work it
    // does not do.
    expect(observer!.outputSchema).not.toBe(stageArtifactSchema("DISCOVER"));
  });

  it("names an artifact for every stage in the lifecycle table", () => {
    for (const definition of SDLC_LIFECYCLE) {
      expect(stageArtifactSchema(definition.stage), definition.stage).toBeDefined();
    }
  });
});
