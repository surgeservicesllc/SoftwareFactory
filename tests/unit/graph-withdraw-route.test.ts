import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActiveOrganization } = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization,
}));

import { POST } from "@/app/api/graphs/[graphId]/withdraw/route";

/**
 * Stop's boundary. The database owns membership, the RUNNING refusal and
 * idempotence; this file pins the route's own conduct — exact rpc
 * arguments, the honest 409 for a live claim, a cross-origin post refused,
 * a non-UUID refused before the database.
 */

const organizationId = "44444444-4444-4444-8444-444444444444";
const graphId = "90000000-0000-4000-8000-000000000001";

const rpc = vi.fn();

function post(id: string, body: unknown = {}, origin: string | null = "https://factory.example") {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (origin) headers.set("Origin", origin);
  return POST(
    new Request(`https://factory.example/api/graphs/${id}/withdraw`, {
      body: JSON.stringify(body),
      headers,
      method: "POST",
    }),
    { params: Promise.resolve({ graphId: id }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  rpc.mockResolvedValue({
    data: { id: graphId, withdrawn_at: "2026-08-30T07:00:00.000Z" },
    error: null,
  });
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId },
    client: { rpc },
  });
});

describe("POST /api/graphs/[graphId]/withdraw", () => {
  it("passes the exact identities through and answers with what happened", async () => {
    const response = await post(graphId, { reason: "changed my mind" });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.graphId).toBe(graphId);
    expect(body.withdrawnAt).toBe("2026-08-30T07:00:00.000Z");
    expect(body.note).toContain("Nothing already running was interrupted");
    expect(rpc).toHaveBeenCalledWith("withdraw_graph_as_member", {
      p_organization_id: organizationId,
      p_graph_id: graphId,
      p_reason: "changed my mind",
    });
  });

  it("answers a live claim with the honest refusal, never a fake stop", async () => {
    rpc.mockResolvedValue({ data: null, error: { code: "55000", message: "graph_run_in_flight" } });
    const response = await post(graphId);
    expect(response.status).toBe(409);
    const body = await response.json();
    expect(body.error.code).toBe("graph_run_in_flight");
    expect(body.error.message).toContain("stops future claims");
  });

  it("refuses a graph id that is not a UUID before touching the database", async () => {
    const response = await post("not-a-graph");
    expect(response.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin post before it reaches the workspace", async () => {
    const response = await post(graphId, {}, "https://evil.example");
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(rpc).not.toHaveBeenCalled();
  });
});
