// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const harness = vi.hoisted(() => {
  const cookieValues = new Map<string, string>();
  return {
    configuration: {
      appId: 4573846,
      appSlug: "software-factory",
      callbackUrl: "https://factory.example/api/github/install/callback",
      clientId: "client-id",
      clientSecret: "client-secret",
      privateKey: "private-key",
      stateSecret: "s".repeat(48),
      webhookSecret: "w".repeat(48),
    },
    cookieValues,
    cookieDelete: vi.fn(),
    cookieSet: vi.fn(),
    exchangeCode: vi.fn(),
    fetchSnapshot: vi.fn(),
    persistSnapshot: vi.fn(),
    requireManager: vi.fn(),
    requireUser: vi.fn(),
    revokeToken: vi.fn(),
    verifyInstallation: vi.fn(),
  };
});

vi.mock("next/headers", () => ({
  cookies: async () => ({
    delete: harness.cookieDelete,
    get: (name: string) => {
      const value = harness.cookieValues.get(name);
      return value ? { name, value } : undefined;
    },
    set: harness.cookieSet,
  }),
}));

vi.mock("@/lib/github/access", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/github/access")>();
  return {
    ...original,
    requireGitHubUser: harness.requireUser,
    requireOrganizationManager: harness.requireManager,
  };
});

vi.mock("@/lib/github/client", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/github/client")>();
  return {
    ...original,
    exchangeGitHubUserCode: harness.exchangeCode,
    fetchGitHubInstallationSnapshot: harness.fetchSnapshot,
    revokeGitHubUserToken: harness.revokeToken,
    verifyUserCanAccessInstallation: harness.verifyInstallation,
  };
});

vi.mock("@/lib/github/config", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/github/config")>();
  return {
    ...original,
    getGitHubAppConfiguration: () => harness.configuration,
  };
});

vi.mock("@/lib/github/sync", () => ({
  persistGitHubInstallationSnapshot: harness.persistSnapshot,
}));

import { GET as callback } from "@/app/api/github/install/callback/route";
import { POST as start } from "@/app/api/github/install/start/route";
import { GitHubApiError } from "@/lib/github/client";
import { GITHUB_INSTALL_STATE_COOKIE } from "@/lib/github/state";

const organizationId = "11111111-1111-4111-8111-111111111111";
const userId = "22222222-2222-4222-8222-222222222222";
const connectionId = "33333333-3333-4333-8333-333333333333";
const installationId = 153286187;
const snapshot = {
  account: {
    avatarUrl: null,
    id: 9001,
    login: "example-org",
    type: "Organization" as const,
  },
  appId: harness.configuration.appId,
  appSlug: harness.configuration.appSlug,
  events: ["installation", "installation_repositories"],
  id: installationId,
  installedAt: "2026-08-12T20:00:00.000Z",
  permissions: { contents: "write", metadata: "read", pull_requests: "write" },
  repositories: [],
  repositorySelection: "selected" as const,
  suspendedAt: null,
  targetType: "Organization" as const,
};

function startRequest(returnTo = "/connections") {
  return new Request("https://factory.example/api/github/install/start", {
    body: JSON.stringify({ organizationId, returnTo }),
    headers: {
      "content-type": "application/json",
      origin: "https://factory.example",
    },
    method: "POST",
  });
}

async function beginInstallation() {
  const response = await start(startRequest());
  const body = await response.json() as { authorizationUrl: string };
  const state = new URL(body.authorizationUrl).searchParams.get("state");
  if (!state) throw new Error("Expected installation state");
  return { body, response, state };
}

function callbackRequest(
  state: string,
  options: { acceptJson?: boolean; extra?: string } = {},
) {
  const extra = options.extra ? `&${options.extra}` : "";
  return new Request(
    `https://factory.example/api/github/install/callback?code=one-time-code&installation_id=${installationId}&state=${encodeURIComponent(state)}${extra}`,
    options.acceptJson ? { headers: { accept: "application/json" } } : undefined,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.cookieValues.clear();
  harness.cookieSet.mockImplementation((name: string, value: string) => {
    harness.cookieValues.set(name, value);
  });
  harness.cookieDelete.mockImplementation((name: string) => {
    harness.cookieValues.delete(name);
  });
  harness.requireUser.mockResolvedValue({
    activeOrganization: { id: organizationId, name: "Example", role: "owner", slug: "example" },
    supabase: { tenant: "client" },
    user: { id: userId },
  });
  harness.requireManager.mockResolvedValue("owner");
  harness.exchangeCode.mockResolvedValue("ephemeral-user-token");
  harness.verifyInstallation.mockResolvedValue({ app_id: harness.configuration.appId });
  harness.fetchSnapshot.mockResolvedValue(snapshot);
  harness.persistSnapshot.mockResolvedValue({
    connection_id: connectionId,
    repository_count: 1,
    was_created: true,
  });
  harness.revokeToken.mockResolvedValue(undefined);
});

