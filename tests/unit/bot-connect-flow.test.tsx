import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BotFabricConsole } from "@/components/bot-fabric-console";

/**
 * Connecting a bot used to mean typing `ANTHROPIC_API_KEY` from memory. These
 * cover the redesign, and the assertions are about two things: that a
 * configured provider needs no typing at all, and that an unconfigured one is
 * never described as ready.
 *
 * The second is the one worth guarding. Presence of a variable is all the
 * server checks, so the interface must not translate that into "Connected" —
 * a revoked key is indistinguishable from a good one without calling out.
 */

const fabricPayload = {
  activeOrganizationId: "11111111-2222-4333-8444-555555555555",
  canManage: true,
  bots: [],
  roles: [],
  assignments: [],
  projects: [],
  executor: {
    connected: false,
    label: "Not Connected",
    detail: "No worker executes bots in this phase.",
    globalKillSwitchActive: true,
  },
};

function providerPayload(overrides: Record<string, unknown> = {}) {
  return {
    providers: [
      {
        id: "anthropic",
        label: "Claude",
        vendor: "Anthropic",
        monogram: "CL",
        accent: "#d9855b",
        summary: "Long-horizon agentic work.",
        suggestedModels: ["claude-opus-5"],
        defaultModel: "claude-opus-5",
        credentialRef: "ANTHROPIC_API_KEY",
        credentialReady: true,
        credentialOptional: false,
        probeVerdict: "verified",
        probeReason: "The provider accepted this key.",
        probeLive: true,
        requiresBaseUrl: false,
        docsUrl: "https://platform.claude.com/docs",
        apiKeyUrl: "https://platform.claude.com/settings/keys",
        ...overrides,
      },
    ],
  };
}

/** Routes by URL, because the console now reads two endpoints. */
function stubRoutedFetch(providers: unknown, onRegister?: (body: unknown) => void) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (String(url).startsWith("/api/bots/providers")) {
      return { ok: true, status: 200, json: async () => providers };
    }
    if (init?.method === "POST") {
      onRegister?.(JSON.parse(String(init.body)));
      return { ok: true, status: 201, json: async () => ({}) };
    }
    return { ok: true, status: 200, json: async () => fabricPayload };
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

async function openPicker() {
  const user = userEvent.setup();
  render(<BotFabricConsole />);
  await user.click(await screen.findByRole("tab", { name: /bots/i }));
  return user;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("a provider that is already set up", () => {
  it("is marked as detected before anything is clicked", async () => {
    stubRoutedFetch(providerPayload());
    await openPicker();

    expect(await screen.findByText(/^verified$/i)).toBeInTheDocument();
  });

  it("connects with no typing at all", async () => {
    const registered: unknown[] = [];
    stubRoutedFetch(providerPayload(), (body) => registered.push(body));
    const user = await openPicker();

    await user.click(await screen.findByRole("button", { name: /claude/i }));
    // The whole point of the redesign: the primary action is reachable without
    // filling in a single field.
    await user.click(await screen.findByRole("button", { name: /connect claude/i }));

    await waitFor(() => expect(registered).toHaveLength(1));
    expect(registered[0]).toMatchObject({
      provider: "anthropic",
      name: "Claude",
      model: "claude-opus-5",
      credentialRef: "ANTHROPIC_API_KEY",
    });
  });

  it("keeps the name, model and endpoint fields available but folded away", async () => {
    stubRoutedFetch(providerPayload());
    const user = await openPicker();
    await user.click(await screen.findByRole("button", { name: /claude/i }));

    const toggle = screen.getByRole("button", { name: /customise name, model and endpoint/i });
    expect(toggle).toHaveAttribute("aria-expanded", "false");

    await user.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByLabelText(/bot name/i)).toHaveValue("Claude");
  });
});

