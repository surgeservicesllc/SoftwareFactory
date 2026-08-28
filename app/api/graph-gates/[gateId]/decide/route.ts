import { z } from "zod";

import {
  approvedArchitectureBridgeSchema,
  approvedArchitecturePrompt,
  deploymentAnchorArtifactSchema,
  FULL_LIFECYCLE_TEMPLATE_KEY,
  FULL_LIFECYCLE_TEMPLATE_VERSION,
  gateInspectionSchema,
  graphPhase1CBridgeSchema,
  graphReleaseInspectionSchema,
  mergedPullRequestMismatch,
  phase1CSubmissionSchema,
  phase1CTargetSchema,
  productionDeploymentMismatch,
  storedPullRequestSchema,
} from "@/lib/graph/phase1c-gate-bridge";
import { createGitHubInstallationToken, GitHubApiError } from "@/lib/github/client";
import {
  getGitHubAppConfigurationForAppId,
  GitHubConfigurationError,
} from "@/lib/github/config";
import { githubRouteErrorResponse } from "@/lib/github/errors";
import { createSupabaseGitHubWebhookClient } from "@/lib/github/service-role";
import {
  getGitHubBranchReference,
  getGitHubDeploymentEvidence,
  getGitHubPullRequest,
} from "@/lib/github/repository";
import { productionDeploymentUrlSchema } from "@/lib/github/schemas";
import { assessCommandRisk, resolveAcceptanceCriteria } from "@/lib/orchestration/command";
import {
  dispatchGraphWorker,
  dispatchPhase1CWorker,
  type Phase1CDispatchTarget,
} from "@/lib/orchestration/dispatch";
import { createPhase1CExecutionPlan } from "@/lib/orchestration/plan";
import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { findSensitiveData } from "@/lib/server/sensitive-data";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

const decisionSchema = z.object({
  approved: z.boolean(),
  evidenceArtifactId: z.string().uuid().optional(),
  reason: z.string().trim().min(1).max(1000).optional(),
}).strict();

const architectureArtifactSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["RAW", "REDUCED", "SYNTHESIS", "ANCHOR"]),
  payload: z.unknown(),
});
const releaseGateApprovalSchema = z.object({
  bridge_id: z.string().uuid(),
  deployment_id: z.string().uuid().optional(),
  gate_reason: z.string().nullable(),
  gate_state: z.literal("APPROVED"),
  head_sha: z.string().regex(/^[0-9a-f]{40}$/).optional(),
  merge_commit_sha: z.string().regex(/^[0-9a-f]{40}$/).optional(),
});
const attachedPhase1CSubmissionSchema = phase1CSubmissionSchema.extend({
  bridge_id: z.string().uuid(),
});
const releaseApprovalIntentSchema = z.object({
  consume_nonce: z.string().uuid(),
  intent_id: z.string().uuid(),
});
const storedDeploymentReplaySchema = z.object({
  commit_sha: z.string().regex(/^[0-9a-f]{40}$/),
  environment: z.string(),
  id: z.string().uuid(),
  status: z.literal("succeeded"),
  url: productionDeploymentUrlSchema,
});
type TenantClient = Awaited<ReturnType<typeof requireActiveOrganization>>["client"];
type Gate = z.infer<typeof gateInspectionSchema>;
type Graph = z.infer<typeof graphReleaseInspectionSchema>;
type Target = z.infer<typeof phase1CTargetSchema>;

function unavailable(code: string, message: string, status = 503) {
  return jsonNoStore({ error: { code, message } }, { status });
}

function splitRepository(fullName: string) {
  const [owner, repository, extra] = fullName.split("/");
  if (!owner || !repository || extra) {
    throw new GitHubApiError(409, "project_not_executable", "The project repository binding is invalid.");
  }
  return { owner, repository };
}

function dispatchTarget(target: Target): Phase1CDispatchTarget {
  return {
    appId: target.app_id,
    externalInstallationId: target.external_installation_id,
    externalRepositoryId: target.external_repository_id,
    repositoryFullName: target.repository_full_name,
  };
}

async function readTarget(client: TenantClient, organizationId: string, projectId: string) {
  const result = await client.rpc("resolve_phase1c_command_target", {
    p_organization_id: organizationId,
    p_project_id: projectId,
  }).single();
  if (result.error) return { response: databaseErrorResponse(result.error) } as const;
  const parsed = phase1CTargetSchema.safeParse(result.data);
  if (!parsed.success || parsed.data.project_id !== projectId) {
    return {
      response: unavailable(
        "command_target_invalid",
        "The project's exact GitHub repository binding could not be verified safely.",
      ),
    } as const;
  }
  return { target: parsed.data } as const;
}

