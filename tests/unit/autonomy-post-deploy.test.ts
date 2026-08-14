import { describe, expect, it } from "vitest";

import {
  MAXIMUM_EVIDENCE_AGE_MS,
  VALIDATION_STAGES,
  describeValidation,
  evaluatePostDeployValidation,
  type DeploymentIdentity,
  type ValidationCheck,
  type ValidationEvidence,
} from "@/lib/autonomy/post-deploy";

const NOW = new Date("2026-08-14T00:00:00.000Z");
const COMPLETED = "2026-08-13T23:30:00.000Z";

const deployment: DeploymentIdentity = Object.freeze({
  projectId: "project-1",
  environment: "production",
  provider: "vercel",
  deploymentId: "dpl_1",
  commitSha: "abc123",
  url: "https://example.test",
  ready: true,
});

/** One passing required check per stage, so the happy path is reachable. */
function allStagesPass(): ValidationCheck[] {
  return VALIDATION_STAGES.map((stage) => ({
    stage,
    name: `${stage} check`,
    required: true,
    result: "pass" as const,
  }));
}

function evidence(overrides: Partial<ValidationEvidence> = {}): ValidationEvidence {
  return {
    projectId: deployment.projectId,
    environment: deployment.environment,
    provider: deployment.provider,
    deploymentId: deployment.deploymentId,
    commitSha: deployment.commitSha,
    url: deployment.url,
    startedAt: "2026-08-13T23:00:00.000Z",
    completedAt: COMPLETED,
    correlationId: "corr-1",
    validatorVersion: "validator@1",
    policyVersion: "post-deploy@1",
    baselineReference: "baseline-1",
    checks: allStagesPass(),
    observationWindowComplete: true,
    ...overrides,
  };
}

const evaluate = (
  overrides: Partial<ValidationEvidence> | null = {},
  deploymentOverrides: Partial<DeploymentIdentity> = {},
) =>
  evaluatePostDeployValidation({
    deployment: { ...deployment, ...deploymentOverrides },
    evidence: overrides === null ? null : evidence(overrides),
    now: NOW,
  });

describe("the only path to passed", () => {
  it("passes when every required check passed against matching, fresh evidence", () => {
    const result = evaluate();

    expect(result.outcome).toBe("passed");
    expect(result.findings).toEqual([]);
    expect(result.freezeAutomation).toBe(false);
    expect(result.ownerAttentionRequired).toBe(false);
    expect(result.openIncident).toBe(false);
  });

  it("records which deployment the decision was about", () => {
    expect(evaluate().evaluatedDeploymentId).toBe("dpl_1");
  });
});

describe("missing, stale, or mismatched evidence is inconclusive, never passed", () => {
  it("is inconclusive when nothing validated the deployment at all", () => {
    const result = evaluate(null);

    expect(result.outcome).toBe("inconclusive");
    expect(result.findings).toContain("NO_EVIDENCE");
  });

  it.each([
    ["deploymentId", { deploymentId: "dpl_other" }, "DEPLOYMENT_MISMATCH"],
    ["projectId", { projectId: "project-other" }, "DEPLOYMENT_MISMATCH"],
    ["environment", { environment: "preview" as const }, "DEPLOYMENT_MISMATCH"],
    ["provider", { provider: "netlify" }, "DEPLOYMENT_MISMATCH"],
    ["commitSha", { commitSha: "def456" }, "COMMIT_MISMATCH"],
  ])("is inconclusive when the evidence's %s does not match", (_field, override, finding) => {
    const result = evaluate(override);

    expect(result.outcome).toBe("inconclusive");
    expect(result.findings).toContain(finding);
  });

  it("is inconclusive when validation has not finished", () => {
    const result = evaluate({ completedAt: null });

    expect(result.outcome).toBe("inconclusive");
    expect(result.findings).toContain("VALIDATION_INCOMPLETE");
  });

  it("is inconclusive when the evidence is older than the staleness bound", () => {
    const stale = new Date(NOW.getTime() - MAXIMUM_EVIDENCE_AGE_MS - 1000).toISOString();
    const result = evaluate({ completedAt: stale });

    expect(result.outcome).toBe("inconclusive");
    expect(result.findings).toContain("EVIDENCE_STALE");
  });

  it("treats an unparseable timestamp as stale rather than as fresh", () => {
    expect(evaluate({ completedAt: "not a date" }).findings).toContain("EVIDENCE_STALE");
  });

  it("is inconclusive when the provider does not report the deployment ready", () => {
    const result = evaluate({}, { ready: false });

    expect(result.outcome).toBe("inconclusive");
    expect(result.findings).toContain("DEPLOYMENT_NOT_READY");
  });

  it.each([
    "correlationId",
    "validatorVersion",
    "policyVersion",
    "url",
    "startedAt",
  ] as const)("is inconclusive when the record is missing %s", (field) => {
    const result = evaluate({ [field]: "  " });

    expect(result.outcome).toBe("inconclusive");
    expect(result.findings).toContain("EVIDENCE_INCOMPLETE");
  });
});

