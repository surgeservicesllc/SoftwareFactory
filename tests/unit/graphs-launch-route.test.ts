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
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId, role: "owner" },
    client: { rpc },
  });
  dispatchGraphWorker.mockResolvedValue(undefined);
});

describe("POST /api/graphs", () => {
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
