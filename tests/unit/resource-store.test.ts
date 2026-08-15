// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { closedBreaker } from "@/lib/resources/breakers";
import {
  breakerFor,
  loadBreakers,
  recordAssignment,
  recordBreakerFault,
  recordBreakerSuccess,
} from "@/lib/resources/store";
import { RESOURCE_POLICY_VERSION, type ResourceAssignment } from "@/lib/resources/manager";

type RpcCall = { name: string; params: Record<string, unknown> };

function client(options: {
  rows?: unknown;
  selectError?: { message: string } | null;
  rpcResult?: unknown;
  rpcError?: { message: string } | null;
  calls?: RpcCall[];
}) {
  return {
    rpc(name: string, params: Record<string, unknown>) {
      options.calls?.push({ name, params });
      return Promise.resolve({ data: options.rpcResult ?? null, error: options.rpcError ?? null });
    },
    from() {
      return {
        select() {
          return {
            eq() {
              return Promise.resolve({
                data: options.rows ?? [],
                error: options.selectError ?? null,
              });
            },
          };
        },
      };
    },
  };
}

const assignment: ResourceAssignment = Object.freeze({
  policyVersion: RESOURCE_POLICY_VERSION,
  decision: "ASSIGNED",
  agentId: "engineer",
  provider: "openai",
  model: "gpt-5.3-codex",
  objective: "BALANCED",
  mode: "AUTO",
  reason: "Highest score on capability fit and observed performance.",
  candidates: Object.freeze([
    {
      agentId: "engineer",
      provider: "openai",
      model: "gpt-5.3-codex",
      eligible: true,
      score: 0.81,
      components: { capabilityFit: 1, reliability: 0.9, speed: 1000, cost: 0.02, affinity: 0.5 },
      rejections: Object.freeze([]),
      retryAfterMs: null,
      notes: Object.freeze([]),
      prediction: Object.freeze({
        expectedSuccessRate: 0.9,
        expectedDurationMs: 1000,
        expectedCostUsd: 0.02,
        evidenced: true,
      }),
    },
  ]),
  prediction: Object.freeze({
    expectedSuccessRate: 0.9,
    expectedDurationMs: 1000,
    expectedCostUsd: 0.02,
    evidenced: true,
  }),
});

