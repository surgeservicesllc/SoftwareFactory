// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { CompiledNode } from "@/lib/graph/compiler";
import {
  acquireNodeLocks,
  lockOrder,
  planLockWaves,
  releaseNodeLocks,
  requiredLocks,
  type LockHandle,
} from "@/lib/graph/locks";
import type { ResourceRef } from "@/lib/graph/types";

function node(key: string, writes: ResourceRef[] = []): CompiledNode {
  return {
    nodeKey: key,
    job: key,
    executor: "MODEL",
    capability: "implementation",
    modelTier: "STANDARD",
    risk: "GREEN",
    timeoutMs: 60_000,
    maxAttempts: 2,
    allowProviderFallback: true,
    reads: [],
    writes,
  } as CompiledNode;
}

const file = (id: string): ResourceRef => ({ kind: "file", id });

function acquirer(failOn?: string, message = "resource_locked") {
  return vi.fn(async (resource: ResourceRef): Promise<LockHandle> => {
    if (failOn && resource.id === failOn) throw new Error(message);
    return { lockId: `lock-${resource.id}`, resource };
  });
}

describe("lock ordering", () => {
  it("sorts resources into a stable global order", () => {
    // Any total order prevents deadlock; what matters is that every node uses
    // the same one regardless of how the planner listed them.
    const a = lockOrder([file("z.ts"), file("a.ts"), file("m.ts")]);
    const b = lockOrder([file("m.ts"), file("z.ts"), file("a.ts")]);

    expect(a.map((r) => r.id)).toEqual(["a.ts", "m.ts", "z.ts"]);
    expect(a).toEqual(b);
  });

  it("requires a lock for everything a node writes, in order", () => {
    expect(requiredLocks(node("n", [file("b.ts"), file("a.ts")])).map((r) => r.id)).toEqual([
      "a.ts",
      "b.ts",
    ]);
  });
});

describe("acquiring node locks", () => {
  it("takes every lock a node needs", async () => {
    const acquire = acquirer();
    const result = await acquireNodeLocks(node("n", [file("a.ts"), file("b.ts")]), acquire, vi.fn());

    expect(result.outcome).toBe("ACQUIRED");
    expect(result.held).toHaveLength(2);
    expect(acquire).toHaveBeenCalledTimes(2);
  });

  it("needs no locks when a node writes nothing", async () => {
    const acquire = acquirer();
    const result = await acquireNodeLocks(node("reader"), acquire, vi.fn());

    expect(result.outcome).toBe("ACQUIRED");
    expect(acquire).not.toHaveBeenCalled();
  });

  it("releases what it already holds when one lock is contended", async () => {
    // A node holding half its locks while waiting for the rest is the state
    // that produces deadlock.
    const release = vi.fn(async () => {});
    const result = await acquireNodeLocks(
      node("n", [file("a.ts"), file("b.ts"), file("c.ts")]),
      acquirer("b.ts"),
      release,
    );

    expect(result.outcome).toBe("CONTENDED");
    expect(result.held).toEqual([]);
    expect(result.blockedOn?.id).toBe("b.ts");
    // The one already taken was given back.
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("distinguishes contention from a real failure", async () => {
    const contended = await acquireNodeLocks(
      node("n", [file("a.ts")]),
      acquirer("a.ts", "resource_locked"),
      vi.fn(),
    );
    expect(contended.outcome).toBe("CONTENDED");
    expect(contended.detail).toContain("another node holds");

    const broken = await acquireNodeLocks(
      node("n", [file("a.ts")]),
      acquirer("a.ts", "not_a_member"),
      vi.fn(),
    );
    expect(broken.outcome).toBe("FAILED");
  });

  it("does not let a failed release break a node whose work succeeded", async () => {
    const release = vi.fn(async () => {
      throw new Error("network");
    });

    // Expiry is the backstop; a failed release must not propagate.
    await expect(
      releaseNodeLocks([{ lockId: "l1", resource: file("a.ts") }], release),
    ).resolves.toBeUndefined();
  });

  it("releases in reverse order so the log reads as a stack", async () => {
    const order: string[] = [];
    const release = vi.fn(async (handle: LockHandle) => {
      order.push(handle.resource.id);
    });

    await releaseNodeLocks(
      [
        { lockId: "1", resource: file("a.ts") },
        { lockId: "2", resource: file("b.ts") },
      ],
      release,
    );

    expect(order).toEqual(["b.ts", "a.ts"]);
  });
});

describe("lock waves", () => {
  it("puts nodes with disjoint writes in one wave", () => {
    const waves = planLockWaves([
      node("a", [file("one.ts")]),
      node("b", [file("two.ts")]),
      node("c", [file("three.ts")]),
    ]);

    expect(waves).toHaveLength(1);
    expect(waves[0]).toEqual(["a", "b", "c"]);
  });

  it("separates nodes that would fight over a resource", () => {
    // Contention resolved by planning rather than by collision and retry.
    const waves = planLockWaves([
      node("a", [file("shared.ts")]),
      node("b", [file("shared.ts")]),
      node("c", [file("other.ts")]),
    ]);

    expect(waves).toHaveLength(2);
    expect(waves[0]).toEqual(["a", "c"]);
    expect(waves[1]).toEqual(["b"]);
  });

  it("keeps lock-free nodes in the first wave", () => {
    const waves = planLockWaves([node("writer", [file("x.ts")]), node("reader")]);

    expect(waves).toHaveLength(1);
    expect(waves[0]).toEqual(["writer", "reader"]);
  });

  it("gives every node a wave even when all of them contend", () => {
    const shared = [file("same.ts")];
    const waves = planLockWaves([node("a", shared), node("b", shared), node("c", shared)]);

    expect(waves).toEqual([["a"], ["b"], ["c"]]);
  });
});
