import { beforeEach, describe, expect, it, vi } from "vitest";

const { dispatchGraphWorker, requireActiveOrganization } = vi.hoisted(() => ({
  dispatchGraphWorker: vi.fn(),
  requireActiveOrganization: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization,
}));
vi.mock("@/lib/orchestration/dispatch", () => ({ dispatchGraphWorker }));

import { POST } from "@/app/api/graphs/route";

/**
 * The Workflows page's Launch, at the route boundary.
 *
 * The case that earned this file: the owner pressed Launch on
 * `full_lifecycle`, the graph landed PLANNED — and nothing ever ran it. The
 * route recorded the graph and stopped, the scheduled drain is off by
 * default, and the wake that the command routes fire was missing here. The
 * button looked like "run this" and meant "file this".
 *
 * So the properties pinned are the wake's: it fires with the created graph's
 * id through the project's own binding, its failure can never fail a launch
 * that already succeeded, and the response says plainly which of the two
 * worlds the caller is in.
 */

const organizationId = "44444444-4444-4444-8444-444444444444";
const projectId = "55555555-5555-4555-8555-555555555555";
const graphId = "66666666-6666-4666-8666-666666666666";

const targetRow = {
  app_id: 99,
  external_installation_id: 1234,
  external_repository_id: 5678,
  repository_full_name: "owner/repository",
};

const rpc = vi.fn();

/**
 * The billing tables the launch quota reads. Chainable like PostgREST and
 * thenable at the end; the counts default to an untouched Free organization
 * so every pre-existing case launches exactly as it did before quotas.
 */
const usageCounts = { graphs: 0, projects: 0, members: 1 };

function from(table: string) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "gte", "lt", "order", "limit"]) {
    chain[method] = () => chain;
  }
  (chain as { then: unknown }).then = (resolve: (value: unknown) => void) => {
    if (table === "billing_subscriptions") return resolve({ data: [], error: null });
    if (table === "graphs") return resolve({ count: usageCounts.graphs, error: null });
    if (table === "projects") return resolve({ count: usageCounts.projects, error: null });
    if (table === "organization_members") return resolve({ count: usageCounts.members, error: null });
    return resolve({ data: null, error: null });
  };
  return chain;
}

function request(body: unknown) {
  return new Request("https://factory.example/api/graphs", {
    body: JSON.stringify(body),
    headers: new Headers({
      "Content-Type": "application/json",
      Origin: "https://factory.example",
    }),
    method: "POST",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockImplementation((functionName: string) => {
    if (functionName === "create_graph_from_plan") {
      return Promise.resolve({ data: graphId, error: null });
    }
    // resolve_phase1c_command_target
    return { single: async () => ({ data: targetRow, error: null }) };
  });
  usageCounts.graphs = 0;
  usageCounts.projects = 0;
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId, role: "owner" },
    client: { rpc, from },
  });
  dispatchGraphWorker.mockResolvedValue(undefined);
});

describe("POST /api/graphs", () => {
  it("refuses the launch at the Free plan's monthly allowance, before any compile work", async () => {
    usageCounts.graphs = 10;

    const response = await POST(request({ projectId, templateKey: "full_lifecycle" }));

    expect(response.status).toBe(402);
    const body = await response.json() as {
      error: { code: string; message: string; limit: number; current: number; plan: string };
    };
    expect(body.error.code).toBe("plan_limit_reached");
    expect(body.error.limit).toBe(10);
    expect(body.error.current).toBe(10);
    expect(body.error.plan).toBe("free");
    // The refusal cost nothing: no graph was created, no worker woken.
    expect(rpc).not.toHaveBeenCalled();
    expect(dispatchGraphWorker).not.toHaveBeenCalled();
  });

  it("wakes the worker for the graph it just created, and says so", async () => {
    const response = await POST(request({ projectId, templateKey: "full_lifecycle" }));

    expect(response.status).toBe(200);
    const body = await response.json() as {
      graphId: string; state: string; workerWoken: boolean; note: string;
    };
    expect(body.graphId).toBe(graphId);
    expect(body.state).toBe("PLANNED");
    expect(body.workerWoken).toBe(true);
    expect(body.note).toContain("woken");

    expect(dispatchGraphWorker).toHaveBeenCalledWith(
      {
        appId: targetRow.app_id,
        externalInstallationId: targetRow.external_installation_id,
        externalRepositoryId: targetRow.external_repository_id,
        repositoryFullName: targetRow.repository_full_name,
      },
      graphId,
    );
  });

  it("keeps the launch's answer independent of a wake that throws", async () => {
    dispatchGraphWorker.mockRejectedValue(new Error("GitHub is unreachable"));

    const response = await POST(request({ projectId, templateKey: "full_lifecycle" }));

    expect(response.status).toBe(200);
    const body = await response.json() as { graphId: string; workerWoken: boolean; note: string };
    expect(body.graphId).toBe(graphId);
    expect(body.workerWoken).toBe(false);
    expect(body.note).toContain("scheduled or manual dispatch");
  });

  it("reports an unwakeable project the same honest way", async () => {
    // No verified GitHub binding: the target resolves to nothing, which is a
    // state, not an error — the graph is still created.
    rpc.mockImplementation((functionName: string) => {
      if (functionName === "create_graph_from_plan") {
        return Promise.resolve({ data: graphId, error: null });
      }
      return { single: async () => ({ data: null, error: { code: "PGRST116" } }) };
    });

    const response = await POST(request({ projectId, templateKey: "full_lifecycle" }));

    expect(response.status).toBe(200);
    const body = await response.json() as { workerWoken: boolean };
    expect(body.workerWoken).toBe(false);
    expect(dispatchGraphWorker).not.toHaveBeenCalled();
  });

  it("never wakes anything when the plan was refused", async () => {
    rpc.mockImplementation((functionName: string) => {
      if (functionName === "create_graph_from_plan") {
        return Promise.resolve({
          data: null,
          error: { code: "42501", message: "organization membership is required" },
        });
      }
      return { single: async () => ({ data: targetRow, error: null }) };
    });

    const response = await POST(request({ projectId, templateKey: "full_lifecycle" }));

    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(dispatchGraphWorker).not.toHaveBeenCalled();
  });
});

