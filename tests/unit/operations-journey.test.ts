import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { runSyntheticJourney } = await import("@/lib/operations/journey");

const shell = {
  kind: "app_shell" as const,
  name: "Home",
  path: "/",
  method: "GET" as const,
  expectedStatus: 200,
};

const read = {
  kind: "critical_read" as const,
  name: "Orders",
  path: "/api/orders",
  method: "GET" as const,
  expectedStatus: 200,
};

const baseOptions = {
  baseUrl: "https://storefront.example",
  degradedLatencyMs: 2_000,
  timeoutMs: 5_000,
};

function respondWith(byPath: Record<string, number>, delays: Record<string, number> = {}): typeof fetch {
  return (async (input: string) => {
    const path = new URL(input).pathname;
    const delay = delays[path] ?? 0;
    if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
    return new Response(null, { status: byPath[path] ?? 404 });
  }) as unknown as typeof fetch;
}

describe("synthetic journey execution", () => {
  it("passes when every executed step returns its expected status", async () => {
    const result = await runSyntheticJourney(
      { ...baseOptions, journey: { profile: "standard", steps: [shell, read] } },
      respondWith({ "/": 200, "/api/orders": 200 }),
    );

    expect(result.outcome).toBe("pass");
    expect(result.failedStep).toBeNull();
    expect(result.steps.map((step) => step.outcome)).toEqual(["pass", "pass"]);
  });

  it("stops at the first failing step instead of hammering a broken production", async () => {
    const calls: string[] = [];
    const tracking = (async (input: string) => {
      calls.push(new URL(input).pathname);
      return new Response(null, { status: new URL(input).pathname === "/" ? 503 : 200 });
    }) as unknown as typeof fetch;

    const result = await runSyntheticJourney(
      { ...baseOptions, journey: { profile: "standard", steps: [shell, read] } },
      tracking,
    );

    expect(result.outcome).toBe("fail");
    expect(result.failedStep).toBe("Home");
    expect(calls).toEqual(["/"]);
    expect(result.steps).toHaveLength(1);
  });

  it("records a declared safe write as skipped rather than performing it", async () => {
    const calls: string[] = [];
    const tracking = (async (input: string) => {
      calls.push(new URL(input).pathname);
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    const result = await runSyntheticJourney(
      {
        ...baseOptions,
        journey: {
          profile: "standard",
          steps: [
            shell,
            read,
            {
              kind: "safe_write",
              name: "Heartbeat",
              path: "/api/heartbeat",
              method: "POST",
              expectedStatus: 202,
              reversalNote: "Writes a self-expiring heartbeat row that the app prunes hourly.",
            },
          ],
        },
      },
      tracking,
    );

    expect(calls).not.toContain("/api/heartbeat");
    const writeStep = result.steps.find((step) => step.kind === "safe_write");
    expect(writeStep?.outcome).toBe("skipped");
    expect(writeStep?.detail).toMatch(/not executed/i);
    expect(result.outcome).toBe("pass");
  });

  it("reports degraded when a step is slower than the threshold but still correct", async () => {
    const result = await runSyntheticJourney(
      { ...baseOptions, degradedLatencyMs: 1, journey: { profile: "basic", steps: [shell] } },
      respondWith({ "/": 200 }, { "/": 15 }),
    );

    expect(result.outcome).toBe("degraded");
    expect(result.failedStep).toBeNull();
  });

  it("refuses to run a journey that does not satisfy its profile", async () => {
    const result = await runSyntheticJourney(
      { ...baseOptions, journey: { profile: "critical", steps: [shell] } },
      respondWith({ "/": 200 }),
    );

    expect(result.outcome).toBe("unknown");
    expect(result.failureReason).toMatch(/critical profile also requires/i);
    expect(result.steps).toHaveLength(0);
  });

  it("refuses a step whose path escapes to another host", async () => {
    const result = await runSyntheticJourney(
      {
        ...baseOptions,
        journey: {
          profile: "basic",
          steps: [{ ...shell, name: "Escape", path: "//169.254.169.254/latest/meta-data" }],
        },
      },
      respondWith({}),
    );

    expect(result.outcome).toBe("unknown");
    expect(result.failureReason).toMatch(/cannot be probed/i);
  });

  it("refuses an undeclared write before issuing any request", async () => {
    const calls: string[] = [];
    const tracking = (async (input: string) => {
      calls.push(new URL(input).pathname);
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    const result = await runSyntheticJourney(
      {
        ...baseOptions,
        journey: {
          profile: "basic",
          steps: [
            shell,
            { kind: "api", name: "Create order", path: "/api/orders", method: "POST", expectedStatus: 201 },
          ],
        },
      },
      tracking,
    );

    expect(result.outcome).toBe("unknown");
    expect(result.failureReason).toMatch(/without declaring itself a safe write/i);
    // Validation happens before execution, so nothing reached production.
    expect(calls).toEqual([]);
  });

  it("never issues a request for a destructive path", async () => {
    const calls: string[] = [];
    const tracking = (async (input: string) => {
      calls.push(new URL(input).pathname);
      return new Response(null, { status: 200 });
    }) as unknown as typeof fetch;

    const result = await runSyntheticJourney(
      {
        ...baseOptions,
        journey: { profile: "basic", steps: [shell, { ...read, name: "Purge", path: "/api/orders/delete" }] },
      },
      tracking,
    );

    expect(result.outcome).toBe("unknown");
    expect(calls).toEqual([]);
  });
});
