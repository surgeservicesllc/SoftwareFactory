// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { FROZEN_POLICIES } from "@/lib/graph/frozen";
import {
  assertImprovementRespectsConstitution,
  FROZEN_CONSTITUTION_VERSION,
  frozenPolicyFingerprint,
  type ImprovementProposalEffects,
} from "@/lib/improvement/constitution";

/** A proposal that satisfies everything, so each test varies one thing. */
function proposal(
  overrides: Partial<ImprovementProposalEffects> = {},
): ImprovementProposalEffects {
  return {
    changedPaths: ["lib/server/http.ts"],
    claimedBenefitMetric: null,
    classifiedRisk: "GREEN",
    emergencyStopActive: false,
    gatesSatisfied: ["lint", "typecheck", "tests", "build", "review"],
    headBranch: "factory/20260815-abc123",
    implementedBy: "worker-1",
    ownerApproved: false,
    requiredGates: ["lint", "typecheck", "tests", "build", "review"],
    reviewedBy: "reviewer-1",
    selfImprovementEnabled: true,
    ...overrides,
  };
}

function codes(effects: ImprovementProposalEffects) {
  return assertImprovementRespectsConstitution(effects).violations.map((v) => v.code);
}

describe("frozen constitution", () => {
  it("allows an ordinary reviewed GREEN improvement on an isolated branch", () => {
    const verdict = assertImprovementRespectsConstitution(proposal());

    expect(verdict.allowed).toBe(true);
    expect(verdict.violations).toEqual([]);
    expect(verdict.constitutionVersion).toBe(FROZEN_CONSTITUTION_VERSION);
  });

  it("refuses a proposal that edits the rules constraining it", () => {
    for (const path of [
      "lib/graph/frozen.ts",
      "lib/improvement/constitution.ts",
      "lib/autonomy/approval.ts",
      "lib/autonomy/diff-risk.ts",
      "policies/RISK_CLASSIFICATION.md",
    ]) {
      expect(codes(proposal({ changedPaths: [path] }))).toContain("EDITS_FROZEN_POLICY");
    }
  });

  it("refuses to let a proposal improve the measurement and claim the number", () => {
    // The Goodhart trap: leave every policy intact, change what the score
    // counts, and report a better score.
    const gaming = proposal({
      changedPaths: ["lib/improvement/metrics.ts"],
      claimedBenefitMetric: "factory_health_score",
    });
    expect(codes(gaming)).toContain("EDITS_OWN_MEASUREMENT");

    // Changing measurement is legitimate on its own — it just cannot be the
    // same change that banks the benefit.
    const honest = proposal({
      changedPaths: ["lib/improvement/metrics.ts"],
      claimedBenefitMetric: null,
    });
    expect(codes(honest)).not.toContain("EDITS_OWN_MEASUREMENT");
  });

  it("requires owner approval for a RED proposal and cannot be talked out of it", () => {
    expect(codes(proposal({ classifiedRisk: "RED" }))).toContain(
      "WEAKENS_RISK_CLASSIFICATION",
    );
    expect(
      codes(proposal({ classifiedRisk: "RED", ownerApproved: true })),
    ).not.toContain("WEAKENS_RISK_CLASSIFICATION");
  });

  it("refuses self-review, including when the reviewer is simply absent", () => {
    expect(codes(proposal({ implementedBy: "w1", reviewedBy: "w1" }))).toContain(
      "SELF_APPROVES",
    );
    expect(codes(proposal({ reviewedBy: null }))).toContain("SELF_APPROVES");
  });

  it("refuses any branch that is not an isolated factory branch", () => {
    for (const branch of ["main", "master", "feature/x", "factorylike/y"]) {
      expect(codes(proposal({ headBranch: branch }))).toContain(
        "WRITES_OUTSIDE_ISOLATED_BRANCH",
      );
    }
    for (const branch of ["factory/a", "softwarefactory/b"]) {
      expect(codes(proposal({ headBranch: branch }))).not.toContain(
        "WRITES_OUTSIDE_ISOLATED_BRANCH",
      );
    }
  });

  it("treats a missing gate as a blocker rather than a pass", () => {
    const verdict = assertImprovementRespectsConstitution(
      proposal({ gatesSatisfied: ["lint", "typecheck"] }),
    );

    expect(verdict.allowed).toBe(false);
    const violation = verdict.violations.find((v) => v.code === "SKIPS_MANDATORY_GATE");
    expect(violation?.detail).toContain("tests");
    expect(violation?.detail).toContain("review");
  });

  it("stops completely when self-improvement is disabled or the emergency stop is active", () => {
    expect(codes(proposal({ selfImprovementEnabled: false }))).toContain(
      "SELF_IMPROVEMENT_DISABLED",
    );
    expect(codes(proposal({ emergencyStopActive: true }))).toContain(
      "EMERGENCY_STOP_ACTIVE",
    );
  });

  it("reports every violation at once rather than stopping at the first", () => {
    // A proposal fixing one refusal should not discover a new one each round.
    const verdict = assertImprovementRespectsConstitution(
      proposal({
        changedPaths: ["lib/graph/frozen.ts"],
        classifiedRisk: "RED",
        headBranch: "main",
        implementedBy: "w1",
        reviewedBy: "w1",
      }),
    );

    expect(verdict.allowed).toBe(false);
    expect(verdict.violations.length).toBeGreaterThanOrEqual(4);
  });

  it("records the version and a fingerprint of the frozen set on every verdict", () => {
    const verdict = assertImprovementRespectsConstitution(proposal());

    // So a later audit can ask whether a proposal was judged under today's
    // rules or weaker ones.
    expect(verdict.policyFingerprint).toBe(frozenPolicyFingerprint());
    expect(verdict.policyFingerprint).toContain("NO_SELF_APPROVAL");
    expect(verdict.policyFingerprint.split("|")).toHaveLength(FROZEN_POLICIES.length);
  });

  it("imports the frozen list rather than restating it", () => {
    // Two lists would eventually disagree about what is frozen, and the
    // disagreement would favour whichever one the caller happened to consult.
    expect(frozenPolicyFingerprint()).toBe([...FROZEN_POLICIES].sort().join("|"));
  });
});
