// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const rosterHarness = vi.hoisted(() => ({
  loadBotFabric: vi.fn(),
  listAiAccounts: vi.fn(),
}));
vi.mock("@/lib/bots/service", () => ({ loadBotFabric: rosterHarness.loadBotFabric }));
vi.mock("@/lib/ai-accounts/broker", () => ({ listAiAccounts: rosterHarness.listAiAccounts }));

import { buildGrokChiefOfStaffPlan } from "@/lib/factory/chief-of-staff";
import { NODE_CAPABILITIES } from "@/lib/graph/contracts";
import {
  applyGrokGraphControl,
  configuredGrokAgents,
  GrokStoreProjectionError,
  loadConfiguredGrokAgents,
  grokSpecialistRosterIdempotencyKey,
  recordGrokSpecialistRoster,
  recordGrokPlanningFailure,
  mapGrokSessionDetail,
  readGrokBundle,
  storedGrokPlanningFailure,
  storedGrokPlan,
} from "@/lib/grok/session-store";

const organizationId = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000002";
const sessionId = "30000000-0000-4000-8000-000000000003";
const messageId = "40000000-0000-4000-8000-000000000004";
const graphId = "50000000-0000-4000-8000-000000000005";
const assistantMessageId = "41000000-0000-4000-8000-000000000004";
const failureEventId = "42000000-0000-4000-8000-000000000004";
const appendEventId = "43000000-0000-4000-8000-000000000004";
const blockedEventId = "44000000-0000-4000-8000-000000000004";
const actorUserId = "70000000-0000-4000-8000-000000000007";
const planningFailureMessage =
  "Planning is blocked until a Ready configured Codex agent covers the repository-writing task.";

describe("atomic Grok graph control", () => {
  const appliedControl = {
    intent_id: "60000000-0000-4000-8000-000000000006",
    organization_id: organizationId,
    project_id: projectId,
    session_id: sessionId,
    graph_id: graphId,
    action: "resume",
    state: "applied",
    idempotency_key: "control-key-123",
    replayed: false,
  };

  it("applies one graph control through the atomic owner boundary", async () => {
    const rpc = vi.fn().mockResolvedValue({ data: [appliedControl], error: null });

    await expect(applyGrokGraphControl({ rpc } as never, {
      organizationId,
      sessionId,
      graphId,
      action: "resume",
      reason: "Resume after reviewing durable evidence.",
      idempotencyKey: "control-key-123",
    })).resolves.toEqual(appliedControl);
    expect(rpc).toHaveBeenCalledWith("apply_grok_graph_control_v2_as_owner", {
      p_organization_id: organizationId,
      p_session_id: sessionId,
      p_graph_id: graphId,
      p_action: "resume",
      p_reason: "Resume after reviewing durable evidence.",
      p_idempotency_key: "control-key-123",
    });
  });

  it("preserves the database replay signal", async () => {
    const replay = { ...appliedControl, replayed: true };
    const rpc = vi.fn().mockResolvedValue({ data: [replay], error: null });

    await expect(applyGrokGraphControl({ rpc } as never, {
      organizationId,
      sessionId,
      graphId,
      action: "resume",
      reason: "Resume after reviewing durable evidence.",
      idempotencyKey: "control-key-123",
    })).resolves.toEqual(replay);
  });

  it.each([
    ["organization", { organization_id: "a0000000-0000-4000-8000-00000000000a" }],
    ["session", { session_id: "c0000000-0000-4000-8000-00000000000c" }],
    ["graph", { graph_id: "b0000000-0000-4000-8000-00000000000b" }],
    ["action", { action: "pause" }],
    ["idempotency key", { idempotency_key: "different-key-456" }],
  ] as const)("rejects a schema-valid result with the wrong %s", async (_label, override) => {
    const rpc = vi.fn().mockResolvedValue({
      data: [{ ...appliedControl, ...override }],
      error: null,
    });

    await expect(applyGrokGraphControl({ rpc } as never, {
      organizationId,
      sessionId,
      graphId,
      action: "resume",
      reason: "Resume after reviewing durable evidence.",
      idempotencyKey: "control-key-123",
    })).rejects.toThrow(/did not match its exact input/i);
  });

  it.each([{ data: [] }, { data: [appliedControl, appliedControl] }])(
    "fails closed when the atomic RPC does not return exactly one row",
    async ({ data }) => {
      const rpc = vi.fn().mockResolvedValue({ data, error: null });

      await expect(applyGrokGraphControl({ rpc } as never, {
        organizationId,
        sessionId,
        graphId,
        action: "resume",
        reason: "Resume after reviewing durable evidence.",
        idempotencyKey: "control-key-123",
      })).rejects.toBeInstanceOf(GrokStoreProjectionError);
    },
  );
});

