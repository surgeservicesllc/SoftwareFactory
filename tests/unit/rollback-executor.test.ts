// @vitest-environment node

import { describe, expect, it, vi } from "vitest";

import {
  executeRollback,
  resolveLastKnownGood,
  type DeploymentRef,
  type RollbackAdapter,
} from "@/lib/operations/rollback-executor";

function deployment(id: string, overrides: Partial<DeploymentRef> = {}): DeploymentRef {
  return {
    deploymentId: id,
    commitSha: `sha-${id}`,
    validationPassed: true,
    containsMigration: false,
    ...overrides,
  };
}

function adapter(overrides: Partial<RollbackAdapter> = {}): RollbackAdapter {
  return {
    promote: vi.fn(async () => ({ ok: true, detail: "promoted" })),
    state: vi.fn(async () => "READY" as const),
    ...overrides,
  };
}

const healthy = async () => ({ healthy: true, detail: "4/4 routes returned 200" });
const unhealthy = async () => ({ healthy: false, detail: "still returning 500" });

function input(overrides: Partial<Parameters<typeof executeRollback>[0]> = {}) {
  return {
    incidentId: "inc-1",
    projectId: "proj-1",
    failedDeployment: deployment("bad", { validationPassed: false }),
    candidates: [deployment("bad", { validationPassed: false }), deployment("good")],
    attemptsAlready: 0,
    maxAttempts: 3,
    freezeApplied: true,
    ...overrides,
  };
}

describe("resolving the Last Known Good", () => {
  it("takes the newest deployment that passed its own validation", () => {
    const lkg = resolveLastKnownGood(deployment("bad"), [
      deployment("newer", { validationPassed: false }),
      deployment("good"),
      deployment("older"),
    ]);

    expect(lkg?.deploymentId).toBe("good");
  });

  it("never selects the deployment that just failed", () => {
    expect(resolveLastKnownGood(deployment("same"), [deployment("same")])).toBeNull();
  });

  it("refuses a deployment that only reported READY", () => {
    // "READY" is the provider's opinion; a rollback target has to have passed
    // its own post-deploy validation.
    expect(
      resolveLastKnownGood(deployment("bad"), [deployment("never-validated", { validationPassed: false })]),
    ).toBeNull();
  });
});

describe("the rollback executor", () => {
  it("restores production and confirms it by observation", async () => {
    const result = await executeRollback(input(), {
      adapter: adapter(),
      validateRecovery: healthy,
      waitForSettle: async () => "READY",
    });

    expect(result.outcome).toBe("ROLLED_BACK");
    expect(result.targetDeploymentId).toBe("good");
    expect(result.escalateToSev1).toBe(false);
    // The code is restored; the defect is not fixed. Lifting the freeze is an
    // owner decision, not a side effect.
    expect(result.freezeMustRemain).toBe(true);
  });

  it("refuses to roll back across a migration", async () => {
    const promote = vi.fn(async () => ({ ok: true, detail: "promoted" }));
    const result = await executeRollback(
      input({ failedDeployment: deployment("bad", { containsMigration: true, validationPassed: false }) }),
      { adapter: adapter({ promote }), validateRecovery: healthy },
    );

    expect(result.outcome).toBe("OWNER_ACTION_REQUIRED");
    expect(result.ownerAction).toContain("destroy data");
    // The check must happen before anything is promoted.
    expect(promote).not.toHaveBeenCalled();
    expect(result.freezeMustRemain).toBe(true);
  });

  it("stops when nothing was ever validated", async () => {
    const result = await executeRollback(
      input({ candidates: [deployment("a", { validationPassed: false })] }),
      { adapter: adapter(), validateRecovery: healthy },
    );

    expect(result.outcome).toBe("OWNER_ACTION_REQUIRED");
    expect(result.ownerAction).toContain("not a rollback target");
  });

  it("requires the freeze before recovering, so it does not race the next release", async () => {
    const result = await executeRollback(input({ freezeApplied: false }), {
      adapter: adapter(),
      validateRecovery: healthy,
    });

    expect(result.outcome).toBe("OWNER_ACTION_REQUIRED");
    expect(result.ownerAction).toContain("race the next release");
  });

  it("asks for an owner when no provider is connected, keeping the freeze", async () => {
    const result = await executeRollback(input(), { adapter: null, validateRecovery: healthy });

    expect(result.outcome).toBe("OWNER_ACTION_REQUIRED");
    expect(result.targetDeploymentId).toBe("good");
    expect(result.freezeMustRemain).toBe(true);
    // Truthful rather than pretending a rollback happened.
    expect(result.detail).toContain("not connected");
  });

  it("escalates when the promotion itself fails", async () => {
    const result = await executeRollback(input(), {
      adapter: adapter({ promote: vi.fn(async () => ({ ok: false, detail: "403 from provider" })) }),
      validateRecovery: healthy,
    });

    expect(result.outcome).toBe("ROLLBACK_FAILED");
    // A failed rollback is strictly worse than the failure that prompted it.
    expect(result.escalateToSev1).toBe(true);
    expect(result.freezeMustRemain).toBe(true);
  });

  it("escalates when the promoted deployment never becomes ready", async () => {
    const result = await executeRollback(input(), {
      adapter: adapter(),
      validateRecovery: healthy,
      waitForSettle: async () => "ERROR",
    });

    expect(result.outcome).toBe("ROLLBACK_FAILED");
    expect(result.escalateToSev1).toBe(true);
  });

  it("does not call a rollback successful when production is still sick", async () => {
    const result = await executeRollback(input(), {
      adapter: adapter(),
      validateRecovery: unhealthy,
      waitForSettle: async () => "READY",
    });

    // The provider said READY and production is still broken, which means the
    // cause was not the last deployment.
    expect(result.outcome).toBe("ROLLBACK_FAILED");
    expect(result.escalateToSev1).toBe(true);
    expect(result.detail).toContain("still returning 500");
  });

  it("refuses to claim restoration it cannot observe", async () => {
    const result = await executeRollback(input(), {
      adapter: adapter(),
      waitForSettle: async () => "READY",
    });

    expect(result.outcome).toBe("OWNER_ACTION_REQUIRED");
    expect(result.ownerAction).toContain("unverified");
  });

  it("stops repeating once the attempt ceiling is reached", async () => {
    const promote = vi.fn(async () => ({ ok: true, detail: "promoted" }));
    const result = await executeRollback(input({ attemptsAlready: 3, maxAttempts: 3 }), {
      adapter: adapter({ promote }),
      validateRecovery: healthy,
    });

    expect(result.outcome).toBe("OWNER_ACTION_REQUIRED");
    expect(result.escalateToSev1).toBe(true);
    expect(result.ownerAction).toContain("needs a person");
    expect(promote).not.toHaveBeenCalled();
  });

  it("records the steps it took, so the audit is not reconstructed", async () => {
    const result = await executeRollback(input(), {
      adapter: adapter(),
      validateRecovery: healthy,
      waitForSettle: async () => "READY",
    });

    expect(result.steps.some((s) => s.includes("Resolved Last Known Good"))).toBe(true);
    expect(result.steps.some((s) => s.includes("Recovery validation"))).toBe(true);
  });
});
