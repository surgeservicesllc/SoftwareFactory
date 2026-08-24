import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActiveOrganization } = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization,
}));

import { GET } from "@/app/api/graphs/runs/[graphRunId]/artifacts/route";

/**
 * The run's recorded artifacts, at the route boundary.
 *
 * The database function owns the tenancy rule — the run must belong to the
 * caller's organization — so what this file pins is the route's own conduct:
 * it passes the caller's organization and the run id through unchanged,
 * reports rows verbatim in the response shape the page reads, refuses a
 * non-UUID id before touching the database, and hands a database refusal
 * back rather than dressing it up.
 */

const organizationId = "44444444-4444-4444-8444-444444444444";
const graphRunId = "80000000-0000-4000-8000-000000000001";

const rpc = vi.fn();

function get(id: string) {
  return GET(
    new Request(`https://factory.example/api/graphs/runs/${id}/artifacts`),
    { params: Promise.resolve({ graphRunId: id }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId },
    client: { rpc },
  });
  rpc.mockResolvedValue({
    data: [
      {
        artifact_id: "a0000000-0000-4000-8000-000000000001",
        node_run_id: "b0000000-0000-4000-8000-000000000001",
        node_key: "decide",
        kind: "REDUCED",
        payload: { chosenPath: "USE" },
        created_at: "2026-08-24T12:00:00.000Z",
      },
    ],
    error: null,
  });
});

describe("GET /api/graphs/runs/[graphRunId]/artifacts", () => {
  it("reports the recorded rows verbatim, in the page's shape", async () => {
    const response = await get(graphRunId);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.artifacts).toEqual([
      {
        artifactId: "a0000000-0000-4000-8000-000000000001",
        nodeRunId: "b0000000-0000-4000-8000-000000000001",
        nodeKey: "decide",
        kind: "REDUCED",
        payload: { chosenPath: "USE" },
        createdAt: "2026-08-24T12:00:00.000Z",
      },
    ]);
    expect(rpc).toHaveBeenCalledWith("list_graph_run_artifacts", {
      p_organization_id: organizationId,
      p_graph_run_id: graphRunId,
    });
  });

  it("refuses a run id that is not a UUID before touching the database", async () => {
    const response = await get("not-a-run");
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.error.code).toBe("invalid_graph_run_id");
  });

  it("hands a database refusal back rather than dressing it up", async () => {
    rpc.mockResolvedValue({
      data: null,
      error: { code: "42501", message: "organization membership is required" },
    });
    const response = await get(graphRunId);
    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = await response.json();
    expect(JSON.stringify(body)).toContain("membership");
  });
});
