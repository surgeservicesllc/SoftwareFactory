import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SafetyControls } from "@/components/safety-controls";
import { AUTOMATIC_ACTIONS } from "@/lib/autonomy/controls";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function controlsBody(overrides: Record<string, unknown> = {}) {
  return {
    killSwitchActive: true,
    canOperate: true,
    controls: {
      autonomousMode: false,
      maximumAutonomousRisk: "GREEN",
      actions: Object.fromEntries(AUTOMATIC_ACTIONS.map((action) => [action, false])),
    },
    ...overrides,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("SafetyControls (live, ADR-080)", () => {
  it("lists every automatic action as a real switch wired to the controls API", async () => {
    const posts: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return jsonResponse({ controls: controlsBody().controls });
      }
      return jsonResponse(controlsBody());
    }));

    render(<SafetyControls />);

    const list = (await screen.findByRole("heading", { name: /what it may do without asking/i }))
      .parentElement!;
    const switches = within(list).getAllByRole("switch");
    // A control added to the model cannot go missing from this page.
    expect(switches).toHaveLength(AUTOMATIC_ACTIONS.length);
    for (const element of switches) expect(element).toHaveAttribute("aria-checked", "false");

    fireEvent.click(within(list).getByRole("switch", { name: "Decide what to work on" }));
    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ control: "autonomy", autoPlan: true });
  });

  it("asks for a reason before releasing the kill switch, and posts it", async () => {
    const posts: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return jsonResponse({ killSwitchActive: false });
      }
      return jsonResponse(controlsBody());
    }));

    render(<SafetyControls />);

    expect(await screen.findByText(/Kill switch ON\./)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Release…" }));
    // Nothing posted yet: release is the consequential direction and must say why.
    expect(posts).toEqual([]);
    const confirm = screen.getByRole("button", { name: "Release kill switch" });
    expect(confirm).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Why release it?"), {
      target: { value: "Supervised GREEN pilot" },
    });
    fireEvent.click(confirm);

    await waitFor(() => expect(posts).toHaveLength(1));
    expect(posts[0]).toEqual({ control: "kill_switch", active: false, reason: "Supervised GREEN pilot" });
  });

  it("says in place when a switched-on action is held off, and by what", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(controlsBody({
      controls: {
        autonomousMode: false,
        maximumAutonomousRisk: "GREEN",
        actions: { ...Object.fromEntries(AUTOMATIC_ACTIONS.map((action) => [action, false])), plan: true },
      },
    }))));

    render(<SafetyControls />);

    expect(await screen.findByText(/Switched on, held off:/)).toHaveTextContent(
      /the global kill switch is on\./,
    );
  });

  it("refuses RED as a ceiling choice and renders members read-only", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(controlsBody({ canOperate: false }))));

    render(<SafetyControls />);

    await screen.findByText(/Kill switch ON\./);
    // A member sees state, not switches.
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Release…" })).not.toBeInTheDocument();
    // RED is labeled as never automatic, whoever is looking.
    expect(screen.getByText("Never automatic")).toBeInTheDocument();
  });

  it("fails closed for a signed-out visitor", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 401)));

    render(<SafetyControls />);

    expect(await screen.findByText(/Sign in to see and operate/)).toBeInTheDocument();
    expect(screen.queryByRole("switch")).not.toBeInTheDocument();
  });
});
