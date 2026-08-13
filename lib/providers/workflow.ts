import {
  isReviewTaskKind,
  PROVIDER_LABELS,
  type AgentRole,
  type ProviderArtifactSummary,
  type ProviderId,
  type ProviderTaskKind,
} from "@/lib/providers/types";

/**
 * Multi-agent workflow composition and the independent-review rule.
 *
 * Agents exchange work as typed artifacts persisted by SoftwareFactory. They
 * never share a provider chat history: every step receives exactly the prior
 * artifacts its definition names, which keeps a handoff auditable and keeps a
 * later step from inheriting an earlier step's unrecorded context.
 */

export const WORKFLOW_POLICY_VERSION = "phase2a-workflow-v1";

export interface WorkflowArtifact {
  readonly runId: string;
  readonly taskKind: ProviderTaskKind;
  readonly agentId: string;
  readonly agentRole: AgentRole;
  readonly provider: ProviderId;
  readonly model: string;
  readonly summary: string;
  readonly producedAt: string;
}

export interface WorkflowStepDefinition {
  readonly stepId: string;
  readonly taskKind: ProviderTaskKind;
  /** The logical role expected to own the step. Never a provider account. */
  readonly agentRole: AgentRole;
  /** Step ids whose artifacts must exist before this step may start. */
  readonly dependsOn: readonly string[];
  /**
   * When set, this step is an independent review of the named step and the
   * reviewing agent may not be the agent that produced it.
   */
  readonly reviewOfStepId: string | null;
  /**
   * When true, the reviewing provider must also differ from the reviewed
   * provider. Used for security review, where a single provider's blind spots
   * would otherwise be shared by author and reviewer.
   */
  readonly requiresDistinctProvider: boolean;
}

/**
 * The default delivery chain: plan, propose an implementation, review that
 * proposal independently, then validate it.
 *
 * Every step produces an advisory artifact. Applying a proposal to a
 * repository is a separate owner action through the existing branch, commit
 * and draft-pull-request flow; no step here writes to a repository.
 */
export const DEFAULT_DELIVERY_WORKFLOW: readonly WorkflowStepDefinition[] = Object.freeze([
  Object.freeze({
    stepId: "plan",
    taskKind: "plan" as const,
    agentRole: "product" as const,
    dependsOn: Object.freeze([]),
    reviewOfStepId: null,
    requiresDistinctProvider: false,
  }),
  Object.freeze({
    stepId: "implement",
    taskKind: "implementation_proposal" as const,
    agentRole: "backend" as const,
    dependsOn: Object.freeze(["plan"]),
    reviewOfStepId: null,
    requiresDistinctProvider: false,
  }),
  Object.freeze({
    stepId: "review",
    taskKind: "implementation_review" as const,
    agentRole: "security" as const,
    dependsOn: Object.freeze(["implement"]),
    reviewOfStepId: "implement",
    requiresDistinctProvider: true,
  }),
  Object.freeze({
    stepId: "qa",
    taskKind: "qa_assessment" as const,
    agentRole: "qa" as const,
    dependsOn: Object.freeze(["implement", "review"]),
    reviewOfStepId: "implement",
    requiresDistinctProvider: false,
  }),
]);

export type ReviewIndependenceViolationCode =
  | "REVIEWER_IS_IMPLEMENTER"
  | "REVIEWER_SHARES_PROVIDER"
  | "REVIEWED_ARTIFACT_MISSING"
  | "NOT_A_REVIEW_STEP";

export interface ReviewIndependenceResult {
  readonly independent: boolean;
  readonly violation: ReviewIndependenceViolationCode | null;
  readonly detail: string;
}

export interface ReviewerIdentity {
  readonly agentId: string;
  readonly agentRole: AgentRole;
  readonly provider: ProviderId;
}

/**
 * Decide whether a proposed reviewer may satisfy an independent-review step.
 *
 * The rule is about the *agent*, not the provider: an implementation agent can
 * never sign off on its own work, whichever model executed it. Provider
 * distinctness is an additional requirement only where the step declares it.
 */
