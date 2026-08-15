import { describe, expect, it } from "vitest";

import {
  DEFAULT_CAPACITY_LIMITS,
  activeReservations,
  admits,
  usageFor,
  validateLimits,
  withCapacity,
  type Reservation,
} from "@/lib/resources/capacity";

/**
 * Capacity is a safety property, so the tests are about what it refuses.
 *
 * Unbounded concurrency is unbounded spend, unbounded load on a provider, and
 * unbounded blast radius when something is going wrong faster than anyone is
 * watching. A capacity model that admits under pressure is worse than none,
 * because it looks like a control.
 */

const NOW = 1_000_000;

function reservation(overrides: Partial<Reservation> = {}): Reservation {
  return {
    agentId: "agent-a",
    provider: "anthropic",
    model: "claude-opus-5",
    projectId: "project-1",
    expiresAt: NOW + 60_000,
    ...overrides,
  };
}

const candidate = {
  agentId: "agent-a",
  provider: "anthropic",
  model: "claude-opus-5",
  projectId: "project-1",
};

describe("expiry", () => {
  it("stops counting a reservation once its lease has run out", () => {
    const held = [
      reservation({ expiresAt: NOW - 1 }),
      reservation({ expiresAt: NOW }),
      reservation({ expiresAt: NOW + 1 }),
    ];

    // A lease released only on success leaks capacity every time a worker dies,
    // and the system throttles itself to a halt with nothing to point at.
    expect(activeReservations(held, NOW)).toHaveLength(1);
  });

  it("readmits a worker whose expired runs no longer count", () => {
    const expired = [
      reservation({ expiresAt: NOW - 5_000 }),
      reservation({ expiresAt: NOW - 5_000 }),
    ];
    expect(admits(expired, candidate, NOW).admitted).toBe(true);
  });
});

describe("the three limits", () => {
  it("refuses a worker already at its own limit", () => {
    const held = [reservation(), reservation()]; // perWorker default is 2
    const verdict = admits(held, candidate, NOW);

    expect(verdict.admitted).toBe(false);
    expect(verdict.refusal).toBe("WORKER_AT_CAPACITY");
  });

  it("refuses on the provider even when every worker is individually free", () => {
    // Six different workers, one run each: no worker is at its limit, and the
    // provider is. A per-worker limit alone cannot see this, which is why the
    // provider limit exists rather than being derived.
    const held = Array.from({ length: 6 }, (_, i) =>
      reservation({ agentId: `agent-${i}`, model: `model-${i}` }),
    );
    const verdict = admits(held, { ...candidate, agentId: "agent-fresh", model: "model-fresh" }, NOW);

    expect(verdict.usage.worker).toBe(0);
    expect(verdict.refusal).toBe("PROVIDER_AT_CAPACITY");
  });

  it("refuses on the project across different providers", () => {
    const held = Array.from({ length: 8 }, (_, i) =>
      reservation({ agentId: `agent-${i}`, provider: i % 2 ? "openai" : "anthropic", model: `model-${i}` }),
    );
    const verdict = admits(held, { ...candidate, agentId: "agent-fresh", provider: "openai", model: "m" }, NOW);

    expect(verdict.refusal).toBe("PROJECT_AT_CAPACITY");
  });

  it("names the narrowest limit that applies, not merely that something is full", () => {
    // Worker at 2 and project at 8 simultaneously. Told "the project is full",
    // an operator raises the wrong number and the real limit refuses again.
    const held = [
      reservation(),
      reservation(),
      ...Array.from({ length: 6 }, (_, i) => reservation({ agentId: `other-${i}`, model: `m-${i}` })),
    ];
    expect(admits(held, candidate, NOW).refusal).toBe("WORKER_AT_CAPACITY");
  });

  it("does not let another project's work consume this one's capacity", () => {
    const held = Array.from({ length: 8 }, (_, i) =>
      reservation({ agentId: `a-${i}`, model: `m-${i}`, projectId: "project-other" }),
    );
    const verdict = admits(held, candidate, NOW);

    // The provider limit still binds across projects — that is the point of it —
    // but the project count must stay per project.
    expect(verdict.usage.project).toBe(0);
    expect(verdict.refusal).toBe("PROVIDER_AT_CAPACITY");
  });
});

describe("counting", () => {
  it("treats one agent on two models as two different workers", () => {
    const held = [reservation(), reservation({ model: "claude-sonnet-5" })];
    // A worker is the agent/model pair. Collapsing to the agent would throttle
    // an agent that is doing two genuinely different jobs.
    expect(usageFor(held, candidate, NOW).worker).toBe(1);
    expect(usageFor(held, candidate, NOW).provider).toBe(2);
  });
});

describe("filtering candidates", () => {
  it("returns the refusal for each rejected candidate, not just a shorter list", () => {
    const held = [reservation(), reservation()];
    const { admitted, refused } = withCapacity(
      [
        { agentId: "agent-a", provider: "anthropic", model: "claude-opus-5" },
        { agentId: "agent-b", provider: "anthropic", model: "claude-opus-5" },
      ],
      held,
      "project-1",
      NOW,
    );

    // An empty list with no reasons can only produce "no eligible worker",
    // which is true and useless.
    expect(admitted.map((c) => c.agentId)).toEqual(["agent-b"]);
    expect(refused).toHaveLength(1);
    expect(refused[0].refusal).toBe("WORKER_AT_CAPACITY");
  });
});

describe("limit validation", () => {
  it("accepts the defaults", () => {
    expect(validateLimits(DEFAULT_CAPACITY_LIMITS)).toEqual([]);
  });

  it("refuses zero rather than guessing what it means", () => {
    // Zero reads as "no restriction" to half its readers and "nothing may run"
    // to the other half, and those are opposites.
    const problems = validateLimits({ ...DEFAULT_CAPACITY_LIMITS, perWorker: 0 });
    expect(problems.join(" ")).toMatch(/ambiguous/i);
  });

  it("refuses a fractional limit", () => {
    expect(validateLimits({ ...DEFAULT_CAPACITY_LIMITS, perProvider: 2.5 })).not.toEqual([]);
  });

  it("flags a per-worker limit that can never bind", () => {
    const problems = validateLimits({ perWorker: 10, perProvider: 4, perProject: 20 });
    expect(problems.join(" ")).toMatch(/can never be the one that refuses/i);
  });
});
