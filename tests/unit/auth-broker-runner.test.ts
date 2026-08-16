// @vitest-environment node

import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

process.env.SOFTWAREFACTORY_CREDENTIAL_KEY = randomBytes(32).toString("base64");

const { relayCodePurpose } = await import("@/lib/ai-accounts/purposes");
const { openSecret, sealSecret } = await import("@/lib/security/secret-box-core");
const {
  extractLoginUrl,
  extractOauthToken,
  productionAuthBrokerDependencies,
  runAuthBrokerOnce,
  stripAnsi,
} = await import("@/lib/worker/auth-broker");

type StoreShape = Parameters<typeof runAuthBrokerOnce>[1]["store"];

const session = {
  sessionId: "33333333-4444-4555-8666-777777777777",
  organizationId: "11111111-2222-4333-8444-555555555555",
  accountId: "22222222-3333-4444-8555-666666666666",
  provider: "anthropic",
  purpose: "claude",
};

function makeStore(overrides: Partial<StoreShape> = {}): StoreShape {
  return {
    claim: vi.fn(async () => session),
    reportLoginUrl: vi.fn(async () => true),
    readRelayCode: vi.fn(async () => null),
    markVerifying: vi.fn(async () => true),
    complete: vi.fn(async () => undefined),
    fail: vi.fn(async () => undefined),
    expireStale: vi.fn(async () => 0),
    ...overrides,
  };
}

function makeCli(overrides: Partial<{
  waitForLoginUrl: (t: number) => Promise<string>;
  submitCode: (code: string) => Promise<void>;
  waitForToken: (t: number) => Promise<string>;
  dispose: () => Promise<void>;
}> = {}) {
  return {
    waitForLoginUrl: vi.fn(async () => "https://claude.com/cai/oauth/authorize?code=true"),
    submitCode: vi.fn(async () => undefined),
    waitForToken: vi.fn(async () => "sk-ant-oat01-abcdefghijklmnopqrstuvwxyz123456"),
    dispose: vi.fn(async () => undefined),
    ...overrides,
  };
}

/** Virtual time: sleeps advance the injected clock instead of the real one. */
function virtualClock() {
  let time = 0;
  return {
    now: () => time,
    sleep: async (ms: number) => { time += ms; },
    advance: (ms: number) => { time += ms; },
  };
}

