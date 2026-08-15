import { describe, expect, it } from "vitest";

import { closedBreaker } from "@/lib/resources/breakers";
import type { AgentCapabilityProfile, ModelCapabilityProfile } from "@/lib/resources/capabilities";
import { DEFAULT_CAPACITY_LIMITS, activeReservations, type Reservation } from "@/lib/resources/capacity";
import { dispatch, dispatchOrder, release, type DispatchRequest } from "@/lib/resources/dispatch";
import type { ResourceNode, WorkerCandidate } from "@/lib/resources/manager";

const agent: AgentCapabilityProfile = {
  agentId: "agent-backend",
  role: "backend",
  capabilities: ["coding", "backend", "qa"],
  available: true,
  allowedProjectIds: [],
};

const cheapModel: ModelCapabilityProfile = {
  provider: "openai",
  model: "gpt-economical",
  capabilities: ["coding", "backend", "qa"],
  contextLimitTokens: 32_000,
  tier: "balanced",
  available: true,
};

function candidate(overrides: Partial<WorkerCandidate> = {}): WorkerCandidate {
  return {
    agent,
    model: cheapModel,
    performance: null,
    configuredAffinity: 0.5,
    breaker: closedBreaker("openai/gpt-economical"),
    ...overrides,
  };
}

function node(nodeId: string, overrides: Partial<ResourceNode> = {}): ResourceNode {
  return {
    nodeId,
    projectId: "project-1",
    required: ["coding", "backend"],
    complexity: "bounded",
    riskLevel: "GREEN",
    estimatedContextTokens: 8_000,
    deterministicHandlerAvailable: false,
    ...overrides,
  };
}

function request(nodeId: string, overrides: Partial<DispatchRequest> = {}): DispatchRequest {
  return {
    node: node(nodeId),
    candidates: [candidate()],
    objective: "BALANCED",
    mode: "AUTO",
    ...overrides,
  };
}

const base = { reservations: [] as Reservation[], leaseDurationMs: 60_000, now: 1_000 };

describe("batch dispatch threads capacity through the tick", () => {
  it("does not let two nodes in one tick take the same last slot", () => {
    // The defect this exists to prevent: routing each node against the
    // reservations that were live at the start of the tick. Both nodes would
    // see a free slot, both would be admitted, and the per-worker limit of 2
    // would be exceeded by exactly the number the scheduler released together.
    const result = dispatch({
      ...base,
      requests: [request("node-a"), request("node-b"), request("node-c")],
    });

    expect(DEFAULT_CAPACITY_LIMITS.perWorker).toBe(2);
    expect(result.dispatched).toHaveLength(2);
    expect(result.withheld).toHaveLength(1);
    expect(result.withheld[0]?.reason).toBe("DEFERRED");
    expect(activeReservations(result.reservations, base.now)).toHaveLength(2);
  });

  it("counts reservations already held when the tick begins", () => {
    const held: Reservation[] = [
      { agentId: "agent-backend", provider: "openai", model: "gpt-economical", projectId: "project-1", expiresAt: 90_000 },
    ];
    const result = dispatch({ ...base, reservations: held, requests: [request("node-a"), request("node-b")] });

    expect(result.dispatched).toHaveLength(1);
    expect(result.withheld).toHaveLength(1);
    expect(result.reservations).toHaveLength(2);
  });

  it("returns the tick's reservations so the caller can persist one set, not merge two", () => {
    const result = dispatch({ ...base, requests: [request("node-a")] });
    expect(result.reservations).toHaveLength(1);
    expect(result.reservations[0]?.expiresAt).toBe(base.now + base.leaseDurationMs);
    expect(result.dispatched[0]?.reservation).toBe(result.reservations[0]);
  });
});

