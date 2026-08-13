import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { WorkerStatusBadge } from "@/components/worker-status";

function response(worker: Record<string, unknown>) {
  return new Response(JSON.stringify({ worker }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test_value");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("worker status badge", () => {
  it("shows Connected only while authenticated heartbeat evidence is fresh", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      connectionStatus: "connected",
      statusLabel: "Worker Connected",
      lastHeartbeatAt: new Date().toISOString(),
      activeWorkers: 1,
      availableWorkers: 1,
      staleAfterSeconds: 90,
    })));

    render(<WorkerStatusBadge />);

    expect(await screen.findByText("Worker Connected")).toBeInTheDocument();
  });

  it("downgrades an expired heartbeat instead of claiming connectivity", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(response({
      connectionStatus: "connected",
      statusLabel: "Worker Connected",
      lastHeartbeatAt: "2020-01-01T00:00:00Z",
      activeWorkers: 1,
      availableWorkers: 1,
      staleAfterSeconds: 30,
    })));

    render(<WorkerStatusBadge />);

    expect(await screen.findByText("Worker Stale")).toBeInTheDocument();
    expect(screen.queryByText("Worker Connected")).not.toBeInTheDocument();
  });
});
