import { render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentOsConsole } from "@/components/agentos-console";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
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

describe("AgentOS console", () => {
  it("asks a signed-out visitor to sign in rather than showing an empty workspace", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() =>
      Promise.resolve(jsonResponse({ error: { code: "unauthorized" } }, 401)),
    ));

    render(<AgentOsConsole />);

    expect(await screen.findByText("Sign in to see agent permissions")).toBeInTheDocument();
  });

  it("says an ungranted agent has nothing rather than leaving it blank", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string) =>
      Promise.resolve(input.includes("/grants")
        ? jsonResponse({
            agentGrants: [{
              agentId: "a1",
              agentName: "customer-support",
              configured: false,
              inboxAccess: false,
              runnerPreference: "inherit",
              environment: { name: null, networking: "limited", allowedHostCount: 0 },
              counts: { mcpConnections: 0, skills: 0, repos: 0, filesystemGrants: 0, collaborators: 0 },
            }],
          })
        : jsonResponse({})),
    ));

    render(<AgentOsConsole />);

    // Default deny is a real state, not a rendering gap.
    expect(await screen.findByText("Nothing granted")).toBeInTheDocument();
    expect(screen.getByText("customer-support")).toBeInTheDocument();
  });

  it("names the rail that stopped a goal, and flags an uncapped one", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string) =>
      Promise.resolve(input.includes("/goals")
        ? jsonResponse({
            goals: [{
              id: "g1",
              title: "Ship search",
              status: "stopped_spend",
              projectName: "Storefront",
              definitionOfDone: { total: 3, satisfied: 1 },
              spend: { capUsd: null, spentUsd: "12.00", uncappedAcknowledged: true },
              iterations: 4,
              stoppedReason: "spend 12.00 reached the cap",
            }],
          })
        : jsonResponse({})),
    ));

    render(<AgentOsConsole />);

    expect(await screen.findByText("spend 12.00 reached the cap")).toBeInTheDocument();
    expect(screen.getByText(/Running without a spend cap/)).toBeInTheDocument();
  });

  it("marks the chain step that needs a person", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string) =>
      Promise.resolve(input.includes("/chains")
        ? jsonResponse({
            chains: [{
              id: "c1",
              title: "Add search",
              templateName: "Compound engineer feature build",
              projectName: "Storefront",
              progress: { total: 9, done: 0 },
              currentStep: { name: "Write a spec", state: "review", approvalGate: true },
            }],
          })
        : jsonResponse({})),
    ));

    render(<AgentOsConsole />);

    expect(await screen.findByText(/needs your approval/)).toBeInTheDocument();
  });

  it("warns when a trigger cannot accept anything", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation((input: string) =>
      Promise.resolve(input.includes("/triggers")
        ? jsonResponse({
            triggers: [{
              id: "t1",
              displayName: "Support inbound",
              agentName: "customer-support",
              projectName: "Storefront",
              enabled: true,
              secretConfigured: false,
              deliveries: { total: 3, accepted: 0, rejected: 3 },
              lastReceivedAt: null,
            }],
          })
        : jsonResponse({})),
    ));

    render(<AgentOsConsole />);

    // Enabled but unusable is exactly the state worth stating.
    expect(await screen.findByText(/No signing secret configured/)).toBeInTheDocument();
    expect(screen.getByText(/3 refused/)).toBeInTheDocument();
  });

  it("states that nothing needs the human when the inbox is clear", async () => {
    // A fresh Response per call: a body can only be read once, and five
    // sections fetch concurrently.
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() =>
      Promise.resolve(jsonResponse({ messages: [] })),
    ));

    render(<AgentOsConsole />);

    // Five sections load concurrently, so this one can land past the
    // one-second default.
    expect(await screen.findByText("Nothing needs you", {}, { timeout: 5000 }))
      .toBeInTheDocument();
    expect(screen.queryByText(/Demo Data/i)).not.toBeInTheDocument();
  });
});
