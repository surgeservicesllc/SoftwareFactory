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

    expect(await screen.findByText(/key detected/i)).toBeInTheDocument();
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
    stubRoutedFetch(providerPayload({ credentialReady: false }));
    await openPicker();

    expect(await screen.findByText(/needs a key/i)).toBeInTheDocument();
    expect(screen.queryByText(/key detected/i)).not.toBeInTheDocument();
  });

  it("shows the exact variable and a link to the page that issues a key", async () => {
    stubRoutedFetch(providerPayload({ credentialReady: false }));
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
    stubRoutedFetch(providerPayload({ credentialReady: false }), (body) => registered.push(body));
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
        return { ok: true, status: 200, json: async () => providerPayload({ credentialReady: ready }) };
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
    expect(await screen.findByText(/ANTHROPIC_API_KEY is set/i)).toBeInTheDocument();
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
    expect(screen.queryByText(/key detected/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/needs a key/i)).not.toBeInTheDocument();
  });
});

describe("a provider that needs no key", () => {
  it("is not described as missing one", async () => {
    stubRoutedFetch(providerPayload({
      id: "selfhosted", label: "Self-hosted", credentialRef: null,
      credentialReady: false, credentialOptional: true, apiKeyUrl: null,
    }));
    await openPicker();

    expect(await screen.findByText(/no key needed/i)).toBeInTheDocument();
    expect(screen.queryByText(/needs a key/i)).not.toBeInTheDocument();
  });
});