describe("a provider that is not set up", () => {
  it("says it needs a key rather than claiming it is ready", async () => {
    stubRoutedFetch(providerPayload({ credentialReady: false, probeVerdict: "not_configured", probeReason: null, probeLive: false }));
    await openPicker();

    expect(await screen.findByText(/needs a key/i)).toBeInTheDocument();
    expect(screen.queryByText(/^verified$/i)).not.toBeInTheDocument();
  });

  it("shows the exact variable and a link to the page that issues a key", async () => {
    stubRoutedFetch(providerPayload({ credentialReady: false, probeVerdict: "not_configured", probeReason: null, probeLive: false }));
    const user = await openPicker();
    await user.click(await screen.findByRole("button", { name: /claude/i }));

    expect(await screen.findByText("ANTHROPIC_API_KEY")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open key page/i })).toHaveAttribute(
      "href",
      "https://platform.claude.com/settings/keys",
    );
  });

  it("refuses to register until the key exists", async () => {
    const registered: unknown[] = [];
    stubRoutedFetch(providerPayload({ credentialReady: false, probeVerdict: "not_configured", probeReason: null, probeLive: false }), (body) => registered.push(body));
    const user = await openPicker();
    await user.click(await screen.findByRole("button", { name: /claude/i }));

    // Registering a bot whose credential is absent produces a record that
    // cannot work and reads as though it can.
    const submit = await screen.findByRole("button", { name: /set anthropic_api_key first/i });
    expect(submit).toBeDisabled();
    expect(registered).toHaveLength(0);
  });

  it("re-checks on demand, so setting the key does not need a page reload", async () => {
    let ready = false;
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).startsWith("/api/bots/providers")) {
        return { ok: true, status: 200, json: async () => providerPayload(ready ? {} : { credentialReady: false, probeVerdict: "not_configured", probeReason: null, probeLive: false }) };
      }
      return { ok: true, status: 200, json: async () => fabricPayload };
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = await openPicker();
    await user.click(await screen.findByRole("button", { name: /claude/i }));
    expect(await screen.findByRole("button", { name: /check again/i })).toBeInTheDocument();

    ready = true;
    await user.click(screen.getByRole("button", { name: /check again/i }));

    expect(await screen.findByRole("button", { name: /connect claude/i })).toBeEnabled();
  });
});

describe("honesty about what presence proves", () => {
  it("never renders the word Connected from a presence check", async () => {
    stubRoutedFetch(providerPayload());
    const user = await openPicker();
    await user.click(await screen.findByRole("button", { name: /claude/i }));

    // "Key detected" and "is set" are claims about a variable. "Connected"
    // would be a claim about the provider, which nothing here verified.
    expect(await screen.findByText(/Anthropic verified this key/i)).toBeInTheDocument();
    expect(screen.queryByText(/^connected$/i)).not.toBeInTheDocument();
  });

  it("shows no readiness claim at all while the check is still unknown", async () => {
    // A failed or pending read must not render as "needs a key" — that would
    // send someone to create a key they already have.
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).startsWith("/api/bots/providers")) {
        return { ok: false, status: 500, json: async () => ({}) };
      }
      return { ok: true, status: 200, json: async () => fabricPayload };
    });
    vi.stubGlobal("fetch", fetchMock);

    await openPicker();

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /claude/i })).toBeInTheDocument();
    });
    expect(screen.queryByText(/^verified$/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/needs a key/i)).not.toBeInTheDocument();
  });
});

describe("a provider that needs no key", () => {
  it("is not described as missing one", async () => {
    stubRoutedFetch(providerPayload({
      id: "selfhosted", label: "Self-hosted", credentialRef: null,
      credentialReady: false, credentialOptional: true, apiKeyUrl: null,
      probeVerdict: "not_probed", probeReason: null, probeLive: false,
    }));
    await openPicker();

    expect(await screen.findByText(/no key needed/i)).toBeInTheDocument();
    expect(screen.queryByText(/needs a key/i)).not.toBeInTheDocument();
  });
});

