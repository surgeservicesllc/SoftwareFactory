// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  assertIndependentReview,
  buildHandoffContext,
  DEFAULT_DELIVERY_WORKFLOW,
  evaluateReviewIndependence,
  evaluateWorkflow,
  findStep,
  ReviewIndependenceError,
  type WorkflowArtifact,
} from "@/lib/providers/workflow";

function artifact(overrides: Partial<WorkflowArtifact> = {}): WorkflowArtifact {
  return {
    runId: "run-implement",
    taskKind: "implementation_proposal",
    agentId: "agent-backend",
    agentRole: "backend",
    provider: "openai",
    model: "owner-selected-model",
    summary: "Proposed the change across three files.",
    producedAt: "2026-08-13T00:00:00.000Z",
    ...overrides,
  };
}

const reviewStep = findStep(DEFAULT_DELIVERY_WORKFLOW, "review")!;
const qaStep = findStep(DEFAULT_DELIVERY_WORKFLOW, "qa")!;
const planStep = findStep(DEFAULT_DELIVERY_WORKFLOW, "plan")!;

describe("independent review", () => {
  it("accepts a different agent on a different provider", () => {
    const result = evaluateReviewIndependence(
      reviewStep,
      { agentId: "agent-security", agentRole: "security", provider: "anthropic" },
      artifact(),
    );

    expect(result.independent).toBe(true);
    expect(result.violation).toBeNull();
  });

  it("refuses to let the implementing agent review its own work", () => {
    const result = evaluateReviewIndependence(
      reviewStep,
      { agentId: "agent-backend", agentRole: "backend", provider: "anthropic" },
      artifact(),
    );

    expect(result.independent).toBe(false);
    expect(result.violation).toBe("REVIEWER_IS_IMPLEMENTER");
  });

  it("refuses the same agent even when a different provider executed the review", () => {
    const result = evaluateReviewIndependence(
      qaStep,
      { agentId: "agent-backend", agentRole: "backend", provider: "anthropic" },
      artifact({ provider: "openai" }),
    );

    expect(result.violation).toBe("REVIEWER_IS_IMPLEMENTER");
  });

  it("requires a distinct provider where the step declares it", () => {
    const result = evaluateReviewIndependence(
      reviewStep,
      { agentId: "agent-security", agentRole: "security", provider: "openai" },
      artifact({ provider: "openai" }),
    );

    expect(result.independent).toBe(false);
    expect(result.violation).toBe("REVIEWER_SHARES_PROVIDER");
  });

  it("allows a shared provider where the step does not require distinctness", () => {
    expect(qaStep.requiresDistinctProvider).toBe(false);
    const result = evaluateReviewIndependence(
      qaStep,
      { agentId: "agent-qa", agentRole: "qa", provider: "openai" },
      artifact({ provider: "openai" }),
    );

    expect(result.independent).toBe(true);
  });

  it("refuses when the reviewed artifact does not exist", () => {
    const result = evaluateReviewIndependence(
      reviewStep,
      { agentId: "agent-security", agentRole: "security", provider: "anthropic" },
      null,
    );

    expect(result.violation).toBe("REVIEWED_ARTIFACT_MISSING");
  });

  it("rejects treating a non-review step as a review", () => {
    const result = evaluateReviewIndependence(
      planStep,
      { agentId: "agent-product", agentRole: "product", provider: "anthropic" },
      artifact(),
    );

    expect(result.violation).toBe("NOT_A_REVIEW_STEP");
  });

  it("throws through the asserting variant", () => {
    expect(() =>
      assertIndependentReview(
        reviewStep,
        { agentId: "agent-backend", agentRole: "backend", provider: "anthropic" },
        artifact(),
      ),
    ).toThrow(ReviewIndependenceError);

    expect(() =>
      assertIndependentReview(
        reviewStep,
        { agentId: "agent-security", agentRole: "security", provider: "anthropic" },
        artifact(),
      ),
    ).not.toThrow();
  });
});

describe("workflow progression", () => {
  it("starts with only the first step ready", () => {
    const status = evaluateWorkflow(DEFAULT_DELIVERY_WORKFLOW, {});

    expect(status.nextStepId).toBe("plan");
    expect(status.complete).toBe(false);
    expect(status.steps.filter((step) => step.state === "ready")).toHaveLength(1);
    expect(status.steps.find((step) => step.stepId === "review")?.missingDependencies).toEqual([
      "implement",
    ]);
  });

  it("advances only as artifacts are recorded", () => {
    const planArtifact = artifact({
      runId: "run-plan",
      taskKind: "plan",
      agentId: "agent-product",
      agentRole: "product",
      provider: "anthropic",
      model: "claude-opus-5",
      summary: "Three-step plan with acceptance criteria.",
    });

    const afterPlan = evaluateWorkflow(DEFAULT_DELIVERY_WORKFLOW, { plan: planArtifact });
    expect(afterPlan.nextStepId).toBe("implement");

    const afterImplement = evaluateWorkflow(DEFAULT_DELIVERY_WORKFLOW, {
      plan: planArtifact,
      implement: artifact(),
    });
    expect(afterImplement.nextStepId).toBe("review");
    // QA depends on both implement and review, so it stays blocked.
    expect(afterImplement.steps.find((step) => step.stepId === "qa")?.state).toBe("blocked");

    const complete = evaluateWorkflow(DEFAULT_DELIVERY_WORKFLOW, {
      plan: planArtifact,
      implement: artifact(),
      review: artifact({ runId: "run-review", taskKind: "implementation_review", agentId: "agent-security" }),
      qa: artifact({ runId: "run-qa", taskKind: "qa_assessment", agentId: "agent-qa" }),
    });
    expect(complete.complete).toBe(true);
    expect(complete.nextStepId).toBeNull();
  });
});

describe("handoff context", () => {
  it("passes only the artifacts a step declares as dependencies", () => {
    const planArtifact = artifact({
      runId: "run-plan",
      taskKind: "plan",
      agentId: "agent-product",
      agentRole: "product",
      provider: "anthropic",
      model: "claude-opus-5",
      summary: "Plan summary.",
    });
    const implementArtifact = artifact();

    const reviewContext = buildHandoffContext(reviewStep, {
      plan: planArtifact,
      implement: implementArtifact,
    });

    expect(reviewContext).toHaveLength(1);
    expect(reviewContext[0]?.runId).toBe("run-implement");
    expect(reviewContext[0]?.summary).toBe(implementArtifact.summary);
  });

  it("omits dependencies that have produced nothing yet", () => {
    expect(buildHandoffContext(qaStep, { implement: artifact() })).toHaveLength(1);
    expect(buildHandoffContext(planStep, {})).toHaveLength(0);
  });
});