/**
 * Step 1's refusals.
 *
 * The ten-step flow begins here, so every way this call can be wrong is a way
 * the whole lifecycle can start from a lie: a graph planted against a project
 * the caller may not touch, a template that does not exist, a body that named
 * neither. Each refusal must reach the caller as a refusal — never a recorded
 * graph, never a woken worker.
 */
describe("POST /api/graphs refuses before it records", () => {
  it("refuses a body that does not name a project and a template", async () => {
    const response = await POST(request({ templateKey: "full_lifecycle" }));

    expect(response.status).toBe(400);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("invalid_request");
    expect(rpc).not.toHaveBeenCalled();
    expect(dispatchGraphWorker).not.toHaveBeenCalled();
  });

  it("refuses a project identifier that is not a uuid", async () => {
    const response = await POST(request({ projectId: "not-a-uuid", templateKey: "full_lifecycle" }));

    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("names the template a caller asked for and could not have", async () => {
    // A typo or a stale client. The message says which key failed, because
    // "not found" alone leaves the caller guessing which half was wrong.
    rpc.mockImplementation(() => Promise.resolve({ data: null, error: null }));
    requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId, role: "owner" },
      client: {
        rpc,
        // The quota tables answer through the shared fake; only the custom
        // template lookup needs its own not-found chain.
        from: (table: string) =>
          table === "graph_templates"
            ? {
                select: () => ({
                  eq: () => ({
                    eq: () => ({
                      eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
                    }),
                  }),
                }),
              }
            : from(table),
      },
    });

    const response = await POST(request({ projectId, templateKey: "no_such_template" }));

    expect(response.status).toBe(400);
    const body = await response.json() as { error: { message: string } };
    expect(body.error.message).toContain("no_such_template");
    expect(dispatchGraphWorker).not.toHaveBeenCalled();
  });

  it("refuses a member who may not launch, before any graph exists", async () => {
    requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId, role: "member" },
      client: { rpc },
    });

    const response = await POST(request({ projectId, templateKey: "full_lifecycle" }));

    expect(response.status).toBe(403);
    expect((await response.json() as { error: { code: string } }).error.code).toBe("manager_required");
    expect(rpc).not.toHaveBeenCalled();
    expect(dispatchGraphWorker).not.toHaveBeenCalled();
  });

  it("refuses a request that did not come from this origin", async () => {
    const response = await POST(
      new Request("https://factory.example/api/graphs", {
        body: JSON.stringify({ projectId, templateKey: "full_lifecycle" }),
        headers: new Headers({
          "Content-Type": "application/json",
          Origin: "https://elsewhere.example",
        }),
        method: "POST",
      }),
    );

    expect(response.status).toBe(403);
    expect((await response.json() as { error: { code: string } }).error.code)
      .toBe("invalid_request_origin");
    expect(rpc).not.toHaveBeenCalled();
    expect(dispatchGraphWorker).not.toHaveBeenCalled();
  });
});
