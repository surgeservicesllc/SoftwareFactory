// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  buildProviderAvailability: vi.fn(),
  snapshotProviderHealth: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/providers/registry", () => ({
  buildProviderAvailability: harness.buildProviderAvailability,
  snapshotProviderHealth: harness.snapshotProviderHealth,
}));

import { loadObservedMetrics, loadProjectRoutingContext } from "@/lib/providers/service";

const organizationId = "10000000-0000-4000-8000-000000000001";
const projectId = "20000000-0000-4000-8000-000000000001";

function queryResult(data: unknown) {
  return { data, error: null };
}

function routingClient(executionEnabled: boolean) {
  const rpc = vi.fn().mockResolvedValue(queryResult([]));
  const from = vi.fn((table: string) => {
    if (table === "projects") {
      const maybeSingle = vi.fn().mockResolvedValue(queryResult({
        id: projectId,
        name: "SoftwareFactory",
        github_repository: "surgeservicesllc/SoftwareFactory",
        default_branch: "main",
        maximum_autonomous_risk: "green",
      }));
      const secondEq = { maybeSingle };
      const firstEq = { eq: vi.fn().mockReturnValue(secondEq) };
      return { select: vi.fn().mockReturnValue({ eq: vi.fn().mockReturnValue(firstEq) }) };
    }
    if (table === "organizations") {
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({
            maybeSingle: vi.fn().mockResolvedValue(queryResult({
              ai_provider_execution_enabled: executionEnabled,
            })),
          }),
        }),
      };
    }
    if (table === "provider_model_configurations") {
      const secondOrder = { limit: vi.fn().mockResolvedValue(queryResult([])) };
      const firstOrder = { order: vi.fn().mockReturnValue(secondOrder) };
      return {
        select: vi.fn().mockReturnValue({
          eq: vi.fn().mockReturnValue({ order: vi.fn().mockReturnValue(firstOrder) }),
        }),
      };
    }
    throw new Error(`Unexpected table: ${table}`);
  });

  return { client: { from, rpc } as never, rpc };
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.buildProviderAvailability.mockResolvedValue([]);
});

describe("provider service read and probe boundaries", () => {
  it("reads observed metrics only through the bounded caller-member RPC", async () => {
    const rpc = vi.fn().mockResolvedValue(queryResult([
      { provider: "openai", status: "succeeded", latency_ms: 100 },
      { provider: "openai", status: "failed", latency_ms: 300 },
    ]));

    const metrics = await loadObservedMetrics({ rpc } as never, organizationId, 500);

    expect(rpc).toHaveBeenCalledWith("list_provider_run_metrics", {
      p_limit: 50,
      p_organization_id: organizationId,
    });
    expect(metrics.openai).toEqual({ recentSuccessRate: 0.5, medianLatencyMs: 300 });
  });

  it("uses a local disabled snapshot even when a caller requests probes while execution is OFF", async () => {
    const { client } = routingClient(false);

    await loadProjectRoutingContext(client, organizationId, projectId, { probeProviders: true });

    expect(harness.buildProviderAvailability).toHaveBeenCalledWith(expect.objectContaining({
      health: expect.arrayContaining([
        expect.objectContaining({ provider: "anthropic", state: "disabled" }),
        expect.objectContaining({ provider: "openai", state: "disabled" }),
      ]),
    }));
  });

  it("uses a conservative local snapshot for no-contact previews", async () => {
    const { client } = routingClient(true);

    await loadProjectRoutingContext(client, organizationId, projectId);

    expect(harness.buildProviderAvailability).toHaveBeenCalledWith(expect.objectContaining({
      health: expect.arrayContaining([
        expect.objectContaining({ provider: "anthropic", state: "not_configured" }),
        expect.objectContaining({ provider: "openai", state: "not_configured" }),
      ]),
    }));
  });

  it("permits live health probing only after enabled execution opts in", async () => {
    const { client } = routingClient(true);

    await loadProjectRoutingContext(client, organizationId, projectId, { probeProviders: true });

    const options = harness.buildProviderAvailability.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(options).not.toHaveProperty("health");
  });
});