describe("GitHub App install routes", () => {
  it("starts a session-bound installation and completes the browser callback", async () => {
    const installation = await beginInstallation();

    expect(installation.response.status).toBe(200);
    expect(new URL(installation.body.authorizationUrl).pathname)
      .toBe("/apps/software-factory/installations/new");
    expect(harness.cookieSet).toHaveBeenCalledWith(
      GITHUB_INSTALL_STATE_COOKIE,
      expect.any(String),
      expect.objectContaining({ httpOnly: true, maxAge: 600, sameSite: "lax" }),
    );

    const response = await callback(callbackRequest(installation.state));
    const location = new URL(response.headers.get("location") ?? "");

    expect(response.status).toBe(303);
    expect(location.origin).toBe("https://factory.example");
    expect(location.pathname).toBe("/connections");
    expect(location.searchParams.get("github")).toBe("connected");
    expect(location.searchParams.get("connectionId")).toBe(connectionId);
    expect(location.searchParams.get("repositories")).toBe("1");
    expect(harness.persistSnapshot).toHaveBeenCalledWith(
      { tenant: "client" },
      userId,
      organizationId,
      snapshot,
    );
    expect(harness.revokeToken).toHaveBeenCalledWith(
      harness.configuration,
      "ephemeral-user-token",
    );
    expect(harness.cookieValues.has(GITHUB_INSTALL_STATE_COOKIE)).toBe(false);
  });

  it("redirects a browser cancellation to a bounded Connections notice", async () => {
    harness.cookieValues.set(GITHUB_INSTALL_STATE_COOKIE, "pending-nonce");

    const response = await callback(new Request(
      "https://factory.example/api/github/install/callback?error=access_denied&error_description=untrusted-provider-detail",
    ));
    const location = new URL(response.headers.get("location") ?? "");

    expect(response.status).toBe(303);
    expect(location.pathname).toBe("/connections");
    expect(location.searchParams.get("github")).toBe("error");
    expect(location.searchParams.get("githubError")).toBe("github_installation_cancelled");
    expect(location.searchParams.get("githubMessage"))
      .toBe("GitHub installation was cancelled or is awaiting organization approval.");
    expect(location.toString()).not.toContain("untrusted-provider-detail");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
    expect(harness.cookieValues.has(GITHUB_INSTALL_STATE_COOKIE)).toBe(false);
  });

  it("keeps cancellation as safe JSON for explicit API clients", async () => {
    const response = await callback(new Request(
      "https://factory.example/api/github/install/callback?setup_action=request",
      { headers: { accept: "application/json" } },
    ));

    expect(response.status).toBe(400);
    expect(response.headers.get("location")).toBeNull();
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "github_installation_cancelled",
        message: "GitHub installation was cancelled or is awaiting organization approval.",
      },
    });
  });

  it("redirects invalid state without calling GitHub or persistence", async () => {
    harness.cookieValues.set(GITHUB_INSTALL_STATE_COOKIE, "n".repeat(43));

    const response = await callback(callbackRequest("x".repeat(32)));
    const location = new URL(response.headers.get("location") ?? "");

    expect(response.status).toBe(303);
    expect(location.pathname).toBe("/connections");
    expect(location.searchParams.get("githubError")).toBe("github_state_invalid");
    expect(location.searchParams.get("githubMessage")).toMatch(/invalid/i);
    expect(harness.exchangeCode).not.toHaveBeenCalled();
    expect(harness.persistSnapshot).not.toHaveBeenCalled();
  });

  it("redirects provider failure safely and revokes the ephemeral user token", async () => {
    const installation = await beginInstallation();
    harness.fetchSnapshot.mockRejectedValueOnce(new GitHubApiError(
      503,
      "github_installation_revoked",
      "The GitHub App installation is no longer available.",
    ));

    const response = await callback(callbackRequest(installation.state));
    const location = new URL(response.headers.get("location") ?? "");

    expect(response.status).toBe(303);
    expect(location.pathname).toBe("/connections");
    expect(location.searchParams.get("githubError")).toBe("github_installation_revoked");
    expect(location.searchParams.get("githubMessage"))
      .toBe("The GitHub App installation is no longer available.");
    expect(harness.persistSnapshot).not.toHaveBeenCalled();
    expect(harness.revokeToken).toHaveBeenCalledWith(
      harness.configuration,
      "ephemeral-user-token",
    );
  });
});