describe("a key that is present but does not work", () => {
  // The whole reason for probing. Before it, all three of these rendered
  // identically to a healthy key.

  it("does not call a rejected key ready, and blocks registration", async () => {
    const registered: unknown[] = [];
    stubRoutedFetch(
      providerPayload({
        probeVerdict: "rejected",
        probeReason: "The provider rejected this key as invalid or revoked.",
      }),
      (body) => registered.push(body),
    );
    const user = await openPicker();

    expect(await screen.findByText(/key rejected/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /claude/i }));

    expect(await screen.findByText(/invalid or revoked/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^connect claude$/i })).not.toBeInTheDocument();
    expect(registered).toHaveLength(0);
  });

  it("says an exhausted balance is an exhausted balance, not a bad key", async () => {
    // Reissuing a working key because the account had no credit is exactly the
    // wrong fix, and it is what a merged "key problem" badge would prompt.
    stubRoutedFetch(providerPayload({
      probeVerdict: "no_credit",
      probeReason: "The key is valid but the account has no available credit.",
    }));
    const user = await openPicker();

    expect(await screen.findByText(/no credit/i)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /claude/i }));
    expect(await screen.findByText(/no available credit/i)).toBeInTheDocument();
  });

  it("treats throttling as transient rather than as a broken key", async () => {
    stubRoutedFetch(providerPayload({
      probeVerdict: "rate_limited",
      probeReason: "The provider is throttling requests right now.",
    }));
    await openPicker();

    expect(await screen.findByText(/throttled/i)).toBeInTheDocument();
    expect(screen.queryByText(/key rejected/i)).not.toBeInTheDocument();
  });

  it("does not claim a provider is broken when we simply could not reach it", async () => {
    stubRoutedFetch(providerPayload({
      probeVerdict: "unreachable",
      probeReason: "The provider did not respond in time.",
    }));
    await openPicker();

    expect(await screen.findByText(/unreachable/i)).toBeInTheDocument();
    expect(screen.queryByText(/key rejected/i)).not.toBeInTheDocument();
  });

  it("re-checks with a cache bypass, so a just-fixed key is not reported stale", async () => {
    const fetchMock = stubRoutedFetch(providerPayload({
      credentialReady: false, probeVerdict: "not_configured", probeReason: null, probeLive: false,
    }));
    const user = await openPicker();
    await user.click(await screen.findByRole("button", { name: /claude/i }));
    await user.click(await screen.findByRole("button", { name: /check again/i }));

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("/api/bots/providers?refresh=1"))).toBe(true);
  });
});

describe("subscription sign-in", () => {
  const notConfigured = {
    credentialReady: false, probeVerdict: "not_configured",
    probeReason: null, probeLive: false,
  };

  function stubWithConnect(providers: unknown, command = "npx -y tsx scripts/connect.mts claude --code abc --host https://f.test") {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).startsWith("/api/bots/providers")) {
        return { ok: true, status: 200, json: async () => providers };
      }
      if (String(url) === "/api/bots/connect") {
        return { ok: true, status: 200, json: async () => ({ command, expiresInSeconds: 600 }) };
      }
      if (init?.method === "POST") return { ok: true, status: 201, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => fabricPayload };
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("offers subscription sign-in ahead of the API key for Claude", async () => {
    stubWithConnect(providerPayload(notConfigured));
    const user = await openPicker();
    await user.click(await screen.findByRole("button", { name: /claude/i }));

    expect(await screen.findByRole("button", { name: /sign in with anthropic/i }))
      .toBeInTheDocument();
    // The key route is still reachable, but named as the alternative and named
    // as billed, so the free path is the obvious one.
    expect(screen.getByText(/or use an api key instead \(billed per token\)/i))
      .toBeInTheDocument();
  });

  it("hands over one command and never a token", async () => {
    const command = "npx -y tsx scripts/connect.mts claude --code SECRETCODE --host https://f.test";
    stubWithConnect(providerPayload(notConfigured), command);
    const user = await openPicker();
    await user.click(await screen.findByRole("button", { name: /claude/i }));
    await user.click(await screen.findByRole("button", { name: /sign in with anthropic/i }));

    expect(await screen.findByText(command)).toBeInTheDocument();
    // The browser is told what to run and learns nothing else. The token comes
    // back from the operator's machine straight to the server.
    expect(screen.getByText(/works once and expires in 10 minutes/i)).toBeInTheDocument();
  });

  it("re-checks with a cache bypass once the operator says they ran it", async () => {
    const fetchMock = stubWithConnect(providerPayload(notConfigured));
    const user = await openPicker();
    await user.click(await screen.findByRole("button", { name: /claude/i }));
    await user.click(await screen.findByRole("button", { name: /sign in with anthropic/i }));
    await user.click(await screen.findByRole("button", { name: /i have run it/i }));

    const urls = fetchMock.mock.calls.map((call) => String(call[0]));
    expect(urls.some((url) => url.includes("/api/bots/providers?refresh=1"))).toBe(true);
  });

  it("reports a refusal from the server rather than showing a dead command", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).startsWith("/api/bots/providers")) {
        return { ok: true, status: 200, json: async () => providerPayload(notConfigured) };
      }
      if (String(url) === "/api/bots/connect") {
        return {
          ok: false, status: 503,
          json: async () => ({ error: { message: "SOFTWAREFACTORY_CREDENTIAL_KEY is not set." } }),
        };
      }
      return { ok: true, status: 200, json: async () => fabricPayload };
    });
    vi.stubGlobal("fetch", fetchMock);

    const user = await openPicker();
    await user.click(await screen.findByRole("button", { name: /claude/i }));
    await user.click(await screen.findByRole("button", { name: /sign in with anthropic/i }));

    // A command that could never be redeemed would fail minutes later with no
    // explanation.
    expect(await screen.findByText(/CREDENTIAL_KEY is not set/i)).toBeInTheDocument();
    expect(screen.queryByText(/scripts\/connect.mts/)).not.toBeInTheDocument();
  });

  it("does not offer subscription sign-in for a provider that has none", async () => {
    stubWithConnect(providerPayload({
      ...notConfigured, id: "groq", label: "Groq", vendor: "Groq",
      credentialRef: "GROQ_API_KEY",
    }));
    const user = await openPicker();
    await user.click(await screen.findByRole("button", { name: /groq/i }));

    expect(screen.queryByRole("button", { name: /sign in with groq/i })).not.toBeInTheDocument();
    expect(await screen.findByText(/two steps and groq is ready/i)).toBeInTheDocument();
  });
});

