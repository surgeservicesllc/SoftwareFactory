import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentsConsole } from "@/components/agents-console";
import {
  ProviderStatusPanel,
  type ProviderStatus,
} from "@/components/provider-status-panel";
import { RunsConsole } from "@/components/runs-console";
import { STANDARD_MODEL_CATALOGUE } from "@/lib/providers/standard-catalogue";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

const anthropicConnected: ProviderStatus = {
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

const openaiNotConfigured: ProviderStatus = {
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

function providerPayload(
  executionEnabled = false,
  role = "owner",
  providers: ProviderStatus[] = [anthropicConnected, openaiNotConfigured],
) {
  return jsonResponse({
    executionEnabled,
    organization: { id: "10000000-0000-4000-8000-000000000001", name: "Factory", role },
    providers,
  });
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "sb_publishable_test_value");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
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

describe("AgentsConsole provider assignment", () => {
  const agentId = "40000000-0000-4000-8000-000000000001";
  const baseAgent: {
    id: string;
    name: string;
    role: string;
    description: string | null;
    status: string;
    provider: string | null;
    model: string | null;
    providerConnectionStatus: string | null;
    currentAssignment: string | null;
    lastRunAt: string | null;
    capabilities: string[];
    project: { id: string; name: string } | null;
  } = {
    id: agentId,
    name: "Security Reviewer",
    role: "security",
    description: "Reviews sensitive changes without owning a provider account.",
    status: "idle",
    provider: null,
    model: null,
    providerConnectionStatus: null,
    currentAssignment: null,
    lastRunAt: null,
    capabilities: ["security review"],
    project: null,
  };
  const openaiConfiguredButNotConnected: ProviderStatus = {
    ...openaiNotConfigured,
    configuredModels: [{
      id: "cfg-openai-1",
      provider: "openai",
      model: "gpt-5.3-codex",
      displayName: "GPT-5.3 Codex",
      enabled: true,
      isDefault: true,
    }],
  };

  it("keeps the logical role separate and saves the exact enabled provider/model preference", async () => {
    let agents = [baseAgent];
    const assignments: unknown[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/providers") {
        return providerPayload(false, "owner", [anthropicConnected, openaiConfiguredButNotConnected]);
      }
      if (url === `/api/agents/${agentId}/assignment`) {
        const assignment = JSON.parse(String(init?.body)) as { provider: string | null; model: string | null };
        assignments.push(assignment);
        agents = [{
          ...baseAgent,
          provider: assignment.provider,
          model: assignment.model,
          providerConnectionStatus: "configured",
        }];
        return jsonResponse({ agent: { id: agentId, name: baseAgent.name, ...assignment } });
      }
      if (url === "/api/agents") return jsonResponse({ agents });
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentsConsole />);

    expect(await screen.findByText("Security Reviewer")).toBeInTheDocument();
    expect(screen.getByText(/logical agent, project, provider account/)).toBeInTheDocument();
    expect(await screen.findAllByText("Not Connected")).not.toHaveLength(0);

    const selector = screen.getByRole("combobox", { name: "Provider assignment for Security Reviewer" });
    expect(selector).toBeEnabled();
    expect(selector.closest("ul")).toHaveClass("md:grid-cols-2", "xl:grid-cols-3");

    await userEvent.selectOptions(selector, "openai|gpt-5.3-codex");

    await waitFor(() => expect(assignments).toEqual([
      { provider: "openai", model: "gpt-5.3-codex" },
    ]));
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Security Reviewer now prefers OpenAI / Codex / gpt-5.3-codex.",
    );
    expect(screen.getByText("Configured")).toBeInTheDocument();
    expect(screen.getByText("Not Connected - Not Configured")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledWith(
      `/api/agents/${agentId}/assignment`,
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("offers the standard catalogue when nothing is enabled, and every agent becomes selectable", async () => {
    /*
     * The dead end this closes: the assignment RPC only accepts enabled
     * catalogue configurations, and a fresh organization has none — so every
     * select offered exactly one row, "Automatic routing", with the way out
     * hidden on the settings page. One click seeds the standard models
     * through the same upsert endpoint the settings page uses.
     */
    const seeded: Array<{ provider: string; model: string; displayName: string }> = [];
    const anthropicEmpty: ProviderStatus = {
      ...anthropicConnected,
      configuredModels: [],
    };
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/providers") {
        return seeded.length === 0
          ? providerPayload(false, "owner", [anthropicEmpty, openaiNotConfigured])
          : providerPayload(false, "owner", [
            {
              ...anthropicConnected,
              configuredModels: seeded
                .filter((entry) => entry.provider === "anthropic")
                .map((entry, index) => ({
                  id: `cfg-${index}`,
                  provider: "anthropic",
                  model: entry.model,
                  displayName: entry.displayName,
                  enabled: true,
                  isDefault: false,
                })),
            },
            openaiNotConfigured,
          ]);
      }
      if (url === "/api/providers/models" && init?.method === "POST") {
        seeded.push(JSON.parse(String(init.body)) as { provider: string; model: string; displayName: string });
        return jsonResponse({ model: { enabled: true } });
      }
      if (url === "/api/agents") return jsonResponse({ agents: [baseAgent] });
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentsConsole />);

    // No enabled models: the boundary names the dead end and offers the way out.
    expect(await screen.findByText(/Enable the standard catalogue to make each agent selectable/)).toBeInTheDocument();
    const enable = screen.getByRole("button", { name: "Enable the standard model catalogue" });
    await userEvent.click(enable);

    // Derived, not counted by hand: the catalogue is built from the provider
    // list, so a model added there is a change to this number and pinning a
    // literal only means editing two places instead of one.
    const standardCount = STANDARD_MODEL_CATALOGUE.length;
    const openAiCount = STANDARD_MODEL_CATALOGUE
      .filter((entry) => entry.provider === "openai").length;
    expect(await screen.findByRole("status")).toHaveTextContent(
      `${standardCount} standard models are enabled. Every agent below is now selectable.`,
    );
    // The standard list flows through the same upsert endpoint, one per model.
    expect(seeded).toHaveLength(standardCount);
    expect(seeded[0]).toMatchObject({ provider: "anthropic", model: "claude-opus-5", displayName: "Claude Opus 5" });
    expect(seeded.filter((entry) => entry.provider === "openai")).toHaveLength(openAiCount);
    // Every entry carries a real display name rather than falling back to the
    // raw identifier, which is what an unnamed new model would show.
    expect(seeded.every((entry) => !/^gpt-|^claude-/.test(entry.displayName))).toBe(true);

    // And the reloaded catalogue makes the agent's select a real choice.
    const selector = screen.getByRole("combobox", { name: "Provider assignment for Security Reviewer" });
    expect(
      within(selector).getByRole("option", { name: "Claude Opus 5 (Anthropic / Claude)" }),
    ).toBeInTheDocument();
  });

  it("fails closed with an explicit Not Connected state when provider status is unavailable", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/agents") return jsonResponse({
        agents: [{
          ...baseAgent,
          provider: "openai",
          model: "gpt-5.3-codex",
          providerConnectionStatus: "configured",
        }],
      });
      if (url === "/api/providers") {
        return jsonResponse({ error: { message: "Provider status is temporarily unavailable." } }, 503);
      }
      throw new Error(`Unexpected fetch ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentsConsole />);

    const selector = await screen.findByRole("combobox", { name: "Provider assignment for Security Reviewer" });
    expect(await screen.findByText("Not Connected - provider status unavailable")).toBeInTheDocument();
    expect(selector).toBeDisabled();
    expect(screen.getByRole("button", { name: "Retry provider status" })).toBeInTheDocument();
    expect(screen.getByText(/current assignment remains unchanged/i)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalledWith(
      expect.stringContaining("/assignment"),
      expect.anything(),
    );
  });

  it("renders member assignments read-only while the server remains the authorization boundary", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/agents") return jsonResponse({ agents: [baseAgent] });
      if (url === "/api/providers") return providerPayload(false, "member");
      throw new Error(`Unexpected fetch ${url}`);
    }));

    render(<AgentsConsole />);

    const selector = await screen.findByRole("combobox", { name: "Provider assignment for Security Reviewer" });
    expect(await screen.findByText(/Assignments are read-only for this workspace role/)).toBeInTheDocument();
    expect(selector).toBeDisabled();
    expect(screen.getByText(/Owner or administrator access is required/)).toBeInTheDocument();
  });

  it("does not probe provider status for a signed-out visitor", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ error: { code: "unauthorized" } }, 401),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<AgentsConsole />);

    expect(await screen.findByText("Sign in to see your agents")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith("/api/agents", { cache: "no-store" });
  });

  it("shows loading, error, and empty roster states without demo agents", async () => {
    let resolveAgents: ((response: Response) => void) | undefined;
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/agents") {
        return new Promise<Response>((resolve) => { resolveAgents = resolve; });
      }
      if (url === "/api/providers") return Promise.resolve(providerPayload());
      return Promise.reject(new Error(`Unexpected fetch ${url}`));
    });
    vi.stubGlobal("fetch", fetchMock);

    const view = render(<AgentsConsole />);
    expect(await screen.findByLabelText("Loading logical agents")).toBeInTheDocument();

    resolveAgents?.(jsonResponse({ agents: [] }));
    expect(await screen.findByText("No agents yet")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Initialize standard roster" })).toBeInTheDocument();
    expect(screen.queryByText(/Demo Data/i)).not.toBeInTheDocument();

    view.unmount();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      jsonResponse({ error: { message: "Agent records are unavailable." } }, 500),
    ));
    render(<AgentsConsole />);
    expect(await screen.findByText("Agent records are unavailable.")).toBeInTheDocument();
  });
});

describe("RunsConsole provider evidence", () => {
  const runId = "50000000-0000-4000-8000-000000000001";
  const run = {
    id: runId,
    status: "succeeded",
    startedAt: "2026-08-13T12:00:00.000Z",
    completedAt: "2026-08-13T12:01:00.000Z",
    createdAt: "2026-08-13T12:00:00.000Z",
    durationMs: 60_000,
    risk: "green",
    provider: "openai",
    model: "gpt-5.3-codex",
    branch: "factory/run-provider-evidence",
    project: { id: "project-1", name: "SoftwareFactory" },
    task: { id: "task-1", title: "Audit provider routing" },
    agent: { id: "agent-1", name: "Security Reviewer" },
  };

  it("shows bounded durable provider/model routing evidence without inferring live health", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/runs") return jsonResponse({ runs: [run] });
      if (url === `/api/runs/${runId}`) return jsonResponse({ run: {
        ...run,
        agent: { ...run.agent, role: "security" },
        command: { id: "command-1", prompt: "Audit provider routing" },
        routing: {
          source: "AGENT_ASSIGNMENT",
          policyVersion: "phase2a-routing-v1",
          reasons: [{
            code: "AGENT_ASSIGNMENT_APPLIED",
            provider: "openai",
            detail: "The selected logical agent has an explicit OpenAI assignment.",
          }],
          candidates: [{
            provider: "openai",
            model: "gpt-5.3-codex",
            eligible: true,
            score: 0.91,
            ineligibleReasons: [],
          }],
        },
        validations: [],
        changedFiles: [],
        commits: [],
        checks: [],
      } });
      throw new Error(`Unexpected fetch ${url}`);
    }));

    render(<RunsConsole />);

    expect(await screen.findByText("Recorded target: OpenAI / Codex / gpt-5.3-codex")).toBeInTheDocument();
    const row = screen.getByText("Audit provider routing").closest("li");
    expect(row).toHaveClass("md:flex-row");
    await userEvent.click(within(row as HTMLElement).getByRole("button", { name: "View run" }));

    const evidence = await screen.findByRole("heading", { name: "Why this provider?" });
    const section = evidence.closest("section") as HTMLElement;
    expect(within(section).getByText("OpenAI / Codex")).toBeInTheDocument();
    expect(within(section).getByText("gpt-5.3-codex")).toBeInTheDocument();
    expect(within(section).getByText(/explicit OpenAI assignment/)).toBeInTheDocument();
    expect(within(section).getByText(/AGENT_ASSIGNMENT_APPLIED/)).toBeInTheDocument();
    expect(within(section).getByText("Score 0.910")).toBeInTheDocument();
    expect(within(section).getByText("gpt-5.3-codex")).toHaveClass("break-all");
    expect(within(section).getByText(/explicit OpenAI assignment/)).toHaveClass("break-words");
    expect(within(section).getByText(/AGENT_ASSIGNMENT_APPLIED/)).toHaveClass("break-all");
  });

  it("states when the bounded run projection contains no provider target", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({
      runs: [{ ...run, provider: null, model: null }],
    })));

    render(<RunsConsole />);

    expect(await screen.findByText("No provider/model routing target is recorded for this run.")).toBeInTheDocument();
  });
});
