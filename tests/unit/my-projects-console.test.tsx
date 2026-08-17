import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MyProjectsConsole } from "@/components/my-projects-console";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function project(id: string, name: string) {
  return {
    autonomousMode: false,
    connectionId: null,
    connectionStatus: "not_connected",
    defaultBranch: "main",
    description: null,
    githubRepository: `example-org/${name.toLowerCase()}`,
    githubRepositoryId: null,
    healthStatus: "unknown",
    id,
    maximumAutonomousRisk: "GREEN",
    name,
    status: "active",
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(projects: unknown[]) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url === "/api/projects") return jsonResponse({ projects });
    if (url === "/api/github/connections") return jsonResponse({ connections: [] });
    // The expanded inspector's per-project panels (bots, operations) make
    // their own best-effort reads; empty bodies render their absence states.
    return jsonResponse({});
  }));
}

describe("MyProjectsConsole", () => {
  it("lists every project as a row, opens the first, and expands the rest on demand", async () => {
    stubFetch([
      project("11111111-1111-4111-8111-111111111111", "Alpha"),
      project("22222222-2222-4222-8222-222222222222", "Beta"),
    ]);

    render(<MyProjectsConsole />);

    // Both rows are present; only the first project's detail is open.
    expect(await screen.findByRole("button", { name: "Hide Alpha details" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    const betaToggle = screen.getByRole("button", { name: "Show Beta details" });
    expect(betaToggle).toHaveAttribute("aria-expanded", "false");
    expect(screen.getAllByText("Visibility")).toHaveLength(1);

    // The down arrow shows the second project's details too — the same live
    // inspector the Projects page renders.
    fireEvent.click(betaToggle);
    expect(screen.getAllByText("Visibility")).toHaveLength(2);
    expect(screen.getByRole("button", { name: "Hide Beta details" })).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    // And folds them away again.
    fireEvent.click(screen.getByRole("button", { name: "Hide Alpha details" }));
    expect(screen.getAllByText("Visibility")).toHaveLength(1);
  });

  it("sends an empty workspace to the add-project form", async () => {
    stubFetch([]);

    render(<MyProjectsConsole />);

    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /new project/i })).toHaveAttribute(
      "href",
      "/solutions/projects#add-project",
    );
  });

  it("gates a signed-out visitor instead of pretending at an empty portfolio", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 401)));

    render(<MyProjectsConsole />);

    expect(await screen.findByText("Sign in to see your projects")).toBeInTheDocument();
  });
});
