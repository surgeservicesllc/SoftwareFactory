import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createGitHubInstallationToken,
  dispatchPhase1CWorker,
  getGitHubAppConfigurationForAppId,
  getGitHubBranchReference,
  loadBotFabric,
  requireActiveOrganization,
} = vi.hoisted(() => ({
  createGitHubInstallationToken: vi.fn(),
  dispatchPhase1CWorker: vi.fn(),
  getGitHubAppConfigurationForAppId: vi.fn(),
  getGitHubBranchReference: vi.fn(),
  loadBotFabric: vi.fn(),
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
vi.mock("@/lib/bots/service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/bots/service")>()),
  loadBotFabric,
}));
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
const projectPipelineId = "10101010-1010-4010-8010-101010101010";
const pipelineTemplateId = "12121212-1212-4212-8212-121212121212";
const pipelineTemplateKey = "security_audit";
const assignmentId = "13131313-1313-4313-8313-131313131313";
const botId = "14141414-1414-4414-8414-141414141414";
const roleId = "15151515-1515-4515-8515-151515151515";
const routeId = "16161616-1616-4616-8616-161616161616";

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
      pipelineTemplateKey,
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

const configuredGrant = Object.freeze({
  preset: "developer",
  responsibilities: ["Implement and validate the requested change"],
  instructions: "Work only through an isolated draft pull request.",
  repositoryAccess: "write",
  branchStrategy: "per_task_branch",
  canOpenPullRequest: true,
  canMergePullRequest: false,
  pipelineAccess: "assigned",
  environmentAccess: "none",
  tools: ["repository"],
  requiresHumanApproval: true,
  maxConcurrentTasks: 2,
  priority: 1,
});

function routingCandidate(overrides: RegistryRow = {}): RegistryRow {
  return {
    project_pipeline_id: projectPipelineId,
    pipeline_template_key: pipelineTemplateKey,
    pipeline_template_id: pipelineTemplateId,
    assignment_id: assignmentId,
    bot_id: botId,
    bot_name: "Codex Audit Bot",
    role_id: roleId,
    role_slug: "developer",
    role_risk_ceiling: "red",
    assignment_status: "active",
    current_readiness: "ready",
    ai_account_status: "connected",
    provider: "openai",
    model: "gpt-5.3-codex",
    assignment_model: null,
    work_effort: "high",
    assignment_config: { ...configuredGrant },
    assigned_pipeline_keys: [pipelineTemplateKey],
    in_flight: 0,
    max_concurrent_tasks: 2,
    has_capacity: true,
    is_configured: true,
    assigned_at: "2026-08-21T12:00:00.000Z",
    ...overrides,
  };
}

function freshRoutingSnapshot(
  candidate: RegistryRow,
  effectiveRisk: "green" | "yellow" | "red" = "green",
  workEffort = String(candidate.work_effort),
): RegistryRow {
  return {
    schemaVersion: 1,
    command: { effectiveRisk },
    project: { organizationId, projectId },
    pipeline: {
      selectionId: String(candidate.project_pipeline_id),
      templateKey: String(candidate.pipeline_template_key),
      templateId: typeof candidate.pipeline_template_id === "string"
        ? candidate.pipeline_template_id
        : null,
    },
    assignment: {
      assignmentId: String(candidate.assignment_id),
      botId: String(candidate.bot_id),
      roleId: String(candidate.role_id),
      provider: String(candidate.provider),
      model: typeof candidate.assignment_model === "string"
        ? candidate.assignment_model
        : String(candidate.model),
      workEffort,
    },
  };
}