describe("one click is offered for every provider, not just OpenRouter", () => {
  const notConfigured = {
    credentialReady: false, probeVerdict: "not_configured",
    probeReason: null, probeLive: false,
  };

  function stubConnect(providers: unknown) {
    const fetchMock = vi.fn(async (url: string) => {
      if (String(url).startsWith("/api/bots/providers")) {
        return { ok: true, status: 200, json: async () => providers };
      }
      return { ok: true, status: 200, json: async () => fabricPayload };
    });
    vi.stubGlobal("fetch", fetchMock);
    return fetchMock;
  }

  it("offers Claude in one click, ahead of the terminal route", async () => {
    // The friction that mattered: clicking Claude used to lead to a command.
    // OpenRouter serves Claude models and has a real third-party OAuth flow,
    // so the fastest path to Claude is a single link.
    stubConnect(providerPayload(notConfigured));
    const user = await openPicker();
    await user.click(await screen.findByRole("button", { name: /claude/i }));

    const oneClick = await screen.findByRole("link", { name: /sign in with openrouter/i });
    expect(oneClick).toHaveAttribute("href", "/api/bots/connect/oauth/start");
    expect(screen.getByText(/get claude in one click/i)).toBeInTheDocument();
  });

  it("keeps the zero-cost subscription route available as the alternative", async () => {
    stubConnect(providerPayload(notConfigured));
    const user = await openPicker();
    await user.click(await screen.findByRole("button", { name: /claude/i }));

    // Still there, and still labelled as the one that bills nothing per token.
    expect(await screen.findByText(/or use your anthropic subscription instead/i))
      .toBeInTheDocument();
    expect(screen.getByText(/bills nothing per token/i)).toBeInTheDocument();
  });

  it("does not offer OpenRouter to itself twice", async () => {
    stubConnect(providerPayload({
      ...notConfigured, id: "openrouter", label: "OpenRouter", vendor: "OpenRouter",
      credentialRef: "OPENROUTER_API_KEY",
    }));
    const user = await openPicker();
    await user.click(await screen.findByRole("button", { name: /openrouter/i }));

    expect(screen.queryByText(/get openrouter in one click/i)).not.toBeInTheDocument();
    expect(await screen.findAllByRole("link", { name: /sign in with openrouter/i }))
      .toHaveLength(1);
  });
});
