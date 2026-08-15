// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import type { CompiledNode } from "@/lib/graph/compiler";
import {
  allocateWorkspaces,
  isolatedWorkspaceCount,
  planWorkspaces,
  releaseWorkspaces,
  type Workspace,
} from "@/lib/graph/fan-out";
import type { ResourceRef } from "@/lib/graph/types";

const file = (id: string): ResourceRef => ({ kind: "file", id });

function node(
  key: string,
  options: { writes?: ResourceRef[]; reads?: ResourceRef[] } = {},
): CompiledNode {
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
    reads: options.reads ?? [],
    writes: options.writes ?? [],
  } as CompiledNode;
}

function acquirer(failOn?: string) {
  let issued = 0;
  return vi.fn(async ({ nodeKey, writable }: { nodeKey: string; writable: boolean }): Promise<Workspace> => {
    if (failOn && nodeKey === failOn) throw new Error("clone failed");
    issued += 1;
    return {
      workspaceId: `ws-${issued}`,
      directory: `/tmp/ws-${issued}`,
      branch: writable ? `factory/${nodeKey}` : null,
    };
  });
}

const limits = { maxIsolatedWorkspaces: 4 };

describe("planning workspaces", () => {
  it("gives every writing node its own checkout", () => {
    const plans = planWorkspaces([
      node("a", { writes: [file("app/page.tsx")] }),
      node("b", { writes: [file("lib/x.ts")] }),
    ]);

    expect(plans.every((plan) => plan.mode === "ISOLATED")).toBe(true);
    expect(plans[0].reason).toContain("nothing else is editing");
  });

  it("isolates a writer even when it is the only node", () => {
    // A node that writes into a shared checkout is a landmine for whatever
    // runs next, not just for what runs alongside.
    expect(planWorkspaces([node("solo", { writes: [file("x")] })])[0].mode).toBe("ISOLATED");
  });

  it("lets read-only nodes share one checkout", () => {
    const plans = planWorkspaces([
      node("r1", { reads: [file("a")] }),
      node("r2", { reads: [file("b")] }),
    ]);

    expect(plans.map((plan) => plan.mode)).toEqual(["SHARED_READ_ONLY", "SHARED_READ_ONLY"]);
  });

  it("gives no checkout to a node that touches no repository resource", () => {
    const plan = planWorkspaces([node("think")])[0];

    expect(plan.mode).toBe("NONE");
    expect(plan.reason).toContain("no checkout at all");
  });

  it("counts the isolated workspaces a batch would need", () => {
    expect(
      isolatedWorkspaceCount([
        node("w1", { writes: [file("a")] }),
        node("w2", { writes: [file("b")] }),
        node("r", { reads: [file("c")] }),
        node("t"),
      ]),
    ).toBe(2);
  });
});

describe("allocating workspaces", () => {
  it("allocates one per writer and one shared for readers", async () => {
    const acquire = acquirer();
    const result = await allocateWorkspaces(
      [
        node("w1", { writes: [file("a")] }),
        node("w2", { writes: [file("b")] }),
        node("r1", { reads: [file("c")] }),
        node("r2", { reads: [file("d")] }),
      ],
      acquire,
      vi.fn(),
      limits,
    );

    expect(result.outcome).toBe("ALLOCATED");
    // Two writers plus one shared reader checkout: three acquisitions, not four.
    expect(acquire).toHaveBeenCalledTimes(3);
    expect(result.assigned.get("r1")).toBe(result.assigned.get("r2"));
    expect(result.assigned.get("w1")).not.toBe(result.assigned.get("w2"));
  });

  it("defers a writer rather than running it unisolated", async () => {
    const result = await allocateWorkspaces(
      [
        node("w1", { writes: [file("a")] }),
        node("w2", { writes: [file("b")] }),
        node("w3", { writes: [file("c")] }),
      ],
      acquirer(),
      vi.fn(),
      { maxIsolatedWorkspaces: 2 },
    );

    expect(result.outcome).toBe("DEFERRED");
    expect(result.deferred).toEqual(["w3"]);
    // A bounded delay is always the better trade against silent corruption.
    expect(result.detail).toContain("overwriting another");
    expect(result.assigned.has("w3")).toBe(false);
  });

  it("gives back everything when one acquisition fails", async () => {
    const release = vi.fn(async () => {});
    const result = await allocateWorkspaces(
      [
        node("w1", { writes: [file("a")] }),
        node("w2", { writes: [file("b")] }),
      ],
      acquirer("w2"),
      release,
      limits,
    );

    expect(result.outcome).toBe("FAILED");
    expect(result.assigned.size).toBe(0);
    // A half-allocated fan-out leaves checkouts held by nodes that never run.
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("needs no workspace at all for a batch that touches nothing", async () => {
    const acquire = acquirer();
    const result = await allocateWorkspaces([node("a"), node("b")], acquire, vi.fn(), limits);

    expect(result.outcome).toBe("ALLOCATED");
    expect(acquire).not.toHaveBeenCalled();
    expect(result.detail).toContain("needs a checkout");
  });
});

describe("releasing workspaces", () => {
  it("releases a shared checkout once, not once per reader", async () => {
    const release = vi.fn(async () => {});
    const shared: Workspace = { workspaceId: "ws-1", directory: "/tmp/ws-1", branch: null };

    await releaseWorkspaces([shared, shared, shared], release);

    // Double-freeing the readers' shared checkout would delete it under a
    // caller still using it.
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("does not let a failed release destroy a completed result", async () => {
    const release = vi.fn(async () => {
      throw new Error("disk busy");
    });

    await expect(
      releaseWorkspaces([{ workspaceId: "ws-1", directory: "/tmp/ws-1", branch: null }], release),
    ).resolves.toBeUndefined();
  });
});
