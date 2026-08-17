import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectBots } from "@/components/project-bots";

const projectId = "11111111-1111-4111-8111-111111111111";
const otherProjectId = "22222222-2222-4222-8222-222222222222";

function fabric(overrides: Record<string, unknown> = {}) {
  return {
    canManage: true,
    bots: [
      { id: "bot-1", name: "Auditor", provider: "anthropic" },
      { id: "bot-2", name: "Fixer", provider: "openai" },
      { id: "bot-3", name: "Reviewer", provider: "anthropic" },
    ],
    roles: [
      { id: "role-1", name: "Engineer" },
      { id: "role-2", name: "Reviewer" },
    ],
    assignments: [
      { id: "as-1", botId: "bot-1", projectId, roleId: "role-1", status: "active" },
      // Serving a different project: not this project's, and not free to take.
      { id: "as-2", botId: "bot-2", projectId: otherProjectId, roleId: "role-1", status: "active" },
    ],
    ...overrides,
  };
}

function stubFabric(body: unknown, extra?: (url: string, init?: RequestInit) => Response | null) {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({
      url,
      method: init?.method ?? "GET",
      body: init?.body ? JSON.parse(String(init.body)) : null,
    });
    const handled = extra?.(url, init);
    if (handled) return handled;
    if (url === "/api/bots") {
      return { ok: true, status: 200, json: async () => body } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => ({}) } as unknown as Response;
  }));
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProjectBots", () => {
  it("lists only this project's bots and offers only genuinely free ones", async () => {
    stubFabric(fabric());

    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);

    // Assigned here.
    expect(await screen.findByText("Auditor")).toBeInTheDocument();
    expect(screen.getByText(/1 assigned/)).toBeInTheDocument();
    // Serving another project — never shown as this project's bot.
    expect(screen.queryByText("Fixer")).not.toBeInTheDocument();

    // The picker offers the free bot only: a bot posted elsewhere would be
    // moved by a click, which this phase does not do silently.
    const picker = screen.getByLabelText("Bot");
    const options = within(picker).getAllByRole("option").map((option) => option.textContent);
    expect(options).toEqual(["Choose a bot", "Reviewer"]);
  });

  it("assigns a bot to this project with a role", async () => {
    const calls = stubFabric(fabric(), (url, init) => {
      if (url === "/api/bot-assignments" && init?.method === "POST") {
        return { ok: true, status: 201, json: async () => ({ assignment: {} }) } as unknown as Response;
      }
      return null;
    });
    const user = userEvent.setup();

    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);

    await user.selectOptions(await screen.findByLabelText("Bot"), "bot-3");
    await user.selectOptions(screen.getByLabelText("Role"), "role-2");
    await user.click(screen.getByRole("button", { name: /assign bot/i }));

    const post = calls.find((call) => call.method === "POST");
    expect(post?.url).toBe("/api/bot-assignments");
    expect(post?.body).toEqual({ botId: "bot-3", projectId, roleId: "role-2" });
    // The roster is re-read so the page shows what the server now holds.
    expect(calls.filter((call) => call.url === "/api/bots").length).toBeGreaterThan(1);
  });

  it("releases an assigned bot through the status transition", async () => {
    const calls = stubFabric(fabric(), (url, init) => {
      if (url.startsWith("/api/bot-assignments/") && init?.method === "PATCH") {
        return { ok: true, status: 200, json: async () => ({ assignment: {} }) } as unknown as Response;
      }
      return null;
    });
    const user = userEvent.setup();

    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);

    await user.click(await screen.findByRole("button", { name: /release auditor/i }));

    const patch = calls.find((call) => call.method === "PATCH");
    expect(patch?.url).toBe("/api/bot-assignments/as-1");
    expect(patch?.body).toEqual({ status: "released" });
  });

  it("says a failed roster read is unknown rather than showing an empty one", async () => {
    stubFabric(null, (url) => {
      if (url === "/api/bots") {
        return { ok: false, status: 503, json: async () => ({}) } as unknown as Response;
      }
      return null;
    });

    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);

    expect(await screen.findByText(/roster could not be loaded/i)).toBeInTheDocument();
    expect(screen.queryByText(/none assigned/i)).not.toBeInTheDocument();
  });

  it("names the next step when there is nothing to assign, and hides controls from a member", async () => {
    stubFabric(fabric({ bots: [], assignments: [] }));
    const { unmount } = render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);
    expect(await screen.findByText(/create a bot in bot manager/i)).toBeInTheDocument();
    unmount();
    vi.unstubAllGlobals();

    stubFabric(fabric({ canManage: false }));
    render(<ProjectBots projectId={projectId} projectName="SoftwareFactory" />);
    // A read-only member still sees who serves the project, but no controls.
    expect(await screen.findByText("Auditor")).toBeInTheDocument();
    expect(screen.queryByLabelText("Bot")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /release/i })).not.toBeInTheDocument();
  });
});
