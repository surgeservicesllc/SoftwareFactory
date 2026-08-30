import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActiveOrganization } = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization,
}));

import { GET } from "@/app/api/graphs/runs/[graphRunId]/events/route";

/**
 * The run's activity log at the route boundary. RLS owns the tenancy rule;
 * what this file pins is the route's own conduct: verbatim rows in
 * chronological order, node keys resolved through the run's own node rows,
 * an admitted truncation flag, a non-UUID refused before the database, and
 * a database refusal handed back undressed.
 */

const organizationId = "44444444-4444-4444-8444-444444444444";
const graphRunId = "80000000-0000-4000-8000-000000000002";

type Row = Record<string, unknown>;

/** One chainable query stub per table, answering with the table's rows. */
function tableClient(rowsByTable: Record<string, Row[] | { error: Row }>) {
  return {
    from(table: string) {
      const answer = rowsByTable[table];
      const result = answer && "error" in answer && !Array.isArray(answer)
        ? { data: null, error: answer.error }
        : { data: answer ?? [], error: null };
      const chain = {
        select: () => chain,
        eq: () => chain,
        in: () => chain,
        order: () => chain,
        limit: () => Promise.resolve(result),
        then: (resolve: (value: unknown) => unknown) => resolve(result),
      };
      return chain;
    },
  };
}

function get(id: string) {
  return GET(
    new Request(`https://factory.example/api/graphs/runs/${id}/events`),
    { params: Promise.resolve({ graphRunId: id }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/graphs/runs/[graphRunId]/events", () => {
  it("reports the recorded events verbatim, chronological, with node keys named", async () => {
    requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId },
      client: tableClient({
        // The database answers newest first; the route reads it back for people.
        graph_events: [
          {
            id: "e2", event_type: "node_completed", detail: "worker w attempt 2",
            node_run_id: "nr1", created_at: "2026-08-30T05:02:00.000Z",
          },
          {
            id: "e1", event_type: "node_running", detail: "worker w",
            node_run_id: "nr1", created_at: "2026-08-30T05:01:00.000Z",
          },
        ],
        node_runs: [{ id: "nr1", node_id: "gn1" }],
        graph_nodes: [{ id: "gn1", node_key: "implement" }],
      }),
    });
    const response = await get(graphRunId);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.events).toEqual([
      {
        eventId: "e1", eventType: "node_running", detail: "worker w",
        nodeKey: "implement", createdAt: "2026-08-30T05:01:00.000Z",
      },
      {
        eventId: "e2", eventType: "node_completed", detail: "worker w attempt 2",
        nodeKey: "implement", createdAt: "2026-08-30T05:02:00.000Z",
      },
    ]);
    expect(body.truncated).toBe(false);
  });

  it("keeps a run-level event without pretending it belongs to a node", async () => {
    requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId },
      client: tableClient({
        graph_events: [{
          id: "e3", event_type: "run_completed", detail: null,
          node_run_id: null, created_at: "2026-08-30T05:03:00.000Z",
        }],
      }),
    });
    const response = await get(graphRunId);
    const body = await response.json();
    expect(body.events).toEqual([{
      eventId: "e3", eventType: "run_completed", detail: null,
      nodeKey: null, createdAt: "2026-08-30T05:03:00.000Z",
    }]);
  });

  it("refuses a run id that is not a UUID before touching the database", async () => {
    const response = await get("not-a-run");
    expect(response.status).toBe(400);
    expect(requireActiveOrganization).not.toHaveBeenCalled();
    const body = await response.json();
    expect(body.error.code).toBe("invalid_graph_run_id");
  });

  it("hands a database refusal back rather than dressing it up", async () => {
    requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId },
      client: tableClient({
        graph_events: { error: { code: "42501", message: "organization membership is required" } },
      }),
    });
    const response = await get(graphRunId);
    expect(response.status).toBeGreaterThanOrEqual(400);
    const body = await response.json();
    expect(JSON.stringify(body)).toContain("membership");
  });
});