function factoryReplay(overrides: RegistryRow = {}): RegistryRow {
  return {
    command_id: commandId,
    task_id: "33333333-3333-4333-8333-333333333333",
    command_state: "queued",
    task_state: "queued",
    requires_owner_approval: false,
    was_created: false,
    route_id: routeId,
    project_pipeline_id: projectPipelineId,
    pipeline_template_key: pipelineTemplateKey,
    pipeline_template_id: pipelineTemplateId,
    assignment_id: assignmentId,
    bot_id: botId,
    role_id: roleId,
    routing_snapshot: {
      schemaVersion: 1,
      command: { effectiveRisk: "yellow" },
      project: { organizationId, projectId },
      pipeline: {
        selectionId: projectPipelineId,
        templateKey: pipelineTemplateKey,
        templateId: pipelineTemplateId,
      },
      assignment: {
        assignmentId,
        botId,
        roleId,
        provider: "openai",
        model: "gpt-5.3-codex",
        workEffort: "high",
      },
    },
    command_parameters: {
      executionMode: "manual",
      provider: "openai",
      model: "gpt-5.3-codex",
      repositoryBinding: {
        baseBranch: "stored-main",
        baseSha: "b".repeat(40),
      },
    },
    repository_full_name: "stored-owner/stored-repository",
    ...overrides,
  };
}

