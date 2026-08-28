// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  attachError: null as null | { code: string; message: string },
  createGitHubInstallationToken: vi.fn(),
  createServiceClient: vi.fn(),
  dispatchGraphWorker: vi.fn(),
  dispatchPhase1CWorker: vi.fn(),
  events: [] as string[],
  getGitHubAppConfigurationForAppId: vi.fn(),
  getGitHubBranchReference: vi.fn(),
  getGitHubDeploymentEvidence: vi.fn(),
  getGitHubPullRequest: vi.fn(),
  requireActiveOrganization: vi.fn(),
  requiresApproval: false as boolean,
  rpc: vi.fn(),
  serviceRpc: vi.fn(),
  tableRows: new Map<string, unknown>(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization: harness.requireActiveOrganization,
}));
vi.mock("@/lib/orchestration/dispatch", () => ({
  dispatchGraphWorker: harness.dispatchGraphWorker,
  dispatchPhase1CWorker: harness.dispatchPhase1CWorker,
}));
vi.mock("@/lib/github/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/github/client")>()),
  createGitHubInstallationToken: harness.createGitHubInstallationToken,
}));
vi.mock("@/lib/github/config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/github/config")>()),
  getGitHubAppConfigurationForAppId: harness.getGitHubAppConfigurationForAppId,
}));
vi.mock("@/lib/github/repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/github/repository")>()),
  getGitHubBranchReference: harness.getGitHubBranchReference,
  getGitHubDeploymentEvidence: harness.getGitHubDeploymentEvidence,
  getGitHubPullRequest: harness.getGitHubPullRequest,
}));
vi.mock("@/lib/github/service-role", () => ({
  createSupabaseGitHubWebhookClient: harness.createServiceClient,
}));

import { POST } from "@/app/api/graph-gates/[gateId]/decide/route";

const gateId = "a0000000-0000-4000-8000-000000000001";
const graphId = "b0000000-0000-4000-8000-000000000002";
const projectId = "c0000000-0000-4000-8000-000000000003";
const organizationId = "10000000-0000-4000-8000-000000000001";
const repositoryId = "d0000000-0000-4000-8000-000000000004";
const nodeId = "e0000000-0000-4000-8000-000000000005";
const graphRunId = "f0000000-0000-4000-8000-000000000006";
const userId = "16000000-0000-4000-8000-000000000012";
const nodeRunId = "11000000-0000-4000-8000-000000000007";
const artifactId = "12000000-0000-4000-8000-000000000008";
const bridgeId = "13000000-0000-4000-8000-000000000009";
const commandId = "14000000-0000-4000-8000-000000000010";
const taskId = "15000000-0000-4000-8000-000000000011";
const pullRequestId = "17000000-0000-4000-8000-000000000013";
const deploymentId = "21000000-0000-4000-8000-000000000017";
const approvalIntentId = "22000000-0000-4000-8000-000000000018";
const approvalConsumeNonce = "23000000-0000-4000-8000-000000000019";
const baseSha = "1".repeat(40);
const headSha = "2".repeat(40);
const mergeSha = "3".repeat(40);

const targetRow = {
  app_id: 7,
  base_branch: "main",
  connection_id: "18000000-0000-4000-8000-000000000014",
  external_installation_id: 1234,
  external_repository_id: 5678,
  internal_installation_id: "19000000-0000-4000-8000-000000000015",
  project_id: projectId,
  repository_full_name: "owner/repository",
  repository_id: repositoryId,
};

const ordinaryGate = {
  graph_id: graphId,
  id: gateId,
  kind: "HUMAN",
  node_id: nodeId,
  opened_by_run_id: graphRunId,
  organization_id: organizationId,
  stage: "DECISION",
  state: "OPEN",
};

const ordinaryGraph = {
  base_branch: null,
  base_sha: null,
  github_repository_id: null,
  goal: "Choose a plan",
  id: graphId,
  is_lifecycle: true,
  organization_id: organizationId,
  project_id: projectId,
  template_key: null,
  template_version: null,
};

function fullLifecycle(stage: "ARCHITECTURE" | "TEST" | "DEPLOYMENT") {
  return {
    gate: { ...ordinaryGate, stage },
    graph: {
      ...ordinaryGraph,
      base_branch: "main",
      base_sha: baseSha,
      github_repository_id: repositoryId,
      goal: "Build the approved feature",
      template_key: "full_lifecycle",
      template_version: 2,
    },
  };
}

