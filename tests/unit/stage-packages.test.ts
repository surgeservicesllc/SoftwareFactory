import { describe, expect, it } from "vitest";

import { templateNodeContracts, GRAPH_TEMPLATES } from "@/lib/graph/templates";
import { validateNodeOutput } from "@/lib/graph/contracts";
import {
  DECISION_PATHS,
  EVALUATION_CRITERIA,
  decisionPackageSchema,
  discoveryPackageSchema,
  evaluationPackageSchema,
  weightedTotal,
  type ScoredCandidate,
} from "@/lib/graph/stage-packages";

/**
 * The typed packages DISCOVER, EVALUATE and DECIDE hand forward.
 *
 * Two properties carry the honesty rules: a candidate that only exists in the
 * model's memory can never claim repository verification, and a decision that
 * skipped one of the five paths is not a decision. Both are contract
 * violations rather than style preferences, which is what routes a bad answer
 * into a retry instead of downstream.
 */

const candidate = {
  name: "freqtrade",
  summary: "Crypto trading bot with backtesting and optimization.",
  source: "MODEL_KNOWLEDGE" as const,
  evidence: "model recollection",
  verification: "UNVERIFIED" as const,
  matchScore: 92,
  strengths: ["Complete framework", "Active development"],
  limitations: ["GPL license", "Steeper learning curve"],
};

const scores: ScoredCandidate["scores"] = {
  licenseLegal: 8,
  securitySafety: 8,
  maintenanceActivity: 9,
  featureCompleteness: 9,
  performanceScalability: 8,
  documentation: 7,
  communityEcosystem: 8,
  easeOfIntegration: 7,
  reliabilityTesting: 6,
  codeQuality: 8,
};

