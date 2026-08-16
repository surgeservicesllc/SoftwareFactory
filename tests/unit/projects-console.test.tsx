import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProjectsConsole } from "@/components/projects-console";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

const connectionId = "22222222-2222-4222-8222-222222222222";
const branchSha = "0123456789abcdef0123456789abcdef01234567";

function projectsResponse() {
  return jsonResponse({
    projects: [{
      autonomousMode: false,
      connectionId,
      connectionStatus: "connected",
      defaultBranch: "main",
      description: "GitHub-backed application",
      githubRepository: "example-org/application",
      githubRepositoryId: 789,
      healthStatus: "unknown",
      id: "11111111-1111-4111-8111-111111111111",
      maximumAutonomousRisk: "GREEN",
      name: "Application",
      status: "active",
    }],
  });
}

function connectionsResponse(options: { lastSyncedAt?: string | null; private?: boolean } = {}) {
  return jsonResponse({
    connections: [{
      account: { login: "example-org", type: "Organization" },
      id: connectionId,
      installation: {
        id: 456,
        lastSyncedAt: options.lastSyncedAt === undefined ? "2026-08-12T20:00:00.000Z" : options.lastSyncedAt,
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
        lastSyncedAt: "2026-08-12T19:00:00.000Z",
        private: options.private ?? true,
        selected: true,
      }],
      status: "connected",
      statusLabel: "Connected",
    }],
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProjectsConsole GitHub evidence", () => {
  it("renders repository sync, branch, pull request, and check details supplied by GitHub", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/projects") return projectsResponse();
      if (url === "/api/github/connections") return connectionsResponse();
      if (url.includes("/branches?")) {
        return jsonResponse({ branches: [
          { name: "main", protected: true, sha: branchSha },
          { name: "feature", protected: false, sha: "fedcba9876543210fedcba9876543210fedcba98" },
        ] });
      }
      if (url.includes("/commits?")) {
        return jsonResponse({ commits: [{
          author: { githubLogin: "surgeservicesllc", name: "Surge Services" },
          date: "2026-08-12T20:15:00.000Z",
          message: "Ship production evidence",
          sha: "abcdef1234567890abcdef1234567890abcdef12",
          url: "https://github.com/example-org/application/commit/abcdef1",
        }] });
      }
      if (url.includes("/pulls?")) {
        return jsonResponse({ pullRequests: [{
          author: { avatarUrl: null, login: "octocat" },
          baseBranch: "main",
          createdAt: "2026-08-12T20:00:00.000Z",
          draft: false,
          headBranch: "feature",
          headSha: "fedcba9876543210fedcba9876543210fedcba98",
          id: 12,
          mergeability: "mergeable",
          number: 12,
          state: "open",
          title: "Add evidence",
          updatedAt: "2026-08-12T20:30:00.000Z",
          url: "https://github.com/example-org/application/pull/12",
        }] });
      }
      if (url.includes("/checks?")) {
        return jsonResponse({ checkRuns: [{
          completedAt: "2026-08-12T20:35:00.000Z",
          conclusion: "success",
          id: 99,
          name: "Phase 1B CI",
          startedAt: "2026-08-12T20:31:00.000Z",
          status: "completed",
          url: "https://github.com/example-org/application/actions/runs/99",
        }] });
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<ProjectsConsole />);

    expect(await screen.findByText("Private")).toBeInTheDocument();
    expect(screen.getByText("Last synchronized").parentElement).not.toHaveTextContent("Never");
    expect(await screen.findByText("Protected")).toBeInTheDocument();
    expect(screen.getByText("Unprotected")).toBeInTheDocument();
    expect(screen.getByLabelText(`Latest SHA ${branchSha}`)).toHaveTextContent("0123456");
    expect(screen.getByText("Author: octocat · Mergeability: Mergeable")).toBeInTheDocument();
    expect(screen.getByText(/Created .* · Updated /)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(`ref=${encodeURIComponent("fedcba9876543210fedcba9876543210fedcba98")}`),
      { cache: "no-store" },
    );

    const checks = screen.getAllByText("Phase 1B CI");
    expect(checks).toHaveLength(2);
    const defaultBranchCheck = checks.find((element) => element.closest("li")?.textContent?.includes("Status:"));
    expect(defaultBranchCheck).toBeDefined();
    expect(within(defaultBranchCheck!.closest("li") as HTMLElement).getByText("Status: completed · Conclusion: success")).toBeInTheDocument();
    expect(screen.getByLabelText("Pull request checks")).toHaveTextContent("completed / success");
  });

  it("labels missing optional pull-request and check conclusions without inventing provider state", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/projects") return projectsResponse();
      if (url === "/api/github/connections") return connectionsResponse({ lastSyncedAt: null, private: false });
      if (url.includes("/branches?")) return jsonResponse({ branches: [{ name: "main", protected: true, sha: branchSha }] });
      if (url.includes("/commits?")) return jsonResponse({ commits: [] });
      if (url.includes("/pulls?")) {
        return jsonResponse({ pullRequests: [{
          author: null,
          baseBranch: "main",
          draft: true,
          headBranch: "pending",
          headSha: branchSha,
          id: 13,
          number: 13,
          state: "open",
          title: "Pending provider response",
          updatedAt: "2026-08-12T20:30:00.000Z",
          url: "https://github.com/example-org/application/pull/13",
        }] });
      }
      if (url.includes("/checks?")) {
        return jsonResponse({ checkRuns: [{
          completedAt: null,
          conclusion: null,
          id: 100,
          name: "Queued CI",
          startedAt: null,
          status: "queued",
          url: null,
        }] });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    render(<ProjectsConsole />);

    expect(await screen.findByText("Public")).toBeInTheDocument();
    expect(await screen.findByText("Author: Unknown · Mergeability: Unknown")).toBeInTheDocument();
    expect(screen.getByText("Status: queued · Conclusion: —")).toBeInTheDocument();
  });
});

