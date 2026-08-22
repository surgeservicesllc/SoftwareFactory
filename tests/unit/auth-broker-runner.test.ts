// @vitest-environment node

import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

process.env.SOFTWAREFACTORY_CREDENTIAL_KEY = randomBytes(32).toString("base64");

const { relayCodePurpose } = await import("@/lib/ai-accounts/purposes");
const { openSecret, sealSecret } = await import("@/lib/security/secret-box-core");
const {
  codeSubmissionKeystrokes,
  credentialShapeProblem,
  extractCodexCallback,
  extractLoginUrl,
  extractOauthToken,
  productionAuthBrokerDependencies,
  redirectPortFromLoginUrl,
  runAuthBrokerOnce,
  stripAnsi,
  verifyStoredAccounts,
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
    listAccountsForVerification: vi.fn(async () => []),
    readStoredCredential: vi.fn(async () => null),
    markAccountVerified: vi.fn(async () => true),
    markAccountNeedsReauth: vi.fn(async () => true),
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

  it("completes a device-code login with nothing relayed at all", async () => {
    // The person approves on the provider's page; the CLI notices and the
    // session connects without any pasted code — submitCode never runs.
    const store = makeStore({
      readRelayCode: vi.fn(async () => null),
    });
    let polls = 0;
    const submitCode = vi.fn();
    const cli = {
      ...makeCli(),
      submitCode,
      pollCompleted: vi.fn(async () => ++polls >= 2),
      waitForToken: vi.fn(async () => JSON.stringify({ tokens: {} })),
    };
    const clock = virtualClock();

    const outcome = await runAuthBrokerOnce("worker-1", {
      store,
      startLogin: async () => cli,
      openRelayCode: vi.fn(),
      sealCredential: (s, token) => sealSecret(token, {
        organizationId: s.organizationId,
        purpose: s.purpose,
      }),
      sleep: clock.sleep,
      now: clock.now,
    });

    expect(outcome).toBe("connected");
    expect(submitCode).not.toHaveBeenCalled();
    expect(store.markVerifying).toHaveBeenCalledWith(session.sessionId);
    expect(store.complete).toHaveBeenCalled();
    expect(store.fail).not.toHaveBeenCalled();
  });

  it("abandons a session that is cancelled mid-drive instead of waiting out the window", async () => {
    let statusPolls = 0;
    const store = makeStore({
      readRelayCode: vi.fn(async () => null),
      readSessionStatus: vi.fn(async () => (++statusPolls >= 3 ? "revoked" : "awaiting_user")),
    });
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
    // Abandoned quietly: the session is already terminal, nothing to mark.
    expect(store.fail).not.toHaveBeenCalled();
    expect(cli.submitCode).not.toHaveBeenCalled();
    expect(cli.dispose).toHaveBeenCalled();
  });

  it("fails fast when a relay code predates this worker's login", async () => {
    // A code sealed before the claim belongs to a dead worker's login — no
    // fresh login can verify it, so the session fails immediately with a
    // message that says to sign in again, and no login is ever started.
    const store = makeStore({
      readRelayCode: vi.fn(async () => "sealed-from-a-previous-attempt"),
    });
    const startLogin = vi.fn();
    const outcome = await runAuthBrokerOnce("worker-1", {
      store,
      startLogin,
      openRelayCode: vi.fn(),
      sealCredential: vi.fn(),
    });
    expect(outcome).toBe("failed");
    expect(startLogin).not.toHaveBeenCalled();
    expect(store.fail).toHaveBeenCalledWith(
      session.sessionId, expect.stringMatching(/sign in again/i),
    );
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

  it("types the code and presses Enter as its own keystroke, twice", () => {
    // A raw-mode prompt only registers Enter as a lone carriage return; a
    // newline glued to the pasted code fills the field without submitting it.
    const strokes = codeSubmissionKeystrokes("  ac_code#state  ");
    expect(strokes[0]).toEqual({ settleMs: 0, chunk: "ac_code#state" });
    const enters = strokes.slice(1);
    expect(enters.length).toBeGreaterThanOrEqual(2);
    for (const stroke of enters) {
      expect(stroke.chunk).toBe("\r");
      expect(stroke.settleMs).toBeGreaterThan(0);
    }
  });

  it("strips CSI and OSC sequences", () => {
    expect(stripAnsi("]0;titleplain [31mred[0m")).toBe("plain red");
  });
});

describe("the verification sweep", () => {
  const account = {
    organizationId: session.organizationId,
    accountId: session.accountId,
    provider: "anthropic",
    purpose: "claude",
  };

  it("refreshes a connected account whose sealed credential opens and looks right", async () => {
    const sealed = sealSecret("sk-ant-oat01-abcdefghijklmnopqrstuvwxyz123456", {
      organizationId: account.organizationId, purpose: account.purpose,
    });
    const store = makeStore({
      listAccountsForVerification: vi.fn(async () => [account]),
      readStoredCredential: vi.fn(async () => sealed),
    });

    const result = await verifyStoredAccounts(store);

    expect(result).toEqual({ verified: 1, demoted: 0 });
    expect(store.markAccountVerified).toHaveBeenCalledWith(
      account.organizationId, account.accountId,
    );
    expect(store.markAccountNeedsReauth).not.toHaveBeenCalled();
  });

  it("demotes with a named reason when the credential is missing, unopenable, or the wrong shape", async () => {
    const wrongShape = sealSecret("not-a-subscription-token", {
      organizationId: account.organizationId, purpose: account.purpose,
    });
    const sealedElsewhere = sealSecret("sk-ant-oat01-abcdefghijklmnopqrstuvwxyz123456", {
      organizationId: account.organizationId, purpose: "codex",
    });
    const store = makeStore({
      listAccountsForVerification: vi.fn(async () => [
        account,
        { ...account, accountId: "acc-missing", purpose: "claude_2" },
        { ...account, accountId: "acc-unopenable", purpose: "claude" },
      ]),
    });
    // Three accounts, three failure kinds: wrong shape, missing, unopenable
    // (sealed under a different purpose, so the open fails authentically).
    vi.mocked(store.readStoredCredential)
      .mockResolvedValueOnce(wrongShape)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(sealedElsewhere);

    const result = await verifyStoredAccounts(store);

    expect(result).toEqual({ verified: 0, demoted: 3 });
    const reasons = vi.mocked(store.markAccountNeedsReauth).mock.calls.map((call) => call[2]);
    expect(reasons[0]).toMatch(/not shaped like a subscription token/);
    expect(reasons[1]).toMatch(/no stored credential exists/);
    expect(reasons[2]).toMatch(/cannot be opened/);
    expect(store.markAccountVerified).not.toHaveBeenCalled();
  });

  it("knows each provider's credential shape, and passes unknown providers", () => {
    expect(credentialShapeProblem(
      "anthropic", "sk-ant-oat01-abcdefghijklmnopqrstuvwxyz123456",
    )).toBeNull();
    expect(credentialShapeProblem("anthropic", "sk-proj-not-a-claude-token-at-all-here"))
      .toMatch(/not shaped like/);
    expect(credentialShapeProblem("openai", JSON.stringify({ tokens: {} }))).toBeNull();
    expect(credentialShapeProblem("openai", "just text")).toMatch(/auth file/);
    expect(credentialShapeProblem("google", "anything")).toBeNull();
  });
});

describe("productionAuthBrokerDependencies", () => {
  it("drives a Codex login instead of refusing it", async () => {
    // Prove the production router selects the Codex driver without starting
    // a real provider CLI in a unit test (or depending on a Unix pseudo-TTY).
    const expectedCli = makeCli();
    const openai = vi.fn(async () => expectedCli);
    const anthropic = vi.fn(async () => makeCli());
    const dependencies = productionAuthBrokerDependencies(makeStore(), {
      openai,
      anthropic,
    });
    const startedCli = await dependencies.startLogin({
      ...session, provider: "openai", purpose: "codex",
    });
    expect(startedCli).toBe(expectedCli);
    expect(openai).toHaveBeenCalledWith({
      ...session, provider: "openai", purpose: "codex",
    });
    expect(anthropic).not.toHaveBeenCalled();
  });
});

describe("the Codex callback relay", () => {
  it("recovers the query from a pasted dead-localhost address", () => {
    expect(extractCodexCallback(
      "  http://localhost:1455/auth/callback?code=ac_123&state=xyz  ",
    )).toBe("code=ac_123&state=xyz");
    expect(extractCodexCallback(
      "localhost:1455/auth/callback?code=ac_123&state=xyz#fragment",
    )).toBe("code=ac_123&state=xyz");
    expect(extractCodexCallback("code=ac_123&state=xyz")).toBe("code=ac_123&state=xyz");
  });

  it("refuses pastes that carry no code to replay", () => {
    expect(extractCodexCallback("http://localhost:1455/auth/callback")).toBeNull();
    expect(extractCodexCallback("just some text")).toBeNull();
    expect(extractCodexCallback("state=xyz&decode=1")).toBeNull();
  });

  it("reads the callback port from the login URL's redirect_uri", () => {
    expect(redirectPortFromLoginUrl(
      "https://auth.openai.com/oauth/authorize?client_id=x&redirect_uri="
      + encodeURIComponent("http://localhost:2481/auth/callback"),
    )).toBe(2481);
    expect(redirectPortFromLoginUrl("https://auth.openai.com/oauth/authorize?client_id=x"))
      .toBe(1455);
  });
});