describe("deferred is not the same as unroutable", () => {
  it("defers a node the fleet is merely too busy for", () => {
    const full: Reservation[] = Array.from({ length: 2 }, () => ({
      agentId: "agent-backend", provider: "openai", model: "gpt-economical", projectId: "project-1", expiresAt: 90_000,
    }));
    const result = dispatch({ ...base, reservations: full, requests: [request("node-a")] });

    expect(result.withheld[0]?.reason).toBe("DEFERRED");
  });

  it("marks a node no worker can ever satisfy as unroutable, so it is not re-offered forever", () => {
    const result = dispatch({
      ...base,
      requests: [request("node-a", { candidates: [candidate({ agent: { ...agent, capabilities: ["frontend"] } })] })],
    });

    // Waiting does not grow a capability. Re-offering this node every tick
    // would spin the scheduler on work that cannot be done.
    expect(result.withheld[0]?.reason).toBe("UNROUTABLE");
  });

  it("defers when any one candidate is refused on capacity alone, whatever its peers lack", () => {
    const full: Reservation[] = Array.from({ length: 2 }, () => ({
      agentId: "agent-backend", provider: "openai", model: "gpt-economical", projectId: "project-1", expiresAt: 90_000,
    }));
    const result = dispatch({
      ...base,
      reservations: full,
      requests: [
        request("node-a", {
          candidates: [candidate(), candidate({ agent: { ...agent, agentId: "agent-wrong", capabilities: ["frontend"] } })],
        }),
      ],
    });
    // One candidate is only busy, so waiting could still help.
    expect(result.withheld[0]?.reason).toBe("DEFERRED");
  });

  it("reports which limit refused, not just that something did", () => {
    const full: Reservation[] = Array.from({ length: 2 }, () => ({
      agentId: "agent-backend", provider: "openai", model: "gpt-economical", projectId: "project-1", expiresAt: 90_000,
    }));
    const result = dispatch({ ...base, reservations: full, requests: [request("node-a")] });

    expect(result.withheld[0]?.assignment.candidates[0]?.rejections).toContain("WORKER_AT_CAPACITY");
  });
});

describe("dispatch order is decided, not inherited", () => {
  it("starts RED work before GREEN when only one slot is left", () => {
    const held: Reservation[] = [
      { agentId: "agent-backend", provider: "openai", model: "gpt-economical", projectId: "project-1", expiresAt: 90_000 },
    ];
    const strong: ModelCapabilityProfile = { ...cheapModel, tier: "strong", capabilities: [...cheapModel.capabilities, "security", "architecture", "synthesis"] };
    const red = request("node-red", {
      node: node("node-red", { riskLevel: "RED" }),
      candidates: [candidate({ model: strong })],
    });

    const result = dispatch({ ...base, reservations: held, requests: [request("node-green"), red] });

    expect(result.dispatched.map((entry) => entry.nodeId)).toEqual(["node-red"]);
    expect(result.withheld.map((entry) => entry.nodeId)).toEqual(["node-green"]);
  });

  it("breaks ties on nodeId so a replay dispatches identically", () => {
    const ordered = dispatchOrder([request("node-c"), request("node-a"), request("node-b")]);
    expect(ordered.map((entry) => entry.node.nodeId)).toEqual(["node-a", "node-b", "node-c"]);

    const forward = dispatch({ ...base, requests: [request("node-c"), request("node-a"), request("node-b")] });
    const reversed = dispatch({ ...base, requests: [request("node-b"), request("node-a"), request("node-c")] });
    expect(forward.dispatched.map((entry) => entry.nodeId)).toEqual(reversed.dispatched.map((entry) => entry.nodeId));
  });

  it("honours a stated priority within the same risk level", () => {
    const ordered = dispatchOrder([
      request("node-a", { priority: 1 }),
      request("node-b", { priority: 9 }),
    ]);
    expect(ordered.map((entry) => entry.node.nodeId)).toEqual(["node-b", "node-a"]);
  });
});

describe("deterministic work bypasses the fleet entirely", () => {
  it("dispatches without consuming a slot", () => {
    const deterministic = request("node-det", { node: node("node-det", { deterministicHandlerAvailable: true }) });
    const result = dispatch({ ...base, requests: [deterministic, request("node-a"), request("node-b"), request("node-c")] });

    expect(result.dispatched.map((entry) => entry.nodeId)).toContain("node-det");
    // The deterministic node did not cost the fleet anything, so two model
    // nodes still start -- work that needs no inference must not queue behind
    // work that does.
    expect(activeReservations(result.reservations, base.now)).toHaveLength(2);
    expect(result.withheld).toHaveLength(1);
  });
});

