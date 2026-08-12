// @vitest-environment node

import { createHmac, generateKeyPairSync } from "node:crypto";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createGitHubInstallState,
  GitHubStateError,
  normalizeReturnTo,
  verifyGitHubInstallState,
} from "@/lib/github/state";
import {
  createGitHubBranch,
  createGitHubDraftPullRequest,
  isProtectedGitHubWritePath,
  normalizeRepositoryPath,
  updateGitHubFileOnBranch,
  validateGitHubRef,
} from "@/lib/github/repository";
import {
  createGitHubInstallationToken,
  GitHubApiError,
  githubApiRequest,
} from "@/lib/github/client";
import { sha256Hex, verifyGitHubWebhookSignature } from "@/lib/github/webhook";

const stateSecret = "s".repeat(48);
const now = Date.UTC(2026, 7, 12, 12, 0, 0);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("GitHub installation state", () => {
  it("round-trips a signed, session-bound, time-limited state", () => {
    const created = createGitHubInstallState(
      {
        organizationId: "11111111-1111-4111-8111-111111111111",
        returnTo: "/connections?source=github",
        userId: "22222222-2222-4222-8222-222222222222",
      },
      stateSecret,
      now,
    );

    expect(verifyGitHubInstallState(
      created.token,
      created.nonce,
      "22222222-2222-4222-8222-222222222222",
      stateSecret,
      now + 60_000,
    )).toMatchObject({
      organizationId: "11111111-1111-4111-8111-111111111111",
      returnTo: "/connections?source=github",
      userId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("rejects tampering, replay from another session, and expiration", () => {
    const created = createGitHubInstallState(
      {
        organizationId: "11111111-1111-4111-8111-111111111111",
        returnTo: "/connections",
        userId: "22222222-2222-4222-8222-222222222222",
      },
      stateSecret,
      now,
    );

    expect(() => verifyGitHubInstallState(
      `${created.token.slice(0, -1)}x`,
      created.nonce,
      "22222222-2222-4222-8222-222222222222",
      stateSecret,
      now,
    )).toThrow(GitHubStateError);
    expect(() => verifyGitHubInstallState(
      created.token,
      "another-browser-session-nonce-which-is-long-enough",
      "22222222-2222-4222-8222-222222222222",
      stateSecret,
      now,
    )).toThrow(/does not match this session/);
    expect(() => verifyGitHubInstallState(
      created.token,
      created.nonce,
      "22222222-2222-4222-8222-222222222222",
      stateSecret,
      now + 11 * 60_000,
    )).toThrow(/expired/);
  });

  it("allows only local, explicitly supported return paths", () => {
    expect(normalizeReturnTo("/projects?github=1")).toBe("/projects?github=1");
    expect(() => normalizeReturnTo("https://evil.example/steal")).toThrow();
    expect(() => normalizeReturnTo("//evil.example/steal")).toThrow();
    expect(() => normalizeReturnTo("/settings")).toThrow();
  });
});

describe("GitHub webhook signatures", () => {
  it("accepts only the exact HMAC-SHA256 signature over raw bytes", () => {
    const payload = new TextEncoder().encode('{"action":"created","unicode":"✓"}');
    const secret = "webhook-secret-at-least-thirty-two-bytes";
    const signature = `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;

    expect(verifyGitHubWebhookSignature(payload, signature, secret)).toBe(true);
    expect(verifyGitHubWebhookSignature(payload, signature.replace(/.$/, "0"), secret)).toBe(false);
    expect(verifyGitHubWebhookSignature(payload, null, secret)).toBe(false);
    expect(sha256Hex(payload)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("GitHub repository write safety", () => {
  it("rejects traversal, dangerous refs, and protected resources", () => {
    expect(normalizeRepositoryPath("AI/BACKLOG.md")).toBe("AI/BACKLOG.md");
    expect(() => normalizeRepositoryPath("../.env")).toThrow();
    expect(() => validateGitHubRef("main..stolen")).toThrow();
    expect(isProtectedGitHubWritePath(".github/workflows/ci.yml")).toBe(true);
    expect(isProtectedGitHubWritePath("supabase/migrations/20260812000400.sql")).toBe(true);
    expect(isProtectedGitHubWritePath("supabase/config.toml")).toBe(true);
    expect(isProtectedGitHubWritePath("policies/AUTO_MERGE_POLICY.md")).toBe(true);
    expect(isProtectedGitHubWritePath("AI/BACKLOG.md")).toBe(true);
    expect(isProtectedGitHubWritePath("AI/DECISIONS.md")).toBe(true);
    expect(isProtectedGitHubWritePath("lib/supabase/auth.ts")).toBe(true);
    expect(isProtectedGitHubWritePath("lib/supabase/tenant.ts")).toBe(true);
    expect(isProtectedGitHubWritePath("lib/github/config.ts")).toBe(true);
    expect(isProtectedGitHubWritePath("app/api/projects/route.ts")).toBe(true);
    expect(isProtectedGitHubWritePath("proxy.ts")).toBe(true);
    expect(isProtectedGitHubWritePath("vercel.json")).toBe(true);
    expect(isProtectedGitHubWritePath("README.md")).toBe(false);
  });

  it("creates an isolated branch, updates only that branch, and requests a draft PR", async () => {
    const calls: Array<{ body: Record<string, unknown>; method: string; url: string }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      const body = init?.body ? JSON.parse(String(init.body)) as Record<string, unknown> : {};
      calls.push({ body, method: String(init?.method), url });
      if (url.endsWith("/git/refs")) {
        return Response.json({ ref: body.ref, object: { sha: body.sha } }, { status: 201 });
      }
      if (url.includes("/contents/AI/BACKLOG.md")) {
        return Response.json({
          content: { html_url: "https://github.com/acme/factory/blob/softwarefactory/change/AI/BACKLOG.md" },
          commit: {
            html_url: "https://github.com/acme/factory/commit/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            sha: "a".repeat(40),
          },
        });
      }
      return Response.json({
        draft: true,
        html_url: "https://github.com/acme/factory/pull/42",
        id: 99,
        number: 42,
        state: "open",
        title: "Update backlog",
      }, { status: 201 });
    }));

    await createGitHubBranch("token-not-logged", "acme", "factory", "softwarefactory/change", "b".repeat(40));
    await updateGitHubFileOnBranch("token-not-logged", {
      branch: "softwarefactory/change",
      content: "# Updated",
      expectedBlobSha: "c".repeat(40),
      message: "docs: update backlog",
      owner: "acme",
      path: "AI/BACKLOG.md",
      repository: "factory",
    });
    await createGitHubDraftPullRequest("token-not-logged", {
      baseBranch: "main",
      body: "Owner-initiated change",
      headBranch: "softwarefactory/change",
      owner: "acme",
      repository: "factory",
      title: "Update backlog",
    });

    expect(calls[0].body).toEqual({ ref: "refs/heads/softwarefactory/change", sha: "b".repeat(40) });
    expect(calls[1].body).toMatchObject({ branch: "softwarefactory/change", sha: "c".repeat(40) });
    expect(calls[2].body).toMatchObject({ base: "main", draft: true, head: "softwarefactory/change" });
    expect(calls.every((call) => call.body.force !== true)).toBe(true);
  });

  it("surfaces stale file SHAs without retrying or writing the default branch", async () => {
    const fetchMock = vi.fn(async (
      _input: string | URL | Request,
      _init?: RequestInit,
    ) => {
      void _input;
      void _init;
      return Response.json(
        { message: "sha does not match" },
        { status: 422 },
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(updateGitHubFileOnBranch("token-not-logged", {
      branch: "softwarefactory/change",
      content: "# Updated",
      expectedBlobSha: "c".repeat(40),
      message: "docs: update backlog",
      owner: "acme",
      path: "AI/BACKLOG.md",
      repository: "factory",
    })).rejects.toMatchObject({ code: "github_request_failed", status: 409 });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body).toMatchObject({ branch: "softwarefactory/change", sha: "c".repeat(40) });
    expect(body).not.toHaveProperty("force");
  });

  it("fails closed when GitHub cannot create the required draft PR", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(
      { message: "Validation Failed" },
      { status: 422 },
    )));

    await expect(createGitHubDraftPullRequest("token-not-logged", {
      baseBranch: "main",
      body: "Owner-initiated change",
      headBranch: "softwarefactory/change",
      owner: "acme",
      repository: "factory",
      title: "Update backlog",
    })).rejects.toMatchObject({ code: "github_request_failed", status: 409 });
  });
});

describe("GitHub provider boundaries", () => {
  it("requests a repository-scoped installation token with explicit permissions", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      expect(body).toEqual({
        permissions: { contents: "write", pull_requests: "write" },
        repository_ids: [12345],
      });
      return Response.json({
        expires_at: "2026-08-12T13:00:00Z",
        token: "installation-token-placeholder-value",
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const token = await createGitHubInstallationToken(
      { appId: 987, privateKey: privateKey.export({ format: "pem", type: "pkcs8" }).toString() },
      456,
      {
        permissions: { contents: "write", pull_requests: "write" },
        repositoryIds: [12345],
      },
    );

    expect(token).toEqual({
      expiresAt: "2026-08-12T13:00:00Z",
      token: "installation-token-placeholder-value",
    });
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/app/installations/456/access_tokens");
    expect(JSON.stringify((fetchMock.mock.calls[0]?.[1] as RequestInit).headers))
      .not.toContain("installation-token-placeholder-value");
  });

  it("maps rate limits and revoked credentials to stable, non-secret errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(
      { message: "provider detail must not be forwarded" },
      {
        headers: {
          "x-ratelimit-remaining": "0",
          "x-ratelimit-reset": "1786543200",
        },
        status: 403,
      },
    )));

    await expect(githubApiRequest("/installation/repositories", { token: "secret-token" }))
      .rejects.toMatchObject({ code: "github_rate_limited", status: 429 });

    vi.stubGlobal("fetch", vi.fn(async () => Response.json(
      { message: "Bad credentials: secret-token" },
      { status: 401 },
    )));
    let caught: unknown;
    try {
      await githubApiRequest("/installation/repositories", { token: "secret-token" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GitHubApiError);
    expect(caught).toMatchObject({ code: "github_installation_revoked", status: 503 });
    expect(String((caught as Error).message)).not.toContain("secret-token");
    expect(String((caught as Error).message)).not.toContain("Bad credentials");
  });
});
