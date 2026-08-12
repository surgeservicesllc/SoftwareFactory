import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectionsConsole } from "@/components/connections-console";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

const organization = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Example Engineering",
  role: "owner",
  slug: "example-engineering",
};

function organizationResponse() {
  return jsonResponse({ activeOrganizationId: organization.id, organizations: [organization] });
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState(null, "", "/");
});

describe("ConnectionsConsole", () => {
  it("renders the signed-out state without requesting GitHub data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: { code: "unauthorized" } }, 401));
    vi.stubGlobal("fetch", fetchMock);

    render(<ConnectionsConsole />);

    expect(await screen.findByRole("heading", { name: "Authentication required" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Sign in/ })).toHaveAttribute("href", "/sign-in?next=/connections");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("renders generic onboarding without hard-coded account identity", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ activeOrganizationId: null, organizations: [] })));

    render(<ConnectionsConsole />);

    expect(await screen.findByRole("heading", { name: "Create the control-plane organization" })).toBeInTheDocument();
    expect(screen.getByLabelText("Organization name")).toHaveAttribute("placeholder", "Engineering organization");
    expect(screen.queryByDisplayValue(/Surge/i)).not.toBeInTheDocument();
  });

  it("renders a connected organization installation and its account-scoped management URL", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/organizations") return organizationResponse();
      return jsonResponse({
        connections: [{
          account: { login: "example-org", type: "Organization" },
          id: "22222222-2222-4222-8222-222222222222",
          installation: {
            id: 456,
            lastSyncedAt: "2026-08-12T20:00:00.000Z",
            repositorySelection: "selected",
            suspendedAt: null,
          },
          name: "example-org",
          repositories: [{
            archived: false,
            defaultBranch: "main",
            disabled: false,
            fullName: "example-org/application",
            htmlUrl: "https://github.com/example-org/application",
            id: 789,
            private: true,
            selected: true,
          }],
          status: "connected",
          statusLabel: "Connected",
          statusReason: null,
        }],
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ConnectionsConsole />);

    expect(await screen.findByRole("heading", { name: "example-org" })).toBeInTheDocument();
    expect(screen.getAllByText("Connected")).toHaveLength(2);
    expect(screen.getByText("example-org/application")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Manage/ })).toHaveAttribute(
      "href",
      "https://github.com/organizations/example-org/settings/installations/456",
    );
  });

  it("renders the connected empty-repository state truthfully", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/organizations") return organizationResponse();
      return jsonResponse({
        connections: [{
          account: { login: "example-user", type: "User" },
          id: "22222222-2222-4222-8222-222222222222",
          installation: {
            id: 456,
            lastSyncedAt: null,
            repositorySelection: "selected",
            suspendedAt: null,
          },
          name: "example-user",
          repositories: [],
          status: "connected",
          statusLabel: "Connected",
          statusReason: null,
        }],
      });
    }));

    render(<ConnectionsConsole />);

    expect(await screen.findByText("No active selected repositories.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Manage/ })).toHaveAttribute(
      "href",
      "https://github.com/settings/installations/456",
    );
  });

  it("keeps the connect action visibly pending while authorization starts", async () => {
    const pendingResponse = new Promise<Response>(() => undefined);
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/organizations") return organizationResponse();
      if (String(input) === "/api/github/connections") return jsonResponse({ connections: [] });
      return pendingResponse;
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<ConnectionsConsole />);
    const connect = await screen.findByRole("button", { name: /Connect GitHub/ });
    await user.click(connect);

    await waitFor(() => expect(connect).toBeDisabled());
    expect(fetchMock).toHaveBeenLastCalledWith("/api/github/install/start", expect.objectContaining({ method: "POST" }));
  });

  it("renders an explicit recoverable error state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: { message: "Tenant lookup failed safely." } }, 503)));

    render(<ConnectionsConsole />);

    expect(await screen.findByRole("heading", { name: "Connections unavailable" })).toBeInTheDocument();
    expect(screen.getByText("Tenant lookup failed safely.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Retry/ })).toBeInTheDocument();
  });

  it("shows the bounded GitHub callback failure after the browser redirect", async () => {
    const params = new URLSearchParams({
      github: "error",
      githubError: "github_installation_cancelled",
      githubMessage: "GitHub installation was cancelled or is awaiting organization approval.",
    });
    window.history.replaceState(null, "", `/connections?${params.toString()}`);
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/organizations") return organizationResponse();
      return jsonResponse({ connections: [] });
    }));

    render(<ConnectionsConsole />);

    expect(await screen.findByText(
      "GitHub installation was cancelled or is awaiting organization approval. (github_installation_cancelled)",
    )).toBeInTheDocument();
  });
});