describe("releasing a slot", () => {
  it("gives the capacity back", () => {
    const first = dispatch({ ...base, requests: [request("node-a"), request("node-b"), request("node-c")] });
    expect(first.withheld).toHaveLength(1);

    const remaining = release(first.reservations, first.dispatched[0]!.reservation);
    const second = dispatch({ ...base, reservations: [...remaining], requests: [request("node-c")] });
    expect(second.dispatched).toHaveLength(1);
  });

  it("releases exactly one of two identical reservations", () => {
    const result = dispatch({ ...base, requests: [request("node-a"), request("node-b")] });
    expect(result.reservations).toHaveLength(2);
    expect(release(result.reservations, result.dispatched[1]!.reservation)).toHaveLength(1);
  });

  it("ignores a reservation that is not held rather than throwing", () => {
    // A worker that died, had its lease expire, and is then reported complete
    // hits this path on the happy path of a recovery. The expiry already did
    // the right thing; throwing here would turn a clean recovery into an error.
    const stale: Reservation = {
      agentId: "agent-gone", provider: "openai", model: "gpt-economical", projectId: "project-1", expiresAt: 5,
    };
    const result = dispatch({ ...base, requests: [request("node-a")] });
    expect(release(result.reservations, stale)).toHaveLength(1);
  });
});

describe("rate accounting across a tick", () => {
  it("threads the window forward, so a batch cannot walk through a nearly-full limit", () => {
    // The same defect as the capacity one, in a different currency: routing
    // every node against the window as it stood at the start of the tick lets
    // an entire batch through a limit with one request left in it.
    const result = dispatch({
      ...base,
      requests: [request("node-a"), request("node-b"), request("node-c")],
      capacityLimits: { perWorker: 10, perProvider: 10, perProject: 10 },
      rateEvents: [],
      ratePolicy: { windowMs: 60_000, maxRequests: 2, maxTokens: null },
    });

    expect(result.dispatched).toHaveLength(2);
    expect(result.withheld[0]?.reason).toBe("DEFERRED");
    expect(result.rateEvents).toHaveLength(2);
  });

  it("records the tick's requests as estimates rather than measurements", () => {
    const result = dispatch({ ...base, requests: [request("node-a")], rateEvents: [] });
    expect(result.rateEvents[0]?.estimated).toBe(true);
    expect(result.rateEvents[0]?.provider).toBe("openai");
  });

  it("defers a rate-limited node and reports when it clears", () => {
    const full = [
      { provider: "openai", at: 900, tokens: 10, estimated: false },
      { provider: "openai", at: 950, tokens: 10, estimated: false },
    ];
    const result = dispatch({
      ...base,
      requests: [request("node-a")],
      rateEvents: full,
      ratePolicy: { windowMs: 60_000, maxRequests: 2, maxTokens: null },
    });

    expect(result.withheld[0]?.reason).toBe("DEFERRED");
    expect(result.withheld[0]?.assignment.candidates[0]?.rejections).toContain("REQUEST_RATE_EXCEEDED");
    // Unlike a capacity refusal, this one can say when to come back.
    expect(result.withheld[0]?.assignment.candidates[0]?.retryAfterMs).toBe(900 + 60_000 - base.now);
  });

  it("leaves rate unaccounted when the caller does not pass a window", () => {
    const result = dispatch({ ...base, requests: [request("node-a")] });
    expect(result.dispatched).toHaveLength(1);
    expect(result.rateEvents).toHaveLength(0);
    expect(result.dispatched[0]?.assignment.candidates[0]?.notes).not.toContain("RATE_LIMITED");
  });

  it("does not charge a deterministic node against the rate window", () => {
    const deterministic = request("node-det", { node: node("node-det", { deterministicHandlerAvailable: true }) });
    const result = dispatch({ ...base, requests: [deterministic], rateEvents: [] });
    expect(result.dispatched).toHaveLength(1);
    // No provider call was made, so nothing may be counted against the limit.
    expect(result.rateEvents).toHaveLength(0);
  });
});
