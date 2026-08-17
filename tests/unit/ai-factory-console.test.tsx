import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AiFactoryConsole } from "@/components/ai-factory-console";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function stubFactory(overrides: Partial<Record<string, unknown>> = {}) {
  const defaults: Record<string, unknown> = {
    "/api/github/connections": { connections: [] },
    "/api/projects": { projects: [] },
    "/api/ai-accounts": { accounts: [] },
    "/api/bots": { bots: [], assignments: [] },
    "/api/commands": { commands: [] },
  };
  const bodies = { ...defaults, ...overrides };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url in bodies) return jsonResponse(bodies[url]);
    return jsonResponse({});
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AiFactoryConsole", () => {
  it("starts an empty workspace at Connect Repository, with every later step pending", async () => {
    stubFactory();

    render(<AiFactoryConsole />);

    const first = (await screen.findByText("Connect Repository")).closest("li") as HTMLElement;
    expect(within(first).getByText("You are here")).toBeInTheDocument();
    expect(within(first).getByRole("link", { name: /connect github/i })).toHaveAttribute(
      "href",
      "/solutions/connections",
    );
    expect(screen.getByText("0 of 8 complete")).toBeInTheDocument();
  });

  it("derives progress from the live records, not a stored wizard", async () => {
    stubFactory({
      "/api/github/connections": {
        connections: [{
          status: "connected",
          installation: { id: 1 },
          repositories: [{ selected: true, archived: false }],
        }],
      },
      "/api/projects": { projects: [{ id: "p1", name: "SoftwareFactory" }] },
      "/api/ai-accounts": { accounts: [{ status: "connected" }] },
      "/api/bots": {
        bots: [{ id: "b1" }],
        assignments: [{ id: "a1", status: "active", roleId: "builder" }],
      },
      "/api/commands": {
        commands: [{ id: "c1", prompt: "Ship search", status: "running", project: { id: "p1", name: "SoftwareFactory" } }],
      },
    });

    render(<AiFactoryConsole />);

    // Seven steps carry evidence; only "Watch It Ship" remains, because no
    // command has succeeded yet.
    expect(await screen.findByText("7 of 8 complete")).toBeInTheDocument();
    const watch = screen.getByText("Watch It Ship").closest("li") as HTMLElement;
    expect(within(watch).getByText("You are here")).toBeInTheDocument();
    expect(within(watch).getByText(/Work is in flight/)).toBeInTheDocument();
    // The command section shows the live stage from the worker-advanced status.
    expect(screen.getByText("Ship search")).toBeInTheDocument();
    expect(screen.getByText("Building")).toBeInTheDocument();
    // The command step deep-links the composer with the project carried.
    const command = screen.getByText("Issue a Command").closest("li") as HTMLElement;
    expect(within(command).getByRole("link", { name: /give a bot work/i })).toHaveAttribute(
      "href",
      "/solutions/bot-manager?project=p1",
    );
  });

  it("counts only configured assignments for the configure step", async () => {
    stubFactory({
      "/api/bots": {
        bots: [{ id: "b1" }],
        assignments: [
          { id: "a1", status: "active" },
          { id: "a2", status: "released", roleId: "builder" },
        ],
      },
    });

    render(<AiFactoryConsole />);

    const configure = (await screen.findByText("Configure Bot Settings")).closest("li") as HTMLElement;
    expect(within(configure).getByText(/none carries a role or responsibilities yet/)).toBeInTheDocument();
  });

  it("fails closed for a signed-out visitor", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 401)));

    render(<AiFactoryConsole />);

    expect(await screen.findByText("Sign in to run your factory")).toBeInTheDocument();
  });
});
