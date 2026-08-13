import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ProviderStatusPanel } from "@/components/provider-status-panel";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

const anthropicConnected = {
  provider: "anthropic",
  label: "Anthropic / Claude",
  state: "connected",
  stateLabel: "Connected",
  detail: "The Anthropic model catalogue responded to a live request.",
  checkedAt: "2026-08-13T00:00:00.000Z",
  latencyMs: 220,
  defaultModel: "claude-opus-5",
  configuredModels: [
    {
      id: "cfg-1",
      provider: "anthropic",
      model: "claude-opus-5",
      displayName: "Claude Opus 5",
      enabled: true,
      isDefault: true,
    },
  ],
  environmentVariableNames: ["ANTHROPIC_API_KEY", "ANTHROPIC_DEFAULT_MODEL"],
};

const openaiNotConfigured = {
  provider: "openai",
  label: "OpenAI / Codex",
  state: "not_configured",
  stateLabel: "Not Configured",
  detail: "OPENAI_API_KEY is not set on the server.",
  checkedAt: "2026-08-13T00:00:00.000Z",
  latencyMs: null,
  defaultModel: null,
  configuredModels: [],
  environmentVariableNames: ["OPENAI_API_KEY", "OPENAI_DEFAULT_MODEL"],
};

function providerPayload(executionEnabled = false) {
  return jsonResponse({
    executionEnabled,
    providers: [anthropicConnected, openaiNotConfigured],
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ProviderStatusPanel", () => {
  it("shows the probed state for each provider and never a credential value", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(providerPayload()));

    render(<ProviderStatusPanel />);

    expect(await screen.findByText("Anthropic / Claude")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getByText("Not Configured")).toBeInTheDocument();
    expect(screen.getByText("OPENAI_API_KEY is not set on the server.")).toBeInTheDocument();
    expect(screen.getByText("Execution OFF")).toBeInTheDocument();
    // The panel prints variable names, and there is no value to print.
    expect(screen.getByText(/ANTHROPIC_API_KEY, ANTHROPIC_DEFAULT_MODEL/)).toBeInTheDocument();
  });

  it("reports the execution switch when an owner has enabled it", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(providerPayload(true)));

    render(<ProviderStatusPanel />);

    expect(await screen.findByText("Execution enabled")).toBeInTheDocument();
  });

  it("surfaces an unavailable status service with a retry", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ error: { message: "Provider status is unavailable." } }, 503))
      .mockResolvedValueOnce(providerPayload());
    vi.stubGlobal("fetch", fetchMock);

    render(<ProviderStatusPanel />);

    expect(await screen.findByText("Provider status is unavailable.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Retry/ }));
    expect(await screen.findByText("Anthropic / Claude")).toBeInTheDocument();
  });
});

/*
 * The AgentsConsole and RunsConsole suites that lived here exercised this
 * branch's provider-aware consoles. Those consoles read a richer shape than
 * the hardened `list_agents` / `list_agent_runs` safe-projection RPCs return,
 * so adopting them would have reverted the read path to direct table queries.
 * The list views therefore keep the RPC-backed consoles, and the provider
 * assignment control is tracked as follow-up work in AI/BACKLOG.md rather than
 * asserted against UI that this integration does not ship.
 */
