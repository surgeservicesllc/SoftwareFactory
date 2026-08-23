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

const { closeDecisionGate, DECISION_PATH, forgetDecision, isDecisionGateOpen, openDecisionGate } =
  await import("@/lib/auth/decision-gate");

/**
 * The one-time gate in front of `/decision`.
 *
 * The first case is the one that matters most, because its opposite shipped:
 * a marker meaning "may see the chooser" left every session that predated the
 * feature — the owner's included — permanently redirected away from it. The
 * marker records the decision, so absence means "has not chosen", not
 * "denied".
 */

beforeEach(() => {
  store.clear();
});

describe("the decision gate", () => {
  it("is open when nothing has been recorded, because absence means undecided", async () => {
    // A session that predates the feature, a cleared cookie jar, and a brand
    // new login are indistinguishable here, and all three should see the page.
    expect(await isDecisionGateOpen()).toBe(true);
  });

  it("closes on a choice and reopens on the next sign-in", async () => {
    await closeDecisionGate();
    expect(await isDecisionGateOpen()).toBe(false);

    // "Land all users on the decision page" is a per-login promise, so a new
    // session has to clear the previous session's answer.
    await openDecisionGate();
    expect(await isDecisionGateOpen()).toBe(true);
  });

  it("forgets the choice at sign-out, so a shared browser inherits nothing", async () => {
    await closeDecisionGate();
    await forgetDecision();

    expect(store.has("sf-decision")).toBe(false);
    expect(await isDecisionGateOpen()).toBe(true);
  });

  it("keeps the marker away from browser code and off other sites", async () => {
    await closeDecisionGate();
    const written = store.get("sf-decision");

    expect(written?.value).toBe("chosen");
    expect(written?.options).toMatchObject({
      httpOnly: true,
      path: "/",
      sameSite: "lax",
    });
    // It only has to outlive the session it belongs to; both ends of that
    // session clear it anyway.
    expect(written?.options?.maxAge).toBeGreaterThan(0);
  });

  it("treats any value it did not write as undecided rather than as a choice", async () => {
    for (const forged of ["open", "yes", "", "CHOSEN"]) {
      cookieJar.set("sf-decision", forged);
      expect(await isDecisionGateOpen(), forged).toBe(true);
    }
  });

  it("names the landing path once, where every caller reads it", () => {
    expect(DECISION_PATH).toBe("/decision");
  });
});
