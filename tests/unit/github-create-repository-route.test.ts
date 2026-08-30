// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  createGitHubInstallationToken,
  fetchGitHubInstallationSnapshot,
  getGitHubAppConfigurationForAppId,
  githubApiRequest,
  persistGitHubInstallationSnapshot,
  requireGitHubConnection,
  requireGitHubUser,
  requireOrganizationManager,
} = vi.hoisted(() => ({
  createGitHubInstallationToken: vi.fn(),
  fetchGitHubInstallationSnapshot: vi.fn(),
  getGitHubAppConfigurationForAppId: vi.fn(),
  githubApiRequest: vi.fn(),
  persistGitHubInstallationSnapshot: vi.fn(),
  requireGitHubConnection: vi.fn(),
  requireGitHubUser: vi.fn(),
  requireOrganizationManager: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/github/access", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/github/access")>()),
  requireGitHubConnection,
  requireGitHubUser,
  requireOrganizationManager,
}));
vi.mock("@/lib/github/config", () => ({ getGitHubAppConfigurationForAppId }));
vi.mock("@/lib/github/sync", () => ({ persistGitHubInstallationSnapshot }));
vi.mock("@/lib/github/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/github/client")>()),
  createGitHubInstallationToken,
  fetchGitHubInstallationSnapshot,
  githubApiRequest,
}));

import { GitHubAuthorizationError } from "@/lib/github/access";
import { GitHubApiError } from "@/lib/github/client";
import { POST } from "@/app/api/github/repositories/create/route";

/**
 * The one GitHub route that makes something exist.
 *
 * Everything else in this surface reads what is already there, so the things
 * worth holding here are the ones that follow from writing: the owner comes
 * from the installation rather than the caller, only a manager may press it,
 * a personal account is refused with the reason instead of a button that
 * cannot work, and a repository that was created but is not yet visible to
 * the installation says exactly that rather than reporting plain success.
 */

const organizationId = "11111111-1111-4111-8111-111111111111";
const connectionId = "33333333-3333-4333-8333-333333333333";
const userId = "44444444-4444-4444-8444-444444444444";

let installationRow: { account_login: string; account_type: string } | null;

function supabaseStub() {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: installationRow, error: null }),
        }),
      }),
    }),
  };
}

function request(body: unknown, origin: string | null = "https://factory.example") {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (origin) headers.set("Origin", origin);
  return new Request("https://factory.example/api/github/repositories/create", {
    body: JSON.stringify(body),
    headers,
    method: "POST",
  });
}

const validBody = { connectionId, name: "storefront", visibility: "private" as const };

beforeEach(() => {
  vi.clearAllMocks();
  installationRow = { account_login: "acme-co", account_type: "Organization" };
  requireGitHubUser.mockResolvedValue({
    activeOrganization: { id: organizationId },
    supabase: supabaseStub(),
    user: { id: userId },
  });
  requireGitHubConnection.mockResolvedValue({
    appId: "123",
    connectionId,
    installationId: 987,
    internalInstallationId: "internal-1",
    organizationId,
    repository: null,
    role: "owner",
    status: "active",
    userId,
  });
  requireOrganizationManager.mockResolvedValue(undefined);
  getGitHubAppConfigurationForAppId.mockReturnValue({ appId: "123", privateKey: "key" });
  createGitHubInstallationToken.mockResolvedValue({ token: "ghs_installation" });
  githubApiRequest.mockResolvedValue({
    id: 55,
    name: "storefront",
    full_name: "acme-co/storefront",
    html_url: "https://github.com/acme-co/storefront",
    default_branch: "main",
    private: true,
  });
  fetchGitHubInstallationSnapshot.mockResolvedValue({
    repositories: [{ fullName: "acme-co/storefront" }],
  });
  persistGitHubInstallationSnapshot.mockResolvedValue({});
});

