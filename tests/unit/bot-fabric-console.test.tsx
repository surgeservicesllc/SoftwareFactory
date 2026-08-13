import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BotFabricConsole } from "@/components/bot-fabric-console";

const fabricPayload = {
  activeOrganizationId: "11111111-2222-4333-8444-555555555555",
  canManage: true,
  bots: [
    {
      id: "bot-1",
      name: "Claude",
      provider: "anthropic",
      providerLabel: "Claude",
      providerVendor: "Anthropic",
      model: "claude-opus-5",
      credentialRef: "ANTHROPIC_API_KEY",
      credentialPresent: true,
      baseUrl: null,
      notes: null,
      readiness: "ready",
      readinessLabel: "Ready to assign",
      readinessTone: "safe",
      readinessDetail: "Credential reference resolves server-side. No worker is connected yet.",
      lastCheckedAt: "2026-08-12T10:00:00.000Z",
      currentReadiness: "ready",
      currentReadinessDetail: "Credential reference resolves server-side.",
      createdAt: "2026-08-12T09:00:00.000Z",
    },
  ],
  roles: [
    {
      id: "role-1",
      name: "Frontend engineer",
      slug: "frontend",
      summary: "Builds interface work.",
      instructions: "Implement interface changes.",
      riskCeiling: "GREEN",
      capabilities: ["ui"],
      createdAt: "2026-08-12T09:00:00.000Z",
      updatedAt: "2026-08-12T09:00:00.000Z",
    },
  ],
  assignments: [],
  projects: [
    {
      id: "project-1",
      name: "SoftwareFactory",
      status: "active",
      githubRepository: "surgeservicesllc/SoftwareFactory",
      healthStatus: "unknown",
    },
  ],
  executor: {
    connected: false,
    label: "Not Connected",
    detail:
      "Bots, roles, and assignments are control-plane records. No worker executes them in this phase.",
    globalKillSwitchActive: true,
  },
};

function stubFetch(response: { status: number; body?: unknown }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: response.status >= 200 && response.status < 300,
      status: response.status,
      json: async () => response.body ?? {},
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("BotFabricConsole", () => {
  it("asks an unauthenticated visitor to sign in rather than showing an empty fleet", async () => {
    stubFetch({ status: 401 });

    render(<BotFabricConsole />);

    expect(await screen.findByText(/sign in to manage your bots/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /sign in/i })).toHaveAttribute(
      "href",
      "/sign-in?next=/bot-manager",
    );
  });

  it("states that no worker is connected alongside the fleet", async () => {
    stubFetch({ status: 200, body: fabricPayload });

    render(<BotFabricConsole />);

    expect(await screen.findByText(/worker not connected/i)).toBeInTheDocument();
    expect(
      screen.getByText(/no worker executes them in this phase/i),
    ).toBeInTheDocument();
  });

  it("offers a one-step posting for every unassigned bot", async () => {
    stubFetch({ status: 200, body: fabricPayload });

    render(<BotFabricConsole />);

    expect(await screen.findByRole("button", { name: /assign claude/i })).toBeEnabled();
    expect(screen.getByLabelText(/project/i)).toHaveValue("project-1");
    expect(screen.getByLabelText(/role/i)).toHaveValue("role-1");
  });

  it("shows the credential reference name and never a credential value", async () => {
    stubFetch({ status: 200, body: fabricPayload });

    render(<BotFabricConsole />);

    expect(await screen.findByText(/ANTHROPIC_API_KEY/)).toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/sk-[A-Za-z0-9_-]{20,}/);
  });

  it("lets a manager reach the provider picker from the bots tab", async () => {
    stubFetch({ status: 200, body: fabricPayload });
    const user = userEvent.setup();

    render(<BotFabricConsole />);
    await user.click(await screen.findByRole("tab", { name: /bots/i }));

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /grok/i })).toBeInTheDocument();
    });
    expect(screen.getByRole("button", { name: /gemini/i })).toBeInTheDocument();
    expect(
      screen.getByText(/you reference the variable name, never paste a key/i),
    ).toBeInTheDocument();
  });

  it("hides management controls from a read-only member", async () => {
    stubFetch({ status: 200, body: { ...fabricPayload, canManage: false } });

    render(<BotFabricConsole />);

    expect(await screen.findByRole("button", { name: /assign claude/i })).toBeDisabled();
    expect(screen.getByText(/read access to this fabric/i)).toBeInTheDocument();
  });
});