async function readGateAndGraph(client: TenantClient, organizationId: string, gateId: string) {
  const gateRead = await client.from("graph_gates")
    .select("id,organization_id,graph_id,node_id,stage,kind,state,opened_by_run_id")
    .eq("id", gateId).maybeSingle();
  if (gateRead.error) return { response: databaseErrorResponse(gateRead.error) } as const;
  const gate = gateInspectionSchema.safeParse(gateRead.data);
  if (!gate.success || gate.data.organization_id !== organizationId) {
    return {
      response: unavailable(
        "gate_not_found",
        "The lifecycle gate could not be found in the active organization.",
        404,
      ),
    } as const;
  }

  const graphRead = await client.from("graphs")
    .select(
      "id,organization_id,project_id,goal,is_lifecycle,template_key,template_version,github_repository_id,base_branch,base_sha",
    )
    .eq("id", gate.data.graph_id).maybeSingle();
  if (graphRead.error) return { response: databaseErrorResponse(graphRead.error) } as const;
  const graph = graphReleaseInspectionSchema.safeParse(graphRead.data);
  if (!graph.success || graph.data.organization_id !== organizationId || graph.data.id !== gate.data.graph_id) {
    return {
      response: unavailable(
        "graph_identity_invalid",
        "The gate's lifecycle graph identity could not be verified safely.",
      ),
    } as const;
  }
  return { gate: gate.data, graph: graph.data } as const;
}

function exactFullLifecycle(graph: Graph) {
  return graph.is_lifecycle
    && graph.template_key === FULL_LIFECYCLE_TEMPLATE_KEY
    && graph.template_version === FULL_LIFECYCLE_TEMPLATE_VERSION;
}

function completeReleaseIdentity(graph: Graph): graph is Graph & {
  base_branch: string;
  base_sha: string;
  github_repository_id: string;
} {
  return Boolean(graph.base_branch && graph.base_sha && graph.github_repository_id);
}

async function decideGate(client: TenantClient, gateId: string, approved: boolean, reason: string | null) {
  const result = await client.rpc("decide_node_gate", {
    p_gate_id: gateId,
    p_approved: approved,
    p_reason: reason,
  });
  if (result.error) return { response: databaseErrorResponse(result.error) } as const;
  const raw = Array.isArray(result.data) ? result.data[0] : result.data;
  return {
    gate: raw as { id: string; state: string; stage: string; kind: string; reason: string | null },
  } as const;
}

function gateProjection(
  gate: { id: string; state: string; stage: string; kind: string; reason: string | null } | null,
) {
  return gate
    ? { id: gate.id, state: gate.state, stage: gate.stage, kind: gate.kind, reason: gate.reason }
    : null;
}

async function verifyCurrentBase(
  graph: Graph & { base_branch: string; base_sha: string; github_repository_id: string },
  target: Target,
) {
  if (
    graph.project_id !== target.project_id
    || graph.base_branch !== target.base_branch
    || graph.github_repository_id !== target.repository_id
  ) {
    return {
      response: unavailable(
        "graph_repository_mismatch",
        "The lifecycle graph does not match the project's current repository binding.",
        409,
      ),
    } as const;
  }
  const { owner, repository } = splitRepository(target.repository_full_name);
  const token = await createGitHubInstallationToken(
    getGitHubAppConfigurationForAppId(target.app_id),
    target.external_installation_id,
    {
      permissions: { contents: "read", metadata: "read" },
      repositoryIds: [target.external_repository_id],
    },
  );
  const reference = await getGitHubBranchReference(
    token.token,
    owner,
    repository,
    target.base_branch,
  );
  if (reference.object.sha.toLowerCase() !== graph.base_sha) {
    return {
      response: unavailable(
        "graph_base_advanced",
        "The repository base branch changed after this lifecycle launched. Launch a new lifecycle from the current commit.",
        409,
      ),
    } as const;
  }
  return { verified: true as const };
}

