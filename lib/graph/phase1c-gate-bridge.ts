import { z } from "zod";

import {
  canonicalizeProductionDeploymentUrl,
  productionDeploymentUrlSchema,
} from "@/lib/github/schemas";

export const FULL_LIFECYCLE_TEMPLATE_KEY = "full_lifecycle" as const;
export const FULL_LIFECYCLE_TEMPLATE_VERSION = 2 as const;

const shaSchema = z.string().regex(/^[0-9a-f]{40}$/);

export const gateInspectionSchema = z.object({
  graph_id: z.string().uuid(),
  id: z.string().uuid(),
  kind: z.enum(["AUTOMATIC", "HUMAN"]),
  node_id: z.string().uuid(),
  opened_by_run_id: z.string().uuid().nullable(),
  organization_id: z.string().uuid(),
  stage: z.string(),
  state: z.enum(["OPEN", "APPROVED", "REJECTED"]),
});

export const graphReleaseInspectionSchema = z.object({
  base_branch: z.string().trim().min(1).max(255).nullable(),
  base_sha: shaSchema.nullable(),
  github_repository_id: z.string().uuid().nullable(),
  goal: z.string().trim().min(1).max(4_000),
  id: z.string().uuid(),
  is_lifecycle: z.boolean(),
  organization_id: z.string().uuid(),
  project_id: z.string().uuid(),
  template_key: z.string().nullable(),
  template_version: z.number().int().positive().nullable(),
});

export const phase1CTargetSchema = z.object({
  app_id: z.number().int().positive(),
  base_branch: z.string().trim().min(1).max(255),
  connection_id: z.string().uuid(),
  external_installation_id: z.number().int().positive(),
  external_repository_id: z.number().int().positive(),
  internal_installation_id: z.string().uuid(),
  project_id: z.string().uuid(),
  repository_full_name: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  repository_id: z.string().uuid(),
});

export const approvedArchitectureBridgeSchema = z.object({
  architecture_artifact_id: z.string().uuid(),
  bridge_id: z.string().uuid(),
  gate_reason: z.string().nullable(),
  gate_state: z.literal("APPROVED"),
  graph_id: z.string().uuid(),
  graph_run_id: z.string().uuid(),
  implementation_node_id: z.string().uuid(),
  organization_id: z.string().uuid(),
  project_id: z.string().uuid(),
});

export const phase1CSubmissionSchema = z.object({
  command_id: z.string().uuid(),
  command_state: z.enum([
    "submitted",
    "awaiting_approval",
    "queued",
    "running",
    "succeeded",
    "failed",
    "cancelled",
  ]),
  requires_owner_approval: z.boolean(),
  task_id: z.string().uuid(),
  task_state: z.enum([
    "backlog",
    "awaiting_approval",
    "queued",
    "in_progress",
    "blocked",
    "completed",
    "failed",
    "cancelled",
  ]),
  was_created: z.boolean(),
});

export const graphPhase1CBridgeSchema = z.object({
  base_branch: z.string().trim().min(1).max(255).optional(),
  deployment_id: z.string().uuid().nullable().optional(),
  graph_id: z.string().uuid(),
  head_sha: shaSchema.nullable(),
  id: z.string().uuid(),
  merge_commit_sha: shaSchema.nullable(),
  organization_id: z.string().uuid(),
  project_id: z.string().uuid(),
  pull_request_id: z.string().uuid().nullable(),
  state: z.enum([
    "GRAPH_READY",
    "COMMAND_RECORDED",
    "PHASE1C_BOUND",
    "PULL_REQUEST_RECORDED",
    "MERGE_RECORDED",
    "DEPLOYMENT_RECORDED",
    "MONITORING_RECORDED",
    "VALIDATED",
  ]),
});

export const deploymentAnchorArtifactSchema = z.object({
  deploymentId: z.number().int().positive().safe(),
  environment: z.literal("Production"),
  environmentUrl: productionDeploymentUrlSchema,
  observation: z.literal("github_production_deployment"),
  observedAt: z.string().datetime({ offset: true }),
  ref: z.string().trim().min(1).max(255),
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  sha: shaSchema,
  state: z.literal("success"),
});

export const recordedDeploymentSchema = z.object({
  bridge_id: z.string().uuid(),
  deployment_id: z.string().uuid(),
});

export type GitHubDeploymentEvidence = Readonly<{
  completedAt: string;
  creatorLogin: string | null;
  deploymentId: number;
  environment: string;
  environmentUrl: string | null;
  productionEnvironment: boolean;
  ref: string;
  sha: string;
  startedAt: string;
  status: string;
  statusCreatorLogin: string | null;
  task: string;
}>;

