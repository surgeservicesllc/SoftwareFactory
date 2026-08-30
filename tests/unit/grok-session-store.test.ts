// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/bots/service", () => ({ loadBotFabric: vi.fn() }));

import { buildGrokChiefOfStaffPlan } from "@/lib/factory/chief-of-staff";
import {
  mapGrokSessionDetail,
  readGrokBundle,
} from "@/lib/grok/session-store";

const organizationId = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000002";
const sessionId = "30000000-0000-4000-8000-000000000003";
const messageId = "40000000-0000-4000-8000-000000000004";
const graphId = "50000000-0000-4000-8000-000000000005";

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