async function readArchitectureArtifact(
  client: TenantClient,
  gate: Gate,
  evidenceArtifactId: string,
) {
  if (!gate.opened_by_run_id) {
    return {
      response: unavailable(
        "architecture_evidence_missing",
        "The architecture gate has no completed run evidence.",
        409,
      ),
    } as const;
  }
  const nodeRun = await client.from("node_runs").select("id,state")
    .eq("organization_id", gate.organization_id)
    .eq("graph_run_id", gate.opened_by_run_id)
    .eq("node_id", gate.node_id)
    .in("state", ["VERIFYING", "COMPLETED"])
    .maybeSingle();
  if (nodeRun.error) return { response: databaseErrorResponse(nodeRun.error) } as const;
  const nodeRunId = z.object({ id: z.string().uuid() }).safeParse(nodeRun.data);
  if (!nodeRunId.success) {
    return {
      response: unavailable(
        "architecture_evidence_missing",
        "The approved architecture answer is unavailable.",
        409,
      ),
    } as const;
  }
  const artifactRead = await client.from("graph_artifacts").select("id,kind,payload")
    .eq("id", evidenceArtifactId)
    .eq("organization_id", gate.organization_id)
    .eq("graph_run_id", gate.opened_by_run_id)
    .eq("node_run_id", nodeRunId.data.id)
    .maybeSingle();
  if (artifactRead.error) return { response: databaseErrorResponse(artifactRead.error) } as const;
  const artifact = architectureArtifactSchema.safeParse(artifactRead.data);
  if (!artifact.success || artifact.data.kind !== "RAW") {
    return {
      response: unavailable(
        "architecture_evidence_missing",
        "The approved architecture answer is unavailable.",
        409,
      ),
    } as const;
  }
  return { artifact: artifact.data } as const;
}

async function readDeploymentArtifact(
  client: TenantClient,
  gate: Gate,
  evidenceArtifactId: string,
) {
  if (!gate.opened_by_run_id) {
    return {
      response: unavailable(
        "deployment_evidence_missing",
        "The deployment gate has no completed DEPLOY anchor evidence.",
        409,
      ),
    } as const;
  }
  const nodeRun = await client.from("node_runs").select("id,state")
    .eq("organization_id", gate.organization_id)
    .eq("graph_run_id", gate.opened_by_run_id)
    .eq("node_id", gate.node_id)
    .in("state", ["VERIFYING", "COMPLETED"])
    .maybeSingle();
  if (nodeRun.error) return { response: databaseErrorResponse(nodeRun.error) } as const;
  const nodeRunId = z.object({ id: z.string().uuid() }).safeParse(nodeRun.data);
  if (!nodeRunId.success) {
    return {
      response: unavailable(
        "deployment_evidence_missing",
        "The completed DEPLOY anchor is unavailable.",
        409,
      ),
    } as const;
  }
  const artifactRead = await client.from("graph_artifacts").select("id,kind,payload")
    .eq("id", evidenceArtifactId)
    .eq("organization_id", gate.organization_id)
    .eq("graph_run_id", gate.opened_by_run_id)
    .eq("node_run_id", nodeRunId.data.id)
    .maybeSingle();
  if (artifactRead.error) return { response: databaseErrorResponse(artifactRead.error) } as const;
  const artifact = architectureArtifactSchema.safeParse(artifactRead.data);
  if (!artifact.success || artifact.data.kind !== "ANCHOR") {
    return {
      response: unavailable(
        "deployment_evidence_missing",
        "The completed DEPLOY anchor is unavailable.",
        409,
      ),
    } as const;
  }
  return { artifact: artifact.data } as const;
}