function planningFailurePersistence(createdAt = "2026-08-30T20:00:00.000Z") {
  return {
    session: {
      id: sessionId,
      organization_id: organizationId,
      project_id: projectId,
      title: "Build the portal",
      status: "blocked",
      created_by: "70000000-0000-4000-8000-000000000007",
      idempotency_key: "request-key-123",
      last_message_sequence: 2,
      last_event_sequence: 5,
      version: 5,
      created_at: createdAt,
      updated_at: createdAt,
      closed_at: null,
    },
    message: {
      id: assistantMessageId,
      session_id: sessionId,
      sequence_no: 2,
      role: "assistant",
      content: planningFailureMessage,
      metadata: {
        schemaVersion: 1,
        kind: "grok.planning_error",
        code: "MISSING_CODEX_AGENT",
        workerWoken: false,
        executionStarted: false,
      },
      reply_to_message_id: messageId,
      actor_user_id: null,
      created_at: createdAt,
    },
    event: {
      id: failureEventId,
      session_id: sessionId,
      sequence_no: 4,
      event_type: "session.planning_failed",
      correlation_id: sessionId,
      message_id: assistantMessageId,
      task_link_id: null,
      actor_user_id: null,
      payload: {
        schemaVersion: 1,
        detail: "Planning was blocked before any graph or worker dispatch.",
        code: "MISSING_CODEX_AGENT",
        messageId: assistantMessageId,
        workerWoken: false,
        executionStarted: false,
      },
      occurred_at: createdAt,
      created_at: createdAt,
    },
  };
}

function planningFailureBundle() {
  const persisted = planningFailurePersistence();
  const createdAt = persisted.session.created_at;
  const event = (
    id: string,
    sequence_no: number,
    event_type: string,
    correlation_id: string,
    payload: Record<string, unknown>,
    message_id: string | null,
    actor_user_id: string | null = null,
  ) => ({
    id,
    session_id: sessionId,
    sequence_no,
    event_type,
    correlation_id,
    payload,
    message_id,
    task_link_id: null,
    actor_user_id,
    occurred_at: createdAt,
    created_at: createdAt,
  });
  return {
    session: persisted.session,
    messages: [{
      id: messageId,
      session_id: sessionId,
      sequence_no: 1,
      role: "user",
      content: "Build the portal",
      metadata: {},
      reply_to_message_id: null,
      actor_user_id: actorUserId,
      created_at: createdAt,
    }, persisted.message],
    task_links: [],
    events: [
      event(
        "45000000-0000-4000-8000-000000000004",
        1,
        "session.created",
        sessionId,
        { session_id: sessionId },
        null,
        actorUserId,
      ),
      event(
        "46000000-0000-4000-8000-000000000004",
        2,
        "message.appended",
        messageId,
        { message_id: messageId, message_sequence: 1, role: "user" },
        messageId,
        actorUserId,
      ),
      event(
        appendEventId,
        3,
        "message.appended",
        assistantMessageId,
        { message_id: assistantMessageId, message_sequence: 2, role: "assistant" },
        assistantMessageId,
      ),
      persisted.event,
      event(blockedEventId, 5, "session.blocked", sessionId, { status: "blocked" }, null),
    ],
    artifact_links: [],
    control_intents: [],
    next: { message_sequence: 2, event_sequence: 5 },
  };
}

function researchPlan() {
  const planned = buildGrokChiefOfStaffPlan({
    prompt: "Research the repository architecture",
    project: {
      projectId,
      name: "Factory",
      repositoryFullName: "surgeservicesllc/SoftwareFactory",
      defaultBranch: "main",
    },
    agents: [{
      id: "81000000-0000-4000-8000-000000000081",
      assignmentId: "81000000-0000-4000-8000-000000000081",
      assignmentRevision: 3,
      botId: "82000000-0000-4000-8000-000000000082",
      botRevision: 4,
      roleId: "83000000-0000-4000-8000-000000000083",
      roleUpdatedAt: "2026-08-30T18:00:00.000Z",
      aiAccountId: "84000000-0000-4000-8000-000000000084",
      credentialRef: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN",
      credentialPurpose: "claude",
      providerIdentity: "owner@example.com",
      accountUpdatedAt: "2026-08-30T19:00:00.000Z",
      name: "Claude",
      provider: "anthropic",
      model: "claude-opus-5",
      capabilities: ["*"],
      maxModelTier: "STRONG",
      ready: true,
    }],
  });
  if (!planned.ok) throw new Error(planned.error.message);
  return planned.plan;
}

