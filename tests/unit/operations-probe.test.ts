import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { probeHttpTarget } = await import("@/lib/operations/probe");

function respondWith(status: number, delayMs = 0): typeof fetch {
  return (async () => {
    if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
    return new Response(null, { status });
  }) as unknown as typeof fetch;
}

const baseOptions = {
  targetUrl: "https://example.com/health",
  expectedStatusCode: 200,
  degradedLatencyMs: 2_000,
  timeoutMs: 5_000,
};

describe("HTTPS monitor probe", () => {
  it("passes when the target returns the expected status quickly", async () => {
    const result = await probeHttpTarget(baseOptions, respondWith(200));
    expect(result.outcome).toBe("pass");
    expect(result.statusCode).toBe(200);
    expect(result.failureReason).toBeNull();
    expect(result.latencyMs).not.toBeNull();
  });

  it("fails on an unexpected status and says exactly what it saw", async () => {
    const result = await probeHttpTarget(baseOptions, respondWith(503));
    expect(result.outcome).toBe("fail");
    expect(result.statusCode).toBe(503);
    expect(result.failureReason).toContain("503");
  });

  it("reports degraded when the response is slower than the threshold", async () => {
    const result = await probeHttpTarget(
      { ...baseOptions, degradedLatencyMs: 1 },
      respondWith(200, 15),
    );
    expect(result.outcome).toBe("degraded");
    expect(result.failureReason).toMatch(/above the 1ms threshold/);
  });

  it("fails when the target cannot be reached", async () => {
    const failing = (async () => {
      throw new Error("network unreachable");
    }) as unknown as typeof fetch;
    const result = await probeHttpTarget(baseOptions, failing);
    expect(result.outcome).toBe("fail");
    expect(result.statusCode).toBeNull();
    // The underlying network message is not echoed back to a browser surface.
    expect(result.failureReason).toBe("The production target could not be reached.");
  });

  it("returns unknown, not fail, when the target is not probeable at all", async () => {
    const notCalled = vi.fn();
    const result = await probeHttpTarget(
      { ...baseOptions, targetUrl: "https://169.254.169.254/latest/meta-data" },
      notCalled as unknown as typeof fetch,
    );
    expect(result.outcome).toBe("unknown");
    expect(notCalled).not.toHaveBeenCalled();
    expect(result.failureReason).toMatch(/private, loopback/i);
  });

  it("never follows a redirect and never reads a response body", async () => {
    let capturedInit: RequestInit | null = null;
    const capturing = (async (_input: string, init: RequestInit) => {
      capturedInit = init;
      return new Response("secret production content", { status: 200 });
    }) as unknown as typeof fetch;

    const result = await probeHttpTarget(baseOptions, capturing);
    expect(result.outcome).toBe("pass");
    const init = capturedInit as RequestInit | null;
    expect(init?.redirect).toBe("manual");
    expect(init?.method).toBe("GET");
    expect(JSON.stringify(result)).not.toContain("secret production content");
  });
});
