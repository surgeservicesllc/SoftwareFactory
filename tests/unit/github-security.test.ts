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
  MAX_GITHUB_RESPONSE_BYTES,
} from "@/lib/github/client";
import { sha256Hex, verifyGitHubWebhookSignature } from "@/lib/github/webhook";
import { containsLikelySecret } from "@/lib/server/sensitive-data";

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
