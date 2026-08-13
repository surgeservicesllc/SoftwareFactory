// @vitest-environment node

import { createHmac, generateKeyPairSync } from "node:crypto";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  createGitHubInstallState,
  GitHubStateError,
  normalizeReturnTo,
  readGitHubInstallStateTarget,
  verifyGitHubInstallState,
} from "@/lib/github/state";
import {
  createGitHubBranch,
  createGitHubDraftPullRequest,
  getGitHubFile,
  isProtectedGitHubWritePath,
  listGitHubTree,
  normalizeRepositoryPath,
  updateGitHubFileOnBranch,
  validateGitHubRef,
} from "@/lib/github/repository";
import {
  createGitHubInstallationToken,
  GitHubApiError,
  githubApiRequest,
  MAX_GITHUB_RESPONSE_BYTES,
  verifyUserCanAccessInstallation,
} from "@/lib/github/client";
import { sha256Hex, verifyGitHubWebhookSignature } from "@/lib/github/webhook";
import { containsLikelySecret } from "@/lib/server/sensitive-data";

const stateSecret = "s".repeat(48);
const now = Date.UTC(2026, 7, 12, 12, 0, 0);

beforeEach(() => {
  vi.stubEnv("GITHUB_COMMIT_IDENTITY_NAME", "SoftwareFactory Operator");
  vi.stubEnv("GITHUB_COMMIT_IDENTITY_EMAIL", "operator@example.com");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("GitHub installation state", () => {
  it("round-trips a signed, session-bound, time-limited state", () => {
    const created = createGitHubInstallState(
      {
        appId: 4573846,
        appSlot: "primary",
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
      appId: 4573846,
      appSlot: "primary",
      organizationId: "11111111-1111-4111-8111-111111111111",
      returnTo: "/connections?source=github",
      userId: "22222222-2222-4222-8222-222222222222",
    });
  });

  it("rejects tampering, replay from another session, and expiration", () => {
    const created = createGitHubInstallState(
      {
        appId: 4573846,
        appSlot: "primary",
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

  it("binds the configured App target into the signed state", () => {
    const created = createGitHubInstallState(
      {
        appId: 5000001,
        appSlot: "candidate",
        organizationId: "11111111-1111-4111-8111-111111111111",
        returnTo: "/connections",
        userId: "22222222-2222-4222-8222-222222222222",
      },
      stateSecret,
      now,
    );

    expect(readGitHubInstallStateTarget(created.token)).toEqual({
      appId: 5000001,
      appSlot: "candidate",
    });
    const [payload, signature] = created.token.split(".");
    const decoded = JSON.parse(Buffer.from(payload!, "base64url").toString("utf8")) as Record<string, unknown>;
    decoded.appSlot = "primary";
    const tampered = `${Buffer.from(JSON.stringify(decoded), "utf8").toString("base64url")}.${signature}`;
    expect(() => verifyGitHubInstallState(
      tampered,
      created.nonce,
      "22222222-2222-4222-8222-222222222222",
      stateSecret,
      now,
    )).toThrow(GitHubStateError);
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
  it("rejects modern GitHub fine-grained personal access tokens", () => {
    expect(containsLikelySecret(`github_pat_${"A".repeat(82)}`)).toBe(true);
  });

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
    expect(isProtectedGitHubWritePath("packages/web/AGENTS.md")).toBe(true);
    expect(isProtectedGitHubWritePath("packages/web/CLAUDE.md")).toBe(true);
    expect(isProtectedGitHubWritePath("packages/web/CODEOWNERS")).toBe(true);
    expect(isProtectedGitHubWritePath("src/auth/login.ts")).toBe(true);
    expect(isProtectedGitHubWritePath("src/authorization/check.ts")).toBe(true);
    expect(isProtectedGitHubWritePath("src/session/store.ts")).toBe(true);
    expect(isProtectedGitHubWritePath("src/crypto/aes.ts")).toBe(true);
    expect(isProtectedGitHubWritePath("src/deploy/app.ts")).toBe(true);
    expect(isProtectedGitHubWritePath("src/billing/stripe.ts")).toBe(true);
    expect(isProtectedGitHubWritePath("config/.env.production")).toBe(true);
    expect(isProtectedGitHubWritePath(".npmrc")).toBe(true);
    expect(isProtectedGitHubWritePath("services/api/Dockerfile")).toBe(true);
    expect(isProtectedGitHubWritePath("next.config.ts")).toBe(true);
    expect(isProtectedGitHubWritePath("components/safety-controls.tsx")).toBe(true);
    expect(isProtectedGitHubWritePath("lib/autonomy.ts")).toBe(true);
    expect(isProtectedGitHubWritePath("lib/risk.ts")).toBe(true);
    expect(isProtectedGitHubWritePath("lib/constants.ts")).toBe(true);
    expect(isProtectedGitHubWritePath("package.json")).toBe(true);
    expect(isProtectedGitHubWritePath("package-lock.json")).toBe(true);
    expect(isProtectedGitHubWritePath(".gitignore")).toBe(true);
    expect(isProtectedGitHubWritePath(".vercelignore")).toBe(true);
    expect(isProtectedGitHubWritePath(".dockerignore")).toBe(true);
    expect(isProtectedGitHubWritePath("playwright.config.ts")).toBe(true);
    expect(isProtectedGitHubWritePath("vitest.config.mts")).toBe(true);
    expect(isProtectedGitHubWritePath("eslint.config.mjs")).toBe(true);
    expect(isProtectedGitHubWritePath("tsconfig.json")).toBe(true);
    expect(isProtectedGitHubWritePath("tsconfig.build.json")).toBe(true);
    expect(isProtectedGitHubWritePath("src/security/guard.ts")).toBe(true);
    expect(isProtectedGitHubWritePath("packages/web/AI/BACKLOG.md")).toBe(true);
    expect(isProtectedGitHubWritePath("packages/web/policies/AUTO_MERGE_POLICY.md")).toBe(true);
    expect(isProtectedGitHubWritePath("apps/control/supabase/migrations/next.sql")).toBe(true);
    expect(isProtectedGitHubWritePath("src/app/api/projects/route.ts")).toBe(true);
    expect(isProtectedGitHubWritePath("src/authentication/password.ts")).toBe(true);
    expect(isProtectedGitHubWritePath("src/oauth/callback.ts")).toBe(true);
    expect(isProtectedGitHubWritePath("src/identity/permissions.ts")).toBe(true);
    expect(isProtectedGitHubWritePath("src/rbac/roles.ts")).toBe(true);
    expect(isProtectedGitHubWritePath("src/sessions/store.ts")).toBe(true);
    expect(isProtectedGitHubWritePath("src/encryption/keyring.ts")).toBe(true);
    expect(isProtectedGitHubWritePath("packages/web/lib/github/client.ts")).toBe(true);
    expect(isProtectedGitHubWritePath("src/middleware.ts")).toBe(true);
    expect(isProtectedGitHubWritePath("packages/web/.github/workflows/ci.yml")).toBe(true);
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
    expect(calls[1].body).toMatchObject({
      author: { email: "operator@example.com", name: "SoftwareFactory Operator" },
      branch: "softwarefactory/change",
      committer: { email: "operator@example.com", name: "SoftwareFactory Operator" },
      sha: "c".repeat(40),
    });
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

  it("does not contact GitHub when the server-owned commit identity is missing", async () => {
    vi.stubEnv("GITHUB_COMMIT_IDENTITY_EMAIL", "");
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(updateGitHubFileOnBranch("token-not-logged", {
      branch: "softwarefactory/change",
      content: "# Updated",
      expectedBlobSha: "c".repeat(40),
      message: "docs: update backlog",
      owner: "acme",
      path: "AI/BACKLOG.md",
      repository: "factory",
    })).rejects.toThrow("GITHUB_COMMIT_IDENTITY_EMAIL is not configured.");

    expect(fetchMock).not.toHaveBeenCalled();
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
  const accessibleInstallation = (id: number) => ({
    account: {
      avatar_url: null,
      id: id + 10_000,
      login: `owner-${id}`,
      type: "User",
    },
    app_id: 4573846,
    app_slug: "surge-softwarefactory",
    created_at: "2026-08-13T12:00:00Z",
    events: ["push"],
    id,
    permissions: { metadata: "read" },
    repository_selection: "selected",
    suspended_at: null,
    target_type: "User",
  });

  it("verifies user access through GitHub's documented installation-list endpoint", async () => {
    const installationId = 153286187;
    const firstPage = Array.from({ length: 100 }, (_, index) => accessibleInstallation(index + 1));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ installations: firstPage, total_count: 101 }))
      .mockResolvedValueOnce(Response.json({
        installations: [accessibleInstallation(installationId)],
        total_count: 101,
      }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(verifyUserCanAccessInstallation("ephemeral-user-token", installationId))
      .resolves.toMatchObject({ app_id: 4573846, id: installationId });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(String(fetchMock.mock.calls[0]?.[0]))
      .toBe("https://api.github.com/user/installations?per_page=100&page=1");
    expect(String(fetchMock.mock.calls[1]?.[0]))
      .toBe("https://api.github.com/user/installations?per_page=100&page=2");
    expect(fetchMock.mock.calls.map((call) => String(call[0])))
      .not.toContain(`https://api.github.com/user/installations/${installationId}`);
  });

  it("fails closed when the user installation list omits the callback installation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({
      installations: [accessibleInstallation(123)],
      total_count: 1,
    }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(verifyUserCanAccessInstallation("ephemeral-user-token", 456))
      .rejects.toMatchObject({
        code: "github_installation_not_authorized",
        status: 403,
      });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails closed on malformed user installation authorization metadata", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      installations: [{ id: 153286187 }],
      total_count: 1,
    })));

    await expect(verifyUserCanAccessInstallation("ephemeral-user-token", 153286187))
      .rejects.toMatchObject({
        code: "github_installations_invalid",
        status: 502,
      });
  });

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

  it.each([
    {
      body: { message: "You have exceeded a secondary rate limit. Please wait before retrying." },
      headers: new Headers({ "x-ratelimit-remaining": "4999" }),
      label: "secondary limit provider message",
    },
    {
      body: { message: "Request temporarily refused" },
      headers: new Headers({ "retry-after": "60", "x-ratelimit-remaining": "4999" }),
      label: "Retry-After header",
    },
  ])("maps a 403 $label to a retryable rate-limit error", async ({ body, headers }) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(body, { headers, status: 403 })));

    await expect(githubApiRequest("/installation/repositories", { token: "secret-token" }))
      .rejects.toMatchObject({ code: "github_rate_limited", status: 429 });
  });

  it("keeps an ordinary 403 distinct from a rate limit", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(
      { message: "Resource not accessible by integration" },
      { headers: { "x-ratelimit-remaining": "4999" }, status: 403 },
    )));

    await expect(githubApiRequest("/installation/repositories", { token: "secret-token" }))
      .rejects.toMatchObject({ code: "github_permission_denied", status: 403 });
  });

  it("maps a 429 response to a stable rate-limit error without forwarding provider detail", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(
      { message: "provider detail containing secret-token" },
      { status: 429 },
    )));

    let caught: unknown;
    try {
      await githubApiRequest("/installation/repositories", { token: "secret-token" });
    } catch (error) {
      caught = error;
    }
    expect(caught).toMatchObject({ code: "github_rate_limited", status: 429 });
    expect(String((caught as Error).message)).not.toContain("secret-token");
    expect(String((caught as Error).message)).not.toContain("provider detail");
  });

  it("rejects an oversized declared response before reading its stream", async () => {
    const pull = vi.fn(() => undefined);
    const cancel = vi.fn(() => undefined);
    const body = new ReadableStream<Uint8Array>({ cancel, pull }, { highWaterMark: 0 });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, {
      headers: { "content-length": String(MAX_GITHUB_RESPONSE_BYTES + 1) },
      status: 200,
    })));

    await expect(githubApiRequest("/installation/repositories", { token: "secret-token" }))
      .rejects.toMatchObject({ code: "github_response_too_large", status: 502 });
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(pull).not.toHaveBeenCalled();
  });

  it("stops buffering an undeclared response as soon as the byte bound is crossed", async () => {
    const cancel = vi.fn(() => undefined);
    let sent = false;
    const body = new ReadableStream<Uint8Array>({
      cancel,
      pull(controller) {
        if (sent) return;
        sent = true;
        controller.enqueue(new Uint8Array(MAX_GITHUB_RESPONSE_BYTES));
        controller.enqueue(new Uint8Array([0x7b]));
      },
    });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, { status: 200 })));

    await expect(githubApiRequest("/installation/repositories", { token: "secret-token" }))
      .rejects.toMatchObject({ code: "github_response_too_large", status: 502 });
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it("rejects malformed Content-Length without consuming the response", async () => {
    const cancel = vi.fn(() => undefined);
    const body = new ReadableStream<Uint8Array>({ cancel });
    vi.stubGlobal("fetch", vi.fn(async () => new Response(body, {
      headers: { "content-length": "not-a-number" },
      status: 200,
    })));

    await expect(githubApiRequest("/installation/repositories", { token: "secret-token" }))
      .rejects.toMatchObject({ code: "github_invalid_response", status: 502 });
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe("GitHub repository file reads", () => {
  it("maps a live directory response and encodes the requested path and ref", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json([{
      html_url: "https://github.com/example-org/application/tree/main/docs",
      name: "guides",
      path: "docs/guides",
      sha: "a".repeat(40),
      size: 0,
      type: "dir",
    }]));
    vi.stubGlobal("fetch", fetchMock);

    await expect(listGitHubTree("installation-token-value", "example-org", "application", "feature/docs", "docs")).resolves.toEqual([{
      name: "guides",
      path: "docs/guides",
      sha: "a".repeat(40),
      size: 0,
      type: "directory",
      url: "https://github.com/example-org/application/tree/main/docs",
    }]);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({ pathname: "/repos/example-org/application/contents/docs", search: "?ref=feature%2Fdocs" }),
      expect.objectContaining({ cache: "no-store", redirect: "error" }),
    );
  });

  it("decodes a bounded UTF-8 file and rejects binary, invalid, and oversized content", async () => {
    const text = "Hello, factory ✓";
    const textBytes = Buffer.from(text, "utf8");
    const fileResponse = (bytes: Buffer, size = bytes.byteLength) => Response.json({
      content: bytes.toString("base64"),
      encoding: "base64",
      html_url: "https://github.com/example-org/application/blob/main/README.md",
      name: "README.md",
      path: "README.md",
      sha: "b".repeat(40),
      size,
      type: "file",
    });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fileResponse(textBytes))
      .mockResolvedValueOnce(fileResponse(Buffer.from([0x61, 0x00, 0x62])))
      .mockResolvedValueOnce(fileResponse(Buffer.from([0xff])))
      .mockResolvedValueOnce(fileResponse(Buffer.alloc(0), 1024 * 1024 + 1));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getGitHubFile("installation-token-value", "example-org", "application", "main", "README.md")).resolves.toMatchObject({
      content: text,
      encoding: "utf-8",
      ref: "main",
      size: textBytes.byteLength,
    });
    await expect(getGitHubFile("installation-token-value", "example-org", "application", "main", "README.md")).rejects.toMatchObject({ code: "github_file_binary", status: 415 });
    await expect(getGitHubFile("installation-token-value", "example-org", "application", "main", "README.md")).rejects.toMatchObject({ code: "github_file_binary", status: 415 });
    await expect(getGitHubFile("installation-token-value", "example-org", "application", "main", "README.md")).rejects.toMatchObject({ code: "github_file_too_large", status: 413 });
  });
});
