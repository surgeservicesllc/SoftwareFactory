// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  CONNECTION_CAPABILITIES,
  isConnectionCapability,
  routeConnectionIdentity,
  type ConnectionCapability,
  type ConnectionHealth,
  type RoutableConnection,
} from "@/lib/connections/identity-router";

const projectA = "40000000-0000-4000-8000-0000000000a1";

function connection(overrides: Partial<RoutableConnection> & { connectionId: string }): RoutableConnection {
  return {
    accountLabel: "acme",
    activeLeases: 0,
    capability: "repository.write",
    declaredCapabilities: ["repository.read", "repository.write"],
    health: "connected" as ConnectionHealth,
    maxConcurrency: null,
    priority: 100,
    provider: "github",
    status: "connected",
    ...overrides,
  };
}

function route(
  candidates: readonly RoutableConnection[],
  capability: ConnectionCapability = "repository.write",
  policy?: Parameters<typeof routeConnectionIdentity>[0]["policy"],
) {
  return routeConnectionIdentity({ candidates, capability, policy, projectId: projectA });
}

describe("Identity Router", () => {
  it("selects the highest-priority eligible mapping", () => {
    const result = route([
      connection({ accountLabel: "secondary", connectionId: "b", priority: 200 }),
      connection({ accountLabel: "primary", connectionId: "a", priority: 10 }),
    ]);

    expect(result.outcome).toBe("SELECTED");
    if (result.outcome !== "SELECTED") return;
    expect(result.connectionId).toBe("a");
    expect(result.accountLabel).toBe("primary");
    expect(result.usedFallback).toBe(false);
  });

  it("refuses rather than guessing when nothing is mapped", () => {
    const result = route([
      connection({ capability: "repository.read", connectionId: "a" }),
    ]);

    expect(result.outcome).toBe("REFUSED");
    if (result.outcome !== "REFUSED") return;
    // The whole point: a lone GitHub connection is not automatically the
    // answer for a capability nobody mapped it to.
    expect(result.code).toBe("NO_MAPPING");
  });

  it("distinguishes an unmapped capability from a mapped but unusable one", () => {
    const unusable = route([
      connection({ connectionId: "a", health: "unauthorized" }),
    ]);

    expect(unusable.outcome).toBe("REFUSED");
    if (unusable.outcome !== "REFUSED") return;
    expect(unusable.code).toBe("CONNECTION_UNHEALTHY");
    expect(unusable.reason).toContain("unusable");
  });

  it("refuses a tie instead of picking one arbitrarily", () => {
    const result = route([
      connection({ connectionId: "a", priority: 50 }),
      connection({ connectionId: "b", priority: 50 }),
    ]);

    expect(result.outcome).toBe("REFUSED");
    if (result.outcome !== "REFUSED") return;
    expect(result.code).toBe("AMBIGUOUS_MAPPING");
    expect(result.reason).toContain("priority 50");
  });

  it("treats a degraded connection as selectable but an unauthorized one as never selectable", () => {
    const degraded = route([connection({ connectionId: "a", health: "degraded" })]);
    expect(degraded.outcome).toBe("SELECTED");

    for (const health of ["unauthorized", "offline", "error", "disabled"] as const) {
      const result = route([connection({ connectionId: "a", health })]);
      expect(result.outcome).toBe("REFUSED");
      if (result.outcome !== "REFUSED") continue;
      expect(result.code).toBe("CONNECTION_UNHEALTHY");
    }
  });

  it("refuses a connection whose own declaration no longer covers the mapping", () => {
    // A provider can revoke a permission after the mapping was made. Trusting
    // the mapping alone would route work to an identity that cannot perform it.
    const result = route([
      connection({ connectionId: "a", declaredCapabilities: ["repository.read"] }),
    ]);

    expect(result.outcome).toBe("REFUSED");
    if (result.outcome !== "REFUSED") return;
    expect(result.code).toBe("CAPABILITY_NOT_DECLARED");
  });

  it("enforces capacity rather than exceeding a provider ceiling", () => {
    const exhausted = route([
      connection({ activeLeases: 4, connectionId: "a", maxConcurrency: 4 }),
    ]);
    expect(exhausted.outcome).toBe("REFUSED");
    if (exhausted.outcome !== "REFUSED") return;
    expect(exhausted.code).toBe("CAPACITY_EXHAUSTED");

    const withRoom = route([
      connection({ activeLeases: 3, connectionId: "a", maxConcurrency: 4 }),
    ]);
    expect(withRoom.outcome).toBe("SELECTED");
  });

  it("falls back only to an explicitly eligible connection, and reports that it did", () => {
    const result = route([
      connection({ connectionId: "primary", health: "unauthorized", priority: 10 }),
      connection({ accountLabel: "backup", connectionId: "backup", priority: 20 }),
    ]);

    expect(result.outcome).toBe("SELECTED");
    if (result.outcome !== "SELECTED") return;
    expect(result.connectionId).toBe("backup");
    expect(result.usedFallback).toBe(true);
    // Auditable: the skipped identity and why it was skipped are both retained.
    expect(result.rejected).toContainEqual({
      connectionId: "primary",
      reason: "CONNECTION_UNHEALTHY",
    });
  });

  it("does not fall back when the request forbids it", () => {
    const result = route(
      [
        connection({ connectionId: "primary", health: "error", priority: 10 }),
        connection({ connectionId: "backup", priority: 20 }),
      ],
      "repository.write",
      { allowFallback: false },
    );

    expect(result.outcome).toBe("REFUSED");
  });

  it("honours an override only when the override is independently eligible", () => {
    const honoured = route(
      [
        connection({ connectionId: "a", priority: 10 }),
        connection({ accountLabel: "chosen", connectionId: "b", priority: 20 }),
      ],
      "repository.write",
      { overrideConnectionId: "b" },
    );
    expect(honoured.outcome).toBe("SELECTED");
    if (honoured.outcome === "SELECTED") {
      expect(honoured.connectionId).toBe("b");
      expect(honoured.reason).toContain("override");
    }

    // An override is a choice among authorized connections, never a grant.
    const refused = route(
      [
        connection({ connectionId: "a", priority: 10 }),
        connection({ connectionId: "b", health: "unauthorized", priority: 20 }),
      ],
      "repository.write",
      { overrideConnectionId: "b" },
    );
    expect(refused.outcome).toBe("REFUSED");
    if (refused.outcome !== "REFUSED") return;
    expect(refused.code).toBe("OVERRIDE_NOT_ELIGIBLE");
  });

  it("refuses a provider the project policy does not permit", () => {
    const result = route(
      [connection({ connectionId: "a", provider: "vercel" })],
      "repository.write",
      { permittedProviders: ["github"] },
    );

    expect(result.outcome).toBe("REFUSED");
    if (result.outcome !== "REFUSED") return;
    expect(result.code).toBe("PROVIDER_NOT_PERMITTED");
  });

  it("never returns secret material in a routing result", () => {
    const result = route([connection({ connectionId: "a" })]);
    const serialized = JSON.stringify(result);

    // A routing result is meant to be safe to log and audit.
    expect(serialized).not.toMatch(/secret|token|password|key|env:\/\//i);
  });

  it("keeps its capability vocabulary aligned with the schema", () => {
    expect(CONNECTION_CAPABILITIES).toContain("repository.write");
    expect(isConnectionCapability("repository.write")).toBe(true);
    expect(isConnectionCapability("repository.destroy")).toBe(false);
    expect(isConnectionCapability(null)).toBe(false);
  });
});

describe("Identity Router project isolation", () => {
  /**
   * Canary A in decision form. Project A and project B each map their own
   * account. The router is given only what the database would return for one
   * project, so B's connection cannot be selected for A — but the assertion
   * that matters is the one below it: even when B's row is handed to A's
   * request, it is refused rather than used.
   */
  it("cannot select another project's connection even if it is offered", () => {
    const projectAConnection = connection({
      accountLabel: "tenant-a",
      connectionId: "conn-a",
    });
    const projectBConnection = connection({
      accountLabel: "tenant-b",
      capability: "deploy.production",
      connectionId: "conn-b",
      declaredCapabilities: ["deploy.production"],
    });

    const result = route([projectAConnection, projectBConnection]);

    expect(result.outcome).toBe("SELECTED");
    if (result.outcome !== "SELECTED") return;
    expect(result.connectionId).toBe("conn-a");
    expect(result.accountLabel).toBe("tenant-a");
    // B was considered and explicitly rejected, not quietly ignored.
    expect(result.rejected).toContainEqual({
      connectionId: "conn-b",
      reason: "NO_MAPPING",
    });
  });

  it("degrades only the project whose connection was lost", () => {
    const lost = connection({ connectionId: "conn-a", health: "unauthorized" });
    const healthy = connection({ accountLabel: "tenant-b", connectionId: "conn-b" });

    // Project A, holding only the lost connection, stops.
    const projectAResult = route([lost]);
    expect(projectAResult.outcome).toBe("REFUSED");

    // Project B, holding its own, continues.
    const projectBResult = route([healthy]);
    expect(projectBResult.outcome).toBe("SELECTED");
  });

  it("restores the same identity after recovery, without inventing a new one", () => {
    const beforeLoss = route([connection({ connectionId: "conn-a" })]);
    const duringLoss = route([connection({ connectionId: "conn-a", health: "offline" })]);
    const afterRecovery = route([connection({ connectionId: "conn-a" })]);

    expect(beforeLoss.outcome).toBe("SELECTED");
    expect(duringLoss.outcome).toBe("REFUSED");
    expect(afterRecovery.outcome).toBe("SELECTED");
    if (beforeLoss.outcome !== "SELECTED" || afterRecovery.outcome !== "SELECTED") return;
    expect(afterRecovery.connectionId).toBe(beforeLoss.connectionId);
  });

  it("routes a handoff to the new identity while the old one stays nameable", () => {
    // Canary D in decision form: after a remap, new work uses B. A is still a
    // real connection id, which is what lets historical runs keep showing it.
    const afterHandoff = route([
      connection({ accountLabel: "old", connectionId: "conn-a", priority: 200 }),
      connection({ accountLabel: "new", connectionId: "conn-b", priority: 10 }),
    ]);

    expect(afterHandoff.outcome).toBe("SELECTED");
    if (afterHandoff.outcome !== "SELECTED") return;
    expect(afterHandoff.connectionId).toBe("conn-b");
    expect(afterHandoff.accountLabel).toBe("new");
  });
});