export function evaluateReviewIndependence(
  step: WorkflowStepDefinition,
  reviewer: ReviewerIdentity,
  reviewedArtifact: WorkflowArtifact | null,
): ReviewIndependenceResult {
  if (!step.reviewOfStepId || !isReviewTaskKind(step.taskKind)) {
    return Object.freeze({
      independent: false,
      violation: "NOT_A_REVIEW_STEP",
      detail: `Step ${step.stepId} is not an independent-review step.`,
    });
  }

  if (!reviewedArtifact) {
    return Object.freeze({
      independent: false,
      violation: "REVIEWED_ARTIFACT_MISSING",
      detail: `Step ${step.stepId} reviews ${step.reviewOfStepId}, which has produced no artifact yet.`,
    });
  }

  if (reviewer.agentId === reviewedArtifact.agentId) {
    return Object.freeze({
      independent: false,
      violation: "REVIEWER_IS_IMPLEMENTER",
      detail:
        "The agent that produced the implementation cannot satisfy its own independent review.",
    });
  }

  if (step.requiresDistinctProvider && reviewer.provider === reviewedArtifact.provider) {
    return Object.freeze({
      independent: false,
      violation: "REVIEWER_SHARES_PROVIDER",
      detail: `Step ${step.stepId} requires a provider other than ${PROVIDER_LABELS[reviewedArtifact.provider]}, which produced the work under review.`,
    });
  }

  return Object.freeze({
    independent: true,
    violation: null,
    detail: `${reviewer.agentRole} agent ${reviewer.agentId} is independent of the reviewed work.`,
  });
}

/**
 * Throwing variant for call sites where a dependent review must not proceed.
 */
export class ReviewIndependenceError extends Error {
  readonly code: ReviewIndependenceViolationCode;

  constructor(result: ReviewIndependenceResult) {
    super(result.detail);
    this.name = "ReviewIndependenceError";
    this.code = result.violation ?? "NOT_A_REVIEW_STEP";
  }
}

export function assertIndependentReview(
  step: WorkflowStepDefinition,
  reviewer: ReviewerIdentity,
  reviewedArtifact: WorkflowArtifact | null,
): void {
  const result = evaluateReviewIndependence(step, reviewer, reviewedArtifact);
  if (!result.independent) throw new ReviewIndependenceError(result);
}

export type WorkflowStepState = "blocked" | "ready" | "completed";

export interface WorkflowStepStatus {
  readonly stepId: string;
  readonly taskKind: ProviderTaskKind;
  readonly agentRole: AgentRole;
  readonly state: WorkflowStepState;
  readonly missingDependencies: readonly string[];
}

export interface WorkflowStatus {
  readonly policyVersion: typeof WORKFLOW_POLICY_VERSION;
  readonly steps: readonly WorkflowStepStatus[];
  readonly nextStepId: string | null;
  readonly complete: boolean;
}

/**
 * Evaluate which workflow step may run next given the artifacts recorded so
 * far. A step whose dependencies are unmet stays blocked; nothing infers
 * completion from an absent record.
 */
export function evaluateWorkflow(
  definition: readonly WorkflowStepDefinition[],
  artifactsByStepId: Readonly<Record<string, WorkflowArtifact | undefined>>,
): WorkflowStatus {
  const steps = definition.map((step) => {
    const completed = Boolean(artifactsByStepId[step.stepId]);
    const missingDependencies = Object.freeze(
      step.dependsOn.filter((dependency) => !artifactsByStepId[dependency]),
    );

    const state: WorkflowStepState = completed
      ? "completed"
      : missingDependencies.length === 0
        ? "ready"
        : "blocked";

    return Object.freeze({
      stepId: step.stepId,
      taskKind: step.taskKind,
      agentRole: step.agentRole,
      state,
      missingDependencies,
    });
  });

  const nextStep = steps.find((step) => step.state === "ready") ?? null;

  return Object.freeze({
    policyVersion: WORKFLOW_POLICY_VERSION,
    steps: Object.freeze(steps),
    nextStepId: nextStep?.stepId ?? null,
    complete: steps.every((step) => step.state === "completed"),
  });
}

/**
 * Build the structured handoff a step receives: only the artifacts its
 * declared dependencies produced, in dependency order. Nothing else from the
 * run leaks into the provider prompt.
 */
export function buildHandoffContext(
  step: WorkflowStepDefinition,
  artifactsByStepId: Readonly<Record<string, WorkflowArtifact | undefined>>,
): readonly ProviderArtifactSummary[] {
  return Object.freeze(
    step.dependsOn
      .map((dependency) => artifactsByStepId[dependency])
      .filter((artifact): artifact is WorkflowArtifact => Boolean(artifact))
      .map((artifact) =>
        Object.freeze({
          taskKind: artifact.taskKind,
          agentRole: artifact.agentRole,
          agentId: artifact.agentId,
          provider: artifact.provider,
          model: artifact.model,
          runId: artifact.runId,
          summary: artifact.summary,
        }),
      ),
  );
}

export function findStep(
  definition: readonly WorkflowStepDefinition[],
  stepId: string,
): WorkflowStepDefinition | null {
  return definition.find((step) => step.stepId === stepId) ?? null;
}