function request(body: unknown, origin = "https://factory.example") {
  return new Request(`https://factory.example/api/graph-gates/${gateId}/decide`, {
    method: "POST",
    headers: { "Content-Type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

const params = { params: Promise.resolve({ gateId }) };

function queryFor(table: string) {
  const chain = {
    eq: vi.fn(),
    in: vi.fn(),
    limit: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data: harness.tableRows.get(table) ?? null, error: null })),
    order: vi.fn(),
    select: vi.fn(),
  };
  chain.select.mockReturnValue(chain);
  chain.eq.mockReturnValue(chain);
  chain.in.mockReturnValue(chain);
  chain.order.mockReturnValue(chain);
  chain.limit.mockReturnValue(chain);
  return chain;
}

function setLifecycle(stage: "ARCHITECTURE" | "TEST" | "DEPLOYMENT") {
  const lifecycle = fullLifecycle(stage);
  harness.tableRows.set("graph_gates", lifecycle.gate);
  harness.tableRows.set("graphs", lifecycle.graph);
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.attachError = null;
  harness.events.length = 0;
  harness.requiresApproval = false;
  harness.tableRows.clear();
  harness.tableRows.set("graph_gates", ordinaryGate);
  harness.tableRows.set("graphs", ordinaryGraph);
  harness.requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId, role: "owner" },
    client: {
      from: vi.fn((table: string) => queryFor(table)),
      rpc: harness.rpc,
    },
    user: { id: userId },
  });
  harness.rpc.mockImplementation((functionName: string) => {
    if (functionName === "resolve_phase1c_command_target") {
      return { single: async () => ({ data: targetRow, error: null }) };
    }
    if (functionName === "approve_graph_phase1c_architecture_gate") {
      harness.events.push(functionName);
      return {
        single: async () => ({
          data: {
            architecture_artifact_id: artifactId,
            bridge_id: bridgeId,
            gate_reason: "Architecture reviewed",
            gate_state: "APPROVED",
            graph_id: graphId,
            graph_run_id: graphRunId,
            implementation_node_id: "20000000-0000-4000-8000-000000000016",
            organization_id: organizationId,
            project_id: projectId,
          },
          error: null,
        }),
      };
    }
    if (functionName === "submit_and_attach_graph_phase1c_command") {
      return Promise.resolve({
        data: harness.attachError ? null : [{
          bridge_id: bridgeId,
          command_id: commandId,
          command_state: harness.requiresApproval ? "awaiting_approval" : "queued",
          requires_owner_approval: harness.requiresApproval,
          task_id: taskId,
          task_state: harness.requiresApproval ? "awaiting_approval" : "queued",
          was_created: true,
        }],
        error: harness.attachError,
      });
    }
    if (functionName === "request_graph_release_gate_approval") {
      harness.events.push(functionName);
      return {
        single: async () => ({
          data: {
            consume_nonce: approvalConsumeNonce,
            intent_id: approvalIntentId,
          },
          error: null,
        }),
      };
    }
    if (functionName === "decide_node_gate") {
      harness.events.push("decide");
      return Promise.resolve({
        data: { id: gateId, state: "APPROVED", stage: ordinaryGate.stage, kind: "HUMAN", reason: null },
        error: null,
      });
    }
    return Promise.resolve({ data: null, error: null });
  });
  harness.createServiceClient.mockReturnValue({ rpc: harness.serviceRpc });
  harness.serviceRpc.mockImplementation((name: string) => {
    harness.events.push(name);
    if (name === "approve_graph_phase1c_test_gate_as_worker") {
      return Promise.resolve({
        data: [{
          bridge_id: bridgeId,
          gate_reason: null,
          gate_state: "APPROVED",
          head_sha: headSha,
          merge_commit_sha: mergeSha,
        }],
        error: null,
      });
    }
    if (name === "approve_graph_phase1c_deployment_gate_as_worker") {
      return Promise.resolve({
        data: [{
          bridge_id: bridgeId,
          deployment_id: deploymentId,
          gate_reason: null,
          gate_state: "APPROVED",
        }],
        error: null,
      });
    }
    return Promise.resolve({ data: bridgeId, error: null });
  });
  harness.createGitHubInstallationToken.mockResolvedValue({ token: "installation-token" });
  harness.getGitHubAppConfigurationForAppId.mockReturnValue({ appId: 7 });
  harness.getGitHubBranchReference.mockImplementation(async () => {
    harness.events.push("base-verified");
    return { object: { sha: baseSha } };
  });
  harness.getGitHubDeploymentEvidence.mockResolvedValue({
    completedAt: "2026-08-27T12:05:00.000Z",
    creatorLogin: "vercel[bot]",
    deploymentId: 6130925898,
    environment: "Production",
    environmentUrl: "https://softwarefactory-exact-owner.vercel.app",
    productionEnvironment: true,
    ref: "main",
    sha: mergeSha,
    startedAt: "2026-08-27T12:00:00.000Z",
    status: "success",
    statusCreatorLogin: "vercel[bot]",
    task: "deploy",
  });
  harness.getGitHubPullRequest.mockImplementation(async () => {
    harness.events.push("github-pr-read");
    return {
      baseBranch: "main",
      headBranch: "factory/change",
      headSha,
      merged: true,
      mergedAt: "2026-08-27T12:00:00.000Z",
      mergeCommitSha: mergeSha,
      number: 42,
      state: "closed",
      url: "https://github.com/owner/repository/pull/42",
    };
  });
  harness.dispatchGraphWorker.mockResolvedValue(undefined);
  harness.dispatchPhase1CWorker.mockResolvedValue(undefined);
});

