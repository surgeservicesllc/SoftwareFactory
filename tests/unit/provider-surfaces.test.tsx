import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentsConsole } from "@/components/agents-console";
import { ProviderStatusPanel } from "@/components/provider-status-panel";
import { RunsConsole } from "@/components/runs-console";

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

describe("AgentsConsole", () => {
  function stubAgentFetch(agents: unknown[], onAssignment?: (body: unknown) => void) {
    return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/providers") return providerPayload();
      if (url.endsWith("/assignment")) {
        onAssignment?.(JSON.parse(String(init?.body ?? "{}")));
        return jsonResponse({ agent: { id: "agent-1", name: "Security Reviewer" } });
      }
      return jsonResponse({ agents });
    });
  }

  it("offers the roster action when no agents exist", async () => {
    vi.stubGlobal("fetch", stubAgentFetch([]));

    render(<AgentsConsole />);

    expect(await screen.findByRole("heading", { name: "No agents defined" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Create standard roster/ })).toBeInTheDocument();
  });

  it("renders an agent as automatic until it is assigned a provider", async () => {
    vi.stubGlobal(
      "fetch",
      stubAgentFetch([
        {
          id: "agent-1",
          name: "Security Reviewer",
          role: "security",
          description: "Reviews sensitive changes.",
          status: "idle",
          provider: null,
          providerLabel: null,
          model: null,
          lastRunAt: null,
        },
      ]),
    );

    render(<AgentsConsole />);

    expect(await screen.findByText("Security Reviewer")).toBeInTheDocument();
    // "Automatic" appears as both the status badge and the provider value.
    expect(screen.getAllByText("Automatic")).toHaveLength(2);
    expect(screen.getByText("Chosen at run time")).toBeInTheDocument();
  });

  it("sends the chosen provider and model when an assignment changes", async () => {
    const assignments: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      stubAgentFetch(
        [
          {
            id: "agent-1",
            name: "Security Reviewer",
            role: "security",
            description: null,
            status: "idle",
            provider: null,
            providerLabel: null,
            model: null,
            lastRunAt: null,
          },
        ],
        (body) => assignments.push(body),
      ),
    );

    render(<AgentsConsole />);

    const select = await screen.findByLabelText("Provider assignment for Security Reviewer");
    await userEvent.selectOptions(select, "anthropic::claude-opus-5");

    await waitFor(() => expect(assignments).toHaveLength(1));
    expect(assignments[0]).toEqual({ provider: "anthropic", model: "claude-opus-5" });
  });
});

describe("RunsConsole", () => {
  it("shows an empty state rather than illustrative runs", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ runs: [] })));

    render(<RunsConsole />);

    expect(await screen.findByRole("heading", { name: "No provider runs recorded" })).toBeInTheDocument();
  });

  it("renders a recorded run with its routing explanation and fallback origin", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse({
          runs: [
            {
              id: "3f2a1b4c-0000-4000-8000-000000000001",
              taskKind: "implementation_review",
              status: "succeeded",
              provider: "openai",
              providerLabel: "OpenAI / Codex",
              model: "owner-selected-model",
              latencyMs: 4200,
              fallbackFromProvider: "anthropic",
              estimatedCostLabel: "Not declared",
              inputTokens: 1200,
              outputTokens: 420,
              errorMessage: null,
              summary: "No blocking defects found.",
              createdAt: "2026-08-13T00:00:00.000Z",
              routing: {
                decision: "ROUTED",
                source: "FALLBACK",
                requestedProvider: "AUTO",
                policyVersion: "phase2a-routing-v1",
                reasons: [
                  { code: "FALLBACK_APPLIED", detail: "Anthropic failed with rate_limited." },
                ],
              },
            },
          ],
        }),
      ),
    );

    render(<RunsConsole />);

    expect(await screen.findByText("implementation review")).toBeInTheDocument();
    expect(screen.getByText("Fallback from anthropic")).toBeInTheDocument();
    expect(screen.getByText("Not declared")).toBeInTheDocument();
    expect(screen.getByText("1200 / 420")).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: /Why this provider/ }));
    expect(screen.getByText("FALLBACK_APPLIED")).toBeInTheDocument();
    expect(screen.getByText(/Anthropic failed with rate_limited/)).toBeInTheDocument();
  });
});
