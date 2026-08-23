// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const store = new Map<string, { value: string; options?: Record<string, unknown> }>();
const cookieJar = {
  get: (name: string) => {
    const entry = store.get(name);
    return entry ? { name, value: entry.value } : undefined;
  },
  set: (name: string, value: string, options?: Record<string, unknown>) => {
    store.set(name, { value, options });
  },
  delete: (name: string) => {
    store.delete(name);
  },
};

vi.mock("next/headers", () => ({ cookies: async () => cookieJar }));

const { closeDecisionGate, DECISION_PATH, GATE_MAX_AGE_SECONDS, isDecisionGateOpen, openDecisionGate } =
  await import("@/lib/auth/decision-gate");

/**
 * The one-time gate in front of `/decision`.
 *
 * What has to hold is the shape of the promise the owner was given: the page
 * is reachable after signing in and not afterwards, the marker is invisible to
 * browser code, and it cannot outlive the login moment it belongs to.
 */

beforeEach(() => {
  store.clear();
});

describe("the decision gate", () => {
  it("is closed until a sign-in opens it, and closed again once a choice is made", async () => {
    expect(await isDecisionGateOpen()).toBe(false);

    await openDecisionGate();
    expect(await isDecisionGateOpen()).toBe(true);

    await closeDecisionGate();
    expect(await isDecisionGateOpen()).toBe(false);
  });

  it("keeps the marker away from browser code and off other sites", async () => {
    await openDecisionGate();
    const written = store.get("sf-decision");

    expect(written?.options).toMatchObject({
      httpOnly: true,
      path: "/",
      sameSite: "lax",
    });
    // Short enough to be a login moment; long enough to survive workspace
    // onboarding and come back.
    expect(written?.options?.maxAge).toBe(GATE_MAX_AGE_SECONDS);
    expect(GATE_MAX_AGE_SECONDS).toBeLessThanOrEqual(30 * 60);
  });

  it("refuses a value it did not write, so a forged cookie opens nothing", async () => {
    cookieJar.set("sf-decision", "yes");
    expect(await isDecisionGateOpen()).toBe(false);

    cookieJar.set("sf-decision", "");
    expect(await isDecisionGateOpen()).toBe(false);
  });

  it("names the landing path once, where every caller reads it", () => {
    expect(DECISION_PATH).toBe("/decision");
  });
});
