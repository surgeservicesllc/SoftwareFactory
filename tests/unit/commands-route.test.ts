import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createGitHubInstallationToken,
  dispatchPhase1CWorker,
  getGitHubAppConfigurationForAppId,
  getGitHubBranchReference,
  requireActiveOrganization,
} = vi.hoisted(() => ({
  createGitHubInstallationToken: vi.fn(),
  dispatchPhase1CWorker: vi.fn(),
  getGitHubAppConfigurationForAppId: vi.fn(),
  getGitHubBranchReference: vi.fn(),
  requireActiveOrganization: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/github/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/github/client")>()),
  createGitHubInstallationToken,
}));
vi.mock("@/lib/github/config", () => ({ getGitHubAppConfigurationForAppId }));
vi.mock("@/lib/github/repository", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/github/repository")>()),
  getGitHubBranchReference,
}));
vi.mock("@/lib/orchestration/dispatch", () => ({ dispatchPhase1CWorker }));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization,
}));

import { POST } from "@/app/api/commands/route";
import { GitHubApiError } from "@/lib/github/client";

const organizationId = "44444444-4444-4444-8444-444444444444";
const projectId = "11111111-1111-4111-8111-111111111111";
const commandId = "22222222-2222-4222-8222-222222222222";

const target = {
  app_id: 4582606,
  base_branch: "main",
  connection_id: "55555555-5555-4555-8555-555555555555",
  external_installation_id: 153479019,
  external_repository_id: 1332327462,
  internal_installation_id: "66666666-6666-4666-8666-666666666666",
  project_id: projectId,
  repository_full_name: "surgeservicesllc/SoftwareFactory",
  repository_id: "77777777-7777-4777-8777-777777777777",
};

function commandRequest(
  origin?: string,
  overrides: Record<string, unknown> = {},
) {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (origin) headers.set("Origin", origin);
  return new Request("https://factory.example/api/commands", {
    body: JSON.stringify({
      acceptanceCriteria: ["The dashboard copy is reviewed."],
      commandType: "audit",
      idempotencyKey: "command:test:1",
      parameters: {},
      projectId,
      prompt: "Review the dashboard copy.",
      risk: "green",
      ...overrides,
    }),
    headers,
    method: "POST",
  });
}

function configuredClient(options: {
  requiresApproval?: boolean;
  targetData?: typeof target | null;
  targetError?: { code?: string; message?: string } | null;
}) {
  const submission = {
    command_id: commandId,
    command_state: options.requiresApproval ? "awaiting_approval" : "queued",
    requires_owner_approval: options.requiresApproval ?? false,
    task_id: "33333333-3333-4333-8333-333333333333",
    task_state: options.requiresApproval ? "awaiting_approval" : "queued",
    was_created: true,
  };
  const rpc = vi.fn((name: string) => {
    if (name === "record_phase1c_dispatch_outcome") {
      return Promise.resolve({ data: null, error: null });
    }
    return {
      single: vi.fn().mockResolvedValue(
        name === "resolve_phase1c_command_target"
          ? { data: options.targetData === undefined ? target : options.targetData, error: options.targetError ?? null }
          : { data: submission, error: null },
      ),
    };
  });
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId, role: "owner" },
    client: { rpc },
  });
  return rpc;
}