describe("attribution comes before anything the record claims", () => {
  it("does not report a failure it cannot attribute to this deployment", () => {
    // The record is for another deployment *and* says a check failed. Reporting
    // "failed" would blame this deployment for another one's result.
    const result = evaluate({
      deploymentId: "dpl_other",
      checks: [
        { stage: "availability", name: "health", required: true, result: "fail" },
      ],
    });

    expect(result.outcome).toBe("inconclusive");
    expect(result.findings).toContain("DEPLOYMENT_MISMATCH");
    expect(result.findings).not.toContain("REQUIRED_CHECK_FAILED");
  });

  it("does not pass a mismatched record that says everything passed", () => {
    expect(evaluate({ commitSha: "def456" }).outcome).not.toBe("passed");
  });
});

describe("failed", () => {
  it("fails when a required check breached policy", () => {
    const checks = allStagesPass();
    checks[1] = { ...checks[1], result: "fail", detail: "health endpoint 503" };
    const result = evaluate({ checks });

    expect(result.outcome).toBe("failed");
    expect(result.findings).toContain("REQUIRED_CHECK_FAILED");
  });

  it("opens an incident and sends the rollback question elsewhere", () => {
    const checks = allStagesPass();
    checks[1] = { ...checks[1], result: "fail" };
    const result = evaluate({ checks });

    expect(result.openIncident).toBe(true);
    expect(result.rollbackEligibilityMustBeReevaluated).toBe(true);
    expect(result.ownerAttentionRequired).toBe(true);
  });

  it("reports a failure rather than an ambiguity when both are present", () => {
    // A definite breach is more actionable than an unknown alongside it.
    const checks = allStagesPass();
    checks[1] = { ...checks[1], result: "fail" };
    checks[2] = { ...checks[2], result: "unknown" };

    expect(evaluate({ checks }).outcome).toBe("failed");
  });

  it("ignores a check the policy does not require", () => {
    const result = evaluate({
      checks: [...allStagesPass(), { stage: "quality_security", name: "lighthouse", required: false, result: "fail" }],
    });

    expect(result.outcome).toBe("passed");
  });
});

describe("every required stage has to report", () => {
  it.each(VALIDATION_STAGES)("is inconclusive when the %s stage reported nothing", (stage) => {
    const result = evaluate({ checks: allStagesPass().filter((check) => check.stage !== stage) });

    expect(result.outcome).toBe("inconclusive");
    expect(result.findings).toContain("REQUIRED_STAGE_MISSING");
  });

  it("is inconclusive when a required check could not be determined", () => {
    const checks = allStagesPass();
    checks[3] = { ...checks[3], result: "unknown" };
    const result = evaluate({ checks });

    expect(result.outcome).toBe("inconclusive");
    expect(result.findings).toContain("REQUIRED_CHECK_UNKNOWN");
  });

  it("is inconclusive when the observation window has not completed", () => {
    const result = evaluate({ observationWindowComplete: false });

    expect(result.outcome).toBe("inconclusive");
    expect(result.findings).toContain("OBSERVATION_WINDOW_INCOMPLETE");
  });

  it("does not infer a completed observation window from its absence", () => {
    expect(evaluate({ observationWindowComplete: undefined }).outcome).toBe("inconclusive");
  });
});

describe("cancelled", () => {
  it("reports cancellation rather than judging the checks", () => {
    const result = evaluate({ cancelledBy: "owner-1", cancelledReason: "kill switch" });

    expect(result.outcome).toBe("cancelled");
    expect(result.findings).toContain("CANCELLED_BY_OWNER");
  });

  it("is not a pass, and asks for an owner", () => {
    const result = evaluate({ cancelledBy: "owner-1" });

    expect(result.ownerAttentionRequired).toBe(true);
    expect(result.openIncident).toBe(false);
  });
});

describe("what each outcome authorizes", () => {
  it("freezes automation only when the evidence is inconclusive", () => {
    expect(evaluate(null).freezeAutomation).toBe(true);
    expect(evaluate().freezeAutomation).toBe(false);
  });

  it("never authorizes a rollback, only a re-evaluation of one", () => {
    const checks = allStagesPass();
    checks[0] = { ...checks[0], result: "fail" };
    const result = evaluate({ checks });

    // AUTO_ROLLBACK.md owns that decision; this result must not pre-empt it.
    expect(Object.keys(result)).not.toContain("rollbackAuthorized");
    expect(result.rollbackEligibilityMustBeReevaluated).toBe(true);
  });

  it("asks for an owner on every outcome except passed", () => {
    expect(evaluate().ownerAttentionRequired).toBe(false);
    expect(evaluate(null).ownerAttentionRequired).toBe(true);
    expect(evaluate({ cancelledBy: "owner-1" }).ownerAttentionRequired).toBe(true);
  });
});

describe("describeValidation", () => {
  it("leads with the outcome and explains every finding", () => {
    const lines = describeValidation(evaluate(null));

    expect(lines[0]).toBe("Outcome: inconclusive.");
    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/no validation evidence/i);
  });

  it("says so plainly when nothing was wrong", () => {
    expect(describeValidation(evaluate())[1]).toMatch(/every required check passed/i);
  });
});
