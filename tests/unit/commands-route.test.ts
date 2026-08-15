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
const dependencyTaskA = "88888888-8888-4888-8888-888888888888";
const dependencyTaskB = "99999999-9999-4999-8999-999999999999";

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

type RegistryRow = Record<string, unknown>;

/** A thenable PostgREST-shaped builder resolving to fixed rows. */
function registryTable(rows: RegistryRow[] | null, error: { message: string } | null = null) {
  const result = { data: rows, error };
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    in: vi.fn(() => builder),
    then: (resolve: (value: typeof result) => unknown) => Promise.resolve(result).then(resolve),
  };
  return builder;
}

function configuredClient(options: {
  requiresApproval?: boolean;
  targetData?: typeof target | null;
  targetError?: { code?: string; message?: string } | null;
  /** project_connections rows; defaults to one legacy (unlabelled) mapping. */
  mappingRows?: RegistryRow[];
  connectionRows?: RegistryRow[];
  registryError?: boolean;
  /** Make record_connection_routing_decision fail. */
  decisionError?: boolean;
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
    if (name === "record_connection_routing_decision") {
      return Promise.resolve({
        data: options.decisionError ? null : "decision-id",
        error: options.decisionError ? { code: "42501", message: "denied" } : null,
      });
    }
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
  const from = vi.fn((table: string) => {
    if (options.registryError) return registryTable(null, { message: "registry unavailable" });
    if (table === "project_connections") {
      return registryTable(options.mappingRows ?? [
        { capability: null, connection_id: target.connection_id, priority: 100 },
      ]);
    }
    if (table === "connections") return registryTable(options.connectionRows ?? []);
    throw new Error(`Unexpected table ${table}`);
  });
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId, role: "owner" },
    client: { from, rpc },
  });
  return rpc;
}