async function approveArchitecture(
  client: TenantClient,
  organizationId: string,
  gate: Gate,
  graph: Graph,
  evidenceArtifactId: string,
  reason: string | null,
): Promise<Response> {
  if (!completeReleaseIdentity(graph)) {
    return unavailable(
      "graph_release_identity_missing",
      "This lifecycle predates exact release identity. Launch a new Full Lifecycle before approving architecture.",
      409,
    );
  }
  const targetResult = await readTarget(client, organizationId, graph.project_id);
  if ("response" in targetResult && targetResult.response) return targetResult.response;
  if (!("target" in targetResult) || !targetResult.target) {
    return unavailable("command_target_invalid", "The repository target could not be verified safely.");
  }
  const target = targetResult.target;
  const baseVerification = await verifyCurrentBase(graph, target);
  if ("response" in baseVerification && baseVerification.response) return baseVerification.response;

  // Read and screen the exact answer before recording the irreversible human
  // decision. The bridge RPC re-derives it and both ids must agree.
  const artifactResult = await readArchitectureArtifact(client, gate, evidenceArtifactId);
  if ("response" in artifactResult && artifactResult.response) return artifactResult.response;
  if (!("artifact" in artifactResult) || !artifactResult.artifact) {
    return unavailable("architecture_evidence_missing", "The architecture answer is unavailable.", 409);
  }
  const prompt = approvedArchitecturePrompt(graph.goal, artifactResult.artifact.payload);
  if (findSensitiveData(prompt)) {
    return unavailable(
      "architecture_sensitive_data",
      "The architecture answer cannot be handed to Phase 1C because it contains likely sensitive data.",
      409,
    );
  }

  const bridgeRead = await client.rpc("approve_graph_phase1c_architecture_gate", {
    p_architecture_artifact_id: artifactResult.artifact.id,
    p_gate_id: gate.id,
    p_reason: reason,
  }).single();
  if (bridgeRead.error) return databaseErrorResponse(bridgeRead.error);
  const bridge = approvedArchitectureBridgeSchema.safeParse(bridgeRead.data);
  if (
    !bridge.success
    || bridge.data.organization_id !== organizationId
    || bridge.data.project_id !== graph.project_id
    || bridge.data.graph_id !== graph.id
    || bridge.data.architecture_artifact_id !== artifactResult.artifact.id
  ) {
    return unavailable(
      "bridge_identity_invalid",
      "The graph-to-Phase-1C bridge returned conflicting identity evidence.",
    );
  }
  const decision = {
    gate: {
      id: gate.id,
      kind: gate.kind,
      reason: bridge.data.gate_reason,
      stage: gate.stage,
      state: bridge.data.gate_state,
    },
  };

  const commandType = "build_feature" as const;
  const acceptanceCriteria = resolveAcceptanceCriteria(commandType, []);
  const riskAssessment = assessCommandRisk({
    acceptanceCriteria,
    commandType,
    prompt,
    requestedRisk: "YELLOW",
  });
  const execution = createPhase1CExecutionPlan(commandType);
  const parameters = {
    acceptanceCriteria,
    agentRole: execution.agentRole,
    budget: execution.budget,
    commandType,
    dependencyTaskIds: [],
    executionMode: "manual",
    model: execution.model,
    plan: execution.plan,
    provider: execution.provider,
    repositoryBinding: {
      appId: target.app_id,
      baseBranch: graph.base_branch,
      baseSha: graph.base_sha,
      connectionId: target.connection_id,
      externalInstallationId: target.external_installation_id,
      externalRepositoryId: target.external_repository_id,
      installationId: target.internal_installation_id,
      repositoryId: target.repository_id,
    },
    riskAssessment: {
      factors: riskAssessment.factors,
      reasons: riskAssessment.reasons,
      requestedRisk: riskAssessment.requestedRisk.toLowerCase(),
    },
  };
  const submissionRead = await client.rpc("submit_and_attach_graph_phase1c_command", {
    p_bridge_id: bridge.data.bridge_id,
    p_parameters: parameters,
  });
  if (submissionRead.error) return databaseErrorResponse(submissionRead.error);
  const submissionRaw = Array.isArray(submissionRead.data) ? submissionRead.data[0] : submissionRead.data;
  const submission = attachedPhase1CSubmissionSchema.safeParse(submissionRaw);
  if (!submission.success || submission.data.bridge_id !== bridge.data.bridge_id) {
    return unavailable(
      "phase1c_submission_invalid",
      "Phase 1C returned an invalid command identity projection.",
    );
  }

  if (submission.data.requires_owner_approval) {
    return jsonNoStore({
      gate: gateProjection(decision.gate),
      workerWoken: false,
      phase1c: {
        bridgeId: bridge.data.bridge_id,
        commandId: submission.data.command_id,
        taskId: submission.data.task_id,
      },
      note: "The architecture is approved and its RED Phase 1C command is recorded. A separate exact owner approval is required; no worker was dispatched.",
    });
  }

  let workerWoken = false;
  try {
    const dispatchResult = await dispatchPhase1CWorker(
      dispatchTarget(target),
      submission.data.command_id,
    );
    workerWoken = dispatchResult.dispatched;
  } catch {
    workerWoken = false;
  }
  return jsonNoStore({
    gate: gateProjection(decision.gate),
    workerWoken,
    phase1c: {
      bridgeId: bridge.data.bridge_id,
      commandId: submission.data.command_id,
      taskId: submission.data.task_id,
    },
    note: workerWoken
      ? "The architecture is approved, its exact Phase 1C command is attached, and the manual draft-PR worker has been woken. The worker binds the exact run before work; no merge or deployment was authorized."
      : "The architecture is approved and its exact Phase 1C command is attached, but the executor is Not Connected. No automatic action, merge, or deployment occurred.",
  });
}