describe("deciding a lifecycle gate", () => {
  it("keeps ordinary gate behavior and wakes the graph worker", async () => {
    const response = await POST(request({ approved: true }), params);
    expect(response.status).toBe(200);
    expect(harness.rpc).toHaveBeenCalledWith("decide_node_gate", {
      p_gate_id: gateId,
      p_approved: true,
      p_reason: null,
    });
    expect(harness.dispatchGraphWorker).toHaveBeenCalledWith(
      {
        appId: targetRow.app_id,
        externalInstallationId: targetRow.external_installation_id,
        externalRepositoryId: targetRow.external_repository_id,
        repositoryFullName: targetRow.repository_full_name,
      },
      graphId,
    );
  });

  it("records an ordinary rejection and wakes nothing", async () => {
    const response = await POST(request({ approved: false, reason: "not ready" }), params);
    expect(response.status).toBe(200);
    expect(harness.dispatchGraphWorker).not.toHaveBeenCalled();
    expect(harness.dispatchPhase1CWorker).not.toHaveBeenCalled();
  });

  it("requires the owner before approving Full Lifecycle architecture", async () => {
    setLifecycle("ARCHITECTURE");
    harness.requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId, role: "admin" },
      client: { from: vi.fn((table: string) => queryFor(table)), rpc: harness.rpc },
      user: { id: userId },
    });
    const response = await POST(request({ approved: true }), params);
    expect(response.status).toBe(403);
    expect(harness.getGitHubBranchReference).not.toHaveBeenCalled();
    expect(harness.rpc).not.toHaveBeenCalledWith("decide_node_gate", expect.anything());
  });

  it("requires an exact evidence artifact for Full Lifecycle architecture", async () => {
    setLifecycle("ARCHITECTURE");
    const response = await POST(request({ approved: true }), params);
    expect(response.status).toBe(400);
    expect(harness.getGitHubBranchReference).not.toHaveBeenCalled();
    expect(harness.rpc).not.toHaveBeenCalledWith(
      "approve_graph_phase1c_architecture_gate",
      expect.anything(),
    );
  });

  it("approves architecture only after exact base verification, attaches the command, then wakes Phase 1C", async () => {
    setLifecycle("ARCHITECTURE");
    harness.tableRows.set("node_runs", { id: nodeRunId, state: "VERIFYING" });
    harness.tableRows.set("graph_artifacts", {
      id: artifactId,
      kind: "RAW",
      payload: { answer: "Add the bounded feature." },
    });
    const response = await POST(request({
      approved: true,
      evidenceArtifactId: artifactId,
      reason: "Architecture reviewed",
    }), params);
    const body = await response.json() as { note: string; phase1c: { bridgeId: string } };
    expect(response.status).toBe(200);
    expect(harness.events.indexOf("base-verified"))
      .toBeLessThan(harness.events.indexOf("approve_graph_phase1c_architecture_gate"));
    expect(harness.rpc).toHaveBeenCalledWith("approve_graph_phase1c_architecture_gate", {
      p_architecture_artifact_id: artifactId,
      p_gate_id: gateId,
      p_reason: "Architecture reviewed",
    });
    const submitCall = harness.rpc.mock.calls.find(
      ([name]) => name === "submit_and_attach_graph_phase1c_command",
    );
    expect(submitCall?.[1]).toEqual(expect.objectContaining({
      p_bridge_id: bridgeId,
      p_parameters: expect.objectContaining({
        commandType: "build_feature",
        executionMode: "manual",
        repositoryBinding: expect.objectContaining({ baseBranch: "main", baseSha }),
      }),
    }));
    expect(submitCall?.[1].p_parameters).not.toHaveProperty("graphContext");
    expect(harness.serviceRpc).not.toHaveBeenCalledWith("bind_graph_phase1c_run_as_worker", expect.anything());
    expect(harness.dispatchPhase1CWorker).toHaveBeenCalledWith(expect.anything(), commandId);
    expect(body.phase1c).toMatchObject({ bridgeId });
    expect(body.note).toContain("no merge or deployment was authorized");
  });

  it("refuses architecture before deciding when the base branch advanced", async () => {
    setLifecycle("ARCHITECTURE");
    harness.getGitHubBranchReference.mockResolvedValue({ object: { sha: "9".repeat(40) } });
    const response = await POST(request({ approved: true, evidenceArtifactId: artifactId }), params);
    expect(response.status).toBe(409);
    expect(harness.rpc).not.toHaveBeenCalledWith("approve_graph_phase1c_architecture_gate", expect.anything());
    expect(harness.rpc).not.toHaveBeenCalledWith(
      "submit_and_attach_graph_phase1c_command",
      expect.anything(),
    );
  });

  it("reports Not Connected after attaching when the Phase 1C wake fails", async () => {
    setLifecycle("ARCHITECTURE");
    harness.tableRows.set("node_runs", { id: nodeRunId, state: "VERIFYING" });
    harness.tableRows.set("graph_artifacts", { id: artifactId, kind: "RAW", payload: { answer: "Add the feature." } });
    harness.dispatchPhase1CWorker.mockRejectedValue(new Error("worker offline"));
    const response = await POST(request({ approved: true, evidenceArtifactId: artifactId }), params);
    const body = await response.json() as { workerWoken: boolean; note: string };
    expect(response.status).toBe(200);
    expect(body.workerWoken).toBe(false);
    expect(body.note).toContain("Not Connected");
    expect(harness.rpc).toHaveBeenCalledWith(
      "submit_and_attach_graph_phase1c_command",
      expect.anything(),
    );
  });

  it("attaches an awaiting-approval command before returning and dispatches nothing", async () => {
    setLifecycle("ARCHITECTURE");
    harness.requiresApproval = true;
    harness.tableRows.set("node_runs", { id: nodeRunId, state: "VERIFYING" });
    harness.tableRows.set("graph_artifacts", { id: artifactId, kind: "RAW", payload: { answer: "Add the feature." } });
    const response = await POST(request({ approved: true, evidenceArtifactId: artifactId }), params);
    const body = await response.json() as { workerWoken: boolean; note: string };
    expect(response.status).toBe(200);
    expect(harness.rpc).toHaveBeenCalledWith("submit_and_attach_graph_phase1c_command", {
      p_bridge_id: bridgeId,
      p_parameters: expect.any(Object),
    });
    expect(body.workerWoken).toBe(false);
    expect(body.note).toContain("separate exact owner approval");
    expect(harness.dispatchPhase1CWorker).not.toHaveBeenCalled();
  });

  it("fails closed when the durable command attachment is refused", async () => {
    setLifecycle("ARCHITECTURE");
    harness.attachError = { code: "23514", message: "bridge command identity mismatch" };
    harness.tableRows.set("node_runs", { id: nodeRunId, state: "VERIFYING" });
    harness.tableRows.set("graph_artifacts", { id: artifactId, kind: "RAW", payload: { answer: "Add the feature." } });
    const response = await POST(request({ approved: true, evidenceArtifactId: artifactId }), params);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(harness.dispatchPhase1CWorker).not.toHaveBeenCalled();
  });

  it("replays an already-approved architecture gate without re-deciding it", async () => {
    setLifecycle("ARCHITECTURE");
    const gate = harness.tableRows.get("graph_gates") as typeof ordinaryGate;
    harness.tableRows.set("graph_gates", { ...gate, state: "APPROVED" });
    harness.tableRows.set("node_runs", { id: nodeRunId, state: "VERIFYING" });
    harness.tableRows.set("graph_artifacts", { id: artifactId, kind: "RAW", payload: { answer: "Add the feature." } });
    const response = await POST(request({ approved: true, evidenceArtifactId: artifactId }), params);
    expect(response.status).toBe(200);
    expect(harness.rpc).not.toHaveBeenCalledWith("decide_node_gate", expect.anything());
    expect(harness.rpc).toHaveBeenCalledWith("approve_graph_phase1c_architecture_gate", expect.anything());
    expect(harness.rpc).toHaveBeenCalledWith(
      "submit_and_attach_graph_phase1c_command",
      expect.anything(),
    );
    expect(harness.dispatchPhase1CWorker).toHaveBeenCalledWith(expect.anything(), commandId);
  });

  it("refuses TEST approval when GitHub says the exact PR is not merged", async () => {
    setLifecycle("TEST");
    harness.tableRows.set("graph_phase1c_bridges", {
      graph_id: graphId, head_sha: headSha, id: bridgeId, merge_commit_sha: null,
      organization_id: organizationId, project_id: projectId, pull_request_id: pullRequestId,
      state: "PULL_REQUEST_RECORDED",
    });
    harness.tableRows.set("pull_requests", {
      base_branch: "main", external_number: 42, head_branch: "factory/change", head_sha: headSha,
      id: pullRequestId, merge_commit_sha: null, merged_at: null, repository: "owner/repository", status: "draft",
    });
    harness.getGitHubPullRequest.mockResolvedValue({
      baseBranch: "main", headBranch: "factory/change", headSha, merged: false,
      mergedAt: null, mergeCommitSha: null, number: 42, state: "open",
      url: "https://github.com/owner/repository/pull/42",
    });
    const response = await POST(request({ approved: true, evidenceArtifactId: artifactId }), params);
    expect(response.status).toBe(409);
    expect(harness.serviceRpc).not.toHaveBeenCalledWith(
      "approve_graph_phase1c_test_gate_as_worker",
      expect.anything(),
    );
    expect(harness.rpc).not.toHaveBeenCalledWith("decide_node_gate", expect.anything());
  });

  it("records exact GitHub merge identity before approving TEST and waking observation", async () => {
    setLifecycle("TEST");
    harness.tableRows.set("graph_phase1c_bridges", {
      graph_id: graphId, head_sha: headSha, id: bridgeId, merge_commit_sha: null,
      organization_id: organizationId, project_id: projectId, pull_request_id: pullRequestId,
      state: "PULL_REQUEST_RECORDED",
    });
    harness.tableRows.set("pull_requests", {
      base_branch: "main", external_number: 42, head_branch: "factory/change", head_sha: headSha,
      id: pullRequestId, merge_commit_sha: null, merged_at: null, repository: "owner/repository", status: "draft",
    });
    const response = await POST(request({ approved: true, evidenceArtifactId: artifactId }), params);
    expect(response.status).toBe(200);
    expect(harness.serviceRpc).toHaveBeenCalledWith("approve_graph_phase1c_test_gate_as_worker", {
      p_base_branch: "main",
      p_consume_nonce: approvalConsumeNonce,
      p_external_number: 42,
      p_head_branch: "factory/change",
      p_head_sha: headSha,
      p_intent_id: approvalIntentId,
      p_merge_commit_sha: mergeSha,
      p_merged_at: "2026-08-27T12:00:00.000Z",
    });
    expect(harness.events).toContain("approve_graph_phase1c_test_gate_as_worker");
    expect(harness.events).not.toContain("decide");
    expect(harness.dispatchGraphWorker).toHaveBeenCalledWith(expect.anything(), graphId);
  });

  it("records exact successful Production evidence before approving DEPLOYMENT", async () => {
    setLifecycle("DEPLOYMENT");
    harness.tableRows.set("graph_phase1c_bridges", {
      deployment_id: null,
      graph_id: graphId,
      head_sha: headSha,
      id: bridgeId,
      merge_commit_sha: mergeSha,
      organization_id: organizationId,
      project_id: projectId,
      pull_request_id: pullRequestId,
      state: "MERGE_RECORDED",
    });
    harness.tableRows.set("node_runs", { id: nodeRunId, state: "VERIFYING" });
    harness.tableRows.set("graph_artifacts", {
      id: artifactId,
      kind: "ANCHOR",
      payload: {
        deploymentId: 6130925898,
        environment: "Production",
        environmentUrl: "https://softwarefactory-exact-owner.vercel.app",
        observation: "github_production_deployment",
        observedAt: "2026-08-27T12:05:01.000Z",
        ref: "main",
        repository: "owner/repository",
        sha: mergeSha,
        state: "success",
      },
    });

    const response = await POST(request({ approved: true, evidenceArtifactId: artifactId }), params);
    expect(response.status).toBe(200);
    expect(harness.getGitHubDeploymentEvidence).toHaveBeenCalledWith(
      "installation-token",
      "owner",
      "repository",
      6130925898,
    );
    expect(harness.serviceRpc).toHaveBeenCalledWith(
      "approve_graph_phase1c_deployment_gate_as_worker",
      {
        p_commit_sha: mergeSha,
        p_completed_at: "2026-08-27T12:05:00.000Z",
        p_consume_nonce: approvalConsumeNonce,
        p_environment: "Production",
        p_external_deployment_id: 6130925898,
        p_github_repository_id: repositoryId,
        p_intent_id: approvalIntentId,
        p_started_at: "2026-08-27T12:00:00.000Z",
        p_status: "success",
        p_url: "https://softwarefactory-exact-owner.vercel.app",
      },
    );
    expect(harness.events).toContain("approve_graph_phase1c_deployment_gate_as_worker");
    expect(harness.events).not.toContain("decide");
    expect(harness.dispatchGraphWorker).toHaveBeenCalledWith(expect.anything(), graphId);
  });

  it("refuses DEPLOYMENT approval when current provider evidence mismatches the anchor", async () => {
    setLifecycle("DEPLOYMENT");
    harness.tableRows.set("graph_phase1c_bridges", {
      deployment_id: null,
      graph_id: graphId,
      head_sha: headSha,
      id: bridgeId,
      merge_commit_sha: mergeSha,
      organization_id: organizationId,
      project_id: projectId,
      pull_request_id: pullRequestId,
      state: "MERGE_RECORDED",
    });
    harness.tableRows.set("node_runs", { id: nodeRunId, state: "VERIFYING" });
    harness.tableRows.set("graph_artifacts", {
      id: artifactId,
      kind: "ANCHOR",
      payload: {
        deploymentId: 6130925898,
        environment: "Production",
        environmentUrl: "https://softwarefactory-exact-owner.vercel.app",
        observation: "github_production_deployment",
        observedAt: "2026-08-27T12:05:01.000Z",
        ref: "main",
        repository: "owner/repository",
        sha: mergeSha,
        state: "success",
      },
    });
    harness.getGitHubDeploymentEvidence.mockResolvedValue({
      completedAt: "2026-08-27T12:05:00.000Z",
      creatorLogin: "vercel[bot]",
      deploymentId: 6130925898,
      environment: "Production",
      environmentUrl: "https://different-release.vercel.app",
      productionEnvironment: true,
      ref: "main",
      sha: mergeSha,
      startedAt: "2026-08-27T12:00:00.000Z",
      status: "success",
      statusCreatorLogin: "vercel[bot]",
      task: "deploy",
    });

    const response = await POST(request({ approved: true, evidenceArtifactId: artifactId }), params);
    expect(response.status).toBe(409);
    expect(harness.serviceRpc).not.toHaveBeenCalledWith(
      "approve_graph_phase1c_deployment_gate_as_worker",
      expect.anything(),
    );
    expect(harness.rpc).not.toHaveBeenCalledWith("decide_node_gate", expect.anything());
  });

  it("passes the database's human-gate refusal through", async () => {
    harness.rpc.mockImplementation((name: string) => name === "decide_node_gate"
      ? Promise.resolve({ data: null, error: { code: "42501", message: "owner or admin role is required" } })
      : name === "resolve_phase1c_command_target"
        ? { single: async () => ({ data: targetRow, error: null }) }
        : Promise.resolve({ data: null, error: null }));
    const response = await POST(request({ approved: true }), params);
    expect(response.status).toBe(403);
  });

  it("refuses a request from another origin", async () => {
    const response = await POST(request({ approved: true }, "https://evil.example"), params);
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it("refuses an invalid body", async () => {
    const response = await POST(request({ reason: "looks fine" }), params);
    expect(response.status).toBe(400);
    expect(harness.rpc).not.toHaveBeenCalled();
  });

  it("refuses an invalid gate identifier", async () => {
    const response = await POST(request({ approved: true }), {
      params: Promise.resolve({ gateId: "not-a-uuid" }),
    });
    expect(response.status).toBe(400);
    expect(harness.rpc).not.toHaveBeenCalled();
  });
});
