import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectAgentSelector } from "@/components/project-agent-selection";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

const AGENTS = [
  { id: "ag1", name: "Orchestrator", role: "orchestrator", description: null, project: null },
  { id: "ag2", name: "QA", role: "qa", description: null, project: null },
  { id: "ag3", name: "Elsewhere Reviewer", role: "qa", description: null, project: { id: "p-other", name: "Other" } },
];

function stubFetch(overrides: Partial<Record<string, unknown>> = {}, calls?: Array<{ url: string; init?: RequestInit }>) {
  const bodies: Record<string, unknown> = {
    "/api/agents": { agents: AGENTS },
    "/api/project-agents": { available: true, canManage: true, selections: [] },
    "/api/projects": { projects: [{ id: "p1", name: "Factory One" }] },
    ...overrides,
  };
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls?.push({ url, init });
    const base = url.split("?")[0]!;
    if (base in bodies) return jsonResponse(bodies[base]);
    return jsonResponse({});
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProjectAgentSelector", () => {
  it("offers org-wide agents for the project and hides agents bound elsewhere", async () => {
    stubFetch();
    render(<ProjectAgentSelector projectContext={{ id: "p1", name: "Factory One" }} />);

    expect(await screen.findByText("Orchestrator")).toBeInTheDocument();
    expect(screen.getByText("QA")).toBeInTheDocument();
    // Bound to another project: the database would refuse it, so the page
    // does not offer it.
    expect(screen.queryByText("Elsewhere Reviewer")).not.toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /include in ai factory/i })).toHaveLength(2);
  });

  it("includes an agent through the route and reflects the recorded selection", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    let selections: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push({ url, init });
      const base = url.split("?")[0]!;
      if (base === "/api/agents") return jsonResponse({ agents: AGENTS });
      if (base === "/api/project-agents" && init?.method === "POST") {
        selections = [{ id: "pa1", projectId: "p1", agentId: "ag1", agentName: "Orchestrator", agentRole: "orchestrator", selectedAt: "2026-08-22T00:00:00.000Z" }];
        return jsonResponse({ selection: { id: "pa1" }, created: true });
      }
      if (base === "/api/project-agents") {
        return jsonResponse({ available: true, canManage: true, selections });
      }
      return jsonResponse({});
    }));

    render(<ProjectAgentSelector projectContext={{ id: "p1", name: "Factory One" }} />);
    const buttons = await screen.findAllByRole("button", { name: /include in ai factory/i });
    fireEvent.click(buttons[0]!);

    await waitFor(() => expect(screen.getByText("Included")).toBeInTheDocument());
    const post = calls.find((call) => call.init?.method === "POST");
    expect(JSON.parse(String(post?.init?.body))).toEqual({ projectId: "p1", agentId: "ag1" });
    expect(screen.getByRole("button", { name: /remove from ai factory/i })).toHaveAttribute("aria-pressed", "true");
  });

  it("reports the missing migration as Not Connected with every control disabled", async () => {
    stubFetch({ "/api/project-agents": { available: false, canManage: false, selections: [] } });
    render(<ProjectAgentSelector projectContext={{ id: "p1", name: "Factory One" }} />);

    expect(await screen.findByText("Not Connected")).toBeInTheDocument();
    for (const button of screen.getAllByRole("button", { name: /include in ai factory/i })) {
      expect(button).toBeDisabled();
    }
  });

  it("is read-only for a member, saying who can change it", async () => {
    stubFetch({ "/api/project-agents": { available: true, canManage: false, selections: [] } });
    render(<ProjectAgentSelector projectContext={{ id: "p1", name: "Factory One" }} />);

    expect(await screen.findByText(/owner or administrator can change/i)).toBeInTheDocument();
    for (const button of screen.getAllByRole("button", { name: /include in ai factory/i })) {
      expect(button).toBeDisabled();
    }
  });

  it("standalone, it picks projects itself and names the empty-project next step", async () => {
    stubFetch({ "/api/projects": { projects: [] } });
    render(<ProjectAgentSelector />);

    expect(await screen.findByText(/create a project first/i)).toBeInTheDocument();
  });
});
