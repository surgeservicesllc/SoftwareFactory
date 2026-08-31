// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/bots/service", () => ({ loadBotFabric: vi.fn() }));

import { buildGrokChiefOfStaffPlan } from "@/lib/factory/chief-of-staff";
import {
  recordGrokPlanningFailure,
  mapGrokSessionDetail,
  readGrokBundle,
  storedGrokPlanningFailure,
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
      id: "claude-1",
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

    const client = { from: vi.fn(), rpc: vi.fn() } as never;
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
    const client = { from: vi.fn((table: string) => tableResult(table)) } as never;
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
      graph_runs: { data: { id: runId, state: "RUNNING", created_at: createdAt }, error: null },
      graph_nodes: { data: [{ id: nodeId, node_key: plannedTask.id, job: plannedTask.title }], error: null },
      node_runs: {
        data: [{ node_id: nodeId, state: "RUNNING", provider: "anthropic", model: "claude-opus-5" }],
        error: null,
      },
    };
    const client = {
      from: vi.fn((table: string) => {
        const result = results[table];
        const query: Record<string, unknown> = {};
        for (const method of ["select", "eq", "order", "limit"]) query[method] = vi.fn(() => query);
        query.maybeSingle = vi.fn(async () => result);
        query.then = (resolve: (value: typeof result) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject);
        return query;
      }),
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
        graph_id: graphId, graph_run_id: runId, relation: "planned", created_at: createdAt,
      }],
      events: [], artifact_links: [], control_intents: [],
      next: { message_sequence: 2, event_sequence: 4 },
    };

    const detail = await mapGrokSessionDetail(client, organizationId, "Factory", bundle as never);
    expect(detail.session.status).toBe("paused");
    expect(detail.session.allowedActions).toEqual(["resume", "cancel"]);
  });

  it("maps the database's enriched artifact projection without dropping its URI", async () => {
    const createdAt = "2026-08-30T20:00:00.000Z";
    const rpc = vi.fn().mockResolvedValue({
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
          last_event_sequence: 1,
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
    });
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
});
