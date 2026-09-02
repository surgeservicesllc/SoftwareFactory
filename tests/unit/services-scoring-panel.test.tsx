import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServicesScoringPanel } from "@/components/services/scoring-panel";
import { SCORING_DEFAULTS, signedPoints } from "@/lib/services/scoring";

/**
 * The page prints every point beside its fact, switches models by
 * re-reading, saves a rule as {model, ruleKey, points, active}, resets by
 * deleting, and runs the postal assignment as a single request whose
 * count it repeats verbatim.
 */

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

const leadBoard = {
  model: "lead",
  rules: SCORING_DEFAULTS.filter((rule) => rule.model === "lead").map((rule) => ({
    ruleKey: rule.ruleKey, label: rule.label, points: rule.points, defaultPoints: rule.points,
    active: true, overridden: rule.ruleKey === "commercial",
  })),
  accounts: [
    {
      accountId: "a1", name: "Ridgeway Bakery", kind: "commercial", status: "lead", score: 65,
      breakdown: [
        { rule: "commercial", label: "Commercial account", points: 15, fact: "Commercial account" },
        { rule: "estimate_sent", label: "An estimate sent", points: 15, fact: "An estimate is out, undecided" },
        { rule: "silent_30d", label: "No activity in 30 days", points: -10, fact: "No activity ever recorded" },
      ],
    },
  ],
  counts: { scored: 1, average: 65, top: 65, overridden: 1 },
};
const churnBoard = {
  model: "churn",
  rules: [],
  accounts: [{
    accountId: "c1", name: "Harborview Foods", kind: "commercial", status: "customer", score: 75,
    breakdown: [{ rule: "visit_overdue", label: "x", points: 25, fact: "An active plan is 30 days past due" }],
  }],
  counts: { scored: 1, average: 75, top: 75, overridden: 0 },
};

function mockFetch() {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("/assign")) return jsonResponse({ assigned: 3 });
    if (url.endsWith("/rules")) return jsonResponse({ rule: {} });
    if (url.includes("model=churn")) return jsonResponse(churnBoard);
    return jsonResponse(leadBoard);
  }));
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("signedPoints", () => {
  it("prints a real minus sign", () => {
    expect(signedPoints(15)).toBe("+15");
    expect(signedPoints(-10)).toBe("−10");
  });
});

describe("ServicesScoringPanel", () => {
  it("prints the score with every point beside its fact", async () => {
    mockFetch();
    render(<ServicesScoringPanel />);
    const list = await screen.findByTestId("signals-accounts");
    expect(within(list).getByLabelText("Score 65")).toBeInTheDocument();
    expect(within(list).getByText("An estimate is out, undecided")).toBeInTheDocument();
    expect(within(list).getByText("−10")).toBeInTheDocument();
    expect(within(list).getByText("No activity ever recorded")).toBeInTheDocument();
  });

  it("switches model by re-reading", async () => {
    const calls = mockFetch();
    render(<ServicesScoringPanel />);
    await screen.findByText("Ridgeway Bakery");
    await userEvent.click(screen.getByRole("tab", { name: "Churn risk" }));
    await screen.findByText("Harborview Foods");
    expect(calls.some((call) => call.url === "/api/services/scoring?model=churn")).toBe(true);
    expect(screen.getByText("An active plan is 30 days past due")).toBeInTheDocument();
  });

  it("saves a rule with the model, key, points and switch, and resets by deleting", async () => {
    const calls = mockFetch();
    render(<ServicesScoringPanel />);
    await screen.findByText("Ridgeway Bakery");

    const points = screen.getByLabelText("Points for Commercial account");
    await userEvent.clear(points);
    await userEvent.type(points, "30");
    const row = points.closest("li")!;
    await userEvent.click(within(row).getByRole("button", { name: "Save" }));
    await waitFor(() => {
      const put = calls.find((call) => call.init?.method === "PUT");
      expect(put).toBeDefined();
      expect(JSON.parse(String(put!.init!.body))).toEqual({
        model: "lead", ruleKey: "commercial", points: 30, active: true,
      });
    });

    await userEvent.click(within(row).getByRole("button", { name: "Reset" }));
    await waitFor(() => {
      const del = calls.find((call) => call.init?.method === "DELETE");
      expect(del).toBeDefined();
      expect(JSON.parse(String(del!.init!.body))).toEqual({ model: "lead", ruleKey: "commercial" });
    });
  });

  it("only offers Reset on a rule that is actually overridden", async () => {
    mockFetch();
    render(<ServicesScoringPanel />);
    await screen.findByText("Ridgeway Bakery");
    const untouched = screen.getByLabelText("Points for Email on file").closest("li")!;
    expect(within(untouched).getByRole("button", { name: "Reset" })).toBeDisabled();
    const changed = screen.getByLabelText("Points for Commercial account").closest("li")!;
    expect(within(changed).getByRole("button", { name: "Reset" })).toBeEnabled();
  });

  it("runs the postal assignment and repeats the count it was given", async () => {
    const calls = mockFetch();
    render(<ServicesScoringPanel />);
    await screen.findByText("Ridgeway Bakery");
    await userEvent.click(screen.getByRole("button", { name: /Assign unassigned accounts/ }));
    expect(await screen.findByRole("status")).toHaveTextContent("3 accounts assigned, each with a line on its history.");
    expect(calls.some((call) => call.url.endsWith("/assign") && call.init?.method === "POST")).toBe(true);
  });
});
