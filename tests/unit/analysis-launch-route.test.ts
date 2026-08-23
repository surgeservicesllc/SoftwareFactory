import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

// Hoisted: `vi.mock` factories run before module-level consts are initialized.
const mocks = vi.hoisted(() => ({
  launchCommandAnalysisGraph: vi.fn(),
  requireActiveOrganization: vi.fn(),
  dispatchGraphWorker: vi.fn(async () => ({ dispatched: false, reason: "not configured" })),
}));
const { launchCommandAnalysisGraph, requireActiveOrganization } = mocks;

vi.mock("@/lib/orchestration/analysis-launch", () => ({
  launchCommandAnalysisGraph: mocks.launchCommandAnalysisGraph,
}));
vi.mock("@/lib/orchestration/dispatch", () => ({
  dispatchGraphWorker: mocks.dispatchGraphWorker,
}));
// Keep the real module: the route's error boundary matches on the tenant and
// authentication error classes it exports, and a bare stub makes an
// `instanceof` against `undefined` throw instead of classifying.
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization: mocks.requireActiveOrganization,
}));

import { POST } from "@/app/api/commands/[commandId]/analysis/route";

const ORGANIZATION = "10000000-0000-4000-8000-000000000001";
const PROJECT = "20000000-0000-4000-8000-000000000001";
const COMMAND = "30000000-0000-4000-8000-000000000001";

/** A tenant client that answers one `commands` row and records what was asked. */
function clientReturning(row: { command_type: string } | null) {
  const eq = vi.fn();
  const builder = {
    select: vi.fn(() => builder),
    eq: vi.fn((...args: unknown[]) => { eq(...args); return builder; }),
    maybeSingle: vi.fn(async () => ({ data: row, error: null })),
  };
  return {
    from: vi.fn(() => builder),
    // The launch's answer must not depend on the worker wake, so this throws.
    rpc: vi.fn(() => { throw new Error("binding lookup is unavailable"); }),
    filters: eq,
  };
}

function request(body: unknown = { projectId: PROJECT }) {
  return new Request(`https://factory.example/api/commands/${COMMAND}/analysis`, {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://factory.example" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/commands/[commandId]/analysis", () => {
  it("launches the template the command's own type maps to", async () => {
    /*
     * The defect this locks: the body used to carry `commandType`, defaulted
     * to `other`. The command list the button renders from never exposed the
     * type, so every manual launch defaulted — and because `other` maps to a
     * real template rather than refusing, a `fix_bug` command silently got
     * `production_readiness` instead of `bug_sweep`.
     */
    const client = clientReturning({ command_type: "fix_bug" });
    requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: ORGANIZATION },
      client,
    });
    launchCommandAnalysisGraph.mockResolvedValue({
      launched: true, graphId: "graph-1", templateKey: "bug_sweep",
    });

    const response = await POST(request(), { params: Promise.resolve({ commandId: COMMAND }) });

    // 200/202 even though the worker wake threw: the graph exists, and a
    // failed wake leaves it planned for the next dispatch rather than
    // reporting a launch that did happen as a failure.
    expect(response.status).toBeLessThan(400);
    expect(launchCommandAnalysisGraph).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ commandId: COMMAND, commandType: "fix_bug" }),
    );
  });

  it("refuses a body that still names its own command type", async () => {
    // The browser does not get to choose which analysis template runs.
    requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: ORGANIZATION },
      client: clientReturning({ command_type: "fix_bug" }),
    });
    launchCommandAnalysisGraph.mockClear();

    const response = await POST(
      request({ projectId: PROJECT, commandType: "security" }),
      { params: Promise.resolve({ commandId: COMMAND }) },
    );

    expect(response.status).toBe(400);
    expect(launchCommandAnalysisGraph).not.toHaveBeenCalled();
  });

  it("says the request is not in this workspace when no row is visible", async () => {
    // RLS answering with no row is the same refusal the launch would give;
    // stating it here beats sending a guessed type into the doorway.
    requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: ORGANIZATION },
      client: clientReturning(null),
    });
    launchCommandAnalysisGraph.mockClear();

    const response = await POST(request(), { params: Promise.resolve({ commandId: COMMAND }) });

    expect(response.status).toBe(404);
    expect(await response.json()).toMatchObject({ error: { code: "command_not_found" } });
    expect(launchCommandAnalysisGraph).not.toHaveBeenCalled();
  });
});