describe("POST /api/commands", () => {
  beforeEach(() => {
    createGitHubInstallationToken.mockReset().mockResolvedValue({ token: "installation-token" });
    dispatchPhase1CWorker.mockReset().mockResolvedValue(undefined);
    getGitHubAppConfigurationForAppId.mockReset().mockReturnValue({ appId: 4582606 });
    getGitHubBranchReference.mockReset().mockResolvedValue({
      object: { sha: "a".repeat(40) },
      ref: "refs/heads/main",
    });
    requireActiveOrganization.mockReset();
  });

  it.each([undefined, "https://attacker.example"])(
    "rejects a cookie-authenticated mutation from origin %s before Supabase",
    async (origin) => {
      const response = await POST(commandRequest(origin));

      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({
        error: {
          code: "invalid_request_origin",
          message: "The request origin is not allowed.",
        },
      });
      expect(response.headers.get("cache-control")).toContain("no-store");
      expect(requireActiveOrganization).not.toHaveBeenCalled();
    },
  );

  it("requires the organization owner before repository or provider access", async () => {
    const rpc = vi.fn();
    requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId, role: "admin" },
      client: { rpc },
    });

    const response = await POST(commandRequest("https://factory.example"));

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "owner_required" } });
    expect(rpc).not.toHaveBeenCalled();
    expect(createGitHubInstallationToken).not.toHaveBeenCalled();
  });

  it("resolves an exact live repository, persists, and wakes the durable worker", async () => {
    const rpc = configuredClient({});

    const response = await POST(commandRequest("https://factory.example"));

    expect(response.status).toBe(202);
    expect(rpc).toHaveBeenNthCalledWith(1, "resolve_phase1c_command_target", {
      p_organization_id: organizationId,
      p_project_id: projectId,
    });
    expect(rpc).toHaveBeenNthCalledWith(2, "submit_command", expect.objectContaining({
      p_parameters: expect.objectContaining({
        agentRole: "qa",
        model: "gpt-5.3-codex",
        provider: "openai",
        repositoryBinding: expect.objectContaining({ baseSha: "a".repeat(40) }),
      }),
      p_project_id: projectId,
      p_requested_risk: "green",
    }));
    expect(dispatchPhase1CWorker).toHaveBeenCalledWith({
      appId: 4582606,
      externalInstallationId: 153479019,
      externalRepositoryId: 1332327462,
      repositoryFullName: "surgeservicesllc/SoftwareFactory",
    }, commandId);
    expect(rpc).toHaveBeenNthCalledWith(3, "record_phase1c_dispatch_outcome", {
      p_command_id: commandId,
      p_organization_id: organizationId,
      p_outcome: "requested",
      p_reason_code: null,
    });
    expect(await response.json()).toMatchObject({
      execution: { started: false, workerDispatch: "requested" },
      idempotentReplay: false,
      orchestration: { baseBranch: "main", effectiveRisk: "green" },
    });
  });

  it("keeps the durable queue successful when worker notification is delayed", async () => {
    configuredClient({});
    dispatchPhase1CWorker.mockRejectedValue(new Error("provider unavailable"));

    const response = await POST(commandRequest("https://factory.example"));

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      execution: { started: false, workerDispatch: "delayed" },
    });
  });

  it("does not wake a worker for a RED command awaiting owner approval", async () => {
    configuredClient({ requiresApproval: true });

    const response = await POST(commandRequest("https://factory.example", {
      commandType: "security",
      prompt: "Review authentication and authorization controls.",
      risk: "red",
    }));

    expect(response.status).toBe(202);
    expect(dispatchPhase1CWorker).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      execution: { workerDispatch: "not_applicable" },
      requiresOwnerApproval: true,
    });
  });

  it("rejects a project without an exact live execution target", async () => {
    const rpc = configuredClient({ targetData: null, targetError: { code: "P0002" } });

    const response = await POST(commandRequest("https://factory.example"));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "project_not_executable" },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(dispatchPhase1CWorker).not.toHaveBeenCalled();
  });

  it("fails closed before persistence when the exact base SHA cannot be verified", async () => {
    const rpc = configuredClient({});
    getGitHubBranchReference.mockRejectedValue(
      new GitHubApiError(404, "github_resource_not_found", "not found"),
    );

    const response = await POST(commandRequest("https://factory.example"));

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error: {
        code: "project_not_executable",
        message: "The connected repository base branch could not be verified safely.",
      },
    });
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(dispatchPhase1CWorker).not.toHaveBeenCalled();
  });

  it("raises inferred protected work to RED before persistence", async () => {
    const rpc = configuredClient({ requiresApproval: true });

    await POST(commandRequest("https://factory.example", {
      commandType: "fix_bug",
      prompt: "Fix the OAuth session authorization bug.",
      risk: "green",
    }));

    expect(rpc).toHaveBeenNthCalledWith(2, "submit_command", expect.objectContaining({
      p_requested_risk: "red",
    }));
    expect(dispatchPhase1CWorker).not.toHaveBeenCalled();
  });
});