const configuredBotId = "82000000-0000-4000-8000-000000000082";
const configuredRoleId = "83000000-0000-4000-8000-000000000083";
const configuredAccountId = "84000000-0000-4000-8000-000000000084";
const configuredAssignmentId = "85000000-0000-4000-8000-000000000085";

function configuredFabric() {
  return {
    assignmentsComplete: true,
    bots: [{
      id: configuredBotId,
      revision: 6,
      name: "Claude connected",
      provider: "anthropic",
      providerLabel: "Claude",
      providerVendor: "Anthropic",
      model: "claude-opus-5",
      credentialRef: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN",
      credentialPresent: true,
      baseUrl: null,
      notes: null,
      readiness: "ready" as const,
      readinessLabel: "Ready",
      readinessTone: "safe" as const,
      readinessDetail: "The credential is available.",
      lastCheckedAt: "2026-08-30T19:00:00.000Z",
      currentReadiness: "ready" as const,
      currentReadinessDetail: "The credential is available.",
      aiAccountId: configuredAccountId,
      createdAt: "2026-08-30T17:00:00.000Z",
    }],
    roles: [{
      id: configuredRoleId,
      name: "Reviewer",
      slug: "reviewer",
      summary: "Reviews and plans work.",
      instructions: "Review evidence.",
      riskCeiling: "GREEN" as const,
      capabilities: ["planning", "review", "security", "testing", "reporting"],
      createdAt: "2026-08-30T17:00:00.000Z",
      updatedAt: "2026-08-30T18:30:00.000Z",
    }],
    assignments: [{
      id: configuredAssignmentId,
      revision: 8,
      botId: configuredBotId,
      projectId,
      roleId: configuredRoleId,
      status: "active" as const,
      assignedAt: "2026-08-30T18:00:00.000Z",
      releasedAt: null,
      model: "claude-opus-5",
      workEffort: "high",
      config: {
        preset: null,
        responsibilities: [],
        instructions: null,
        repositoryAccess: "read" as const,
        branchStrategy: "per_task_branch" as const,
        canOpenPullRequest: false,
        canMergePullRequest: false,
        pipelineAccess: "none" as const,
        environmentAccess: "none" as const,
        tools: [],
        requiresHumanApproval: true,
        maxConcurrentTasks: 1,
        priority: 1,
      },
    }],
    projects: [],
  };
}

function connectedAccount(overrides: Record<string, unknown> = {}) {
  return {
    account_id: configuredAccountId,
    provider: "anthropic",
    auth_method: "subscription",
    display_name: "Claude account 1",
    provider_identity: "owner@example.com",
    status: "connected",
    credential_purpose: "claude",
    last_verified_at: "2026-08-30T19:00:00.000Z",
    last_error: null,
    created_at: "2026-08-30T17:00:00.000Z",
    updated_at: "2026-08-30T19:30:00.000Z",
    ...overrides,
  };
}

