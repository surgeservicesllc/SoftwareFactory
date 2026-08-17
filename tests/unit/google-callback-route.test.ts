// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const cookieStore = { get: vi.fn(), set: vi.fn(), delete: vi.fn() };
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));

const rpc = vi.fn();
vi.mock("@/lib/github/service-role", () => ({
  createSupabaseGitHubWebhookClient: () => ({ rpc }),
}));

const exchangeGoogleCode = vi.fn();
const discoverFirstProject = vi.fn();
vi.mock("@/lib/bots/google-oauth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/bots/google-oauth")>(
    "@/lib/bots/google-oauth",
  );
  return { ...actual, exchangeGoogleCode, discoverFirstProject };
});

const { GET } = await import("@/app/api/bots/connect/google/callback/route");

/**
 * The Google callback, which is how Claude gets connected.
 *
 * Same attack as any OAuth callback: another site sends a signed-in person's
 * browser here with a code of its own, and its Google account ends up attached
 * to their workspace. The state parameter is what stops that, so it is what
 * most of this covers.
 */

const organizationId = "11111111-2222-4333-8444-555555555555";
const state = "the-state-value-that-was-issued";
const verifier = "the-verifier-that-never-travelled";
const refreshToken = "1//google-refresh-token-value";

function pending(overrides: Record<string, unknown> = {}) {
  return { value: JSON.stringify({ verifier, state, organizationId, ...overrides }) };
}

function callback(params: Record<string, string>) {
  const url = new URL("https://factory.test/api/bots/connect/google/callback");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new Request(url);
}

function outcomeOf(response: Response) {
  return new URL(response.headers.get("location") ?? "https://x/").searchParams.get("connect");
}

beforeEach(() => {
  vi.stubEnv("SOFTWAREFACTORY_CREDENTIAL_KEY", Buffer.alloc(32, 9).toString("base64"));
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_ID", "client-id.apps.googleusercontent.com");
  vi.stubEnv("GOOGLE_OAUTH_CLIENT_SECRET", "the-secret");
  cookieStore.get.mockReturnValue(pending());
  exchangeGoogleCode.mockResolvedValue({
    ok: true, refreshToken, accessToken: "access-token-value",
  });
  discoverFirstProject.mockResolvedValue("my-cloud-project");
  rpc.mockResolvedValue({ data: true, error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("a forged callback", () => {
  it("is refused when the state does not match", async () => {
    const response = await GET(callback({ code: "attacker-code", state: "attacker-state" }));

    expect(outcomeOf(response)).toBe("invalid");
    expect(exchangeGoogleCode).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("is refused with no state, and with no pending cookie", async () => {
    expect(outcomeOf(await GET(callback({ code: "c" })))).toBe("invalid");

    cookieStore.get.mockReturnValue(undefined);
    expect(outcomeOf(await GET(callback({ code: "c", state })))).toBe("expired");
    expect(exchangeGoogleCode).not.toHaveBeenCalled();
  });
});

describe("a genuine callback", () => {
  it("exchanges with the cookie's verifier", async () => {
    await GET(callback({ code: "auth-code", state }));

    expect(exchangeGoogleCode).toHaveBeenCalledWith(
      expect.objectContaining({ code: "auth-code", codeVerifier: verifier }),
    );
  });

  it("stores the refresh token and the discovered project together, sealed", async () => {
    const response = await GET(callback({ code: "auth-code", state }));

    expect(outcomeOf(response)).toBe("connected");
    const args = rpc.mock.calls[0][1] as Record<string, string>;
    expect(args.p_purpose).toBe("vertex");
    expect(args.p_sealed_envelope).toMatch(/^v1\./);
    expect(args.p_sealed_envelope).not.toContain(refreshToken);
    expect(args.p_sealed_envelope).not.toContain("my-cloud-project");

    const { openSecret } = await import("@/lib/server/secret-box");
    // The token is useless for Vertex without the project, so they are sealed
    // as one document and cannot drift apart.
    expect(JSON.parse(openSecret(args.p_sealed_envelope, {
      organizationId: args.p_organization_id, purpose: args.p_purpose,
    }))).toEqual({ refreshToken, projectId: "my-cloud-project" });
  });

  it("never stores the access token, which is worthless within the hour", async () => {
    await GET(callback({ code: "auth-code", state }));

    const args = rpc.mock.calls[0][1] as Record<string, string>;
    const { openSecret } = await import("@/lib/server/secret-box");
    const opened = openSecret(args.p_sealed_envelope, {
      organizationId: args.p_organization_id, purpose: args.p_purpose,
    });

    // Holding a second secret that buys nothing is pure exposure.
    expect(opened).not.toContain("access-token-value");
  });

  it("uses the organization from when the flow began", async () => {
    cookieStore.get.mockReturnValue(
      pending({ organizationId: "99999999-8888-4777-8666-555555555555" }),
    );

    await GET(callback({ code: "auth-code", state }));

    expect((rpc.mock.calls[0][1] as Record<string, string>).p_organization_id)
      .toBe("99999999-8888-4777-8666-555555555555");
  });
});

describe("failures", () => {
  it("does not connect an account with no active Cloud project", async () => {
    discoverFirstProject.mockResolvedValue(null);

    const response = await GET(callback({ code: "c", state }));

    // Storing without a project would read as connected and fail at the first
    // run, which is the worst time to discover it.
    expect(outcomeOf(response)).toBe("no_project");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports a refused exchange without storing anything", async () => {
    exchangeGoogleCode.mockResolvedValue({ ok: false, reason: "no refresh token" });

    expect(outcomeOf(await GET(callback({ code: "c", state })))).toBe("refused");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never leaks the token in the redirect when storing throws", async () => {
    rpc.mockImplementation(() => { throw new Error(`upstream carried ${refreshToken}`); });

    const response = await GET(callback({ code: "c", state }));

    expect(outcomeOf(response)).toBe("failed");
    expect(response.headers.get("location")).not.toContain(refreshToken);
  });

  it("clears the pending cookie on success and on failure", async () => {
    await GET(callback({ code: "c", state }));
    expect(cookieStore.delete).toHaveBeenCalled();

    cookieStore.delete.mockClear();
    await GET(callback({ code: "c", state: "wrong" }));
    expect(cookieStore.delete).toHaveBeenCalled();
  });
});
