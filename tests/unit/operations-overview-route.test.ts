// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const harness = vi.hoisted(() => ({
  operationsContext: vi.fn(),
  operationsFailure: vi.fn(),
  rpc: vi.fn(),
}));

vi.mock("@/lib/operations/route", () => ({
  OPERATIONS_EXECUTION_ENVELOPE: {
    executionAllowed: false,
    deploymentExecutor: "not_connected",
    rollbackExecutor: "not_connected",
    repairWorker: "not_connected",
  },
  operationsContext: harness.operationsContext,
  operationsFailure: harness.operationsFailure,
}));

import { GET } from "@/app/api/operations/overview/route";

const organizationId = "11111111-1111-4111-8111-111111111111";
const incidentRow = {
  id: "incident-1",
  project_id: "project-1",
  project_name: "Launchpad",
  title: "Production latency",
  sev: "SEV2",
  status: "open",
  source: "monitor",
  symptoms: "Latency over threshold",
  impact: "Checkout is slow",
  occurrence_count: 3,
  detected_at: "2026-08-21T12:00:00.000Z",
  last_signal_at: "2026-08-21T12:03:00.000Z",
  resolved_at: null,
  owner_attention_required: true,
  root_cause: null,
  corrective_action: null,
  auto_created: true,
};

function expectNoStore(response: Response) {
  expect(response.headers.get("cache-control")).toBe("private, no-store, max-age=0");
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.rpc.mockImplementation(async (name: string) => ({
    data: name === "list_production_incidents" ? [incidentRow] : [],
    error: null,
  }));
  harness.operationsContext.mockResolvedValue({
    activeOrganization: { id: organizationId, role: "owner" },
    client: { rpc: harness.rpc },
  });
});

describe("operations overview route", () => {
  it("reads only incidents and returns their briefing fields", async () => {
    const response = await GET(new Request(
      "https://factory.example/api/operations/overview?view=briefing",
    ));

    await expect(response.json()).resolves.toEqual({
      activeOrganizationId: organizationId,
      executionAllowed: false,
      deploymentExecutor: "not_connected",
      rollbackExecutor: "not_connected",
      repairWorker: "not_connected",
      incidents: [{
        id: "incident-1",
        projectName: "Launchpad",
        title: "Production latency",
        severity: "SEV2",
        status: "open",
        impact: "Checkout is slow",
        detectedAt: "2026-08-21T12:00:00.000Z",
        resolvedAt: null,
        ownerAttentionRequired: true,
      }],
    });
    expect(harness.rpc).toHaveBeenCalledExactlyOnceWith("list_production_incidents", {
      p_organization_id: organizationId,
      p_limit: 50,
    });
    expectNoStore(response);
  });

  it("preserves all overview reads and incident fields by default", async () => {
    const response = await GET();
    const body = await response.json();

    expect(harness.rpc.mock.calls.map(([name]) => name)).toEqual([
      "operations_portfolio_summary",
      "list_operations_projects",
      "list_production_incidents",
      "list_production_monitors",
      "list_operations_audit_events",
      "list_synthetic_journeys",
    ]);
    expect(body).toEqual(expect.objectContaining({
      activeOrganizationId: organizationId,
      role: "owner",
      summary: null,
      projects: [],
      monitors: [],
      auditEvents: [],
      journeys: [],
    }));
    expect(body.incidents).toEqual([{
      id: "incident-1",
      projectName: "Launchpad",
      title: "Production latency",
      severity: "SEV2",
      status: "open",
      impact: "Checkout is slow",
      detectedAt: "2026-08-21T12:00:00.000Z",
      resolvedAt: null,
      ownerAttentionRequired: true,
      projectId: "project-1",
      source: "monitor",
      symptoms: "Latency over threshold",
      occurrenceCount: 3,
      lastSignalAt: "2026-08-21T12:03:00.000Z",
      rootCause: null,
      correctiveAction: null,
      autoCreated: true,
    }]);
    expectNoStore(response);
  });
});