describe("configured Grok agent identity", () => {
  it("admits only the exact connected account and snapshots every concurrency token", () => {
    const agents = configuredGrokAgents(configuredFabric(), projectId, [connectedAccount()]);

    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      id: configuredAssignmentId,
      assignmentId: configuredAssignmentId,
      assignmentRevision: 8,
      botId: configuredBotId,
      botRevision: 6,
      roleId: configuredRoleId,
      roleUpdatedAt: "2026-08-30T18:30:00.000Z",
      aiAccountId: configuredAccountId,
      credentialRef: "SOFTWAREFACTORY_CLAUDE_CODE_OAUTH_TOKEN",
      credentialPurpose: "claude",
      providerIdentity: "owner@example.com",
      accountUpdatedAt: "2026-08-30T19:30:00.000Z",
      maxModelTier: "STRONG",
    });
    expect(agents[0]?.capabilities).toEqual([
      "planning", "qa", "reporting", "review", "security_review",
    ]);
    expect(JSON.stringify(agents)).not.toContain("credentialValue");
  });

  it("fails closed for a disconnected, mismatched, or privileged credential identity", () => {
    expect(configuredGrokAgents(
      configuredFabric(), projectId, [connectedAccount({ status: "needs_reauth" })],
    )).toEqual([]);
    expect(configuredGrokAgents(
      configuredFabric(), projectId, [connectedAccount({ provider: "openai" })],
    )).toEqual([]);
    expect(configuredGrokAgents(
      configuredFabric(), projectId, [connectedAccount({ auth_method: "api_key" })],
    )).toEqual([]);
    expect(configuredGrokAgents({
      ...configuredFabric(),
      bots: [{
        ...configuredFabric().bots[0],
        readiness: "not_connected" as const,
        currentReadiness: "ready" as const,
      }],
    }, projectId, [connectedAccount()])).toEqual([]);
    expect(configuredGrokAgents({
      ...configuredFabric(),
      bots: [{ ...configuredFabric().bots[0], credentialRef: "SUPABASE_SERVICE_ROLE_KEY" }],
    }, projectId, [connectedAccount()])).toEqual([]);
    expect(() => configuredGrokAgents(
      configuredFabric(), projectId,
      [connectedAccount({ provider_identity: `sk-${"a".repeat(30)}` })],
    )).toThrow("The connected AI-account roster was malformed.");
  });

  it("expands a declared wildcard to the complete sorted canonical vocabulary", () => {
    const fabric = configuredFabric();
    const agents = configuredGrokAgents({
      ...fabric,
      roles: [{ ...fabric.roles[0], capabilities: ["*", "coding", "unknown"] }],
    }, projectId, [connectedAccount()]);

    expect(agents).toHaveLength(1);
    expect(agents[0]?.capabilities).toEqual([...NODE_CAPABILITIES].sort());
    expect(agents[0]?.capabilities).not.toContain("*");
  });

  it("loads the bot and account rosters together before projecting identities", async () => {
    rosterHarness.loadBotFabric.mockResolvedValueOnce(configuredFabric());
    rosterHarness.listAiAccounts.mockResolvedValueOnce([connectedAccount()]);

    await expect(loadConfiguredGrokAgents({} as never, organizationId, projectId))
      .resolves.toHaveLength(1);
    expect(rosterHarness.loadBotFabric).toHaveBeenCalledWith(expect.anything(), organizationId);
    expect(rosterHarness.listAiAccounts).toHaveBeenCalledWith(expect.anything(), organizationId);
  });

  it("reads legacy v1 plans but preserves their non-executable version and missing snapshot", () => {
    const legacy = JSON.parse(JSON.stringify(researchPlan())) as {
      planner: { version: number };
      dag: { tasks: Array<Record<string, unknown>> };
    };
    legacy.planner.version = 1;
    for (const task of legacy.dag.tasks) {
      for (const field of [
        "assignmentId", "assignmentRevision", "botId", "botRevision", "roleId",
        "roleUpdatedAt", "aiAccountId", "credentialRef", "credentialPurpose",
        "providerIdentity", "accountUpdatedAt", "agentCapabilities", "agentMaxModelTier",
      ]) delete task[field];
    }
    const stored = storedGrokPlan({ messages: [{
      sequence_no: 2,
      role: "assistant",
      metadata: { kind: "grok.plan", plan: legacy },
    }] } as never);

    expect(stored?.planner.version).toBe(1);
    expect(stored?.dag.tasks[0]?.assignmentId).toBeUndefined();
  });
});

describe("immutable Grok specialist roster persistence", () => {
  it("derives one child key and preserves exact roster event sequence 3 on replay", async () => {
    const result = {
      message_id: assistantMessageId,
      roster_count: 2,
      roster_sha256: "c".repeat(64),
      replayed: true,
    };
    const rpc = vi.fn().mockResolvedValue({ data: result, error: null });

    await expect(recordGrokSpecialistRoster({ rpc } as never, {
      organizationId,
      projectId,
      sessionId,
      messageId: assistantMessageId,
      requestedBy: actorUserId,
      idempotencyKey: "request-key-123",
      expectedEventSequence: 3,
    })).resolves.toEqual(result);
    expect(grokSpecialistRosterIdempotencyKey("request-key-123"))
      .toBe("request-key-123:specialist-roster");
    expect(rpc).toHaveBeenCalledWith("record_grok_specialist_roster_v1_as_server", {
      p_organization_id: organizationId,
      p_requested_by: actorUserId,
      p_project_id: projectId,
      p_session_id: sessionId,
      p_message_id: assistantMessageId,
      p_idempotency_key: "request-key-123:specialist-roster",
      p_expected_event_sequence: 3,
    });
  });
});

