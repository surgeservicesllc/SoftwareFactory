import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ResourceManagerConsole } from "@/components/resource-manager-console";

vi.mock("@/lib/supabase/browser-config", () => ({
  isBrowserSupabaseConfigured: () => true,
}));

/**
 * The hard part of this console is that almost everything in it is legitimately
 * empty, and an empty panel must say *which kind* of empty it is. These tests
 * mostly assert that distinction rather than that data renders.
 */

const emptyOverview = {
  policyVersion: "phase2c-resource-manager-v1",
  capabilities: ["planning", "coding", "security", "production_investigation"],
  executionState: "not_connected",
  executionLabel: "Not Connected",
  executionReason:
    "No provider run has executed, so no routing decision has ever been recorded against real work.",
  breakers: [],
  transitions: [],
  assignments: [],
};

const populatedOverview = {
  ...emptyOverview,
  breakers: [
    {
      target: "openai/gpt-5.3-codex",
      state: "open",
      fault: "outage",
      faultExplanation: "The provider could not be reached or returned a server error.",
      consecutiveFaults: 3,
      openedAt: "2026-08-14T12:00:00.000Z",
      cooldownMs: 120_000,
      reason: "3 consecutive outage failures.",
      updatedAt: "2026-08-14T12:00:00.000Z",
    },
  ],
  transitions: [
    {
      target: "openai/gpt-5.3-codex",
      fromState: "closed",
      toState: "open",
      fault: "outage",
      reason: "3 consecutive outage failures.",
      occurredAt: "2026-08-14T12:00:00.000Z",
    },
  ],
  assignments: [
    {
      id: "assignment-1",
      projectId: "project-1",
      nodeId: "node-1",
      decision: "ASSIGNED",
      objective: "BALANCED",
      mode: "AUTO",
      agentId: "engineer",
      provider: "anthropic",
      model: "claude-strong",
      reason: "Highest score on declared capability and configured preference; no recorded history yet.",
      policyVersion: "phase2c-resource-manager-v1",
      candidates: [
        {
          agentId: "engineer",
          provider: "anthropic",
          model: "claude-strong",
          eligible: true,
          score: 0.812345,
          rejections: [],
          notes: ["INSUFFICIENT_HISTORY"],
        },
        {
          agentId: "engineer",
          provider: "openai",
          model: "gpt-economical",
          eligible: false,
          score: 0,
          rejections: ["RISK_TIER_TOO_WEAK"],
          notes: ["RISK_REQUIRES_STRONG_MODEL"],
        },
      ],
      // The decision was made with no history, so no rate may be shown.
      predictedSuccessRate: null,
      predictionEvidenced: false,
      decidedAt: "2026-08-14T12:05:00.000Z",
    },
  ],
};

