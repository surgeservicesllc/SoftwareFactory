import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActiveOrganization, dispatchGraphWorker } = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
  dispatchGraphWorker: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization,
}));
vi.mock("@/lib/orchestration/dispatch", () => ({ dispatchGraphWorker }));

import { POST } from "@/app/api/graphs/[graphId]/pause/route";

/**
 * Pause/Resume's boundary. The database owns membership, the withdrawn
 * refusal and idempotence; the engine owns the wave-boundary honoring. This
 * file pins the route's own conduct — exact rpc arguments, the resume wake
 * (and pause's deliberate lack of one), the honest 409 for a withdrawn
 * graph, a cross-origin post refused, a non-UUID refused before the
 * database, and a resume whose wake fails still reporting the resume that
 * really happened.
 */

const organizationId = "44444444-4444-4444-8444-444444444444";
const graphId = "90000000-0000-4000-8000-000000000002";
const projectId = "20000000-0000-4000-8000-000000000002";

const rpc = vi.fn();

function post(id: string, body: unknown, origin: string | null = "https://factory.example") {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (origin) headers.set("Origin", origin);
  return POST(
    new Request(`https://factory.example/api/graphs/${id}/pause`, {
      body: JSON.stringify(body),
      headers,
      method: "POST",
    }),
    { params: Promise.resolve({ graphId: id }) },
  );
}

const binding = {
  app_id: 1234,
  base_branch: "main",
  connection_id: "50000000-0000-4000-8000-000000000005",
  external_installation_id: 987,
  external_repository_id: 654,
  internal_installation_id: "60000000-0000-4000-8000-000000000006",
  project_id: projectId,
  repository_full_name: "acme/widgets",
  repository_id: "30000000-0000-4000-8000-000000000003",
};

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockImplementation((fn: string) => {
    if (fn === "set_graph_pause_as_member") {
      return Promise.resolve({
        data: { id: graphId, project_id: projectId, pause_requested_at: "2026-08-30T08:00:00.000Z" },
        error: null,
      });
    }
    if (fn === "resolve_phase1c_command_target") {
      return { single: () => Promise.resolve({ data: binding, error: null }) };
    }
    return Promise.resolve({ data: null, error: { message: `unexpected rpc ${fn}` } });
  });
  dispatchGraphWorker.mockResolvedValue({ dispatched: true });
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId },
    client: { rpc },
  });
});

describe("POST /api/graphs/[graphId]/pause", () => {
  it("pauses with the exact identities and never wakes a worker to do it", async () => {
    const response = await post(graphId, { paused: true });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.graphId).toBe(graphId);
    expect(body.pausedAt).toBe("2026-08-30T08:00:00.000Z");
    expect(body.note).toContain("nothing new starts");
    expect(rpc).toHaveBeenCalledWith("set_graph_pause_as_member", {
      p_organization_id: organizationId,
      p_graph_id: graphId,
      p_paused: true,
    });
    // Pausing must not dispatch anything: the whole point is that nothing new starts.
    expect(dispatchGraphWorker).not.toHaveBeenCalled();
  });

  it("resumes and wakes the worker through the project's own binding", async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === "set_graph_pause_as_member") {
        return Promise.resolve({
          data: { id: graphId, project_id: projectId, pause_requested_at: null },
          error: null,
        });
      }
      return { single: () => Promise.resolve({ data: binding, error: null }) };
    });
    const response = await post(graphId, { paused: false });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.pausedAt).toBeNull();
    expect(body.workerWoken).toBe(true);
    expect(body.note).toContain("woken");
    expect(dispatchGraphWorker).toHaveBeenCalledWith(
      {
        appId: binding.app_id,
        externalInstallationId: binding.external_installation_id,
        externalRepositoryId: binding.external_repository_id,
        repositoryFullName: binding.repository_full_name,
      },
      graphId,
    );
  });

  it("a resume whose wake fails still reports the resume that happened", async () => {
    rpc.mockImplementation((fn: string) => {
      if (fn === "set_graph_pause_as_member") {
        return Promise.resolve({
          data: { id: graphId, project_id: projectId, pause_requested_at: null },
          error: null,
        });
      }
      return { single: () => Promise.resolve({ data: null, error: { message: "no binding" } }) };
    });
    const response = await post(graphId, { paused: false });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.workerWoken).toBe(false);
    expect(body.note).toContain("Not Connected");
  });

  it("answers a withdrawn graph with the honest refusal", async () => {
    rpc.mockImplementation(() =>
      Promise.resolve({ data: null, error: { code: "55000", message: "graph_withdrawn" } }));
    const response = await post(graphId, { paused: true });
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("graph_withdrawn");
    expect(body.error.message).toContain("permanent");
  });

  it("refuses a body that does not say which direction", async () => {
    const response = await post(graphId, {});
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a graph id that is not a UUID before touching the database", async () => {
    const response = await post("not-a-graph", { paused: true });
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin post before it reaches the workspace", async () => {
    const response = await post(graphId, { paused: true }, "https://evil.example");
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
