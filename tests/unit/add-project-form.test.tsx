import { fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AddProjectForm } from "@/components/add-project-form";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AddProjectForm", () => {
  it.each([
    ["projects HTTP failure", "/api/projects", "http"],
    ["projects invalid JSON", "/api/projects", "json"],
    ["connections HTTP failure", "/api/github/connections", "http"],
    ["connections invalid JSON", "/api/github/connections", "json"],
  ])("fails closed on %s and recovers through Retry", async (_label, failedUrl, mode) => {
    let failedOnce = false;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === failedUrl && !failedOnce) {
        failedOnce = true;
        return mode === "http"
          ? jsonResponse({ error: { message: "Unavailable" } }, 503)
          : new Response("{", { status: 200, headers: { "Content-Type": "application/json" } });
      }
      if (url === "/api/projects") return jsonResponse({ projects: [] });
      if (url === "/api/github/connections") return jsonResponse({ connections: [] });
      throw new Error(`Unexpected request: ${url}`);
    }));

    render(<AddProjectForm />);

    expect(await screen.findByText("Project setup is unavailable")).toBeInTheDocument();
    expect(screen.queryByText("Connect GitHub first")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Connect GitHub first")).toBeInTheDocument();
  });
});