/** Returns the first exact deployment identity mismatch, or null. */
export function productionDeploymentMismatch(
  evidence: GitHubDeploymentEvidence,
  expected: z.infer<typeof deploymentAnchorArtifactSchema>,
) {
  if (evidence.deploymentId !== expected.deploymentId) return "GitHub returned a different deployment identifier.";
  if (evidence.sha !== expected.sha) return "The deployment commit does not match the merged lifecycle commit.";
  if (evidence.ref !== expected.ref) return "The deployment branch does not match the lifecycle base branch.";
  if (evidence.environment !== "Production" || !evidence.productionEnvironment) {
    return "The exact GitHub deployment is not a Production deployment.";
  }
  if (evidence.task !== "deploy" || evidence.creatorLogin !== "vercel[bot]") {
    return "The exact Production deployment was not created by the verified Vercel integration.";
  }
  if (evidence.status !== "success" || evidence.statusCreatorLogin !== "vercel[bot]") {
    return "The exact Production deployment has not reached a verified successful status.";
  }
  const actualUrl = evidence.environmentUrl
    ? canonicalizeProductionDeploymentUrl(evidence.environmentUrl)
    : null;
  const expectedUrl = canonicalizeProductionDeploymentUrl(expected.environmentUrl);
  if (!actualUrl || !expectedUrl || actualUrl !== expectedUrl) {
    return "The successful deployment URL does not match the completed DEPLOY anchor.";
  }
  const startedAt = Date.parse(evidence.startedAt);
  const completedAt = Date.parse(evidence.completedAt);
  if (!Number.isFinite(startedAt) || !Number.isFinite(completedAt) || completedAt < startedAt) {
    return "GitHub returned invalid deployment timing evidence.";
  }
  return null;
}

export const storedPullRequestSchema = z.object({
  base_branch: z.string().trim().min(1).max(255),
  external_number: z.number().int().positive(),
  head_branch: z.string().trim().min(1).max(255),
  head_sha: shaSchema,
  id: z.string().uuid(),
  merge_commit_sha: shaSchema.nullable(),
  merged_at: z.string().datetime({ offset: true }).nullable(),
  repository: z.string().regex(/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/),
  status: z.enum(["draft", "open", "approved", "merged", "closed"]),
});

const architecturePrefix = [
  "Implement the exact architecture approved by the owner in this full lifecycle.",
  "Work only in the connected repository snapshot recorded below. Produce a validated draft pull request; do not merge or deploy.",
  "",
].join("\n");

/** Builds the deterministic, bounded Phase 1C prompt used for idempotent retry. */
export function approvedArchitecturePrompt(goal: string, architecture: unknown) {
  const serializedArchitecture = JSON.stringify(architecture);
  const boundedGoal = goal.trim().slice(0, 1_500);
  const goalSection = `Goal:\n${boundedGoal}\n\nApproved architecture:\n`;
  const suffix = "\n\nPreserve unrelated behavior and report validation evidence.";
  const available = Math.max(0, 4_000 - architecturePrefix.length - goalSection.length - suffix.length);
  const architectureText = serializedArchitecture.length <= available
    ? serializedArchitecture
    : `${serializedArchitecture.slice(0, Math.max(0, available - 33))}\n[architecture payload truncated]`;
  return `${architecturePrefix}${goalSection}${architectureText}${suffix}`;
}

export type GitHubMergedPullRequest = Readonly<{
  baseBranch: string;
  headBranch: string;
  headSha: string;
  merged: boolean;
  mergedAt: string | null;
  mergeCommitSha: string | null;
  number: number;
  state: "open" | "closed";
  url: string;
}>;

export type MergeIdentityExpectation = Readonly<{
  baseBranch: string;
  headBranch: string;
  headSha: string;
  number: number;
}>;

/**
 * Refuses a TEST approval unless GitHub's numbered PR proves the exact stored
 * Phase 1C head was merged into the exact base branch.
 */
export function mergedPullRequestMismatch(
  pullRequest: GitHubMergedPullRequest,
  expected: MergeIdentityExpectation,
): string | null {
  if (pullRequest.number !== expected.number) return "GitHub returned a different pull request number.";
  if (pullRequest.headSha !== expected.headSha) return "The pull request head commit does not match the Phase 1C result.";
  if (pullRequest.headBranch !== expected.headBranch) return "The pull request head branch does not match the Phase 1C result.";
  if (pullRequest.baseBranch !== expected.baseBranch) return "The pull request base branch does not match the lifecycle graph.";
  if (!pullRequest.merged || pullRequest.state !== "closed") return "The exact pull request has not been merged.";
  if (!pullRequest.mergedAt || !pullRequest.mergeCommitSha || !shaSchema.safeParse(pullRequest.mergeCommitSha).success) {
    return "GitHub did not return a complete merge identity for the exact pull request.";
  }
  return null;
}