/** A thenable PostgREST-shaped builder resolving to fixed rows. */
function registryTable(rows: RegistryRow[] | null, error: { message: string } | null = null) {
  const result = { data: rows, error };
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn(() => builder),
    gt: vi.fn(() => builder),
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
  /** Running agent_runs rows counted as live leases. */
  runningRunRows?: RegistryRow[];
  /** Connection-specific provider_capacity_limits rows. */
  capacityLimitRows?: RegistryRow[];
  candidateRows?: RegistryRow[] | null;
  candidateError?: { code?: string; message?: string } | null;
  submitError?: { code?: string; message?: string } | null;
  submissionOverrides?: RegistryRow;
  allowCapacityReplay?: boolean;
  replayRows?: RegistryRow[] | null;
  replayError?: { code?: string; message?: string } | null;
}) {
  const candidateRows = options.candidateRows === undefined
    ? [routingCandidate()]
    : options.candidateRows;
  const rpc = vi.fn((name: string, parameters?: RegistryRow) => {
    if (name === "record_connection_routing_decision") {
      return Promise.resolve({
        data: options.decisionError ? null : "decision-id",
        error: options.decisionError ? { code: "42501", message: "denied" } : null,
      });
    }
    if (name === "list_factory_command_routing_candidates") {
      return Promise.resolve({ data: candidateRows, error: options.candidateError ?? null });
    }
    if (name === "resolve_factory_command_replay") {
      return Promise.resolve({
        data: options.replayRows === undefined ? [] : options.replayRows,
        error: options.replayError ?? null,
      });
    }
    if (name === "resolve_phase1c_command_target") {
      return {
        single: vi.fn().mockResolvedValue({
          data: options.targetData === undefined ? target : options.targetData,
          error: options.targetError ?? null,
        }),
      };
    }
    if (name === "submit_factory_command") {
      const selected = (candidateRows ?? []).find(
        (entry) => entry.assignment_id === parameters?.p_assignment_id,
      ) ?? routingCandidate();
      const submission = {
        command_id: commandId,
        command_state: options.requiresApproval ? "awaiting_approval" : "queued",
        requires_owner_approval: options.requiresApproval ?? false,
        task_id: "33333333-3333-4333-8333-333333333333",
        task_state: options.requiresApproval ? "awaiting_approval" : "queued",
        was_created: true,
        route_id: routeId,
        project_pipeline_id: selected.project_pipeline_id,
        pipeline_template_key: selected.pipeline_template_key,
        pipeline_template_id: selected.pipeline_template_id,
        assignment_id: selected.assignment_id,
        bot_id: selected.bot_id,
        role_id: selected.role_id,
        routing_snapshot: freshRoutingSnapshot(
          selected,
          options.requiresApproval ? "red" : "green",
        ),
        ...options.submissionOverrides,
      };
      const atCapacity = selected.has_capacity === false
        || (
          typeof selected.in_flight === "number"
          && typeof selected.max_concurrent_tasks === "number"
          && selected.in_flight >= selected.max_concurrent_tasks
        );
      const submitError = options.submitError ?? (
        atCapacity && !options.allowCapacityReplay
          ? { code: "55000", message: "selected bot assignment is at its concurrency limit" }
          : null
      );
      return {
        single: vi.fn().mockResolvedValue({
          data: submitError ? null : submission,
          error: submitError,
        }),
      };
    }
    throw new Error(`Unexpected RPC ${name}`);
  });
  const from = vi.fn((table: string) => {
    if (options.registryError) return registryTable(null, { message: "registry unavailable" });
    if (table === "project_connections") {
      return registryTable(options.mappingRows ?? [
        { capability: null, connection_id: target.connection_id, priority: 100 },
      ]);
    }
    if (table === "connections") return registryTable(options.connectionRows ?? []);
    if (table === "agent_runs") return registryTable(options.runningRunRows ?? []);
    if (table === "provider_capacity_limits") {
      return registryTable(options.capacityLimitRows ?? []);
    }
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
    loadBotFabric.mockReset().mockResolvedValue({
      assignments: [],
      bots: [{ id: botId, currentReadiness: "ready" }],
      projects: [],
      roles: [],
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

  it("requires an explicit selected pipeline key before tenant access", async () => {
    const response = await POST(commandRequest("https://factory.example", {
      pipelineTemplateKey: undefined,
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "invalid_command" } });
    expect(requireActiveOrganization).not.toHaveBeenCalled();
  });

  it("returns an exact stored replay before mutable target, routing, fabric, or GitHub reads", async () => {
    const rpc = configuredClient({
      candidateRows: [routingCandidate({
        assignment_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        bot_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        in_flight: 99,
        has_capacity: false,
      })],
      replayRows: [factoryReplay()],
      targetData: { ...target, base_branch: "changed-live-branch" },
    });
    loadBotFabric.mockRejectedValue(new Error("live fabric changed"));
    getGitHubBranchReference.mockRejectedValue(new Error("live base changed"));

    const response = await POST(commandRequest("https://factory.example", {
      risk: "green",
    }));

    expect(response.status).toBe(200);
    expect(rpc).toHaveBeenCalledWith("resolve_factory_command_replay", {
      p_organization_id: organizationId,
      p_project_id: projectId,
      p_pipeline_template_key: pipelineTemplateKey,
      p_prompt: "Review the dashboard copy.",
      p_requested_risk: "green",
      p_command_type: "audit",
      p_acceptance_criteria: ["The dashboard copy is reviewed."],
      p_dependency_task_ids: [],
      p_idempotency_key: "command:test:1",
    });
    expect(rpc).not.toHaveBeenCalledWith("resolve_phase1c_command_target", expect.anything());
    expect(rpc).not.toHaveBeenCalledWith(
      "list_factory_command_routing_candidates",
      expect.anything(),
    );
    expect(rpc).not.toHaveBeenCalledWith("submit_factory_command", expect.anything());
    expect(loadBotFabric).not.toHaveBeenCalled();
    expect(createGitHubInstallationToken).not.toHaveBeenCalled();
    expect(getGitHubBranchReference).not.toHaveBeenCalled();
    expect(dispatchPhase1CWorker).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      idempotentReplay: true,
      execution: {
        workerDispatch: "not_applicable",
        message: expect.stringContaining("stored route"),
      },
      orchestration: {
        baseBranch: "stored-main",
        baseSha: "b".repeat(40),
        effectiveRisk: "yellow",
        model: "gpt-5.3-codex",
        provider: "openai",
        repository: "stored-owner/stored-repository",
        factoryRouting: {
          assignmentId,
          routeId,
          workEffort: "high",
        },
      },
    });
  });

  it("returns an Anthropic record-only replay without claiming an execution run", async () => {
    const stored = factoryReplay();
    const routingSnapshot = stored.routing_snapshot as RegistryRow;
    const assignment = routingSnapshot.assignment as RegistryRow;
    const commandParameters = stored.command_parameters as RegistryRow;
    const rpc = configuredClient({
      replayRows: [{
        ...stored,
        routing_snapshot: {
          ...routingSnapshot,
          assignment: {
            ...assignment,
            provider: "anthropic",
            model: "claude-opus-5",
          },
        },
        command_parameters: {
          ...commandParameters,
          executionMode: "record_only",
          provider: "anthropic",
          model: "claude-opus-5",
        },
      }],
    });

    const response = await POST(commandRequest("https://factory.example"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      idempotentReplay: true,
      execution: { started: false, workerDispatch: "not_applicable" },
      orchestration: {
        executionMode: "record_only",
        provider: "anthropic",
        model: "claude-opus-5",
      },
    });
    expect(body.execution.message).toContain("No execution run was created");
    expect(rpc).not.toHaveBeenCalledWith("submit_factory_command", expect.anything());
    expect(dispatchPhase1CWorker).not.toHaveBeenCalled();
  });

  it("fails closed when a stored replay mode conflicts with its immutable provider route", async () => {
    const stored = factoryReplay();
    const rpc = configuredClient({
      replayRows: [{
        ...stored,
        command_parameters: {
          ...(stored.command_parameters as RegistryRow),
          executionMode: "record_only",
        },
      }],
    });

    const response = await POST(commandRequest("https://factory.example"));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "factory_replay_projection_invalid" },
    });
    expect(rpc).not.toHaveBeenCalledWith("submit_factory_command", expect.anything());
    expect(dispatchPhase1CWorker).not.toHaveBeenCalled();
  });

  it("maps replay intent conflicts before consulting mutable live state", async () => {
    const rpc = configuredClient({
      replayError: {
        code: "22023",
        message: "idempotency key was already used for a different factory command intent",
      },
    });

    const response = await POST(commandRequest("https://factory.example"));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({
      error: { code: "factory_routing_idempotency_conflict" },
    });
    expect(rpc).not.toHaveBeenCalledWith("resolve_phase1c_command_target", expect.anything());
    expect(rpc).not.toHaveBeenCalledWith("submit_factory_command", expect.anything());
    expect(loadBotFabric).not.toHaveBeenCalled();
    expect(createGitHubInstallationToken).not.toHaveBeenCalled();
    expect(dispatchPhase1CWorker).not.toHaveBeenCalled();
  });

  it.each([
    ["paused assignment", { assignment_status: "paused" }],
    ["released assignment", { assignment_status: "released" }],
    ["unconfigured assignment", { is_configured: false }],
    ["persisted unready bot", { current_readiness: "not_connected" }],
    ["AI account needing reauthentication", { ai_account_status: "needs_reauth" }],
    ["read-only repository", {
      assignment_config: {
        ...configuredGrant,
        repositoryAccess: "read",
        canOpenPullRequest: false,
      },
    }],
    ["draft PR permission missing", {
      assignment_config: { ...configuredGrant, canOpenPullRequest: false },
    }],
    ["pipeline access missing", {
      assignment_config: { ...configuredGrant, pipelineAccess: "none" },
    }],
    ["pipeline outside role scope", { assigned_pipeline_keys: ["other_pipeline"] }],
  ])("refuses %s before persistence or dispatch", async (_label, overrides) => {
    const rpc = configuredClient({ candidateRows: [routingCandidate(overrides)] });

    const response = await POST(commandRequest("https://factory.example"));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "factory_routing_unavailable" } });
    expect(rpc).not.toHaveBeenCalledWith("submit_factory_command", expect.anything());
    expect(createGitHubInstallationToken).not.toHaveBeenCalled();
    expect(dispatchPhase1CWorker).not.toHaveBeenCalled();
  });

  it("enforces the selected role's risk ceiling before persistence", async () => {
    const rpc = configuredClient({
      candidateRows: [routingCandidate({ role_risk_ceiling: "green" })],
    });

    const response = await POST(commandRequest("https://factory.example", {
      commandType: "security",
      prompt: "Review authentication and authorization controls.",
      risk: "red",
    }));

    expect(response.status).toBe(409);
    expect(rpc).not.toHaveBeenCalledWith("submit_factory_command", expect.anything());
    expect(dispatchPhase1CWorker).not.toHaveBeenCalled();
  });

  it("maps an unselected pipeline to a truthful setup conflict", async () => {
    const rpc = configuredClient({
      candidateError: { code: "P0002", message: "selected project pipeline was not found" },
    });

    const response = await POST(commandRequest("https://factory.example"));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "pipeline_not_selected" } });
    expect(rpc).not.toHaveBeenCalledWith("submit_factory_command", expect.anything());
    expect(dispatchPhase1CWorker).not.toHaveBeenCalled();
  });

  it("refuses a selected pipeline with no assigned bots", async () => {
    const rpc = configuredClient({ candidateRows: [] });

    const response = await POST(commandRequest("https://factory.example"));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "factory_routing_unavailable" } });
    expect(rpc).not.toHaveBeenCalledWith("submit_factory_command", expect.anything());
    expect(dispatchPhase1CWorker).not.toHaveBeenCalled();
  });

  it.each([
    ["candidate read outage", { candidateError: { code: "57014", message: "timeout" } }, "factory_routing_unavailable"],
    ["missing routing RPC", { candidateError: { code: "PGRST202", message: "missing" } }, "factory_routing_not_connected"],
    ["malformed candidate projection", { candidateRows: [routingCandidate({ assignment_model: undefined })] }, "factory_routing_projection_invalid"],
  ])("returns 503 for a %s", async (_label, options, code) => {
    const rpc = configuredClient(options);

    const response = await POST(commandRequest("https://factory.example"));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code } });
    expect(rpc).not.toHaveBeenCalledWith("submit_factory_command", expect.anything());
    expect(dispatchPhase1CWorker).not.toHaveBeenCalled();
  });

  it("fails closed when the live bot fabric cannot be loaded", async () => {
    const rpc = configuredClient({});
    loadBotFabric.mockRejectedValue(new Error("vault unavailable"));

    const response = await POST(commandRequest("https://factory.example"));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { code: "bot_fabric_unavailable" } });
    expect(rpc).not.toHaveBeenCalledWith("submit_factory_command", expect.anything());
    expect(dispatchPhase1CWorker).not.toHaveBeenCalled();
  });

  it("fails closed when a routing candidate is absent from the live bot fabric", async () => {
    const rpc = configuredClient({});
    loadBotFabric.mockResolvedValue({ assignments: [], bots: [], projects: [], roles: [] });

    const response = await POST(commandRequest("https://factory.example"));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "bot_fabric_projection_invalid" },
    });
    expect(rpc).not.toHaveBeenCalledWith("submit_factory_command", expect.anything());
    expect(dispatchPhase1CWorker).not.toHaveBeenCalled();
  });

  it("refuses when current server credential state demotes a persisted-ready bot", async () => {
    const rpc = configuredClient({});
    loadBotFabric.mockResolvedValue({
      assignments: [],
      bots: [{ id: botId, currentReadiness: "not_connected" }],
      projects: [],
      roles: [],
    });

    const response = await POST(commandRequest("https://factory.example"));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "factory_routing_unavailable" } });
    expect(rpc).not.toHaveBeenCalledWith("submit_factory_command", expect.anything());
    expect(dispatchPhase1CWorker).not.toHaveBeenCalled();
  });

  it("resolves an exact live repository and persists without waking a worker", async () => {
    const rpc = configuredClient({});

    const response = await POST(commandRequest("https://factory.example"));

    expect(response.status).toBe(202);
    expect(rpc).toHaveBeenCalledWith("resolve_phase1c_command_target", {
      p_organization_id: organizationId,
      p_project_id: projectId,
    });
    expect(rpc).toHaveBeenCalledWith("list_factory_command_routing_candidates", {
      p_organization_id: organizationId,
      p_project_id: projectId,
      p_template_key: pipelineTemplateKey,
    });
    expect(rpc).toHaveBeenCalledWith("submit_factory_command", expect.objectContaining({
      p_assignment_id: assignmentId,
      p_organization_id: organizationId,
      p_parameters: expect.objectContaining({
        acceptanceCriteria: ["The dashboard copy is reviewed."],
        agentRole: "qa",
        dependencyTaskIds: [],
        model: "gpt-5.3-codex",
        provider: "openai",
        repositoryBinding: expect.objectContaining({ baseSha: "a".repeat(40) }),
      }),
      p_project_id: projectId,
      p_project_pipeline_id: projectPipelineId,
      p_requested_risk: "green",
    }));
    const submitCall = rpc.mock.calls.find(([name]) => name === "submit_factory_command");
    expect(submitCall?.[1]?.p_parameters).not.toHaveProperty("workEffort");
    expect(rpc).not.toHaveBeenCalledWith("submit_command", expect.anything());
    expect(rpc).not.toHaveBeenCalledWith("record_phase1c_dispatch_outcome", expect.anything());
    expect(dispatchPhase1CWorker).not.toHaveBeenCalled();
    expect(await response.json()).toMatchObject({
      execution: { started: false, workerDispatch: "not_applicable" },
      idempotentReplay: false,
      orchestration: {
        baseBranch: "main",
        dependencyTaskIds: [],
        effectiveRisk: "green",
        factoryRouting: {
          assignmentId,
          pipelineTemplateKey,
          workEffort: "high",
        },
      },
    });
  });

  it("queues a command against the selected ready Claude identity without waking a worker", async () => {
    const claude = routingCandidate({
      bot_name: "Claude - Daniel",
      provider: "anthropic",
      model: "claude-opus-5",
    });
    const rpc = configuredClient({ candidateRows: [claude] });

    const response = await POST(commandRequest("https://factory.example", {
      commandType: "fix_bug",
      prompt: "Fix high-priority bugs.",
    }));

    expect(response.status).toBe(202);
    expect(rpc).toHaveBeenCalledWith("submit_factory_command", expect.objectContaining({
      p_assignment_id: assignmentId,
      p_parameters: expect.objectContaining({
        executionMode: "record_only",
        model: "claude-opus-5",
        plan: {
          requiresDraftPullRequest: false,
          stages: ["record"],
          workflow: "factory_record_only",
        },
        provider: "anthropic",
      }),
    }));
    expect(dispatchPhase1CWorker).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body).toMatchObject({
      execution: { started: false, workerDispatch: "not_applicable" },
      orchestration: {
        executionMode: "record_only",
        model: "claude-opus-5",
        provider: "anthropic",
        factoryRouting: {
          assignmentId,
          model: "claude-opus-5",
          provider: "anthropic",
        },
      },
    });
    expect(body.execution.message).toContain("No execution run was created");
  });

  it("reports the locked SQL routing snapshot when authoritative risk and effort differ", async () => {
    const rpc = configuredClient({
      requiresApproval: true,
      submissionOverrides: {
        routing_snapshot: freshRoutingSnapshot(routingCandidate(), "red", "max"),
      },
    });

    const response = await POST(commandRequest("https://factory.example", {
      prompt: "Review tokenization behavior.",
    }));

    expect(response.status).toBe(202);
    expect(rpc).toHaveBeenCalledWith("submit_factory_command", expect.objectContaining({
      p_requested_risk: "green",
    }));
    expect(await response.json()).toMatchObject({
      requiresOwnerApproval: true,
      execution: {
        message: expect.stringContaining("did not dispatch a worker"),
      },
      orchestration: {
        effectiveRisk: "red",
        factoryRouting: { workEffort: "max" },
      },
    });
  });

  it("fails closed when a fresh submission omits its authoritative routing snapshot", async () => {
    configuredClient({ submissionOverrides: { routing_snapshot: {} } });

    const response = await POST(commandRequest("https://factory.example"));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      error: { code: "factory_submission_projection_invalid" },
    });
  });

  it("chooses the same eligible assignment independent of candidate row order", async () => {
    const preferredAssignmentId = "17171717-1717-4717-8717-171717171717";
    const preferredBotId = "18181818-1818-4818-8818-181818181818";
    const preferred = routingCandidate({
      assignment_id: preferredAssignmentId,
      bot_id: preferredBotId,
      bot_name: "Priority Bot",
      assignment_config: { ...configuredGrant, priority: 0 },
      assigned_at: "2026-08-21T13:00:00.000Z",
    });
    const ordinary = routingCandidate();
    loadBotFabric.mockResolvedValue({
      assignments: [],
      bots: [
        { id: botId, currentReadiness: "ready" },
        { id: preferredBotId, currentReadiness: "ready" },
      ],
      projects: [],
      roles: [],
    });
    const rpc = configuredClient({ candidateRows: [ordinary, preferred] });

    const response = await POST(commandRequest("https://factory.example"));

    expect(response.status).toBe(202);
    expect(rpc).toHaveBeenCalledWith("submit_factory_command", expect.objectContaining({
      p_assignment_id: preferredAssignmentId,
      p_project_pipeline_id: projectPipelineId,
    }));
    expect(dispatchPhase1CWorker).not.toHaveBeenCalled();
  });

  it("routes an idempotent request to an available bot before deferring capacity", async () => {
    const fullBotId = "19191919-1919-4919-8919-191919191919";
    const fullAssignmentId = "20202020-2020-4020-8020-202020202020";
    const fullPriorityBot = routingCandidate({
      assignment_id: fullAssignmentId,
      bot_id: fullBotId,
      bot_name: "Full priority bot",
      assignment_config: { ...configuredGrant, priority: 0 },
      in_flight: 2,
      has_capacity: false,
    });
    const availableBot = routingCandidate({
      assignment_config: { ...configuredGrant, priority: 3 },
    });
    loadBotFabric.mockResolvedValue({
      assignments: [],
      bots: [
        { id: fullBotId, currentReadiness: "ready" },
        { id: botId, currentReadiness: "ready" },
      ],
      projects: [],
      roles: [],
    });
    const rpc = configuredClient({ candidateRows: [fullPriorityBot, availableBot] });

    const response = await POST(commandRequest("https://factory.example", {
      idempotencyKey: "command:available:before:deferred",
    }));

    expect(response.status).toBe(202);
    expect(rpc).toHaveBeenCalledWith("submit_factory_command", expect.objectContaining({
      p_assignment_id: assignmentId,
    }));
    expect(dispatchPhase1CWorker).not.toHaveBeenCalled();
  });

  it("lets atomic submit refuse a fresh idempotency key at capacity", async () => {
    const rpc = configuredClient({
      candidateRows: [routingCandidate({ in_flight: 2, has_capacity: false })],
    });

    const response = await POST(commandRequest("https://factory.example", {
      idempotencyKey: "command:fresh:full",
    }));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code: "factory_routing_unavailable" } });
    expect(rpc).toHaveBeenCalledWith("submit_factory_command", expect.objectContaining({
      p_idempotency_key: "command:fresh:full",
    }));
    expect(dispatchPhase1CWorker).not.toHaveBeenCalled();
  });

  it("refuses capacity locally when no replay key can exist", async () => {
    const rpc = configuredClient({
      candidateRows: [routingCandidate({ in_flight: 2, has_capacity: false })],
    });

    const response = await POST(commandRequest("https://factory.example", {
      idempotencyKey: undefined,
    }));

    expect(response.status).toBe(409);
    expect(rpc).not.toHaveBeenCalledWith("submit_factory_command", expect.anything());
    expect(createGitHubInstallationToken).not.toHaveBeenCalled();
    expect(dispatchPhase1CWorker).not.toHaveBeenCalled();
  });

  it("lets atomic submit replay the exact existing route even when its slot is full", async () => {
    const rpc = configuredClient({
      allowCapacityReplay: true,
      candidateRows: [routingCandidate({ in_flight: 2, has_capacity: false })],
      submissionOverrides: { was_created: false },
    });

    const response = await POST(commandRequest("https://factory.example", {
      idempotencyKey: "command:replay:full",
    }));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      idempotentReplay: true,
      execution: { workerDispatch: "not_applicable" },
    });
    expect(rpc).toHaveBeenCalledWith("submit_factory_command", expect.objectContaining({
      p_assignment_id: assignmentId,
      p_idempotency_key: "command:replay:full",
    }));
    expect(dispatchPhase1CWorker).not.toHaveBeenCalled();
  });

  it.each([
    [
      "atomically stale assignment",
      { code: "55000", message: "selected bot assignment is at its concurrency limit" },
      "factory_routing_unavailable",
    ],
    [
      "changed routing evidence",
      { code: "22023", message: "idempotent factory command routing evidence conflicts" },
      "factory_routing_idempotency_conflict",
    ],
    [
      "legacy command without routing evidence",
      { code: "22023", message: "idempotent command predates factory routing evidence" },
      "factory_routing_idempotency_conflict",
    ],
  ])("maps a %s submit refusal to 409 without dispatch", async (_label, submitError, code) => {
    const rpc = configuredClient({ submitError });

    const response = await POST(commandRequest("https://factory.example"));

    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ error: { code } });
    expect(dispatchPhase1CWorker).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalledWith("record_phase1c_dispatch_outcome", expect.anything());
  });

  it("canonicalizes dependency task references before durable persistence", async () => {
    const rpc = configuredClient({});

    const response = await POST(commandRequest("https://factory.example", {
      dependencyTaskIds: [dependencyTaskB, dependencyTaskA, dependencyTaskB],
    }));

    expect(response.status).toBe(202);
    expect(rpc).toHaveBeenCalledWith("submit_factory_command", expect.objectContaining({
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
    expect(rpc).toHaveBeenCalledWith("submit_factory_command", expect.objectContaining({
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

  it("keeps the worker off for a queued command", async () => {
    configuredClient({});
    dispatchPhase1CWorker.mockRejectedValue(new Error("provider unavailable"));

    const response = await POST(commandRequest("https://factory.example"));

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      execution: { started: false, workerDispatch: "not_applicable" },
    });
    expect(dispatchPhase1CWorker).not.toHaveBeenCalled();
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
    expect(rpc).not.toHaveBeenCalledWith("submit_factory_command", expect.anything());
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
    expect(rpc).not.toHaveBeenCalledWith("submit_factory_command", expect.anything());
    expect(dispatchPhase1CWorker).not.toHaveBeenCalled();
  });

  it("raises inferred protected work to RED before persistence", async () => {
    const rpc = configuredClient({ requiresApproval: true });

    await POST(commandRequest("https://factory.example", {
      commandType: "fix_bug",
      prompt: "Fix the OAuth session authorization bug.",
      risk: "green",
    }));

    expect(rpc).toHaveBeenCalledWith("submit_factory_command", expect.objectContaining({
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

  it("refuses a connection at its scheduler ceiling, counted from live runs", async () => {
    // One connection-specific ceiling of 1 in provider_capacity_limits, one
    // running run on that connection. The router's capacity input is the live
    // run count — the same number the claim path enforces — so the routed
    // submission is refused CAPACITY_EXHAUSTED before anything persists.
    const rpc = configuredClient({
      capacityLimitRows: [
        { connection_id: target.connection_id, maximum_concurrent_runs: 1 },
      ],
      connectionRows: [routableConnection(target.connection_id)],
      mappingRows: [
        { capability: "repository.write", connection_id: target.connection_id, priority: 10 },
      ],
      runningRunRows: [{ connection_id: target.connection_id }],
    });

    const response = await POST(commandRequest("https://factory.example"));

    expect(response.status).toBe(409);
    expect(rpc).toHaveBeenCalledWith("record_connection_routing_decision", expect.objectContaining({
      p_decision: "REFUSED",
      p_refusal_code: "CAPACITY_EXHAUSTED",
    }));
    expect(dispatchPhase1CWorker).not.toHaveBeenCalled();
  });

  it("ignores the stored active_leases counter in favour of the live count", async () => {
    // The stored counter cannot decay when a lease expires, so it is never
    // consulted. A connection whose stored counter claims exhaustion but has
    // no live running runs is routable.
    configuredClient({
      capacityLimitRows: [
        { connection_id: target.connection_id, maximum_concurrent_runs: 1 },
      ],
      connectionRows: [
        routableConnection(target.connection_id, { active_leases: 99, max_concurrency: 1 }),
      ],
      mappingRows: [
        { capability: "repository.write", connection_id: target.connection_id, priority: 10 },
      ],
      runningRunRows: [],
    });

    const response = await POST(commandRequest("https://factory.example"));

    expect(response.status).toBe(202);
    expect(await response.json()).toMatchObject({
      orchestration: {
        connectionRouting: { connectionId: target.connection_id, mode: "routed" },
      },
    });
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