describe("the discovery package", () => {
  it("accepts a shortlist whose candidates say how they are known", () => {
    const parsed = discoveryPackageSchema.safeParse({
      schemaVersion: 1,
      searchAreas: ["backtesting engines", "strategy execution"],
      candidates: [
        candidate,
        {
          ...candidate,
          name: "lib/graph/discovery.ts",
          source: "REPOSITORY",
          evidence: "lib/graph/discovery.ts",
          verification: "VERIFIED_IN_REPO",
        },
      ],
      keyFindings: ["Strong existing engine-side discovery module."],
      recommendedNextSteps: ["Evaluate the top three in detail."],
    });
    expect(parsed.success, parsed.success ? "" : parsed.error.message).toBe(true);
  });

  it("refuses a recalled candidate that claims repository verification", () => {
    const parsed = discoveryPackageSchema.safeParse({
      schemaVersion: 1,
      candidates: [{ ...candidate, verification: "VERIFIED_IN_REPO" }],
    });
    expect(parsed.success).toBe(false);
  });

  it("carries no popularity fields to fake", () => {
    // The executor has no network. A stars count in the schema would be an
    // invitation to recall one and present it as a reading.
    const parsed = discoveryPackageSchema.safeParse({
      schemaVersion: 1,
      candidates: [{ ...candidate, stars: 20_900 }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("the evaluation package", () => {
  const evaluation = {
    schemaVersion: 1,
    candidates: [
      {
        name: "freqtrade",
        scores,
        riskLevel: "LOW" as const,
        recommendation: "STRONGLY_CONSIDER" as const,
        redFlags: [],
        rationale: "Best balance of features, maintenance and community.",
      },
    ],
    ranking: ["freqtrade"],
    topCandidate: {
      name: "freqtrade",
      strengths: ["Excellent backtesting engine"],
      limitations: ["Steeper learning curve"],
    },
    recommendationSummary: "Freqtrade covers most needs out of the box.",
    assumptions: ["Scores based on training knowledge; live verification pending."],
  };

  it("accepts a scored comparison whose ranking covers exactly the candidates", () => {
    const parsed = evaluationPackageSchema.safeParse(evaluation);
    expect(parsed.success, parsed.success ? "" : parsed.error.message).toBe(true);
  });

  it("refuses a ranking that names a candidate nobody scored", () => {
    expect(
      evaluationPackageSchema.safeParse({ ...evaluation, ranking: ["jesse"] }).success,
    ).toBe(false);
  });

  it("computes the weighted total from the rubric instead of trusting one", () => {
    // 8 + 12 + 13.5 + 13.5 + 8 + 7 + 8 + 3.5 + 3 + 4
    expect(weightedTotal({ scores })).toBe(80.5);
    // The rubric itself must stay a 100-point scale.
    expect(Object.values(EVALUATION_CRITERIA).reduce((sum, weight) => sum + weight, 0)).toBe(100);
  });
});

describe("the decision package", () => {
  const weighed = (path: (typeof DECISION_PATHS)[number], score: number) => ({
    path,
    score,
    pros: ["Named advantage"],
    cons: ["Named cost"],
    fitNotes: "Fit against the constraints.",
  });

  const decision = {
    schemaVersion: 1,
    paths: [
      weighed("USE", 82),
      weighed("CONNECT", 74),
      weighed("ADAPT", 71),
      weighed("FORK", 58),
      weighed("BUILD", 42),
    ],
    chosenPath: "USE" as const,
    subject: "freqtrade",
    rationale: ["Fastest time to value while meeting the requirements."],
    executionPlan: [{ step: "Install and stand up", detail: "Self-hosted deployment." }],
    integrationBoundaries: {
      weOwn: ["Frontend", "Auth"],
      counterpartOwns: ["Trading engine", "Backtesting"],
    },
    risks: [{ risk: "GPL-3.0 license", mitigation: "Keep as separate service." }],
  };

  it("accepts a decision that weighed all five paths and chose one of them", () => {
    const parsed = decisionPackageSchema.safeParse(decision);
    expect(parsed.success, parsed.success ? "" : parsed.error.message).toBe(true);
  });

  it("refuses a decision that weighed a path twice and skipped another", () => {
    expect(
      decisionPackageSchema.safeParse({
        ...decision,
        paths: [...decision.paths.slice(0, 4), weighed("USE", 10)],
      }).success,
    ).toBe(false);
  });

  it("refuses a chosen path that was never weighed", () => {
    expect(
      decisionPackageSchema.safeParse({
        ...decision,
        paths: decision.paths.filter((entry) => entry.path !== "USE"),
      }).success,
    ).toBe(false);
  });
});

describe("the scout template's contracts", () => {
  const scout = GRAPH_TEMPLATES.find((template) => template.key === "open_source_scout")!;
  const contracts = templateNodeContracts(scout);

  it("routes prose from a discovery node into a violation, not downstream", () => {
    const consolidate = contracts.find((contract) => contract.nodeId === "consolidate")!;
    const outcome = validateNodeOutput(consolidate, "I looked around and found some things.");
    expect(outcome.valid).toBe(false);
    if (!outcome.valid) expect(outcome.code).toBe("PROSE_WHERE_STRUCTURE_REQUIRED");
  });

  it("accepts a real package at the same node", () => {
    const consolidate = contracts.find((contract) => contract.nodeId === "consolidate")!;
    const outcome = validateNodeOutput(consolidate, {
      schemaVersion: 1,
      searchAreas: ["backtesting"],
      candidates: [candidate],
      keyFindings: ["One strong candidate."],
      recommendedNextSteps: ["Evaluate it."],
    });
    expect(outcome.valid, outcome.valid ? "" : outcome.message).toBe(true);
  });

  it("tolerates a partial fan-in only at the consolidation", () => {
    // One failed scan must not lose the surviving two; every other node
    // still genuinely needs its inputs.
    for (const contract of contracts) {
      expect(
        contract.toleratesPartialInputs ?? false,
        contract.nodeId,
      ).toBe(contract.nodeId === "consolidate");
    }
  });
});