describe("POST /api/github/repositories/create", () => {
  it("creates the repository under the installation's own account", async () => {
    const response = await POST(request(validBody));
    expect(response.status).toBe(200);

    const [path, options] = githubApiRequest.mock.calls[0] as [string, Record<string, unknown>];
    expect(path).toBe("/orgs/acme-co/repos");
    expect(options.method).toBe("POST");
    expect(options.body).toMatchObject({ name: "storefront", private: true, auto_init: true });

    const body = (await response.json()) as { repository: { fullName: string }; selected: boolean };
    expect(body.repository.fullName).toBe("acme-co/storefront");
    expect(body.selected).toBe(true);
  });

  /*
   * The owner is not a request field at all. If it ever becomes one, this
   * fails — a caller must not be able to aim repository creation at an
   * organization the connection does not cover.
   */
  it("ignores any owner the caller tries to supply", async () => {
    const response = await POST(request({ ...validBody, owner: "someone-else" }));
    expect(response.status).toBe(400);
    expect(githubApiRequest).not.toHaveBeenCalled();
  });

  it("asks for only the permission it needs", async () => {
    await POST(request(validBody));
    const [, , scope] = createGitHubInstallationToken.mock.calls[0] as [
      unknown, unknown, { permissions: Record<string, string> },
    ];
    expect(scope.permissions).toEqual({ administration: "write" });
  });

  it("makes a repository private unless public is asked for", async () => {
    await POST(request({ connectionId, name: "storefront" }));
    const [, options] = githubApiRequest.mock.calls[0] as [string, { body: { private: boolean } }];
    expect(options.body.private).toBe(true);

    githubApiRequest.mockClear();
    await POST(request({ ...validBody, visibility: "public" }));
    const [, publicOptions] = githubApiRequest.mock.calls[0] as [string, { body: { private: boolean } }];
    expect(publicOptions.body.private).toBe(false);
  });

  it("refuses a personal account with the reason and the manual step", async () => {
    installationRow = { account_login: "a-person", account_type: "User" };
    const response = await POST(request(validBody));
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("github_personal_account_cannot_create");
    expect(body.error.message).toContain("github.com/new");
    expect(githubApiRequest).not.toHaveBeenCalled();
  });

  /*
   * The likeliest real failure, and it happens before the create call: GitHub
   * will not mint a token carrying a permission the App was never granted, and
   * refuses with a 422 that says nothing actionable.
   */
  it("names the missing permission when the token itself cannot be minted", async () => {
    createGitHubInstallationToken.mockRejectedValue(
      new GitHubApiError(422, "github_unprocessable", "Unprocessable Entity"),
    );
    const response = await POST(request(validBody));
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("github_administration_permission_missing");
    expect(body.error.message).toContain("acme-co");
    expect(githubApiRequest).not.toHaveBeenCalled();
  });

  it("says the app lacks permission rather than reporting a bare failure", async () => {
    githubApiRequest.mockRejectedValue(new GitHubApiError(403, "github_forbidden", "Forbidden"));
    const response = await POST(request(validBody));
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("github_administration_permission_missing");
    expect(body.error.message).toContain("Administration");
  });

  it("names an existing repository as taken and creates nothing", async () => {
    githubApiRequest.mockRejectedValue(new GitHubApiError(422, "github_unprocessable", "exists"));
    const response = await POST(request(validBody));
    expect(response.status).toBe(409);
    const body = (await response.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("github_repository_name_taken");
    expect(body.error.message).toContain("acme-co/storefront");
  });

  /*
   * The dishonest case this exists to prevent: an installation limited to
   * selected repositories does not gain the new one, so reporting plain
   * success would tell someone the factory can use a repository it cannot see.
   */
  it("says so when the repository exists but the installation cannot see it", async () => {
    fetchGitHubInstallationSnapshot.mockResolvedValue({ repositories: [] });
    const response = await POST(request(validBody));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { selected: boolean; message: string };
    expect(body.selected).toBe(false);
    expect(body.message).toContain("does not include it yet");
  });

  it("still reports the repository when reading it back fails", async () => {
    fetchGitHubInstallationSnapshot.mockRejectedValue(new Error("snapshot down"));
    const response = await POST(request(validBody));
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      syncFailed: boolean; selected: boolean; repository: { fullName: string };
    };
    expect(body.syncFailed).toBe(true);
    expect(body.selected).toBe(false);
    expect(body.repository.fullName).toBe("acme-co/storefront");
  });

  it("requires an organization manager", async () => {
    requireOrganizationManager.mockRejectedValue(
      new GitHubAuthorizationError(403, "forbidden", "Only a manager may do this."),
    );
    const response = await POST(request(validBody));
    expect(response.status).toBe(403);
    expect(githubApiRequest).not.toHaveBeenCalled();
  });

  it("refuses a request from another origin", async () => {
    const response = await POST(request(validBody, "https://attacker.example"));
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(githubApiRequest).not.toHaveBeenCalled();
  });

  it("refuses names GitHub would reject, before calling GitHub", async () => {
    for (const name of ["-leading", "has space", "..", "a".repeat(101), "sla/sh"]) {
      const response = await POST(request({ connectionId, name }));
      expect(response.status, name).toBe(400);
    }
    expect(githubApiRequest).not.toHaveBeenCalled();
  });
});
