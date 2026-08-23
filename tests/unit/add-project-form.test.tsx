import { fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  const connectedAccount = {
    id: "connection-1",
    status: "connected",
    account: { login: "surge", type: "User" },
    installation: { id: 7, suspendedAt: null },
    repositories: [{
      id: 42,
      fullName: "surge/exact-project",
      defaultBranch: "main",
      archived: false,
      selected: true,
    }],
  };

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

  it("returns the exact server-issued project id to its caller", async () => {
    let created = false;
    const onCreated = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/projects" && init?.method === "POST") {
        created = true;
        return jsonResponse({ project: { id: "project-created-exactly" } }, 201);
      }
      if (url === "/api/projects") {
        return jsonResponse({
          projects: created ? [{ githubRepositoryId: 42 }] : [],
        });
      }
      if (url === "/api/github/connections") {
        return jsonResponse({ connections: [connectedAccount] });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    render(<AddProjectForm onCreated={onCreated} />);
    const submit = await screen.findByRole("button", { name: "Add project" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    await waitFor(() => expect(onCreated).toHaveBeenCalledWith("project-created-exactly"));
    expect(onCreated).toHaveBeenCalledTimes(1);
  });

  it("fails visibly instead of signaling completion without an exact project id", async () => {
    const onCreated = vi.fn();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/projects" && init?.method === "POST") {
        return jsonResponse({ project: { name: "Missing identity" } }, 201);
      }
      if (url === "/api/projects") return jsonResponse({ projects: [] });
      if (url === "/api/github/connections") {
        return jsonResponse({ connections: [connectedAccount] });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    render(<AddProjectForm onCreated={onCreated} />);
    const submit = await screen.findByRole("button", { name: "Add project" });
    await waitFor(() => expect(submit).toBeEnabled());
    fireEvent.click(submit);

    expect(await screen.findByText(/exact identity could not be confirmed/i)).toBeInTheDocument();
    expect(onCreated).not.toHaveBeenCalled();
  });
});