async function approveMergedTest(
  client: TenantClient,
  organizationId: string,
  gate: Gate,
  graph: Graph,
  evidenceArtifactId: string,
  reason: string | null,
): Promise<Response> {
  if (!completeReleaseIdentity(graph)) {
    return unavailable("graph_release_identity_missing", "The lifecycle graph has no exact release identity.", 409);
  }
  const targetResult = await readTarget(client, organizationId, graph.project_id);
  if ("response" in targetResult && targetResult.response) return targetResult.response;
  if (!("target" in targetResult) || !targetResult.target) {
    return unavailable("command_target_invalid", "The repository target could not be verified safely.");
  }
  const target = targetResult.target;
  if (
    target.repository_id !== graph.github_repository_id
    || target.base_branch !== graph.base_branch
  ) {
    return unavailable(
      "graph_repository_mismatch",
      "The lifecycle graph does not match the project's current repository binding.",
      409,
    );
  }

  const bridgeRead = await client.from("graph_phase1c_bridges")
    .select("id,organization_id,project_id,graph_id,pull_request_id,head_sha,merge_commit_sha,state")
    .eq("organization_id", organizationId).eq("graph_id", graph.id).maybeSingle();
  if (bridgeRead.error) return databaseErrorResponse(bridgeRead.error);
  const bridge = graphPhase1CBridgeSchema.safeParse(bridgeRead.data);
  if (
    !bridge.success
    || bridge.data.project_id !== graph.project_id
    || !bridge.data.pull_request_id
    || !bridge.data.head_sha
    || ![
      "PULL_REQUEST_RECORDED",
      "MERGE_RECORDED",
      "DEPLOYMENT_RECORDED",
      "MONITORING_RECORDED",
      "VALIDATED",
    ].includes(bridge.data.state)
  ) {
    return unavailable(
      "phase1c_pull_request_missing",
      "The exact validated Phase 1C pull request is not ready for merge acceptance.",
      409,
    );
  }

  const storedRead = await client.from("pull_requests")
    .select("id,repository,external_number,head_branch,base_branch,status,head_sha,merge_commit_sha,merged_at")
    .eq("organization_id", organizationId).eq("id", bridge.data.pull_request_id).maybeSingle();
  if (storedRead.error) return databaseErrorResponse(storedRead.error);
  const stored = storedPullRequestSchema.safeParse(storedRead.data);
  if (
    !stored.success
    || stored.data.head_sha !== bridge.data.head_sha
    || stored.data.base_branch !== graph.base_branch
    || stored.data.repository.toLowerCase() !== target.repository_full_name.toLowerCase()
  ) {
    return unavailable(
      "pull_request_identity_invalid",
      "Stored pull request identity conflicts with the lifecycle bridge.",
      409,
    );
  }
  if (
    gate.state === "APPROVED"
    && bridge.data.merge_commit_sha
    && stored.data.status === "merged"
    && stored.data.merge_commit_sha === bridge.data.merge_commit_sha
    && stored.data.merged_at
  ) {
    let workerWoken = false;
    try {
      const dispatchResult = await dispatchGraphWorker(dispatchTarget(target), graph.id);
      workerWoken = dispatchResult.dispatched;
    } catch {
      workerWoken = false;
    }
    return jsonNoStore({
      gate: gateProjection({
        id: gate.id,
        kind: gate.kind,
        reason: null,
        stage: gate.stage,
        state: gate.state,
      }),
      workerWoken,
      release: {
        bridgeId: bridge.data.id,
        headSha: bridge.data.head_sha,
        mergeCommitSha: bridge.data.merge_commit_sha,
        pullRequestNumber: stored.data.external_number,
      },
      note: "The exact merged pull request and TEST approval were already recorded. No merge or deployment action was repeated.",
    });
  }

  const intentRead = await client.rpc("request_graph_release_gate_approval", {
    p_bridge_id: bridge.data.id,
    p_evidence_artifact_id: evidenceArtifactId,
    p_gate_id: gate.id,
    p_reason: reason,
  }).single();
  if (intentRead.error) return databaseErrorResponse(intentRead.error);
  const intent = releaseApprovalIntentSchema.safeParse(intentRead.data);
  if (!intent.success) {
    return unavailable(
      "release_approval_intent_invalid",
      "The owner approval intent returned conflicting release identity.",
    );
  }

  const { owner, repository } = splitRepository(target.repository_full_name);
  const token = await createGitHubInstallationToken(
    getGitHubAppConfigurationForAppId(target.app_id),
    target.external_installation_id,
    {
      permissions: { contents: "read", metadata: "read", pull_requests: "read" },
      repositoryIds: [target.external_repository_id],
    },
  );
  const pullRequest = await getGitHubPullRequest(
    token.token,
    owner,
    repository,
    stored.data.external_number,
  );
  const mismatch = mergedPullRequestMismatch(pullRequest, {
    baseBranch: graph.base_branch,
    headBranch: stored.data.head_branch,
    headSha: bridge.data.head_sha,
    number: stored.data.external_number,
  });
  if (mismatch) return unavailable("pull_request_not_exactly_merged", mismatch, 409);

  const serviceClient = createSupabaseGitHubWebhookClient();
  const mergeRecord = await serviceClient.rpc("approve_graph_phase1c_test_gate_as_worker", {
    p_base_branch: pullRequest.baseBranch,
    p_consume_nonce: intent.data.consume_nonce,
    p_external_number: pullRequest.number,
    p_head_branch: pullRequest.headBranch,
    p_head_sha: pullRequest.headSha,
    p_intent_id: intent.data.intent_id,
    p_merge_commit_sha: pullRequest.mergeCommitSha,
    p_merged_at: pullRequest.mergedAt,
  });
  if (mergeRecord.error) return databaseErrorResponse(mergeRecord.error);
  const mergeRaw = Array.isArray(mergeRecord.data) ? mergeRecord.data[0] : mergeRecord.data;
  const mergeApproval = releaseGateApprovalSchema.safeParse(mergeRaw);
  if (
    !mergeApproval.success
    || mergeApproval.data.bridge_id !== bridge.data.id
    || mergeApproval.data.head_sha !== pullRequest.headSha
    || mergeApproval.data.merge_commit_sha !== pullRequest.mergeCommitSha
  ) {
    return unavailable(
      "merge_record_identity_invalid",
      "The merge evidence boundary returned conflicting lifecycle identity.",
    );
  }
  const decision = {
    gate: {
      id: gate.id,
      kind: gate.kind,
      reason: mergeApproval.data.gate_reason,
      stage: gate.stage,
      state: mergeApproval.data.gate_state,
    },
  };

  let workerWoken = false;
  try {
    const dispatchResult = await dispatchGraphWorker(dispatchTarget(target), graph.id);
    workerWoken = dispatchResult.dispatched;
  } catch {
    workerWoken = false;
  }
  return jsonNoStore({
    gate: gateProjection(decision.gate),
    workerWoken,
    release: {
      bridgeId: bridge.data.id,
      headSha: pullRequest.headSha,
      mergeCommitSha: pullRequest.mergeCommitSha,
      pullRequestNumber: pullRequest.number,
    },
    note: workerWoken
      ? "The exact merged pull request is recorded and the TEST gate is approved. The graph worker has been woken to observe deployment; it cannot merge or deploy."
      : "The exact merged pull request is recorded and the TEST gate is approved. The graph executor is Not Connected, so nothing else runs automatically.",
  });
}

