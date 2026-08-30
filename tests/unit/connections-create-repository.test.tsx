import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConnectionsConsole } from "@/components/connections-console";

/**
 * The Create New GitHub control.
 *
 * The design pairs it with Connect Existing GitHub, and the pairing carries a
 * constraint worth testing rather than commenting: a repository is created
 * *inside* an installed account, and GitHub offers no way to create one inside
 * a personal account from an installed app. So the control appears where it
 * can work, explains itself where it cannot, and — when the repository is made
 * but the installation cannot yet see it — says that instead of "done".
 */

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

const connectionId = "22222222-2222-4222-8222-222222222222";

function connection(accountType: "Organization" | "User") {
  return {
    account: { login: accountType === "Organization" ? "example-org" : "a-person", type: accountType },
    id: connectionId,
    installation: {
      id: 456,
      lastSyncedAt: "2026-08-29T20:00:00.000Z",
      repositorySelection: "selected",
      suspendedAt: null,
    },
    name: accountType === "Organization" ? "example-org" : "a-person",
    repositories: [],
    status: "connected",
    statusLabel: "Connected",
    statusReason: null,
  };
}

const realLocation = window.location;
function stubNavigation() {
  const assign = vi.fn();
  const standIn = {
    assign,
    href: realLocation.href,
    origin: realLocation.origin,
    pathname: realLocation.pathname,
    search: "",
  } as unknown as Location;
  delete (window as { location?: Location }).location;
  (window as { location: Location }).location = standIn;
  return assign;
}

/** Records every request, and answers the create call with `createResponse`. */
function stubFetch(accountType: "Organization" | "User", createResponse?: Response) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url === "/api/organizations") {
      return jsonResponse({ activeOrganizationId: organization.id, organizations: [organization] });
    }
    if (url === "/api/github/repositories/create") {
      return createResponse ?? jsonResponse({
        repository: { fullName: "example-org/storefront", private: true },
        selected: true,
        syncFailed: false,
        message: "example-org/storefront was created and is available to this factory.",
      });
    }
    return jsonResponse({ connections: [connection(accountType)] });
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete (window as { location?: Location }).location;
  (window as { location: Location }).location = realLocation;
});

describe("Create New GitHub", () => {
  it("offers both choices before anything is connected", async () => {
    stubNavigation();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/organizations") {
        return jsonResponse({ activeOrganizationId: organization.id, organizations: [organization] });
      }
      return jsonResponse({ connections: [] });
    }));

    render(<ConnectionsConsole />);

    expect(await screen.findByRole("button", { name: /Connect Existing GitHub/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create New GitHub/ })).toBeInTheDocument();
  });

  /*
   * There is nothing to create into until the app is installed somewhere, so
   * the empty-state button authorizes first and says why rather than opening a
   * form that cannot submit.
   */
  it("sends an unconnected owner to authorize, and says why", async () => {
    const assign = stubNavigation();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/organizations") {
        return jsonResponse({ activeOrganizationId: organization.id, organizations: [organization] });
      }
      return jsonResponse({ connections: [] });
    }));

    render(<ConnectionsConsole />);
    await userEvent.click(await screen.findByRole("button", { name: /Create New GitHub/ }));

    expect(screen.getByText(/Authorize GitHub first/)).toBeInTheDocument();
    expect(assign).toHaveBeenCalledWith(expect.stringContaining("/api/github/install/launch"));
  });

  it("creates a private repository by default, under the connected organization", async () => {
    stubNavigation();
    const calls = stubFetch("Organization");

    render(<ConnectionsConsole />);
    await userEvent.click(await screen.findByRole("button", { name: /Create New GitHub/ }));
    await userEvent.type(screen.getByLabelText("Repository name"), "storefront");
    await userEvent.click(screen.getByRole("button", { name: /Create repository/ }));

    await waitFor(() => {
      expect(calls.some((call) => call.url === "/api/github/repositories/create")).toBe(true);
    });
    const create = calls.find((call) => call.url === "/api/github/repositories/create")!;
    expect(JSON.parse(String(create.init!.body))).toEqual({
      connectionId,
      name: "storefront",
      description: undefined,
      visibility: "private",
    });
  });

  it("sends public only when public is chosen", async () => {
    stubNavigation();
    const calls = stubFetch("Organization");

    render(<ConnectionsConsole />);
    await userEvent.click(await screen.findByRole("button", { name: /Create New GitHub/ }));
    await userEvent.type(screen.getByLabelText("Repository name"), "storefront");
    await userEvent.click(screen.getByRole("radio", { name: /public/i }));
    await userEvent.click(screen.getByRole("button", { name: /Create repository/ }));

    await waitFor(() => {
      const create = calls.find((call) => call.url === "/api/github/repositories/create");
      expect(create).toBeDefined();
      expect(JSON.parse(String(create!.init!.body)).visibility).toBe("public");
    });
  });

  it("repeats the server's word about a repository it cannot yet see", async () => {
    stubNavigation();
    stubFetch("Organization", jsonResponse({
      repository: { fullName: "example-org/storefront", private: true },
      selected: false,
      syncFailed: false,
      message: "example-org/storefront was created, but this installation is limited to selected repositories and does not include it yet. Add it on GitHub, then press Refresh.",
    }));

    render(<ConnectionsConsole />);
    await userEvent.click(await screen.findByRole("button", { name: /Create New GitHub/ }));
    await userEvent.type(screen.getByLabelText("Repository name"), "storefront");
    await userEvent.click(screen.getByRole("button", { name: /Create repository/ }));

    expect(await screen.findByText(/does not include it yet/)).toBeInTheDocument();
  });

  it("shows the server's refusal rather than a generic failure", async () => {
    stubNavigation();
    stubFetch("Organization", jsonResponse({
      error: { code: "github_repository_name_taken", message: "example-org/storefront already exists on GitHub, so nothing was created." },
    }, 409));

    render(<ConnectionsConsole />);
    await userEvent.click(await screen.findByRole("button", { name: /Create New GitHub/ }));
    await userEvent.type(screen.getByLabelText("Repository name"), "storefront");
    await userEvent.click(screen.getByRole("button", { name: /Create repository/ }));

    expect(await screen.findByText(/already exists on GitHub/)).toBeInTheDocument();
  });

  /*
   * The button is absent, not disabled — GitHub genuinely cannot do this for a
   * personal account, so the surface explains the manual route instead.
   */
  it("does not offer creation on a personal account, and says where to go", async () => {
    stubNavigation();
    stubFetch("User");

    render(<ConnectionsConsole />);

    expect(await screen.findByText(/GitHub does not let an installed app create one in a personal account/))
      .toBeInTheDocument();
    expect(screen.getByRole("link", { name: "github.com/new" })).toHaveAttribute(
      "href",
      "https://github.com/new",
    );
    expect(screen.queryByRole("button", { name: /Create New GitHub/ })).not.toBeInTheDocument();
  });

  it("cannot submit an empty name", async () => {
    stubNavigation();
    stubFetch("Organization");

    render(<ConnectionsConsole />);
    await userEvent.click(await screen.findByRole("button", { name: /Create New GitHub/ }));

    expect(screen.getByRole("button", { name: /Create repository/ })).toBeDisabled();
  });
});
