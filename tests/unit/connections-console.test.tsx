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
    // "Connect Existing GitHub" since the owner's design paired it with
    // "Create New GitHub"; both are in this empty state, so the name must be
    // the specific one rather than a prefix that matches either.
    const connect = await screen.findByRole("button", { name: /Connect Existing GitHub/ });
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
    // The notice parameters are one-shot: they are stripped from the URL the
    // moment they are read, so reloading (or bookmarking) the page cannot
    // resurrect a stale success or failure banner over live data.
    expect(window.location.search).toBe("");
    expect(window.location.pathname).toBe("/connections");
  });

  it("offers a workspace switcher out of the wrong-workspace trap", async () => {
    // Connections are workspace-scoped, and the install callback refuses an
    // installation bound to another organization (a deliberate cross-tenant
    // guard). A person whose browser landed in the other workspace saw only an
    // empty list and that refusal, with no way to change context — the live
    // 2026-08-16 "not returning back data" report.
    const otherOrganization = {
      id: "44444444-4444-4444-8444-444444444444",
      name: "Second Workspace",
      role: "owner",
      slug: "second-workspace",
    };
    let activeId = organization.id;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/organizations") {
        return jsonResponse({
          activeOrganizationId: activeId,
          organizations: [organization, otherOrganization],
        });
      }
      if (url === "/api/organizations/active") {
        activeId = (JSON.parse(String(init?.body ?? "{}")) as { organizationId: string }).organizationId;
        return jsonResponse({ ok: true });
      }
      if (url === "/api/github/connections") {
        return jsonResponse({
          connections: activeId === otherOrganization.id
            ? [{
              account: { login: "example-org", type: "Organization" },
              id: "55555555-5555-4555-8555-555555555555",
              installation: {
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
            }]
            : [],
        });
      }
      if (url === "/api/github/install/start") return jsonResponse({ apps: [] });
      if (url === "/api/projects") return jsonResponse({ projects: [] });
      return jsonResponse({});
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ConnectionsConsole />);

    // Wrong workspace: the empty state renders, but so does the switcher.
    expect(await screen.findByRole("heading", { name: "Connect GitHub to begin" })).toBeInTheDocument();
    const switcher = screen.getByRole("group", { name: "Switch workspace" });
    expect(within(switcher).getByRole("button", { name: /Example Engineering — current/ })).toBeDisabled();

    // Switching reloads straight into the workspace that owns the connection.
    await userEvent.click(within(switcher).getByRole("button", { name: "Second Workspace" }));
    expect(await screen.findByRole("heading", { name: "example-org" })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/organizations/active",
      expect.objectContaining({ method: "POST" }),
    );
  });

  const pickerConnection = {
    account: { login: "example-org", type: "Organization" },
    id: "22222222-2222-4222-8222-222222222222",
    installation: {
      id: 456,
      lastSyncedAt: "2026-08-12T20:00:00.000Z",
      repositorySelection: "selected",
      suspendedAt: null,
    },
    name: "example-org",
    repositories: [
      {
        archived: false,
        defaultBranch: "main",
        disabled: false,
        fullName: "example-org/application",
        htmlUrl: "https://github.com/example-org/application",
        id: 789,
        private: true,
        selected: true,
      },
      {
        archived: false,
        defaultBranch: "trunk",
        disabled: false,
        fullName: "example-org/website",
        htmlUrl: "https://github.com/example-org/website",
        id: 790,
        private: true,
        selected: true,
      },
    ],
    status: "connected",
    statusLabel: "Connected",
    statusReason: null,
  };

  function pickerFetch(options: {
    projects?: unknown;
    projectsStatus?: number;
    connections?: unknown[];
    onProjectRepository?: (input: string, init?: RequestInit) => Response | Promise<Response>;
  } = {}) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/organizations") return organizationResponse();
      if (url === "/api/github/connections") {
        return jsonResponse({ connections: options.connections ?? [pickerConnection] });
      }
      if (url === "/api/github/install/start") return jsonResponse({ apps: [] });
      if (url === "/api/projects") {
        if (options.projectsStatus) {
          return jsonResponse({ error: { message: "Projects could not be loaded." } }, options.projectsStatus);
        }
        return jsonResponse({ projects: options.projects ?? [] });
      }
      if (url.startsWith("/api/projects/") && url.endsWith("/repository") && options.onProjectRepository) {
        return options.onProjectRepository(url, init);
      }
      return jsonResponse({});
    });
  }

  const linkedProject = {
    connectionId: pickerConnection.id,
    githubRepository: "example-org/application",
    githubRepositoryId: 789,
    id: "88888888-8888-4888-8888-888888888888",
    name: "Application",
  };

  const unlinkedProject = {
    connectionId: null,
    githubRepository: null,
    githubRepositoryId: null,
    id: "99999999-9999-4999-8999-999999999999",
    name: "Website",
  };

  it("shows each project's linked repository and links a chosen repository", async () => {
    const repositoryCalls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = pickerFetch({
      projects: [linkedProject, unlinkedProject],
      onProjectRepository: (url, init) => {
        repositoryCalls.push({ url, init });
        return jsonResponse({ project: { githubRepository: "example-org/website" } });
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<ConnectionsConsole />);

    expect(await screen.findByText("Linked to example-org/application")).toBeInTheDocument();
    expect(screen.getByText("No repository linked")).toBeInTheDocument();

    const select = screen.getByLabelText("Repository for Website");
    await user.selectOptions(select, `${pickerConnection.id}:790`);
    await user.click(screen.getByRole("button", { name: "Link repository" }));

    await waitFor(() => expect(repositoryCalls).toHaveLength(1));
    expect(repositoryCalls[0].url).toBe(`/api/projects/${unlinkedProject.id}/repository`);
    expect(repositoryCalls[0].init?.method).toBe("PUT");
    expect(JSON.parse(String(repositoryCalls[0].init?.body))).toEqual({
      connectionId: pickerConnection.id,
      repositoryId: 790,
    });
    expect(await screen.findByText("Website is now connected to example-org/website.")).toBeInTheDocument();
  });

  it("unlinks a project's repository after confirmation", async () => {
    const repositoryCalls: Array<{ url: string; init?: RequestInit }> = [];
    const fetchMock = pickerFetch({
      projects: [linkedProject],
      onProjectRepository: (url, init) => {
        repositoryCalls.push({ url, init });
        return jsonResponse({ project: { githubRepository: null } });
      },
    });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const user = userEvent.setup();

    render(<ConnectionsConsole />);

    await user.click(await screen.findByRole("button", { name: "Unlink" }));

    await waitFor(() => expect(repositoryCalls).toHaveLength(1));
    expect(repositoryCalls[0].url).toBe(`/api/projects/${linkedProject.id}/repository`);
    expect(repositoryCalls[0].init?.method).toBe("DELETE");
    expect(await screen.findByText("Application is no longer linked to a GitHub repository.")).toBeInTheDocument();
  });

  it("surfaces the server's uniqueness refusal instead of pretending success", async () => {
    const fetchMock = pickerFetch({
      projects: [unlinkedProject],
      onProjectRepository: () => jsonResponse(
        { error: { message: 'that repository is already linked to project "Application"' } },
        409,
      ),
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    render(<ConnectionsConsole />);

    const select = await screen.findByLabelText("Repository for Website");
    await user.selectOptions(select, `${pickerConnection.id}:789`);
    await user.click(screen.getByRole("button", { name: "Link repository" }));

    expect(
      await screen.findByText('that repository is already linked to project "Application"'),
    ).toBeInTheDocument();
    expect(screen.getByText("No repository linked")).toBeInTheDocument();
  });

  it("renders a projects error state rather than an empty list when the read fails", async () => {
    vi.stubGlobal("fetch", pickerFetch({ projectsStatus: 500 }));

    render(<ConnectionsConsole />);

    expect(
      await screen.findByText(/Projects could not be loaded, so repository links cannot be shown/),
    ).toBeInTheDocument();
  });

  it("points at the install flow when no GitHub App installation exists", async () => {
    vi.stubGlobal("fetch", pickerFetch({
      connections: [],
      projects: [unlinkedProject],
    }));

    render(<ConnectionsConsole />);

    expect(
      await screen.findByText(/No GitHub App installation is connected/),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Install the GitHub App" })).toBeInTheDocument();
  });

  it("says so when the installation can reach zero repositories", async () => {
    vi.stubGlobal("fetch", pickerFetch({
      connections: [{ ...pickerConnection, repositories: [] }],
      projects: [unlinkedProject],
    }));

    render(<ConnectionsConsole />);

    expect(
      await screen.findByText(/connected but can reach no selected repositories/),
    ).toBeInTheDocument();
  });
});