describe("runAuthBrokerOnce", () => {
  it("drives a claimed sign-in to connected: URL out, code in, credential sealed", async () => {
    const sealedRelay = sealSecret("AC-1234-XYZZY", {
      organizationId: session.organizationId,
      purpose: relayCodePurpose(session.sessionId),
    });
    let polls = 0;
    const store = makeStore({
      readRelayCode: vi.fn(async () => (++polls >= 3 ? sealedRelay : null)),
    });
    const cli = makeCli();
    const clock = virtualClock();

    const outcome = await runAuthBrokerOnce("worker-1", {
      store,
      startLogin: async () => cli,
      openRelayCode: (s, sealed) => openSecret(sealed, {
        organizationId: s.organizationId,
        purpose: relayCodePurpose(s.sessionId),
      }),
      sealCredential: (s, token) => sealSecret(token, {
        organizationId: s.organizationId,
        purpose: s.purpose,
      }),
      sleep: clock.sleep,
      now: clock.now,
    });

    expect(outcome).toBe("connected");
    expect(store.reportLoginUrl).toHaveBeenCalledWith(
      session.sessionId, "https://claude.com/cai/oauth/authorize?code=true",
    );
    // The CLI received the plaintext code — unsealed only for that write.
    expect(cli.submitCode).toHaveBeenCalledWith("AC-1234-XYZZY");
    expect(store.markVerifying).toHaveBeenCalledWith(session.sessionId);
    // What reached the vault opens under the ACCOUNT purpose, not the relay's.
    const sealedCredential = vi.mocked(store.complete).mock.calls[0][1];
    expect(openSecret(sealedCredential, {
      organizationId: session.organizationId,
      purpose: "claude",
    })).toBe("sk-ant-oat01-abcdefghijklmnopqrstuvwxyz123456");
    expect(store.fail).not.toHaveBeenCalled();
    expect(cli.dispose).toHaveBeenCalled();
  });

  it("reports idle when nothing is pending", async () => {
    const store = makeStore({ claim: vi.fn(async () => null) });
    const outcome = await runAuthBrokerOnce("worker-1", {
      store,
      startLogin: vi.fn(),
      openRelayCode: vi.fn(),
      sealCredential: vi.fn(),
    });
    expect(outcome).toBe("idle");
  });

  it("fails the session when nobody relays a code in time", async () => {
    const store = makeStore();
    const cli = makeCli();
    const clock = virtualClock();

    const outcome = await runAuthBrokerOnce("worker-1", {
      store,
      startLogin: async () => cli,
      openRelayCode: vi.fn(),
      sealCredential: vi.fn(),
      sleep: clock.sleep,
      now: clock.now,
    });

    expect(outcome).toBe("failed");
    expect(store.fail).toHaveBeenCalledWith(
      session.sessionId, expect.stringMatching(/Nobody finished/),
    );
    expect(cli.submitCode).not.toHaveBeenCalled();
    expect(cli.dispose).toHaveBeenCalled();
  });

  it("stops without failing a session it no longer owns", async () => {
    // reportLoginUrl false means superseded or expired between claim and URL.
    const store = makeStore({ reportLoginUrl: vi.fn(async () => false) });
    const cli = makeCli();

    const outcome = await runAuthBrokerOnce("worker-1", {
      store,
      startLogin: async () => cli,
      openRelayCode: vi.fn(),
      sealCredential: vi.fn(),
    });

    expect(outcome).toBe("failed");
    expect(store.fail).not.toHaveBeenCalled();
    expect(cli.dispose).toHaveBeenCalled();
  });

  it("records a CLI failure and disposes", async () => {
    const store = makeStore();
    const cli = makeCli({
      waitForLoginUrl: vi.fn(async () => {
        throw new Error("The provider login ended before the login URL appeared.");
      }),
    });

    const outcome = await runAuthBrokerOnce("worker-1", {
      store,
      startLogin: async () => cli,
      openRelayCode: vi.fn(),
      sealCredential: vi.fn(),
    });

    expect(outcome).toBe("failed");
    expect(store.fail).toHaveBeenCalledWith(
      session.sessionId, expect.stringMatching(/login ended/),
    );
    expect(cli.dispose).toHaveBeenCalled();
  });
});

describe("terminal output parsing", () => {
  it("finds the login URL through ANSI noise", () => {
    const raw = "[2J[1;1H Browser didn't open? Use the url below\r\n"
      + " [36mhttps://claude.com/cai/oauth/authorize?code=true&client_id=abc123&state=xyz[0m\r\n"
      + " Paste code here if prompted >\r\n";
    expect(extractLoginUrl(raw)).toBe(
      "https://claude.com/cai/oauth/authorize?code=true&client_id=abc123&state=xyz",
    );
  });

  it("finds the minted token and nothing shorter", () => {
    expect(extractOauthToken("done: sk-ant-oat01-ABCdef0123456789_-ABCdef0123456789")).toBe(
      "sk-ant-oat01-ABCdef0123456789_-ABCdef0123456789",
    );
    expect(extractOauthToken("sk-ant-short")).toBeNull();
  });

  it("strips CSI and OSC sequences", () => {
    expect(stripAnsi("]0;titleplain [31mred[0m")).toBe("plain red");
  });
});

describe("productionAuthBrokerDependencies", () => {
  it("refuses to start a login for a provider the worker cannot drive", async () => {
    const dependencies = productionAuthBrokerDependencies(makeStore());
    await expect(
      dependencies.startLogin({ ...session, provider: "openai", purpose: "codex" }),
    ).rejects.toThrow(/Only Claude accounts/);
  });
});
