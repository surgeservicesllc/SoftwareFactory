import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SafetyControls } from "@/components/safety-controls";

/**
 * The mode selector on the safety-controls panel.
 *
 * The three modes exist so a person who does not want to reason about nine
 * switches does not have to. What has to be true of the surface: it says what
 * each mode will still stop and ask about, it sends one word rather than
 * eleven booleans, it tells an operator honestly when their configuration
 * matches no mode, and it offers nothing to press to someone who is not an
 * owner.
 */

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

const noActions = {
  plan: false,
  code: false,
  test: false,
  repair: false,
  review: false,
  approve: false,
  merge: false,
  deploy: false,
  rollback: false,
};

function controlsBody(
  overrides: { mode?: string | null; canOperate?: boolean; actions?: Record<string, boolean> } = {},
) {
  return {
    killSwitchActive: false,
    canOperate: overrides.canOperate ?? true,
    controls: {
      autonomousMode: false,
      maximumAutonomousRisk: "GREEN",
      mode: overrides.mode === undefined ? "ask_me" : overrides.mode,
      actions: { ...noActions, ...(overrides.actions ?? {}) },
    },
  };
}

function stubFetch(body: unknown) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return jsonResponse(body);
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the autonomy mode selector", () => {
  it("offers the three modes and says what each still asks about", async () => {
    stubFetch(controlsBody());
    render(<SafetyControls />);

    const askMe = await screen.findByRole("button", { name: /Ask Me/i });
    expect(askMe).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /Balanced/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Autonomous/i })).toBeInTheDocument();

    // Every mode states its limits rather than only its powers.
    expect(screen.getAllByText(/Always asks:/i)).toHaveLength(3);
  });

  it("sends one named mode rather than a set of switches", async () => {
    const calls = stubFetch(controlsBody());
    render(<SafetyControls />);

    await userEvent.click(await screen.findByRole("button", { name: /Balanced/i }));

    const post = calls.find((call) => call.init?.method === "POST");
    expect(post).toBeDefined();
    expect(JSON.parse(String(post!.init!.body))).toEqual({
      control: "mode",
      mode: "balanced",
    });
  });

  it("does not re-send the mode already selected", async () => {
    const calls = stubFetch(controlsBody({ mode: "ask_me" }));
    render(<SafetyControls />);

    await userEvent.click(await screen.findByRole("button", { name: /Ask Me/i }));
    expect(calls.filter((call) => call.init?.method === "POST")).toHaveLength(0);
  });

  /*
   * The honest case. An operator who hand-enabled `deploy` is outside every
   * preset, and showing them "Autonomous" would claim a safety story they
   * deliberately stepped out of.
   */
  it("says Custom when the switches match no mode", async () => {
    stubFetch(controlsBody({ mode: null, actions: { deploy: true } }));
    render(<SafetyControls />);

    expect(await screen.findByText(/^Custom —/)).toBeInTheDocument();
    for (const name of [/Ask Me/i, /Balanced/i, /Autonomous/i]) {
      expect(screen.getByRole("button", { name })).toHaveAttribute("aria-pressed", "false");
    }
  });

  it("shows a non-owner the modes without letting them change one", async () => {
    stubFetch(controlsBody({ canOperate: false }));
    render(<SafetyControls />);

    for (const name of [/Ask Me/i, /Balanced/i, /Autonomous/i]) {
      expect(await screen.findByRole("button", { name })).toBeDisabled();
    }
  });
});
