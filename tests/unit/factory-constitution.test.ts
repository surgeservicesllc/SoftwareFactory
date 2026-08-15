import { describe, expect, it } from "vitest";

import {
  CONSTITUTION_SUBJECTS,
  CONSTITUTION_VERSION,
  FACTORY_POLICIES,
  FACTORY_POLICY_DETAIL,
  checkIntentAgainstConstitution,
  type SubjectIntent,
} from "@/lib/factory/constitution";
import { FROZEN_POLICIES } from "@/lib/graph/frozen";

/**
 * Phase 3 goals 30 and 31: the constitution is versioned, judges every actor
 * including the self-improvement proposal, and cannot be modified by any
 * subject to improve its own score. These are pins as much as tests — the
 * version, the policy list, and the subject list changing must be a reviewed
 * decision, not a drive-by edit.
 */

function compliantProposal(): SubjectIntent {
  return {
    subject: "self_improvement_proposal",
    declaredRisk: "YELLOW",
    classifiedRisk: "YELLOW",
    skipsOwnerApproval: false,
    writesOutsideDraftPr: false,
    disablesRls: false,
    verifierIsImplementer: false,
    emergencyStopActive: false,
    modifiesConstitution: false,
    addsPaidTokenDependency: false,
    editsRecordedEvidence: false,
  };
}

describe("the factory constitution", () => {
  it("is versioned, and every check names the version that judged it", () => {
    expect(CONSTITUTION_VERSION).toBe("factory-constitution-v1");
    const check = checkIntentAgainstConstitution(compliantProposal());
    expect(check.version).toBe("factory-constitution-v1");
    expect(check.subject).toBe("self_improvement_proposal");
    expect(check.allowed).toBe(true);
  });

  it("contains every graph frozen policy plus the three factory-level rules", () => {
    for (const policy of FROZEN_POLICIES) {
      expect(FACTORY_POLICIES).toContain(policy);
    }
    expect(FACTORY_POLICIES).toContain("NO_PAID_TOKEN_DEPENDENCY");
    expect(FACTORY_POLICIES).toContain("APPEND_ONLY_EVIDENCE");
    expect(FACTORY_POLICIES).toContain("CONSTITUTION_IMMUTABLE_TO_SUBJECTS");
    // Every policy explains itself.
    for (const policy of FACTORY_POLICIES) {
      expect(FACTORY_POLICY_DETAIL[policy].length).toBeGreaterThan(20);
    }
  });

  it("judges the self-improvement proposal as a first-class subject", () => {
    expect(CONSTITUTION_SUBJECTS).toContain("self_improvement_proposal");
    expect(CONSTITUTION_SUBJECTS).toContain("graph_plan");
  });

  it("refuses any subject that would modify the constitution judging it", () => {
    for (const subject of CONSTITUTION_SUBJECTS) {
      const check = checkIntentAgainstConstitution({
        ...compliantProposal(),
        subject,
        modifiesConstitution: true,
      });
      expect(check.allowed).toBe(false);
      expect(check.violations.map((violation) => violation.policy)).toContain(
        "CONSTITUTION_IMMUTABLE_TO_SUBJECTS",
      );
    }
  });

  it("refuses a proposal that adds a paid-token dependency, whatever it predicts", () => {
    const check = checkIntentAgainstConstitution({
      ...compliantProposal(),
      addsPaidTokenDependency: true,
    });
    expect(check.allowed).toBe(false);
    expect(check.violations.map((violation) => violation.policy)).toContain(
      "NO_PAID_TOKEN_DEPENDENCY",
    );
  });

  it("refuses a proposal that edits recorded evidence", () => {
    const check = checkIntentAgainstConstitution({
      ...compliantProposal(),
      editsRecordedEvidence: true,
    });
    expect(check.allowed).toBe(false);
    expect(check.violations.map((violation) => violation.policy)).toContain(
      "APPEND_ONLY_EVIDENCE",
    );
  });

  it("keeps the inherited plan rules: risk lowering, self-approval, RLS, draft-PR, stop", () => {
    const lowered = checkIntentAgainstConstitution({
      ...compliantProposal(),
      declaredRisk: "GREEN",
      classifiedRisk: "RED",
    });
    expect(lowered.allowed).toBe(false);

    const selfVerified = checkIntentAgainstConstitution({
      ...compliantProposal(),
      verifierIsImplementer: true,
    });
    expect(selfVerified.violations.map((violation) => violation.policy)).toContain(
      "NO_SELF_APPROVAL",
    );

    const stopped = checkIntentAgainstConstitution({
      ...compliantProposal(),
      emergencyStopActive: true,
    });
    expect(stopped.allowed).toBe(false);
    expect(stopped.violations.map((violation) => violation.policy)).toContain("EMERGENCY_STOP");
  });
});
