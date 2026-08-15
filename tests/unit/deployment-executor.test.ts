// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { DeploymentReadResult, TrackedDeployment } from "@/lib/deploy/vercel";

vi.mock("server-only", () => ({}));

const {
  awaitProductionDeployment,
  findDeploymentForCommit,
  isDeploymentExecutorConnected,
} = await import("@/lib/deploy/deployment-executor");

/**
 * The rule this module exists to enforce is commit identity: a `ready`
 * production deployment is evidence about *our* merge only if it is a
 * deployment of our merge commit. Most of what follows attacks that, plus the
 * distinction between "still building" and "broken", which decides whether a
 * rollback fires.
 */

const mergeSha = "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0";
const otherSha = "ffffffffffffffffffffffffffffffffffffffff";

function deployment(overrides: Partial<TrackedDeployment> = {}): TrackedDeployment {
  return {
    id: "dpl_1",
    state: "ready",
    target: "production",
    url: "https://example.vercel.app",
    commitSha: mergeSha,
    branch: "main",
    createdAt: "2026-08-15T00:00:00.000Z",
    ...overrides,
  };
}

function connected(deployments: TrackedDeployment[]): DeploymentReadResult {
  return { status: "connected", deployments };
}

const noSleep = async () => {};

beforeEach(() => {
  vi.stubEnv("VERCEL_TOKEN", "vercel_test_token");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("commit identity", () => {
  it("accepts a ready production deployment of exactly this commit", async () => {
    const result = await awaitProductionDeployment({
      projectId: "prj_1", commitSha: mergeSha, sleep: noSleep,
      read: async () => connected([deployment()]),
    });

    expect(result).toMatchObject({
      outcome: "deployed", deploymentId: "dpl_1", state: "ready", commitSha: mergeSha,
    });
  });

  it("does not accept a healthy deployment of a different commit", async () => {
    // The failure this prevents: someone else's push goes green, and this run
    // reports success it did not cause. That is how a broken release becomes
    // Last Known Good.
    const result = await awaitProductionDeployment({
      projectId: "prj_1", commitSha: mergeSha, maxAttempts: 2, sleep: noSleep,
      read: async () => connected([deployment({ commitSha: otherSha })]),
    });

    expect(result.outcome).toBe("not_found");
    expect(result.deploymentId).toBeNull();
  });

  it("does not accept a preview deployment of this commit as production", async () => {
    const result = await awaitProductionDeployment({
      projectId: "prj_1", commitSha: mergeSha, maxAttempts: 1, sleep: noSleep,
      read: async () => connected([deployment({ target: "preview" })]),
    });

    expect(result.outcome).toBe("not_found");
  });

  it("matches case-insensitively but never by prefix", () => {
    const rows = [deployment()];

    expect(findDeploymentForCommit(rows, mergeSha.toUpperCase())?.id).toBe("dpl_1");
    // An abbreviated SHA could collide with an unrelated commit.
    expect(findDeploymentForCommit(rows, mergeSha.slice(0, 7))).toBeNull();
  });

  it("ignores a deployment carrying no commit at all", () => {
    expect(findDeploymentForCommit([deployment({ commitSha: null })], mergeSha)).toBeNull();
  });
});

describe("failure is distinguished from still-building", () => {
  it("reports a failed deployment as failed, immediately", async () => {
    const read = vi.fn(async () => connected([deployment({ state: "error" })]));

    const result = await awaitProductionDeployment({
      projectId: "prj_1", commitSha: mergeSha, maxAttempts: 5, sleep: noSleep, read,
    });

    expect(result.outcome).toBe("failed");
    // A terminal state ends the wait; polling on would delay the incident.
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("treats a cancelled deployment as failed too", async () => {
    const result = await awaitProductionDeployment({
      projectId: "prj_1", commitSha: mergeSha, maxAttempts: 1, sleep: noSleep,
      read: async () => connected([deployment({ state: "canceled" })]),
    });

    expect(result.outcome).toBe("failed");
  });

  it("reports pending, not failed, when the budget runs out mid-build", async () => {
    // "We stopped watching" and "it broke" call for different responses.
    // Conflating them either raises false incidents or hides real ones.
    const result = await awaitProductionDeployment({
      projectId: "prj_1", commitSha: mergeSha, maxAttempts: 3, sleep: noSleep,
      read: async () => connected([deployment({ state: "building" })]),
    });

    expect(result).toMatchObject({ outcome: "pending", attempts: 3, state: "building" });
  });

  it("keeps waiting through a building state and then succeeds", async () => {
    const states: TrackedDeployment["state"][] = ["queued", "building", "ready"];
    let call = 0;
    const result = await awaitProductionDeployment({
      projectId: "prj_1", commitSha: mergeSha, maxAttempts: 5, sleep: noSleep,
      read: async () => connected([deployment({ state: states[call++] })]),
    });

    expect(result.outcome).toBe("deployed");
    expect(result.attempts).toBe(3);
  });
});

describe("provider trouble is not deployment trouble", () => {
  it("does not conclude failure from a read error", async () => {
    // A provider blip must not trigger a rollback of a good release.
    let call = 0;
    const result = await awaitProductionDeployment({
      projectId: "prj_1", commitSha: mergeSha, maxAttempts: 4, sleep: noSleep,
      read: async () => (call++ < 2
        ? { status: "error" as const, deployments: [], reason: "HTTP 500" }
        : connected([deployment()])),
    });

    expect(result.outcome).toBe("deployed");
  });

  it("stops immediately when the provider reports not connected", async () => {
    const read = vi.fn(async () => ({
      status: "not_connected" as const, deployments: [], reason: "no token",
    }));

    const result = await awaitProductionDeployment({
      projectId: "prj_1", commitSha: mergeSha, maxAttempts: 5, sleep: noSleep, read,
    });

    expect(result.outcome).toBe("not_connected");
    // Retrying a missing credential is pure delay; nothing will change.
    expect(read).toHaveBeenCalledTimes(1);
  });

  it("reports not_connected before making any call when no token exists", async () => {
    vi.stubEnv("VERCEL_TOKEN", "");
    const read = vi.fn();

    const result = await awaitProductionDeployment({
      projectId: "prj_1", commitSha: mergeSha, sleep: noSleep,
      read: read as never,
    });

    expect(result.outcome).toBe("not_connected");
    expect(read).not.toHaveBeenCalled();
    expect(isDeploymentExecutorConnected()).toBe(false);
  });
});

describe("bounds and inputs", () => {
  it("never waits forever", async () => {
    const read = vi.fn(async () => connected([]));

    const result = await awaitProductionDeployment({
      projectId: "prj_1", commitSha: mergeSha, maxAttempts: 4, sleep: noSleep, read,
    });

    expect(result.outcome).toBe("not_found");
    expect(read).toHaveBeenCalledTimes(4);
  });

  it("does not sleep after the final attempt", async () => {
    const sleep = vi.fn(async () => {});

    await awaitProductionDeployment({
      projectId: "prj_1", commitSha: mergeSha, maxAttempts: 3, sleep,
      read: async () => connected([]),
    });

    // Three reads, two waits between them — not a trailing wait nobody uses.
    expect(sleep).toHaveBeenCalledTimes(2);
  });

  it("refuses a malformed commit id without calling the provider", async () => {
    const read = vi.fn();

    const result = await awaitProductionDeployment({
      projectId: "prj_1", commitSha: "not-a-sha", sleep: noSleep, read: read as never,
    });

    expect(result.outcome).toBe("not_found");
    expect(read).not.toHaveBeenCalled();
  });

  it("never leaks the token in a result", async () => {
    const result = await awaitProductionDeployment({
      projectId: "prj_1", commitSha: mergeSha, maxAttempts: 1, sleep: noSleep,
      read: async () => ({ status: "error" as const, deployments: [], reason: "HTTP 401" }),
    });

    expect(JSON.stringify(result)).not.toContain("vercel_test_token");
  });
});
