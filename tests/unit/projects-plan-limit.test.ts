// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const harness = vi.hoisted(() => ({ requireActiveOrganization: vi.fn() }));

vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization: harness.requireActiveOrganization,
}));

import { POST } from "@/app/api/projects/route";

/**
 * The Free plan's project cap at the route boundary: creation past the cap is
 * a priced refusal that names its numbers, and the write RPC is never
 * reached. Existing projects are untouched — the check gates creation only.
 */

const ORG = "77777777-7777-4777-8777-777777777777";
const counts = { projects: 0, graphs: 0, members: 1 };
const rpc = vi.fn();

function from(table: string) {
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "eq", "neq", "gte", "lt", "order", "limit"]) {
    chain[method] = () => chain;
  }
  (chain as { then: unknown }).then = (resolve: (value: unknown) => void) => {
    if (table === "billing_subscriptions") return resolve({ data: [], error: null });
    if (table === "projects") return resolve({ count: counts.projects, error: null });
    if (table === "graphs") return resolve({ count: counts.graphs, error: null });
    if (table === "organization_members") return resolve({ count: counts.members, error: null });
    return resolve({ data: null, error: null });
  };
  return chain;
}

function request() {
  return new Request("https://factory.example/api/projects", {
    method: "POST",
    body: JSON.stringify({
      connectionId: "88888888-8888-4888-8888-888888888888",
      repositoryId: 1234,
      name: "Another project",
      defaultBranch: "main",
    }),
    headers: new Headers({
      "Content-Type": "application/json",
      Origin: "https://factory.example",
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  counts.projects = 0;
  rpc.mockResolvedValue({ data: { project: { id: "p1" } }, error: null });
  harness.requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: ORG, role: "owner" },
    client: { rpc, from },
  });
});

describe("POST /api/projects under the plan cap", () => {
  it("refuses creation at the Free cap with the exact numbers, before the write", async () => {
    counts.projects = 1;

    const response = await POST(request());
    expect(response.status).toBe(402);
    const body = (await response.json()) as {
      error: { code: string; limit: number; current: number; plan: string };
    };
    expect(body.error.code).toBe("plan_limit_reached");
    expect(body.error.limit).toBe(1);
    expect(body.error.current).toBe(1);
    expect(body.error.plan).toBe("free");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("lets creation through under the cap", async () => {
    counts.projects = 0;

    const response = await POST(request());
    // Anything but the 402 refusal: the request reached the write boundary.
    expect(response.status).not.toBe(402);
    expect(rpc).toHaveBeenCalled();
  });
});
