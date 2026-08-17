// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const cookieStore = {
  get: vi.fn(),
  set: vi.fn(),
  delete: vi.fn(),
};
vi.mock("next/headers", () => ({ cookies: async () => cookieStore }));

const rpc = vi.fn();
vi.mock("@/lib/github/service-role", () => ({
  createSupabaseGitHubWebhookClient: () => ({ rpc }),
}));

const exchangeCodeForKey = vi.fn();
vi.mock("@/lib/bots/oauth-pkce", async () => {
  const actual = await vi.importActual<typeof import("@/lib/bots/oauth-pkce")>(
    "@/lib/bots/oauth-pkce",
  );
  return { ...actual, exchangeCodeForKey };
});

const { GET } = await import("@/app/api/bots/connect/oauth/callback/route");

/**
 * The callback is where a forged sign-in would land.
 *
 * The attack it has to stop: another site sends a signed-in person's browser
 * here carrying an authorization code of the attacker's choosing. If that
 * worked, the attacker's credential would be attached to the victim's
 * workspace, and every agent run would bill — and leak — through it.
 *
 * The state parameter is what stops it, so most of these are about state.
 */

const organizationId = "11111111-2222-4333-8444-555555555555";
const state = "the-state-value-that-was-issued";
const verifier = "the-verifier-that-never-travelled";

function pendingCookie(overrides: Record<string, unknown> = {}) {
  return {
    value: JSON.stringify({ verifier, state, organizationId, ...overrides }),
  };
}

function callback(params: Record<string, string>) {
  const url = new URL("https://factory.test/api/bots/connect/oauth/callback");
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return new Request(url);
}

/** The `?connect=` outcome the browser is sent back with. */
function outcomeOf(response: Response) {
  return new URL(response.headers.get("location") ?? "https://x/").searchParams.get("connect");
}

beforeEach(() => {
  vi.stubEnv("SOFTWAREFACTORY_CREDENTIAL_KEY", Buffer.alloc(32, 7).toString("base64"));
  cookieStore.get.mockReturnValue(pendingCookie());
  exchangeCodeForKey.mockResolvedValue({ ok: true, key: "sk-or-v1-issued-key" });
  rpc.mockResolvedValue({ data: true, error: null });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("a forged callback", () => {
  it("is refused when the state does not match the cookie", async () => {
    const response = await GET(callback({ code: "attacker-code", state: "attacker-state" }));

    // The whole attack: an attacker's credential attached to a victim's
    // workspace.
    expect(outcomeOf(response)).toBe("invalid");
    expect(exchangeCodeForKey).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("is refused when no state is returned at all", async () => {
    const response = await GET(callback({ code: "attacker-code" }));

    expect(outcomeOf(response)).toBe("invalid");
    expect(exchangeCodeForKey).not.toHaveBeenCalled();
  });

  it("is refused when there is no pending cookie", async () => {
    cookieStore.get.mockReturnValue(undefined);

    const response = await GET(callback({ code: "c", state }));

    expect(outcomeOf(response)).toBe("expired");
    expect(exchangeCodeForKey).not.toHaveBeenCalled();
  });

  it("is refused when the cookie is not readable", async () => {
    cookieStore.get.mockReturnValue({ value: "not json" });

    expect(outcomeOf(await GET(callback({ code: "c", state })))).toBe("invalid");
  });
});

describe("a genuine callback", () => {
  it("exchanges with the cookie's verifier, never anything from the URL", async () => {
    await GET(callback({ code: "auth-code", state, code_verifier: "attacker-supplied" }));

    // PKCE only works because the verifier never travelled. Taking it from the
    // request would make an intercepted code sufficient on its own.
    expect(exchangeCodeForKey).toHaveBeenCalledWith("auth-code", verifier);
  });

  it("seals the key and stores it against the cookie's organization", async () => {
    const response = await GET(callback({ code: "auth-code", state }));

    expect(outcomeOf(response)).toBe("connected");
    const args = rpc.mock.calls[0][1] as Record<string, string>;
    expect(args.p_organization_id).toBe(organizationId);
    expect(args.p_purpose).toBe("openrouter");
    // Sealed before storage, and the plaintext never reaches the database.
    expect(args.p_sealed_envelope).toMatch(/^v1\./);
    expect(args.p_sealed_envelope).not.toContain("sk-or-v1-issued-key");
  });

  it("uses the organization from when the flow began, not the current session", async () => {
    // Someone who switched workspaces mid-flow must not have the credential
    // land in the one they happen to be looking at now.
    cookieStore.get.mockReturnValue(pendingCookie({ organizationId: "99999999-8888-4777-8666-555555555555" }));

    await GET(callback({ code: "auth-code", state }));

    expect((rpc.mock.calls[0][1] as Record<string, string>).p_organization_id)
      .toBe("99999999-8888-4777-8666-555555555555");
  });

  it("never puts the key in the redirect it sends back", async () => {
    const response = await GET(callback({ code: "auth-code", state }));

    expect(response.headers.get("location")).not.toContain("sk-or-v1");
  });
});

describe("clearing the pending state", () => {
  it("clears the cookie on success and on every failure", async () => {
    await GET(callback({ code: "auth-code", state }));
    expect(cookieStore.delete).toHaveBeenCalled();

    cookieStore.delete.mockClear();
    await GET(callback({ code: "c", state: "wrong" }));
    // A verifier that outlives its round trip is a credential waiting to be
    // replayed.
    expect(cookieStore.delete).toHaveBeenCalled();

    cookieStore.delete.mockClear();
    exchangeCodeForKey.mockResolvedValue({ ok: false, reason: "refused" });
    await GET(callback({ code: "c", state }));
    expect(cookieStore.delete).toHaveBeenCalled();
  });
});

describe("failures", () => {
  it("reports a refused exchange without storing anything", async () => {
    exchangeCodeForKey.mockResolvedValue({ ok: false, reason: "provider said no" });

    expect(outcomeOf(await GET(callback({ code: "c", state })))).toBe("refused");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("reports a storage failure rather than claiming success", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "denied" } });

    expect(outcomeOf(await GET(callback({ code: "c", state })))).toBe("failed");
  });

  it("never leaks the key when sealing or storing throws", async () => {
    rpc.mockImplementation(() => { throw new Error("upstream carried sk-or-v1-issued-key"); });

    const response = await GET(callback({ code: "c", state }));

    expect(outcomeOf(response)).toBe("failed");
    expect(response.headers.get("location")).not.toContain("sk-or-v1");
  });
});
