import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CommandComposer } from "@/components/command-composer";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("CommandComposer", () => {
  it("offers only projects with a currently connected GitHub binding", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      projects: [
        {
          connectionStatus: "connected",
          id: "11111111-1111-4111-8111-111111111111",
          name: "Connected application",
          status: "active",
        },
        {
          connectionStatus: "not_connected",
          id: "22222222-2222-4222-8222-222222222222",
          name: "Historical application",
          status: "active",
        },
      ],
    })));

    render(<CommandComposer />);

    expect(await screen.findByRole("option", { name: "Connected application" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Historical application" })).not.toBeInTheDocument();
  });

  it("reuses one command idempotency key after an ambiguous submission failure", async () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    const randomUUID = vi.spyOn(globalThis.crypto, "randomUUID")
      .mockReturnValue("33333333-3333-4333-8333-333333333333");
    let attempts = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/projects") {
        return jsonResponse({
          projects: [{
            connectionStatus: "connected",
            id: projectId,
            name: "Application",
            status: "active",
          }],
        });
      }
      if (String(input) === "/api/commands" && init?.method === "POST") {
        attempts += 1;
        if (attempts === 1) throw new TypeError("The response was lost");
        return jsonResponse({
          command: { id: "44444444-4444-4444-8444-444444444444" },
          execution: { workerDispatch: "requested" },
          orchestration: { effectiveRisk: "yellow", repository: "example/application" },
          requiresOwnerApproval: false,
        }, 202);
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<CommandComposer />);

    await screen.findByRole("option", { name: "Application" });
    await user.type(screen.getByLabelText("What do you want done?"), "Fix the mobile overflow");
    await user.selectOptions(screen.getByLabelText("Work type"), "mobile");
    await user.click(screen.getByRole("button", { name: /Medium/ }));
    await user.click(screen.getByRole("button", { name: "Queue command" }));
    expect(await screen.findByText("The response was lost")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Queue command" }));
    expect(await screen.findByText(/is queued for example\/application as YELLOW/)).toBeInTheDocument();

    const bodies = fetchMock.mock.calls
      .filter(([input, init]) => String(input) === "/api/commands" && init?.method === "POST")
      .map(([, init]) => JSON.parse(String(init?.body)) as { idempotencyKey: string });
    expect(bodies).toHaveLength(2);
    expect(bodies[0]?.idempotencyKey).toBe("command:33333333-3333-4333-8333-333333333333");
    expect(bodies[1]?.idempotencyKey).toBe(bodies[0]?.idempotencyKey);
    expect(randomUUID).toHaveBeenCalledTimes(1);
  });
});