async function approveObservedDeployment(
  client: TenantClient,
  organizationId: string,
  gate: Gate,
  graph: Graph,
  evidenceArtifactId: string,
  reason: string | null,
): Promise<Response> {
  if (!completeReleaseIdentity(graph)) {
    return unavailable("graph_release_identity_missing", "The lifecycle graph has no exact release identity.", 409);
  }
  const targetResult = await readTarget(client, organizationId, graph.project_id);
  if ("response" in targetResult && targetResult.response) return targetResult.response;
  if (!("target" in targetResult) || !targetResult.target) {
    return unavailable("command_target_invalid", "The repository target could not be verified safely.");
  }
  const target = targetResult.target;
  if (
    target.repository_id !== graph.github_repository_id
    || target.base_branch !== graph.base_branch
  ) {
    return unavailable(
      "graph_repository_mismatch",
      "The lifecycle graph does not match the project's current repository binding.",
      409,
    );
  }

  const bridgeRead = await client.from("graph_phase1c_bridges")
    .select(
      "id,organization_id,project_id,graph_id,pull_request_id,head_sha,merge_commit_sha,deployment_id,state",
    )
    .eq("organization_id", organizationId).eq("graph_id", graph.id).maybeSingle();
  if (bridgeRead.error) return databaseErrorResponse(bridgeRead.error);
  const bridge = graphPhase1CBridgeSchema.safeParse(bridgeRead.data);
  if (
    !bridge.success
    || bridge.data.project_id !== graph.project_id
    || !bridge.data.merge_commit_sha
    || ![
      "MERGE_RECORDED",
      "DEPLOYMENT_RECORDED",
      "MONITORING_RECORDED",
      "VALIDATED",
    ].includes(bridge.data.state)
  ) {
    return unavailable(
      "phase1c_merge_missing",
      "The exact merged Phase 1C change is not ready for deployment acceptance.",
      409,
    );
  }
  if (gate.state === "APPROVED" && bridge.data.deployment_id) {
    const deploymentRead = await client.from("deployments")
      .select("id,environment,commit_sha,url,status")
      .eq("organization_id", organizationId)
      .eq("project_id", graph.project_id)
      .eq("id", bridge.data.deployment_id)
      .maybeSingle();
    if (deploymentRead.error) return databaseErrorResponse(deploymentRead.error);
    const deployment = storedDeploymentReplaySchema.safeParse(deploymentRead.data);
    if (
      !deployment.success
      || deployment.data.commit_sha !== bridge.data.merge_commit_sha
      || deployment.data.environment.toLowerCase() !== "production"
    ) {
      return unavailable(
        "deployment_record_identity_invalid",
        "The recorded deployment conflicts with the approved lifecycle gate.",
        409,
      );
    }
    let workerWoken = false;
    try {
      const dispatchResult = await dispatchGraphWorker(dispatchTarget(target), graph.id);
      workerWoken = dispatchResult.dispatched;
    } catch {
      workerWoken = false;
    }
    return jsonNoStore({
      gate: gateProjection({
        id: gate.id,
        kind: gate.kind,
        reason: null,
        stage: gate.stage,
        state: gate.state,
      }),
      workerWoken,
      release: {
        bridgeId: bridge.data.id,
        deploymentId: deployment.data.id,
        deploymentUrl: deployment.data.url,
        mergeCommitSha: deployment.data.commit_sha,
      },
      note: "The exact Production deployment and DEPLOYMENT approval were already recorded. No provider action was repeated.",
    });
  }

  const artifactResult = await readDeploymentArtifact(client, gate, evidenceArtifactId);
  if ("response" in artifactResult && artifactResult.response) return artifactResult.response;
  if (!("artifact" in artifactResult) || !artifactResult.artifact) {
    return unavailable("deployment_evidence_missing", "The completed DEPLOY anchor is unavailable.", 409);
  }
  const anchor = deploymentAnchorArtifactSchema.safeParse(artifactResult.artifact.payload);
  if (
    !anchor.success
    || anchor.data.repository.toLowerCase() !== target.repository_full_name.toLowerCase()
    || anchor.data.sha !== bridge.data.merge_commit_sha
    || anchor.data.ref !== graph.base_branch
  ) {
    return unavailable(
      "deployment_evidence_mismatch",
      "The completed DEPLOY anchor does not match the lifecycle repository, branch, and merge commit.",
      409,
    );
  }

  const intentRead = await client.rpc("request_graph_release_gate_approval", {
    p_bridge_id: bridge.data.id,
    p_evidence_artifact_id: artifactResult.artifact.id,
    p_gate_id: gate.id,
    p_reason: reason,
  }).single();
  if (intentRead.error) return databaseErrorResponse(intentRead.error);
  const intent = releaseApprovalIntentSchema.safeParse(intentRead.data);
  if (!intent.success) {
    return unavailable(
      "release_approval_intent_invalid",
      "The owner approval intent returned conflicting release identity.",
    );
  }

  const { owner, repository } = splitRepository(target.repository_full_name);
  const token = await createGitHubInstallationToken(
    getGitHubAppConfigurationForAppId(target.app_id),
    target.external_installation_id,
    {
      permissions: { deployments: "read", metadata: "read" },
      repositoryIds: [target.external_repository_id],
    },
  );
  const evidence = await getGitHubDeploymentEvidence(
    token.token,
    owner,
    repository,
    anchor.data.deploymentId,
  );
  const mismatch = productionDeploymentMismatch(evidence, anchor.data);
  if (mismatch) return unavailable("deployment_not_exactly_succeeded", mismatch, 409);

  const serviceClient = createSupabaseGitHubWebhookClient();
  const recordRead = await serviceClient.rpc("approve_graph_phase1c_deployment_gate_as_worker", {
    p_commit_sha: evidence.sha,
    p_completed_at: evidence.completedAt,
    p_consume_nonce: intent.data.consume_nonce,
    p_environment: evidence.environment,
    p_external_deployment_id: evidence.deploymentId,
    p_github_repository_id: graph.github_repository_id,
    p_intent_id: intent.data.intent_id,
    p_started_at: evidence.startedAt,
    p_status: evidence.status,
    p_url: evidence.environmentUrl,
  });
  if (recordRead.error) return databaseErrorResponse(recordRead.error);
  const recordRaw = Array.isArray(recordRead.data) ? recordRead.data[0] : recordRead.data;
  const recorded = releaseGateApprovalSchema.safeParse(recordRaw);
  if (
    !recorded.success
    || recorded.data.bridge_id !== bridge.data.id
    || !recorded.data.deployment_id
    || (bridge.data.deployment_id && recorded.data.deployment_id !== bridge.data.deployment_id)
  ) {
    return unavailable(
      "deployment_record_identity_invalid",
      "The deployment evidence boundary returned conflicting lifecycle identity.",
    );
  }

  const decision = {
    gate: {
      id: gate.id,
      kind: gate.kind,
      reason: recorded.data.gate_reason,
      stage: gate.stage,
      state: recorded.data.gate_state,
    },
  };

  let workerWoken = false;
  try {
    const dispatchResult = await dispatchGraphWorker(dispatchTarget(target), graph.id);
    workerWoken = dispatchResult.dispatched;
  } catch {
    workerWoken = false;
  }
  return jsonNoStore({
    gate: gateProjection(decision.gate),
    workerWoken,
    release: {
      bridgeId: bridge.data.id,
      deploymentId: recorded.data.deployment_id,
      deploymentUrl: evidence.environmentUrl,
      mergeCommitSha: evidence.sha,
    },
    note: workerWoken
      ? "The exact successful Production deployment is recorded and the DEPLOYMENT gate is approved. The graph worker has been woken to observe health; it cannot deploy."
      : "The exact successful Production deployment is recorded and the DEPLOYMENT gate is approved. The graph executor is Not Connected, so health observation has not started.",
  });
}