function stubFetch(body: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(body), { status })));
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Resource manager console", () => {
  it("tells a signed-out visitor to sign in instead of showing empty routing data", () => {
    render(<ResourceManagerConsole authenticated={false} />);
    expect(screen.getByRole("heading", { name: /sign in to see routing state/i })).toBeInTheDocument();
  });

  it("distinguishes 'nothing has failed' from 'proven healthy'", async () => {
    stubFetch(emptyOverview);
    render(<ResourceManagerConsole authenticated />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /no observed provider faults/i })).toBeInTheDocument(),
    );
    // The distinction is the entire point: an empty breaker table is an absence
    // of evidence, not evidence of health.
    expect(screen.getByText(/not that any provider has been proven healthy/i)).toBeInTheDocument();
  });

  it("says no decision has been recorded rather than showing an idle-looking zero", async () => {
    stubFetch(emptyOverview);
    render(<ResourceManagerConsole authenticated />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /no routing decisions recorded/i })).toBeInTheDocument(),
    );
    expect(screen.getByText(/no provider run has executed, so nothing has been routed/i)).toBeInTheDocument();
  });

  it("labels execution Not Connected with its reason, and claims nothing before the read lands", async () => {
    stubFetch(emptyOverview);
    render(<ResourceManagerConsole authenticated />);

    // While loading, the card must not already say "Not Connected": that is a
    // state read from the server, not a default. Asserting the reason (which
    // only exists after the response) rather than the label is also what keeps
    // this test from passing on the first render by accident.
    await waitFor(() =>
      expect(
        screen.getByText(/no provider run has executed, so no routing decision has ever been recorded/i),
      ).toBeInTheDocument(),
    );
    expect(screen.getByText("Not Connected")).toBeInTheDocument();
  });

  it("shows an open breaker with its fault explanation and cooldown", async () => {
    stubFetch(populatedOverview);
    render(<ResourceManagerConsole authenticated />);

    await waitFor(() => expect(screen.getAllByText("openai/gpt-5.3-codex").length).toBeGreaterThan(0));
    expect(screen.getByText("Open")).toBeInTheDocument();
    expect(screen.getByText(/could not be reached or returned a server error/i)).toBeInTheDocument();
    expect(screen.getByText("2 min")).toBeInTheDocument();
  });

  it("shows no percentage for an unevidenced prediction", async () => {
    stubFetch(populatedOverview);
    render(<ResourceManagerConsole authenticated />);

    await waitFor(() => expect(screen.getByText("No recorded history")).toBeInTheDocument());
    // A zero here would read as a measurement nobody made.
    expect(screen.queryByText("0%")).not.toBeInTheDocument();
  });

  it("shows why each candidate was or was not eligible", async () => {
    stubFetch(populatedOverview);
    render(<ResourceManagerConsole authenticated />);

    await waitFor(() => expect(screen.getByText("Eligible")).toBeInTheDocument());
    expect(screen.getByText("Ineligible")).toBeInTheDocument();
    expect(screen.getByText("RISK_TIER_TOO_WEAK")).toBeInTheDocument();
    expect(screen.getByText("INSUFFICIENT_HISTORY")).toBeInTheDocument();
  });

  it("infers nothing when the live source cannot be read", async () => {
    stubFetch({ error: { message: "boom" } }, 500);
    render(<ResourceManagerConsole authenticated />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /resource manager state is unavailable/i })).toBeInTheDocument(),
    );
    expect(screen.getByText(/nothing is inferred in its place/i)).toBeInTheDocument();
  });
});

describe("Resource manager model declarations", () => {
  function stubTwoFetches(overview: unknown, models: unknown, modelsOk = true) {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/api/resources/models")
          ? new Response(JSON.stringify(models), { status: modelsOk ? 200 : 500 })
          : new Response(JSON.stringify(overview), { status: 200 }),
      ),
    );
  }

  it("shows an undeclared model as refused rather than assuming a default", async () => {
    stubTwoFetches(emptyOverview, {
      models: [
        {
          provider: "anthropic",
          model: "claude-strong",
          enabled: true,
          strengthTier: null,
          contextLimitTokens: null,
          fullyDeclared: false,
        },
      ],
    });
    render(<ResourceManagerConsole authenticated />);

    await waitFor(() => expect(screen.getByText("anthropic/claude-strong")).toBeInTheDocument());
    // "Undeclared", never a guessed tier — that distinction is why routing
    // refuses these in the first place.
    expect(screen.getAllByText("Undeclared")).toHaveLength(2);
    expect(screen.getByText("Refused until declared")).toBeInTheDocument();
  });

  it("shows a fully declared model as routable", async () => {
    stubTwoFetches(emptyOverview, {
      models: [
        {
          provider: "openai",
          model: "gpt-5.3-codex",
          enabled: true,
          strengthTier: "strong",
          contextLimitTokens: 200000,
          fullyDeclared: true,
        },
      ],
    });
    render(<ResourceManagerConsole authenticated />);

    await waitFor(() => expect(screen.getByText("Routable")).toBeInTheDocument());
    expect(screen.getByText("strong")).toBeInTheDocument();
    expect(screen.getByText("200,000")).toBeInTheDocument();
  });

  it("keeps the page usable when declarations cannot be read, and infers nothing", async () => {
    stubTwoFetches(emptyOverview, { error: { message: "boom" } }, false);
    render(<ResourceManagerConsole authenticated />);

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: /model declarations could not be read/i })).toBeInTheDocument(),
    );
    // The rest of the console still rendered.
    expect(screen.getByRole("heading", { name: /no observed provider faults/i })).toBeInTheDocument();
  });
});