describe("ProjectsConsole add-project form", () => {
  function connection(id: string, login: string, repositoryId: number) {
    return {
      account: { login, type: "Organization" },
      id,
      installation: { id: 456, lastSyncedAt: "2026-08-12T20:00:00.000Z", suspendedAt: null },
      name: login,
      repositories: [{
        archived: false,
        defaultBranch: "main",
        disabled: false,
        fullName: `${login}/application`,
        htmlUrl: `https://github.com/${login}/application`,
        id: repositoryId,
        private: true,
        selected: true,
      }],
      status: "connected",
      statusLabel: "Connected",
    };
  }

  it("does not show an account picker when only one account is connected", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/projects") return jsonResponse({ projects: [] });
      if (url === "/api/github/connections") {
        return jsonResponse({ connections: [connection(connectionId, "example-org", 789)] });
      }
      return jsonResponse({});
    }));

    render(<ProjectsConsole />);

    // The repository choice (which already names the owner) is the only pick.
    expect(await screen.findByLabelText("Repository")).toBeInTheDocument();
    expect(screen.queryByLabelText("GitHub account")).not.toBeInTheDocument();
    // The name is pre-filled from the repository, so adding is one confirmation.
    await waitFor(() => expect(screen.getByLabelText("Name it")).toHaveValue("application"));
  });

  it("shows the account picker only once there are two accounts to choose from", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/projects") return jsonResponse({ projects: [] });
      if (url === "/api/github/connections") {
        return jsonResponse({
          connections: [
            connection(connectionId, "example-org", 789),
            connection("33333333-3333-4333-8333-333333333333", "second-org", 790),
          ],
        });
      }
      return jsonResponse({});
    }));

    render(<ProjectsConsole />);

    expect(await screen.findByLabelText("GitHub account")).toBeInTheDocument();
  });
});
