// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { DEFAULT_CAPACITY_LIMITS } from "@/lib/resources/capacity";
import { DEFAULT_RATE_LIMIT_POLICY } from "@/lib/resources/rate-limits";
import {
  acquireReservation,
  releaseReservation,
  settleReservationTokens,
} from "@/lib/resources/reservation-store";
import type { SupabaseLike } from "@/lib/resources/store";

interface Call {
  name: string;
  params: Record<string, unknown>;
}

function client(
  handler: (call: Call) => { data: unknown; error: { message: string } | null } | Promise<never>,
): { client: SupabaseLike; calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    client: {
      rpc(name: string, params: Record<string, unknown>) {
        calls.push({ name, params });
        return Promise.resolve(handler({ name, params })) as never;
      },
    } as unknown as SupabaseLike,
  };
}

const grant = {
  admitted: true,
  refusal: null,
  reservation_id: "res-1",
  retry_after_ms: null,
  worker_in_use: 0,
  provider_in_use: 0,
  project_in_use: 0,
  requests_in_window: 0,
  tokens_in_window: 0,
};

const request = {
  projectId: "project-1",
  agentId: "agent-backend",
  provider: "openai",
  model: "gpt-economical",
  leaseMs: 60_000,
  limits: DEFAULT_CAPACITY_LIMITS,
};

describe("acquiring a durable slot", () => {
  it("passes the limits from TypeScript rather than letting the database hold a second copy", async () => {
    const { client: db, calls } = client(() => ({ data: [grant], error: null }));
    await acquireReservation(db, { ...request, ratePolicy: DEFAULT_RATE_LIMIT_POLICY, estimatedTokens: 500 });

    expect(calls[0].name).toBe("acquire_resource_reservation");
    expect(calls[0].params).toMatchObject({
      p_max_per_worker: DEFAULT_CAPACITY_LIMITS.perWorker,
      p_max_per_provider: DEFAULT_CAPACITY_LIMITS.perProvider,
      p_max_per_project: DEFAULT_CAPACITY_LIMITS.perProject,
      p_lease_seconds: 60,
      p_rate_window_seconds: 60,
      p_estimated_tokens: 500,
    });
  });

  it("omits the rate window when the caller does not account for rate", async () => {
    const { client: db, calls } = client(() => ({ data: [grant], error: null }));
    await acquireReservation(db, request);

    // Null means "not accounted", the same thing an absent `rateEvents` means
    // to the pure function -- never a window of zero, which would refuse
    // everything.
    expect(calls[0].params.p_rate_window_seconds).toBeNull();
    expect(calls[0].params.p_max_requests_per_window).toBeNull();
  });

  it("reports a named refusal with the limit that refused", async () => {
    const { client: db } = client(() => ({
      data: [{ ...grant, admitted: false, refusal: "PROVIDER_AT_CAPACITY", reservation_id: null, provider_in_use: 6 }],
      error: null,
    }));

    const result = await acquireReservation(db, request);
    expect(result.admitted).toBe(false);
    expect(result.refusal).toBe("PROVIDER_AT_CAPACITY");
    expect(result.usage.provider).toBe(6);
  });

  it("carries the clearing time through for a rate refusal", async () => {
    const { client: db } = client(() => ({
      data: [{ ...grant, admitted: false, refusal: "REQUEST_RATE_EXCEEDED", reservation_id: null, retry_after_ms: 4_200 }],
      error: null,
    }));

    const result = await acquireReservation(db, request);
    expect(result.retryAfterMs).toBe(4_200);
  });
});

describe("admission fails closed, unlike the breaker store", () => {
  it("refuses when the call errors rather than admitting on unknown usage", async () => {
    const { client: db } = client(() => ({ data: null, error: { message: "connection reset" } }));
    const result = await acquireReservation(db, request);

    // A breaker that cannot be read means "no observed failures" and work
    // proceeds. Usage that cannot be read means "unknown", and admitting on
    // unknown removes the limit during exactly the incident it exists for.
    expect(result.admitted).toBe(false);
    expect(result.refusal).toBe("ADMISSION_UNAVAILABLE");
    expect(result.error).toBe("connection reset");
  });

  it("refuses when the transport throws, without throwing at the caller", async () => {
    const { client: db } = client(() => Promise.reject(new Error("socket hang up")));
    const result = await acquireReservation(db, request);

    // A caller forced to tell "full" from "broken" inside a catch block
    // generally does not, so neither outcome is an exception.
    expect(result.refusal).toBe("ADMISSION_UNAVAILABLE");
    expect(result.error).toBe("socket hang up");
  });

  it("treats a successful call that returned no row as unevaluable, not as a grant", async () => {
    const { client: db } = client(() => ({ data: [], error: null }));
    const result = await acquireReservation(db, request);

    // Reading a missing row as an admission is the one failure mode that
    // silently deletes the limit.
    expect(result.admitted).toBe(false);
    expect(result.refusal).toBe("ADMISSION_UNAVAILABLE");
  });

  it("does not report usage it never read", async () => {
    const { client: db } = client(() => ({ data: null, error: { message: "down" } }));
    const result = await acquireReservation(db, request);

    // Zeros with a refusal attached, never counts that would make a transport
    // failure look like an empty fleet.
    expect(result.usage).toEqual({ worker: 0, provider: 0, project: 0, requests: 0, tokens: 0 });
    expect(result.refusal).toBe("ADMISSION_UNAVAILABLE");
  });
});

describe("releasing and settling", () => {
  it("reports a released slot", async () => {
    const { client: db } = client(() => ({ data: true, error: null }));
    expect(await releaseReservation(db, "res-1")).toEqual({ released: true, error: null });
  });

  it("reports an already-released slot as false without raising", async () => {
    const { client: db } = client(() => ({ data: false, error: null }));
    expect((await releaseReservation(db, "res-1")).released).toBe(false);
  });

  it("keeps the cause when a release fails, since the lease expiry is the backstop", async () => {
    const { client: db } = client(() => ({ data: null, error: { message: "timeout" } }));
    const result = await releaseReservation(db, "res-1");
    expect(result).toEqual({ released: false, error: "timeout" });
  });

  it("refuses to settle a negative or fractional token count before calling", async () => {
    const { client: db, calls } = client(() => ({ data: true, error: null }));
    expect((await settleReservationTokens(db, "res-1", -1)).settled).toBe(false);
    expect((await settleReservationTokens(db, "res-1", 1.5)).settled).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it("settles a measurement over the estimate", async () => {
    const { client: db, calls } = client(() => ({ data: true, error: null }));
    expect((await settleReservationTokens(db, "res-1", 120)).settled).toBe(true);
    expect(calls[0].params).toMatchObject({ p_reservation_id: "res-1", p_actual_tokens: 120 });
  });
});