describe("resource store", () => {
  it("converts a stored timestamp into the epoch milliseconds the breaker compares against", async () => {
    const openedAt = "2026-08-14T12:00:00.000Z";
    const records = await loadBreakers(
      client({
        rows: [
          {
            target: "openai",
            state: "open",
            fault: "outage",
            consecutive_faults: 3,
            opened_at: openedAt,
            reason: "3 consecutive outage failures.",
          },
        ],
      }),
      "org-1",
    );

    // `evaluateBreaker` does arithmetic against `Date.now()`. A string here
    // would make every cooldown comparison NaN, which reads as "not elapsed"
    // and would strand an open breaker forever.
    expect(records.get("openai")?.openedAt).toBe(Date.parse(openedAt));
    expect(typeof records.get("openai")?.openedAt).toBe("number");
  });

  it("falls back to a closed breaker when the state cannot be read", async () => {
    const records = await loadBreakers(
      client({ selectError: { message: "relation does not exist" } }),
      "org-1",
    );
    expect(records.size).toBe(0);

    // Closed means "nothing has failed here", not "this is known good". An
    // unreadable breaker must not block work it never observed failing.
    expect(breakerFor(records, "openai")).toEqual(closedBreaker("openai"));
  });

  it("passes the threshold from the shared table rather than a copy", async () => {
    const calls: RpcCall[] = [];
    await recordBreakerFault(
      client({ calls, rpcResult: [{ state: "closed", consecutive_faults: 1, opened: false, reason: null }] }),
      "org-1",
      "openai",
      "rate_limit",
    );
    // A rate limit is the provider saying plainly to back off, so it opens at
    // two. If SQL held its own copy of this number the two could disagree.
    expect(calls[0].params.p_threshold).toBe(2);

    const outageCalls: RpcCall[] = [];
    await recordBreakerFault(
      client({ calls: outageCalls, rpcResult: [{ state: "open", consecutive_faults: 3, opened: true, reason: "x" }] }),
      "org-1",
      "openai",
      "outage",
    );
    expect(outageCalls[0].params.p_threshold).toBe(3);
  });

  it("throws when a fault cannot be recorded, because a lost observation looks like health", async () => {
    await expect(
      recordBreakerFault(client({ rpcError: { message: "denied" } }), "org-1", "openai", "outage"),
    ).rejects.toThrow(/could not be recorded/);

    await expect(
      recordBreakerSuccess(client({ rpcError: { message: "denied" } }), "org-1", "openai"),
    ).rejects.toThrow(/could not be recorded/);
  });

  it("stores only named codes from each candidate, never scores' provenance or free text", async () => {
    const calls: RpcCall[] = [];
    await recordAssignment(client({ calls, rpcResult: "assignment-1" }), {
      projectId: "project-1",
      nodeId: "node-1",
      assignment,
    });

    const candidates = calls[0].params.p_candidates as Array<Record<string, unknown>>;
    expect(Object.keys(candidates[0]).sort()).toEqual(
      ["agentId", "eligible", "model", "notes", "provider", "rejections", "score"].sort(),
    );
    // `components` carries raw observed cost and latency; it is deliberately
    // not persisted here, because the measurement's home is `history.ts`.
    expect(candidates[0]).not.toHaveProperty("components");
    expect(candidates[0]).not.toHaveProperty("prediction");
  });

  it("stores no success rate when the prediction was not evidenced", async () => {
    const calls: RpcCall[] = [];
    await recordAssignment(client({ calls, rpcResult: "assignment-2" }), {
      projectId: "project-1",
      nodeId: "node-1",
      assignment: {
        ...assignment,
        prediction: {
          expectedSuccessRate: null,
          expectedDurationMs: null,
          expectedCostUsd: null,
          evidenced: false,
        },
      },
    });

    expect(calls[0].params.p_predicted_success_rate).toBeNull();
    expect(calls[0].params.p_prediction_evidenced).toBe(false);
  });

  it("never lets an unevidenced prediction smuggle a number through", async () => {
    const calls: RpcCall[] = [];
    await recordAssignment(client({ calls, rpcResult: "assignment-3" }), {
      projectId: "project-1",
      nodeId: "node-1",
      assignment: {
        ...assignment,
        // A malformed prediction claiming a rate it has no evidence for. The
        // database refuses this too; the point is that it never gets that far.
        prediction: {
          expectedSuccessRate: 0.99,
          expectedDurationMs: null,
          expectedCostUsd: null,
          evidenced: false,
        },
      },
    });

    expect(calls[0].params.p_predicted_success_rate).toBeNull();
  });

  it("caps stored candidate evidence so one decision cannot write an unbounded blob", async () => {
    const calls: RpcCall[] = [];
    const many = Array.from({ length: 40 }, (_, index) => ({
      ...assignment.candidates[0],
      agentId: `agent-${index}`,
    }));

    await recordAssignment(client({ calls, rpcResult: "assignment-4" }), {
      projectId: "project-1",
      nodeId: "node-1",
      assignment: { ...assignment, candidates: many },
    });

    expect((calls[0].params.p_candidates as unknown[]).length).toBe(20);
  });

  it("throws when the decision cannot be recorded", async () => {
    await expect(
      recordAssignment(client({ rpcError: { message: "denied" } }), {
        projectId: "project-1",
        nodeId: "node-1",
        assignment,
      }),
    ).rejects.toThrow(/could not be recorded/);
  });

  it("reads a breaker back into exactly the shape the pure module expects", async () => {
    const records = await loadBreakers(
      client({
        rows: [
          {
            target: "anthropic",
            state: "closed",
            fault: "rate_limit",
            consecutive_faults: 1,
            opened_at: null,
            reason: null,
          },
        ],
      }),
      "org-1",
    );

    // A closed breaker holding a non-zero count is a breaker accumulating
    // toward its threshold, which is the state the in-memory version could
    // never reach across requests.
    expect(records.get("anthropic")).toEqual({
      target: "anthropic",
      state: "closed",
      fault: "rate_limit",
      consecutiveFaults: 1,
      openedAt: null,
      reason: null,
    });
  });
});