describe("Grok session graph persistence", () => {
  it("records a planning failure through one atomic service-role RPC without prompt details", async () => {
    const persisted = planningFailurePersistence();
    const rpc = vi.fn().mockResolvedValue({ data: persisted, error: null });
    const result = await recordGrokPlanningFailure({ rpc } as never, {
      organizationId,
      sessionId,
      userMessageId: messageId,
      idempotencyKey: "request-key-123",
      code: "MISSING_CODEX_AGENT",
      expectedVersion: 2,
    });

    expect(result).toEqual(persisted);
    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith("record_grok_planning_failure_as_server", {
      p_organization_id: organizationId,
      p_session_id: sessionId,
      p_user_message_id: messageId,
      p_error_code: "MISSING_CODEX_AGENT",
      p_idempotency_key: "request-key-123:planning-failure",
      p_expected_version: 2,
    });
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("Build the portal");
    expect(JSON.stringify(rpc.mock.calls)).not.toContain("implementation/STRONG");
  });

  it("rejects an incomplete atomic planning-failure result", async () => {
    const persisted = planningFailurePersistence();
    const rpc = vi.fn().mockResolvedValue({
      data: {
        ...persisted,
        session: { ...persisted.session, last_event_sequence: 4 },
      },
      error: null,
    });

    await expect(recordGrokPlanningFailure({ rpc } as never, {
      organizationId,
      sessionId,
      userMessageId: messageId,
      idempotencyKey: "request-key-123",
      code: "MISSING_CODEX_AGENT",
      expectedVersion: 2,
    })).rejects.toThrow("The durable Grok planning-failure result was malformed.");
  });

  it("recovers only a complete immutable blocked planning failure", () => {
    const bundle = planningFailureBundle();

    expect(storedGrokPlanningFailure(bundle as never)).toEqual({
      code: "MISSING_CODEX_AGENT",
      message: planningFailureMessage,
      messageId: assistantMessageId,
    });
    expect(() => storedGrokPlanningFailure({ ...bundle, events: [] } as never)).toThrow(
      "The durable Grok planning-error append event was malformed.",
    );
    expect(() => storedGrokPlanningFailure({
      ...bundle,
      messages: [bundle.messages[0], {
        ...bundle.messages[1],
        reply_to_message_id: "47000000-0000-4000-8000-000000000004",
      }],
    } as never)).toThrow("The durable Grok planning-error session was not blocked safely.");
    expect(() => storedGrokPlanningFailure({
      ...bundle,
      events: bundle.events.filter((event) => event.event_type !== "session.blocked"),
    } as never)).toThrow(
      "The durable Grok session-blocked event was malformed.",
    );
    expect(() => storedGrokPlanningFailure({
      ...bundle,
      events: bundle.events.map((event) => event.event_type === "session.planning_failed"
        ? { ...event, message_id: messageId }
        : event),
    } as never)).toThrow(
      "The durable Grok planning-failure event was malformed.",
    );
    expect(() => storedGrokPlanningFailure({
      ...bundle,
      events: bundle.events.map((event) => event.event_type === "session.blocked"
        ? { ...event, payload: { status: "blocked", dispatch: true } }
        : event),
    } as never)).toThrow(
      "The durable Grok session-blocked event was malformed.",
    );
  });

  it("keeps a durable plan blocked until an exact execution bridge creates graph evidence", async () => {
    const createdAt = "2026-08-30T20:00:00.000Z";
    const plan = researchPlan();
    const bundle = {
      session: {
        id: sessionId,
        organization_id: organizationId,
        project_id: projectId,
        title: "Research",
        status: "active",
        created_by: "70000000-0000-4000-8000-000000000007",
        idempotency_key: "request-key-123",
        last_message_sequence: 2,
        last_event_sequence: 4,
        version: 3,
        created_at: createdAt,
        updated_at: createdAt,
        closed_at: null,
      },
      messages: [{
        id: messageId,
        session_id: sessionId,
        sequence_no: 1,
        role: "user",
        content: "Research the repository architecture",
        metadata: {},
        created_at: createdAt,
      }, {
        id: "41000000-0000-4000-8000-000000000004",
        session_id: sessionId,
        sequence_no: 2,
        role: "assistant",
        content: "The plan is recorded.",
        metadata: { kind: "grok.plan", plan },
        created_at: createdAt,
      }],
      task_links: [], events: [], artifact_links: [], control_intents: [],
      next: { message_sequence: 2, event_sequence: 4 },
    };

    const client = { from: vi.fn(), rpc: vi.fn().mockResolvedValue({ data: [], error: null }) } as never;
    const detail = await mapGrokSessionDetail(client, organizationId, "Factory", bundle as never);

    expect(detail.session).toMatchObject({ status: "blocked", graphId: null, graphRunId: null });
    expect(detail.session.allowedActions).toEqual([]);
    expect(detail.tasks).not.toHaveLength(0);
    expect(detail.tasks.every((task) => task.status === "pending_graph")).toBe(true);
    expect((client as { from: ReturnType<typeof vi.fn> }).from).not.toHaveBeenCalled();
  });

  it("never substitutes planned provider/model identity for missing execution evidence", async () => {
    const createdAt = "2026-08-30T20:00:00.000Z";
    const plan = researchPlan();
    const plannedTask = plan.dag.tasks[0];
    const taskLinkId = "60000000-0000-4000-8000-000000000006";
    const nodeId = "61000000-0000-4000-8000-000000000006";
    const tableResult = (table: string) => {
      const result = table === "graphs"
        ? { data: { id: graphId, goal: plan.intent.prompt, pause_requested_at: null, withdrawn_at: null }, error: null }
        : table === "graph_runs"
          ? { data: null, error: null }
          : table === "graph_phase1c_bridges"
            ? { data: null, error: null }
            : { data: [{ id: nodeId, node_key: plannedTask.id, job: plannedTask.title }], error: null };
      const query: Record<string, unknown> = {};
      for (const method of ["select", "eq", "order", "limit"]) {
        query[method] = vi.fn(() => query);
      }
      query.maybeSingle = vi.fn(async () => result);
      query.then = (resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(result).then(resolve, reject);
      return query;
    };
    const client = {
      from: vi.fn((table: string) => tableResult(table)),
      rpc: vi.fn().mockResolvedValue({ data: [], error: null }),
    } as never;
    const bundle = {
      session: {
        id: sessionId, organization_id: organizationId, project_id: projectId,
        title: "Research", status: "active",
        created_by: "70000000-0000-4000-8000-000000000007",
        idempotency_key: "request-key-123", last_message_sequence: 2,
        last_event_sequence: 4, version: 3, created_at: createdAt,
        updated_at: createdAt, closed_at: null,
      },
      messages: [{
        id: messageId, session_id: sessionId, sequence_no: 1, role: "user",
        content: plan.intent.prompt, metadata: {}, created_at: createdAt,
      }, {
        id: "41000000-0000-4000-8000-000000000004", session_id: sessionId,
        sequence_no: 2, role: "assistant", content: "The plan is recorded.",
        metadata: { kind: "grok.plan", plan }, created_at: createdAt,
      }],
      task_links: [{
        id: taskLinkId, session_id: sessionId, message_id: messageId,
        command_id: null, task_id: null, graph_id: graphId, graph_run_id: null,
        relation: "planned", created_at: createdAt,
      }],
      events: [], artifact_links: [], control_intents: [],
      next: { message_sequence: 2, event_sequence: 4 },
    };

    const detail = await mapGrokSessionDetail(client, organizationId, "Factory", bundle as never);
    expect(detail.session.status).toBe("planned");
    expect(detail.tasks[0]).toMatchObject({
      taskKey: plannedTask.id,
      provider: null,
      model: null,
      agentName: null,
      status: "planned",
    });
    expect(plannedTask.provider).toBe("anthropic");
    expect(plannedTask.model).toBe("claude-opus-5");
  });

  it("projects a requested pause ahead of a still-running durable run", async () => {
    const createdAt = "2026-08-30T20:00:00.000Z";
    const plan = researchPlan();
    const plannedTask = plan.dag.tasks[0];
    const nodeId = "61000000-0000-4000-8000-000000000006";
    const skippedNodeId = "61100000-0000-4000-8000-000000000006";
    const runId = "62000000-0000-4000-8000-000000000006";
    const results: Record<string, { data: unknown; error: null }> = {
      graphs: {
        data: {
          id: graphId,
          goal: plan.intent.prompt,
          pause_requested_at: createdAt,
          withdrawn_at: null,
        },
        error: null,
      },
      graph_runs: {
        data: {
          id: runId, state: "RUNNING", closure_note: null,
          started_at: createdAt, completed_at: null, tokens_used: 1200, cost_micros: 3400,
          created_at: createdAt,
        },
        error: null,
      },
      graph_phase1c_bridges: {
        data: {
          id: "62200000-0000-4000-8000-000000000006",
          graph_run_id: runId,
          state: "PULL_REQUEST_RECORDED",
          command_id: "62300000-0000-4000-8000-000000000006",
          task_id: "62400000-0000-4000-8000-000000000006",
          agent_run_id: "62500000-0000-4000-8000-000000000006",
          pull_request_id: "62600000-0000-4000-8000-000000000006",
          head_sha: "b".repeat(40),
          merge_commit_sha: null,
          deployment_id: null,
          monitor_observation_id: null,
          deployment_validation_id: null,
          updated_at: createdAt,
        },
        error: null,
      },
      graph_nodes: { data: [
        { id: nodeId, node_key: plannedTask.id, job: plannedTask.title },
        { id: skippedNodeId, node_key: "undispatched", job: "Undispatched work" },
      ], error: null },
      node_runs: {
        data: [
          { id: "63000000-0000-4000-8000-000000000006", node_id: nodeId, state: "COMPLETED", provider: "anthropic", model: "claude-opus-5", attempt: 2 },
          // Intentionally returned after the latest attempt: physical row order
          // must never make stale failure/provider evidence win.
          { id: "63200000-0000-4000-8000-000000000006", node_id: nodeId, state: "FAILED", provider: "openai", model: "gpt-stale", attempt: 1 },
          { id: "63100000-0000-4000-8000-000000000006", node_id: skippedNodeId, state: "SKIPPED", provider: null, model: null, attempt: 0 },
        ],
        error: null,
      },
      graph_events: {
        // The database returns newest-first. The 501st row is a truncation sentinel.
        data: Array.from({ length: 501 }, (_, index) => ({
          id: `64000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
          event_type: "node.started", detail: "The observed worker attempt started.",
          node_run_id: "63000000-0000-4000-8000-000000000006", created_at: createdAt,
        })),
        error: null,
      },
    };
    const queryByTable = new Map<string, Record<string, ReturnType<typeof vi.fn>>>();
    const client = {
      from: vi.fn((table: string) => {
        const result = results[table];
        const query: Record<string, ReturnType<typeof vi.fn> | unknown> = {};
        for (const method of ["select", "eq", "order", "limit"]) query[method] = vi.fn(() => query);
        query.maybeSingle = vi.fn(async () => result);
        query.then = (resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject);
        queryByTable.set(table, query as Record<string, ReturnType<typeof vi.fn>>);
        return query;
      }),
      rpc: vi.fn().mockImplementation(async (name: string) => ({
        data: name === "list_grok_context_envelopes" ? [] : [{
          artifact_id: "65000000-0000-4000-8000-000000000006",
          node_run_id: "63000000-0000-4000-8000-000000000006",
          node_key: plannedTask.id,
          kind: "ANCHOR",
          payload: {
            observation: "ci_check_runs",
            sha: "a".repeat(40),
            checks: [{ name: "unit / linux", conclusion: "success", url: "https://github.com/example/factory/actions/runs/1" }],
            failing: [],
          },
          created_at: createdAt,
        }],
        error: null,
      })),
    } as never;
    const bundle = {
      session: {
        id: sessionId, organization_id: organizationId, project_id: projectId,
        title: "Research", status: "active",
        created_by: "70000000-0000-4000-8000-000000000007",
        idempotency_key: "request-key-123", last_message_sequence: 2,
        last_event_sequence: 4, version: 3, created_at: createdAt,
        updated_at: createdAt, closed_at: null,
      },
      messages: [{
        id: messageId, session_id: sessionId, sequence_no: 1, role: "user",
        content: plan.intent.prompt, metadata: {}, created_at: createdAt,
      }, {
        id: "41000000-0000-4000-8000-000000000004", session_id: sessionId,
        sequence_no: 2, role: "assistant", content: "The plan is recorded.",
        metadata: { kind: "grok.plan", plan }, created_at: createdAt,
      }],
      task_links: [{
        id: "60000000-0000-4000-8000-000000000006",
        session_id: sessionId, message_id: messageId, command_id: null, task_id: null,
        graph_id: graphId, graph_run_id: null, relation: "planned", created_at: createdAt,
      }],
      events: [], artifact_links: [], control_intents: [],
      next: { message_sequence: 2, event_sequence: 4 },
    };

    const detail = await mapGrokSessionDetail(client, organizationId, "Factory", bundle as never);
    expect(detail.session.status).toBe("paused");
    expect(detail.session.allowedActions).toEqual(["resume"]);
    expect(detail.tasks[0]).toMatchObject({
      status: "completed", attempt: 2, agentName: null,
      provider: "anthropic", model: "claude-opus-5",
    });
    expect(detail.runEvidence).toMatchObject({
      state: "RUNNING",
      progress: { completed: 1, total: 2, percent: 50 },
      tokensUsed: 1200,
      costMicros: 3400,
      eventsTruncated: true,
      phase1c: {
        state: "PULL_REQUEST_RECORDED",
        agentRunId: "62500000-0000-4000-8000-000000000006",
        headSha: "b".repeat(40),
      },
    });
    expect(detail.runEvidence?.events).toHaveLength(500);
    expect(detail.runEvidence?.events[0]).toMatchObject({
      type: "node.started", nodeKey: plannedTask.id,
    });
    expect(detail.runEvidence?.release.checks).toEqual([{
      name: "unit / linux", conclusion: "success",
      url: "https://github.com/example/factory/actions/runs/1",
    }]);
    expect(detail.artifacts.at(-1)).toMatchObject({
      kind: "ANCHOR", label: "ci check runs", nodeKey: plannedTask.id,
    });
    expect(queryByTable.get("graph_events")?.order).toHaveBeenCalledWith(
      "created_at", { ascending: false },
    );
    expect(queryByTable.get("graph_events")?.order).toHaveBeenCalledWith(
      "id", { ascending: false },
    );
    expect(queryByTable.get("graph_events")?.limit).toHaveBeenCalledWith(501);
    expect(queryByTable.get("graph_runs")?.order).toHaveBeenNthCalledWith(
      1, "created_at", { ascending: false },
    );
    expect(queryByTable.get("graph_runs")?.order).toHaveBeenNthCalledWith(
      2, "id", { ascending: false },
    );
    expect(queryByTable.get("graph_runs")?.limit).toHaveBeenCalledWith(1);
  });

  it("maps the database's enriched artifact projection without dropping its URI", async () => {
    const createdAt = "2026-08-30T20:00:00.000Z";
    const sessionRead = {
      data: {
        session: {
          id: sessionId,
          organization_id: organizationId,
          project_id: projectId,
          title: "Research",
          status: "active",
          created_by: "70000000-0000-4000-8000-000000000007",
          idempotency_key: "request-key-123",
          last_message_sequence: 1,
          last_event_sequence: 0,
          version: 2,
          created_at: createdAt,
          updated_at: createdAt,
          closed_at: null,
        },
        messages: [{
          id: messageId,
          session_id: sessionId,
          sequence_no: 1,
          role: "user",
          content: "Research",
          metadata: {},
          created_at: createdAt,
        }],
        task_links: [],
        events: [],
        artifact_links: [{
          id: "80000000-0000-4000-8000-000000000008",
          kind: "report",
          label: "Architecture report",
          uri: "https://factory.example/artifacts/report",
          created_at: createdAt,
        }],
        control_intents: [],
        next: { message_sequence: 1, event_sequence: 1 },
      },
      error: null,
    };
    const rpc = vi.fn()
      .mockResolvedValueOnce(sessionRead)
      .mockResolvedValueOnce({ data: [], error: null });
    const client = { rpc } as never;
    const bundle = await readGrokBundle(client, organizationId, sessionId);
    const detail = await mapGrokSessionDetail(client, organizationId, "Factory", bundle);
    expect(detail.artifacts).toEqual([{
      id: "80000000-0000-4000-8000-000000000008",
      kind: "report",
      label: "Architecture report",
      uri: "https://factory.example/artifacts/report",
      createdAt,
    }]);
  });

  it("reads the newest bounded session-event window and exposes truncation", async () => {
    const base = planningFailureBundle();
    const eventAt = (sequence: number) => ({
      ...base.events[0],
      id: `49000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
      sequence_no: sequence,
      event_type: sequence === 201 ? "control.applied" : `session.event.${sequence}`,
    });
    const first = {
      ...base,
      session: { ...base.session, last_event_sequence: 201 },
      events: Array.from({ length: 200 }, (_, index) => eventAt(index + 1)),
      next: { ...base.next, event_sequence: 201 },
    };
    // An event appended between the two reads advances the second session
    // snapshot, but must not leak into the window anchored to sequence 201.
    const tail = {
      ...first,
      session: { ...first.session, last_event_sequence: 202 },
      events: Array.from({ length: 200 }, (_, index) => eventAt(index + 2)),
      next: { ...first.next, event_sequence: 202 },
    };
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: first, error: null })
      .mockResolvedValueOnce({ data: tail, error: null });

    const bundle = await readGrokBundle({ rpc } as never, organizationId, sessionId);
    const detail = await mapGrokSessionDetail(
      { rpc: vi.fn().mockResolvedValue({ data: [], error: null }) } as never,
      organizationId,
      "Factory",
      bundle,
    );

    expect(rpc).toHaveBeenNthCalledWith(2, "read_grok_session", expect.objectContaining({
      p_after_event_sequence: 1,
      p_limit: 200,
    }));
    expect(bundle.events).toHaveLength(200);
    expect(bundle.events[0]?.sequence_no).toBe(2);
    expect(bundle.events.at(-1)?.sequence_no).toBe(201);
    expect(detail.eventsTruncated).toBe(true);
    expect(detail.events.at(-1)?.type).toBe("control.applied");
  });

  it("fails closed when the bounded session-event tail is not contiguous", async () => {
    const base = planningFailureBundle();
    const eventAt = (sequence: number) => ({
      ...base.events[0],
      id: `48000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
      sequence_no: sequence,
    });
    const first = {
      ...base,
      session: { ...base.session, last_event_sequence: 201 },
      events: Array.from({ length: 200 }, (_, index) => eventAt(index + 1)),
      next: { ...base.next, event_sequence: 201 },
    };
    const tail = {
      ...first,
      events: Array.from({ length: 199 }, (_, index) => eventAt(index + 2)),
    };
    const rpc = vi.fn()
      .mockResolvedValueOnce({ data: first, error: null })
      .mockResolvedValueOnce({ data: tail, error: null });

    await expect(readGrokBundle(
      { rpc } as never, organizationId, sessionId,
    )).rejects.toThrow("The Grok session event tail was incomplete.");
  });
});
