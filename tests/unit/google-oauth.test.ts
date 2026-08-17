// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const {
  buildGoogleAuthorizeUrl, discoverFirstProject, exchangeGoogleCode, readGoogleOAuthConfig,
} = await import("@/lib/bots/google-oauth");

/**
 * Sign in with Google, which is how this application reaches Claude.
 *
 * Anthropic's own OAuth is closed to third parties. Claude runs on Vertex AI,
 * Google OAuth is open, so this is the standard login flow reaching the
 * intended model. Two things make or break it in ways that only show up later:
 * whether a refresh token comes back, and whether a usable project was found.
 */

const config = { clientId: "client-id.apps.googleusercontent.com", clientSecret: "the-secret" };
const redirectUri = "https://factory.test/api/bots/connect/google/callback";

function stubFetch(handler: (url: string, init?: RequestInit) => unknown) {
  const mock = vi.fn(async (url: string, init?: RequestInit) => handler(String(url), init));
  vi.stubGlobal("fetch", mock);
  return mock;
}

beforeEach(() => {
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", config.clientId);
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", config.clientSecret);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("configuration", () => {
  it("reports unavailable rather than throwing when unconfigured", () => {
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "");
    // A deployment without a Google client should render "not available", not
    // fail a request.
    expect(readGoogleOAuthConfig()).toBeNull();

    vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", config.clientId);
    vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "  ");
    expect(readGoogleOAuthConfig()).toBeNull();
  });

  it("reads a complete client", () => {
    expect(readGoogleOAuthConfig()).toMatchObject({ clientId: config.clientId });
  });
});

describe("the authorize URL", () => {
  it("asks for the scope Vertex needs, and for a refresh token", () => {
    const url = new URL(buildGoogleAuthorizeUrl({
      config, redirectUri, state: "the-state", codeChallenge: "the-challenge",
    }));

    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(url.searchParams.get("scope")).toBe("https://www.googleapis.com/auth/cloud-platform");
    // Both are required. Without them a second sign-in returns only an access
    // token, and the connection dies silently within the hour.
    expect(url.searchParams.get("access_type")).toBe("offline");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("state")).toBe("the-state");
  });

  it("never puts the client secret in the redirect", () => {
    const url = buildGoogleAuthorizeUrl({
      config, redirectUri, state: "s", codeChallenge: "c",
    });

    // The authorize URL is observable; only the token exchange is server-side.
    expect(url).not.toContain(config.clientSecret);
  });
});

describe("exchanging the code", () => {
  it("returns both tokens and sends the verifier", async () => {
    const mock = stubFetch(() => ({
      ok: true, status: 200,
      json: async () => ({ refresh_token: "refresh-value", access_token: "access-value" }),
    }));

    const result = await exchangeGoogleCode({
      config, code: "auth-code", codeVerifier: "the-verifier", redirectUri,
    });

    expect(result).toMatchObject({ ok: true, refreshToken: "refresh-value" });
    const body = String((mock.mock.calls[0][1] as RequestInit).body);
    expect(body).toContain("code_verifier=the-verifier");
    expect(body).toContain("grant_type=authorization_code");
  });

  it("refuses when Google returns no refresh token", async () => {
    // The dangerous success: everything looks connected, and stops working in
    // an hour with no way to renew.
    stubFetch(() => ({
      ok: true, status: 200, json: async () => ({ access_token: "access-only" }),
    }));

    const result = await exchangeGoogleCode({
      config, code: "c", codeVerifier: "v", redirectUri,
    });

    expect(result.ok).toBe(false);
    expect(result.ok === false && result.reason).toMatch(/refresh token/i);
  });

  it("never surfaces Google's error body", async () => {
    stubFetch(() => ({
      ok: false, status: 400,
      json: async () => ({ error_description: "bad code auth-code-secret" }),
    }));

    const result = await exchangeGoogleCode({
      config, code: "auth-code-secret", codeVerifier: "v", redirectUri,
    });

    expect(JSON.stringify(result)).not.toContain("auth-code-secret");
  });

  it("treats a timeout and a network failure as a refusal", async () => {
    stubFetch(() => { throw Object.assign(new Error("aborted"), { name: "AbortError" }); });
    const timedOut = await exchangeGoogleCode({ config, code: "c", codeVerifier: "v", redirectUri });
    expect(timedOut).toMatchObject({ ok: false });

    stubFetch(() => { throw new Error("ECONNREFUSED"); });
    expect((await exchangeGoogleCode({ config, code: "c", codeVerifier: "v", redirectUri })).ok)
      .toBe(false);
  });
});

describe("finding a project", () => {
  it("returns the first active project", async () => {
    stubFetch(() => ({
      ok: true, status: 200,
      json: async () => ({
        projects: [
          { projectId: "deleting-one", lifecycleState: "DELETE_REQUESTED" },
          { projectId: "good-project", lifecycleState: "ACTIVE" },
        ],
      }),
    }));

    // A project being deleted would resolve here and fail at the first Vertex
    // call, which is the worst time to find out.
    expect(await discoverFirstProject("access-value")).toBe("good-project");
  });

  it("returns nothing when the account has no active project", async () => {
    stubFetch(() => ({ ok: true, status: 200, json: async () => ({ projects: [] }) }));
    expect(await discoverFirstProject("access-value")).toBeNull();

    stubFetch(() => ({ ok: true, status: 200, json: async () => ({}) }));
    expect(await discoverFirstProject("access-value")).toBeNull();
  });

  it("sends the access token as a bearer and never in the URL", async () => {
    const mock = stubFetch(() => ({
      ok: true, status: 200,
      json: async () => ({ projects: [{ projectId: "p", lifecycleState: "ACTIVE" }] }),
    }));

    await discoverFirstProject("access-value");

    const [url, init] = mock.mock.calls[0];
    expect(String(url)).not.toContain("access-value");
    expect((init as RequestInit & { headers: Record<string, string> }).headers.Authorization)
      .toBe("Bearer access-value");
  });

  it("returns nothing rather than throwing when the call fails", async () => {
    stubFetch(() => { throw new Error("network"); });
    await expect(discoverFirstProject("access-value")).resolves.toBeNull();
  });
});
