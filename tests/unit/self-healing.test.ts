// @vitest-environment node

import { describe, expect, it } from "vitest";

import {
  ancestryOf,
  assessHealing,
  attemptsOfKind,
  DEFAULT_HEALING_LIMITS,
  routeRepair,
  type AncestryNode,
} from "@/lib/operations/self-healing";

const chain: AncestryNode[] = [
  { kind: "INCIDENT", id: "inc-1", parentId: null },
  { kind: "REPAIR", id: "rep-1", parentId: "inc-1", failureSignature: "typecheck failed" },
  { kind: "RUN", id: "run-1", parentId: "rep-1" },
  { kind: "PULL_REQUEST", id: "pr-1", parentId: "run-1" },
  { kind: "DEPLOYMENT", id: "dep-1", parentId: "pr-1", failureSignature: "build failed" },
];

describe("ancestry", () => {
  it("walks a deployment back to its incident, oldest first", () => {
    expect(ancestryOf("dep-1", chain).map((node) => node.id)).toEqual([
      "inc-1",
      "rep-1",
      "run-1",
      "pr-1",
      "dep-1",
    ]);
  });

  it("truncates rather than throwing when a parent is missing", () => {
    // Partial ancestry is still useful; losing the whole chain to one missing
    // row would be worse.
    const orphaned: AncestryNode[] = [{ kind: "RUN", id: "run-9", parentId: "gone" }];
    expect(ancestryOf("run-9", orphaned).map((n) => n.id)).toEqual(["run-9"]);
  });

  it("does not loop on a cyclic parent link", () => {
    const cyclic: AncestryNode[] = [
      { kind: "REPAIR", id: "a", parentId: "b" },
      { kind: "REPAIR", id: "b", parentId: "a" },
    ];
    expect(ancestryOf("a", cyclic)).toHaveLength(2);
  });

  it("finds every attempt of a kind descending from one incident", () => {
    const nodes: AncestryNode[] = [
      ...chain,
      { kind: "REPAIR", id: "rep-2", parentId: "inc-1" },
      { kind: "INCIDENT", id: "inc-2", parentId: null },
      { kind: "REPAIR", id: "rep-other", parentId: "inc-2" },
    ];

    expect(attemptsOfKind("inc-1", "REPAIR", nodes).map((n) => n.id)).toEqual(["rep-1", "rep-2"]);
  });
});

describe("healing limits", () => {
  it("continues while attempts remain and failures differ", () => {
    const result = assessHealing({
      incidentId: "inc-1",
      nodes: chain,
      nextKind: "REPAIR",
      rollbackAttempts: 0,
    });

    expect(result.decision).toBe("CONTINUE");
    expect(result.ownerAction).toBeNull();
  });

  it("stops on a repeated identical failure before the ceiling", () => {
    const nodes: AncestryNode[] = [
      { kind: "INCIDENT", id: "inc-1", parentId: null },
      { kind: "REPAIR", id: "r1", parentId: "inc-1", failureSignature: "same error" },
      { kind: "REPAIR", id: "r2", parentId: "inc-1", failureSignature: "same error" },
    ];

    const result = assessHealing({
      incidentId: "inc-1",
      nodes,
      nextKind: "REPAIR",
      rollbackAttempts: 0,
    });

    // Two of three attempts used, so the ceiling has not been hit — but the
    // same failure twice is evidence the approach is wrong.
    expect(result.decision).toBe("STOP_AND_ESCALATE");
    expect(result.reason).toContain("activity rather than progress");
    expect(result.ownerAction).toContain("needs a person");
  });

  it("keeps going when failures differ, because that is progress", () => {
    const nodes: AncestryNode[] = [
      { kind: "INCIDENT", id: "inc-1", parentId: null },
      { kind: "REPAIR", id: "r1", parentId: "inc-1", failureSignature: "typecheck failed" },
      { kind: "REPAIR", id: "r2", parentId: "inc-1", failureSignature: "test failed" },
    ];

    expect(
      assessHealing({ incidentId: "inc-1", nodes, nextKind: "REPAIR", rollbackAttempts: 0 }).decision,
    ).toBe("CONTINUE");
  });

  it("stops when the repair ceiling is reached", () => {
    const nodes: AncestryNode[] = [
      { kind: "INCIDENT", id: "inc-1", parentId: null },
      ...Array.from({ length: DEFAULT_HEALING_LIMITS.maxRepairAttempts }, (_, i) => ({
        kind: "REPAIR" as const,
        id: `r${i}`,
        parentId: "inc-1",
        failureSignature: `distinct ${i}`,
      })),
    ];

    const result = assessHealing({
      incidentId: "inc-1",
      nodes,
      nextKind: "REPAIR",
      rollbackAttempts: 0,
    });

    expect(result.decision).toBe("STOP_EXHAUSTED");
    expect(result.reason).toContain("ceiling");
  });

  it("stops when rollback is already exhausted", () => {
    const result = assessHealing({
      incidentId: "inc-1",
      nodes: [{ kind: "INCIDENT", id: "inc-1", parentId: null }],
      nextKind: "REPAIR",
      rollbackAttempts: DEFAULT_HEALING_LIMITS.maxRollbackAttempts,
    });

    expect(result.decision).toBe("STOP_EXHAUSTED");
  });
});

describe("routing a repair", () => {
  const healthy = { decision: "CONTINUE" as const, reason: "ok", ownerAction: null };

  it("routes GREEN work into the existing 1C path", () => {
    const result = routeRepair({
      incidentId: "inc-1",
      risk: "GREEN",
      workerConnected: true,
      healing: healthy,
    });

    expect(result.state).toBe("ROUTED_TO_1C");
    expect(result.detail).toContain("existing Phase 1C");
  });

  it("says BLOCKED_BY_1C truthfully rather than claiming a fix", () => {
    const result = routeRepair({
      incidentId: "inc-1",
      risk: "YELLOW",
      workerConnected: false,
      healing: healthy,
    });

    // The task is real and queued; nothing will claim it. Saying otherwise
    // would be the exact failure this phase exists to prevent.
    expect(result.state).toBe("BLOCKED_BY_1C");
    expect(result.detail).toContain("no fix will be produced");
    expect(result.ownerAction).toContain("Register and enable");
  });

  it("never dispatches RED work automatically", () => {
    const result = routeRepair({
      incidentId: "inc-1",
      risk: "RED",
      workerConnected: true,
      healing: healthy,
    });

    expect(result.state).toBe("BLOCKED_BY_POLICY");
  });

  it("stops when the healing loop says stop, whatever the risk", () => {
    const result = routeRepair({
      incidentId: "inc-1",
      risk: "GREEN",
      workerConnected: true,
      healing: { decision: "STOP_AND_ESCALATE", reason: "same failure twice", ownerAction: "look at it" },
    });

    expect(result.state).toBe("STOPPED");
    expect(result.ownerAction).toBe("look at it");
  });
});
