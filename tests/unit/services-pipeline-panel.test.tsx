import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ServicesPipelinePanel } from "@/components/services/pipeline-panel";

/**
 * The pipeline as a person works it: the board and its report render from
 * the live payload, an empty board names the next step, creation posts the
 * real body with dollars converted to cents, an ordinary stage move PATCHes
 * immediately, and marking a deal lost asks for the reason before anything
 * is sent.
 */

const accountId = "20000000-0000-4000-8000-0000000c0001";
const opportunity = {
  id: "40000000-0000-4000-8000-0000000c0001",
  accountId,
  name: "Quarterly IPM program",
  stage: "new",
  valueCents: 240000,
  expectedCloseDate: null,
  notes: null,
  lostReason: null,
  closedAt: null,
  createdAt: "2026-08-30T10:00:00Z",
  updatedAt: "2026-08-30T10:00:00Z",
};

const emptyStage = { count: 0, valueCents: 0 };
const report = {
  byStage: {
    new: { count: 1, valueCents: 240000 },
    contacted: emptyStage,
    inspection: emptyStage,
    proposal: emptyStage,
    negotiation: emptyStage,
    won: { count: 1, valueCents: 100000 },
    lost: { count: 1, valueCents: 0 },
  },
  openCount: 1,
  openValueCents: 240000,
  wonCount: 1,
  wonValueCents: 100000,
  lostCount: 1,
  winRatePercent: 50,
};

const accountsPayload = {
  accounts: [
    {
      id: accountId,
      name: "Harborview Foods",
      kind: "commercial",
      status: "lead",
      email: null,
      phone: null,
      source: null,
      billingAddress: null,
      notes: null,
      createdAt: "2026-08-30T10:00:00Z",
      updatedAt: "2026-08-30T10:00:00Z",
    },
  ],
  counts: { byStatus: { lead: 1 }, byKind: { commercial: 1 }, total: 1 },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

function serve(handlers: {
  pipeline?: unknown;
  onPost?: (body: unknown) => Response;
  onPatch?: (url: string, body: unknown) => Response;
}) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (init?.method === "POST" && handlers.onPost) {
      return Promise.resolve(handlers.onPost(JSON.parse(init.body as string)));
    }
    if (init?.method === "PATCH" && handlers.onPatch) {
      return Promise.resolve(handlers.onPatch(url, JSON.parse(init.body as string)));
    }
    if (url.startsWith("/api/services/opportunities")) {
      return Promise.resolve(json(handlers.pipeline ?? { opportunities: [opportunity], report }));
    }
    return Promise.resolve(json(accountsPayload));
  });
}

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("the pipeline panel", () => {
  it("renders the live board and its report from one payload", async () => {
    serve({});
    render(<ServicesPipelinePanel />);

    const boardReport = await screen.findByTestId("services-pipeline-report");
    expect(within(boardReport).getByText("$2,400")).toBeInTheDocument();
    expect(within(boardReport).getByText("50%")).toBeInTheDocument();
    const board = screen.getByTestId("services-pipeline-board");
    expect(within(board).getByText("Quarterly IPM program")).toBeInTheDocument();
    expect(within(board).getByText("Harborview Foods")).toBeInTheDocument();
  });

  it("an empty board names its next step", async () => {
    serve({
      pipeline: {
        opportunities: [],
        report: { ...report, byStage: { ...report.byStage, new: emptyStage, won: emptyStage, lost: emptyStage } },
      },
    });
    render(<ServicesPipelinePanel />);

    const empty = await screen.findByTestId("services-pipeline-empty");
    expect(empty.textContent).toContain("New opportunity");
  });

  it("creates through the real route, converting dollars to cents", async () => {
    let posted: unknown = null;
    serve({
      pipeline: { opportunities: [], report },
      onPost: (body) => {
        posted = body;
        return json({ opportunity: { ...opportunity, name: "Initial treatment" } }, 201);
      },
    });
    const user = userEvent.setup();
    render(<ServicesPipelinePanel />);
    await screen.findByTestId("services-pipeline-empty");

    await user.click(screen.getByRole("button", { name: "New opportunity" }));
    await user.selectOptions(screen.getByLabelText("Account"), accountId);
    await user.type(
      screen.getByPlaceholderText("Quarterly IPM service, initial treatment…"),
      "Initial treatment",
    );
    await user.type(screen.getByLabelText(/Value in dollars/), "2400");
    await user.click(screen.getByRole("button", { name: "Record opportunity" }));

    expect(posted).toEqual({
      accountId,
      name: "Initial treatment",
      valueCents: 240000,
    });
  });

  it("moves a stage immediately, but asks the reason before marking lost", async () => {
    const patched: { url: string; body: unknown }[] = [];
    serve({
      onPatch: (url, body) => {
        patched.push({ url, body });
        return json({ opportunity: { ...opportunity, ...(body as object) } });
      },
    });
    const user = userEvent.setup();
    render(<ServicesPipelinePanel />);
    await screen.findByTestId("services-pipeline-board");

    const stageSelect = screen.getByLabelText(`Stage for ${opportunity.name}`);
    await user.selectOptions(stageSelect, "contacted");
    expect(patched).toEqual([
      { url: `/api/services/opportunities/${opportunity.id}`, body: { stage: "contacted" } },
    ]);

    await user.selectOptions(screen.getByLabelText(`Stage for ${opportunity.name}`), "lost");
    // Nothing sent yet — the reason is asked for first.
    expect(patched).toHaveLength(1);
    await user.type(
      screen.getByPlaceholderText("Price, timing, went with another provider…"),
      "Went with another provider",
    );
    await user.click(screen.getByRole("button", { name: "Mark lost" }));
    expect(patched[1]).toEqual({
      url: `/api/services/opportunities/${opportunity.id}`,
      body: { stage: "lost", lostReason: "Went with another provider" },
    });
  });
});