async function decideOrdinaryGate(
  client: TenantClient,
  organizationId: string,
  gate: Gate,
  graph: Graph,
  approved: boolean,
  reason: string | null,
): Promise<Response> {
  const decision = await decideGate(client, gate.id, approved, reason);
  if ("response" in decision && decision.response) return decision.response;
  if (!("gate" in decision) || !decision.gate) {
    return unavailable("gate_decision_invalid", "The gate decision could not be verified.");
  }
  let workerWoken = false;
  if (approved) {
    try {
      const targetResult = await readTarget(client, organizationId, graph.project_id);
      if ("target" in targetResult && targetResult.target) {
        const dispatchResult = await dispatchGraphWorker(dispatchTarget(targetResult.target), graph.id);
        workerWoken = dispatchResult.dispatched;
      }
    } catch {
      workerWoken = false;
    }
  }
  return jsonNoStore({
    gate: gateProjection(decision.gate),
    workerWoken,
    note: approved
      ? workerWoken
        ? "The gate is approved and the executor worker has been woken to continue the graph."
        : "The gate is approved. The executor is Not Connected, so nothing runs; manual and scheduled events cannot bypass the global worker gate."
      : "The gate is rejected. The stage stays blocked and its dependents stay skipped.",
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ gateId: string }> },
): Promise<Response> {
  try {
    assertSameOriginRequest(request);
    const { gateId } = await params;
    if (!z.string().uuid().safeParse(gateId).success) {
      return unavailable("invalid_gate", "The gate identifier is invalid.", 400);
    }
    const parsed = decisionSchema.safeParse(await readBoundedJson(request, 4 * 1024));
    if (!parsed.success) {
      return unavailable("invalid_request", "Send `approved`, and optionally a `reason`.", 400);
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    const inspected = await readGateAndGraph(client, activeOrganization.id, gateId);
    if ("response" in inspected && inspected.response) return inspected.response;
    if (!("gate" in inspected) || !inspected.gate || !("graph" in inspected) || !inspected.graph) {
      return unavailable("gate_identity_invalid", "The lifecycle gate identity could not be verified.");
    }
    const { gate, graph } = inspected;
    const fullLifecycle = exactFullLifecycle(graph);
    const architectureApproval = parsed.data.approved && fullLifecycle
      && gate.kind === "HUMAN" && gate.stage === "ARCHITECTURE";
    const testApproval = parsed.data.approved && fullLifecycle
      && gate.kind === "HUMAN" && gate.stage === "TEST";
    const deploymentApproval = parsed.data.approved && fullLifecycle
      && gate.kind === "HUMAN" && gate.stage === "DEPLOYMENT";

    if ((architectureApproval || testApproval || deploymentApproval) && activeOrganization.role !== "owner") {
      return unavailable(
        "owner_required",
        "Only the organization owner can approve this Full Lifecycle release gate.",
        403,
      );
    }
    if ((architectureApproval || testApproval || deploymentApproval) && !parsed.data.evidenceArtifactId) {
      return unavailable(
        "evidence_artifact_required",
        "Approve the exact architecture or deployment artifact shown on this lifecycle stage.",
        400,
      );
    }
    if (architectureApproval) {
      return approveArchitecture(
        client,
        activeOrganization.id,
        gate,
        graph,
        parsed.data.evidenceArtifactId!,
        parsed.data.reason ?? null,
      );
    }
    if (testApproval) {
      return approveMergedTest(
        client,
        activeOrganization.id,
        gate,
        graph,
        parsed.data.evidenceArtifactId!,
        parsed.data.reason ?? null,
      );
    }
    if (deploymentApproval) {
      return approveObservedDeployment(
        client,
        activeOrganization.id,
        gate,
        graph,
        parsed.data.evidenceArtifactId!,
        parsed.data.reason ?? null,
      );
    }
    return decideOrdinaryGate(
      client,
      activeOrganization.id,
      gate,
      graph,
      parsed.data.approved,
      parsed.data.reason ?? null,
    );
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof GitHubApiError || error instanceof GitHubConfigurationError) {
      return githubRouteErrorResponse(error);
    }
    return jsonNoStore(
      { error: { code: "gate_decision_failed", message: "The gate decision could not be recorded." } },
      { status: 500 },
    );
  }
}
