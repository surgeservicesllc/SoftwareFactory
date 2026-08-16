import { render, screen, waitFor, within } from "@testing-library/react";
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

// jsdom's `window.location.assign` is a non-configurable no-op, so it cannot be
// spied on directly. Replace `window.location` with a proxy that forwards every
// read to the real location but captures `assign`, which is how the connect
// action now leaves for the installation launcher.
const realLocation = window.location;
function stubNavigation() {
  const assign = vi.fn();
  const stand_in = {
    assign,
    href: realLocation.href,
    origin: realLocation.origin,
    pathname: realLocation.pathname,
    search: "",
  } as unknown as Location;
  delete (window as { location?: Location }).location;
  (window as { location: Location }).location = stand_in;
  return assign;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as { location?: Location }).location;
  (window as { location: Location }).location = realLocation;
  window.history.replaceState(null, "", "/");
});

describe("ConnectionsConsole", () => {
  it("renders the signed-out state without requesting GitHub data", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ error: { code: "unauthorized" } }, 401));
    vi.stubGlobal("fetch", fetchMock);

    render(<ConnectionsConsole />);

    expect(await screen.findByRole("heading", { name: "Sign in first" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Sign in/ })).toHaveAttribute("href", "/auth/sign-in?next=/connections");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("renders generic onboarding without hard-coded account identity", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ activeOrganizationId: null, organizations: [] })));

    render(<ConnectionsConsole />);

    expect(await screen.findByRole("heading", { name: "Name your workspace" })).toBeInTheDocument();
    expect(screen.getByLabelText("Workspace name")).toHaveAttribute("placeholder", "Acme Engineering");
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
    expect(screen.getByText("Installation #456 · Repository access: Selected repositories")).toBeInTheDocument();
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

    expect(await screen.findByText(/^No active selected repositories\./)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Manage/ })).toHaveAttribute(
      "href",
      "https://github.com/settings/installations/456",
    );
  });

  it("renders a lost GitHub connection as Error instead of Not Connected", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/organizations") return organizationResponse();
      return jsonResponse({
        connections: [{
          account: { login: "example-org", type: "Organization" },
          id: "22222222-2222-4222-8222-222222222222",
          installation: {
            id: 456,
            lastSyncedAt: "2026-08-12T20:00:00.000Z",
            repositorySelection: "selected",
            suspendedAt: "2026-08-12T20:05:00.000Z",
          },
          name: "example-org",
          repositories: [],
          status: "error",
          statusLabel: "Error",
          statusReason: "The GitHub App installation is suspended.",
        }],
      });
    }));

    render(<ConnectionsConsole />);

    const connectionCard = (await screen.findByRole("heading", { name: "example-org" })).closest("section");
    expect(connectionCard).not.toBeNull();
    expect(within(connectionCard!).getByText("Error")).toBeInTheDocument();
    expect(within(connectionCard!).getByText("The GitHub App installation is suspended.")).toBeInTheDocument();
    expect(within(connectionCard!).queryByText("Not Connected")).not.toBeInTheDocument();
  });

  it("starts authorization as a top-level navigation to the launcher, not a fetch", async () => {
    // The launcher sets the anti-forgery cookie on its own redirect response.
    // A background fetch would set it on an XHR response, which Safari on
    // iOS/iPadOS is entitled to drop — the exact cause of the mobile-only
    // failure this navigation replaces.
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/organizations") return organizationResponse();
      if (String(input) === "/api/github/connections") return jsonResponse({ connections: [] });
      if (String(input) === "/api/github/install/start") return jsonResponse({ apps: [] });
      if (String(input) === "/api/projects") return jsonResponse({ projects: [] });
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);
    const assign = stubNavigation();
    const user = userEvent.setup();

    render(<ConnectionsConsole />);
    const connect = await screen.findByRole("button", { name: /Connect GitHub/ });
    await user.click(connect);

    // The button reflects the pending navigation, and no POST to /start is made.
    await waitFor(() => expect(connect).toBeDisabled());
    expect(assign).toHaveBeenCalledTimes(1);
    const target = new URL(String(assign.mock.calls[0]![0]), "https://factory.test");
    expect(target.pathname).toBe("/api/github/install/launch");
    expect(target.searchParams.get("appSlot")).toBe("primary");
    expect(target.searchParams.get("organizationId")).toBe(organization.id);
    expect(target.searchParams.get("returnTo")).toBe("/solutions/connections");
    expect(fetchMock).not.toHaveBeenCalledWith(
      "/api/github/install/start",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("offers only the server-configured candidate App as the replacement target", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/organizations") return organizationResponse();
      if (String(input) === "/api/github/connections") {
        return jsonResponse({
          connections: [{
            account: { login: "example-org", type: "Organization" },
            id: "22222222-2222-4222-8222-222222222222",
            installation: {
              appId: 4573846,
              appSlug: "software-factory",
              id: 456,
              lastSyncedAt: "2026-08-12T20:00:00.000Z",
              repositorySelection: "selected",
              suspendedAt: null,
            },
            name: "example-org",
            repositories: [],
            status: "connected",
            statusLabel: "Connected",
            statusReason: null,
          }],
        });
      }
      if (String(input) === "/api/github/install/start") {
        return jsonResponse({
          apps: [
            { appId: 4573846, appSlug: "software-factory", slot: "primary" },
            { appId: 5000001, appSlug: "software-factory-candidate", slot: "candidate" },
          ],
        });
      }
      if (String(input) === "/api/projects") return jsonResponse({ projects: [] });
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);
    const assign = stubNavigation();
    const user = userEvent.setup();

    render(<ConnectionsConsole />);
    const install = await screen.findByRole("button", {
      name: /Install replacement GitHub App/,
    });
    await user.click(install);

    await waitFor(() => expect(assign).toHaveBeenCalledTimes(1));
    const target = new URL(String(assign.mock.calls[0]![0]), "https://factory.test");
    expect(target.pathname).toBe("/api/github/install/launch");
    expect(target.searchParams.get("appSlot")).toBe("candidate");
    expect(target.searchParams.get("organizationId")).toBe(organization.id);
  });

  it("requires explicit RED evidence before handing an existing project to the candidate", async () => {
    const oldConnectionId = "22222222-2222-4222-8222-222222222222";
    const candidateConnectionId = "33333333-3333-4333-8333-333333333333";
    const projectId = "44444444-4444-4444-8444-444444444444";
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (String(input) === "/api/organizations") return organizationResponse();
      if (String(input) === "/api/github/connections") {
        const connection = (id: string, appId: number, appSlug: string, installationId: number) => ({
          account: { login: "example-org", type: "Organization" },
          id,
          installation: {
            appId,
            appSlug,
            id: installationId,
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
        });
        return jsonResponse({
          connections: [
            connection(oldConnectionId, 4573846, "software-factory", 456),
            connection(candidateConnectionId, 5000001, "software-factory-candidate", 7890),
          ],
        });
      }
      if (String(input) === "/api/github/install/start") {
        return jsonResponse({
          apps: [
            { appId: 4573846, appSlug: "software-factory", slot: "primary" },
            { appId: 5000001, appSlug: "software-factory-candidate", slot: "candidate" },
          ],
        });
      }
      if (String(input) === "/api/projects") {
        return jsonResponse({
          projects: [{
            connectionId: oldConnectionId,
            githubRepositoryId: 789,
            id: projectId,
            name: "SoftwareFactory",
          }],
        });
      }
      if (String(input) === `/api/github/connections/${candidateConnectionId}/handoff`
        && init?.method === "POST") {
        return jsonResponse({ historyPreserved: true });
      }
      throw new Error(`Unexpected request: ${String(input)}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<ConnectionsConsole />);
    await user.click(await screen.findByRole("button", { name: "Activate for SoftwareFactory" }));
    expect(screen.getByText("Approve RED GitHub App handoff for SoftwareFactory")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Type HANDOFF GITHUB PROJECT"), "HANDOFF GITHUB PROJECT");
    await user.type(
      screen.getByLabelText("Rationale (20–500 characters)"),
      "Replace the GitHub App with its verified candidate.",
    );
    await user.clear(screen.getByLabelText("Rollback and containment plan (20–500 characters)"));
    await user.type(
      screen.getByLabelText("Rollback and containment plan (20–500 characters)"),
      "Reverse to the prior live installation and verify repository reads.",
    );
    await user.click(screen.getByRole("button", { name: "Approve and hand off" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      `/api/github/connections/${candidateConnectionId}/handoff`,
      expect.objectContaining({ method: "POST" }),
    ));
    const handoffCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input).endsWith("/handoff") && init?.method === "POST",
    );
    expect(JSON.parse(String(handoffCall?.[1]?.body))).toEqual({
      confirmation: "HANDOFF GITHUB PROJECT",
      fromConnectionId: oldConnectionId,
      fromInstallationId: 456,
      projectId,
      rationale: "Replace the GitHub App with its verified candidate.",
      repositoryId: 789,
      rollbackPlan: "Reverse to the prior live installation and verify repository reads.",
      toInstallationId: 7890,
    });
  });

  it("renders an explicit recoverable error state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ error: { message: "Tenant lookup failed safely." } }, 503)));

    render(<ConnectionsConsole />);

    expect(await screen.findByRole("heading", { name: "Connections are unavailable" })).toBeInTheDocument();
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