/** A healthy, labelled, declared `repository.write` connection row. */
function routableConnection(id: string, overrides: RegistryRow = {}): RegistryRow {
  return {
    active_leases: 0,
    capabilities: ["repository.write"],
    external_account_label: "surgeservicesllc",
    health: "connected",
    id,
    max_concurrency: null,
    provider: "github",
    status: "connected",
    ...overrides,
  };
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
        acceptanceCriteria: ["The dashboard copy is reviewed."],
        agentRole: "qa",
        dependencyTaskIds: [],
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
      orchestration: {
        baseBranch: "main",
        dependencyTaskIds: [],
        effectiveRisk: "green",
      },
    });
  });

  it("canonicalizes dependency task references before durable persistence", async () => {
    const rpc = configuredClient({});

    const response = await POST(commandRequest("https://factory.example", {
      dependencyTaskIds: [dependencyTaskB, dependencyTaskA, dependencyTaskB],
    }));

    expect(response.status).toBe(202);
    expect(rpc).toHaveBeenNthCalledWith(2, "submit_command", expect.objectContaining({
      p_parameters: expect.objectContaining({
        dependencyTaskIds: [dependencyTaskA, dependencyTaskB],
      }),
    }));
    expect(await response.json()).toMatchObject({
      orchestration: { dependencyTaskIds: [dependencyTaskA, dependencyTaskB] },
    });
  });

  it("derives deterministic acceptance criteria when the caller submits none", async () => {
    const rpc = configuredClient({});

    const response = await POST(commandRequest("https://factory.example", {
      acceptanceCriteria: [],
      commandType: "mobile",
      prompt: "Make the experience work at narrow widths.",
    }));

    expect(response.status).toBe(202);
    expect(rpc).toHaveBeenNthCalledWith(2, "submit_command", expect.objectContaining({
      p_parameters: expect.objectContaining({
        acceptanceCriteria: [
          "The requested mobile behavior is verified at supported responsive widths.",
        ],
      }),
    }));
  });

  it("rejects non-canonical dependency task identifiers before tenant access", async () => {
    const response = await POST(commandRequest("https://factory.example", {
      dependencyTaskIds: ["ABCDEFAB-CDEF-ABCD-EFAB-CDEFABCDEFAB"],
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_command" } });
    expect(requireActiveOrganization).not.toHaveBeenCalled();
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

  it("proceeds on legacy mappings and says the router was not authoritative", async () => {
    // The default fixture is one unlabelled mapping — the pre-2D world. The
    // command must proceed exactly as before, and the response must say which
    // path chose the connection rather than implying the router did.
    configuredClient({});

    const response = await POST(commandRequest("https://factory.example"));

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      orchestration: {
        connectionRouting: {
          mode: "legacy",
          reason: expect.stringContaining("No capability-labelled connection mappings"),
        },
      },
    });
  });

  it("routes through the identity router when the project labels its mappings", async () => {
    const rpc = configuredClient({
      connectionRows: [routableConnection(target.connection_id)],
      mappingRows: [
        { capability: "repository.write", connection_id: target.connection_id, priority: 10 },
      ],
    });

    const response = await POST(commandRequest("https://factory.example"));

    expect(response.status).toBe(202);
    // The decision is durable evidence, recorded before the command persists.
    expect(rpc).toHaveBeenCalledWith("record_connection_routing_decision", {
      p_capability: "repository.write",
      p_connection_id: target.connection_id,
      p_considered_count: 1,
      p_decision: "SELECTED",
      p_project_id: projectId,
      p_refusal_code: null,
      p_rejected: [],
      p_used_fallback: false,
    });
    expect(await response.json()).toMatchObject({
      orchestration: {
        connectionRouting: {
          connectionId: target.connection_id,
          mode: "routed",
          rejected: [],
          usedFallback: false,
        },
      },
    });
  });

  it("refuses the command when the router refuses, naming the router's reason", async () => {
    // The one labelled mapping points at an unauthorized connection. Routing
    // must refuse the submission before any GitHub call or persistence — an
    // unauthorized identity is not a tiebreak candidate.
    const rpc = configuredClient({
      connectionRows: [routableConnection(target.connection_id, { health: "unauthorized" })],
      mappingRows: [
        { capability: "repository.write", connection_id: target.connection_id, priority: 10 },
      ],
    });

    const response = await POST(commandRequest("https://factory.example"));

    expect(response.status).toBe(409);
    // The refusal is recorded — an audit of only selections would read as if
    // the router never said no.
    expect(rpc).toHaveBeenCalledWith("record_connection_routing_decision", expect.objectContaining({
      p_connection_id: null,
      p_decision: "REFUSED",
      p_refusal_code: "CONNECTION_UNHEALTHY",
    }));
    expect(await response.json()).toMatchObject({
      error: {
        code: "connection_routing_refused",
        message: expect.stringContaining("identity router refused"),
      },
    });
    expect(createGitHubInstallationToken).not.toHaveBeenCalled();
    expect(dispatchPhase1CWorker).not.toHaveBeenCalled();
  });

  it("fails the submission when the routing decision cannot be recorded", async () => {
    // Acting on an unrecorded decision would be exactly the unauditable
    // routing the evidence table exists to end.
    configuredClient({
      connectionRows: [routableConnection(target.connection_id)],
      decisionError: true,
      mappingRows: [
        { capability: "repository.write", connection_id: target.connection_id, priority: 10 },
      ],
    });

    const response = await POST(commandRequest("https://factory.example"));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(createGitHubInstallationToken).not.toHaveBeenCalled();
    expect(dispatchPhase1CWorker).not.toHaveBeenCalled();
  });

  it("surfaces a routing disagreement instead of letting either side guess", async () => {
    // The router selects a different (eligible) connection than the resolved
    // primary binding. Contradictory mappings are an owner problem to fix,
    // never a silent tiebreak.
    const otherConnection = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
    configuredClient({
      connectionRows: [routableConnection(otherConnection)],
      mappingRows: [
        { capability: "repository.write", connection_id: otherConnection, priority: 10 },
      ],
    });

    const response = await POST(commandRequest("https://factory.example"));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "connection_routing_disagreement" },
    });
    expect(createGitHubInstallationToken).not.toHaveBeenCalled();
    expect(dispatchPhase1CWorker).not.toHaveBeenCalled();
  });

  it("fails closed when the connection registry cannot be read", async () => {
    // A registry outage must not silently bypass routing enforcement by
    // degrading to the legacy path.
    configuredClient({ registryError: true });

    const response = await POST(commandRequest("https://factory.example"));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "connection_registry_unavailable" },
    });
    expect(dispatchPhase1CWorker).not.toHaveBeenCalled();
  });
});
