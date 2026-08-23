import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ArtifactsConsole } from "@/components/artifacts-console";

/**
 * The artifacts page reports what exists, never what it contains.
 *
 * `graph_artifacts` revokes SELECT from `authenticated` entirely — a run's
 * outputs can carry repository contents and provider responses, and the browser
 * is not the boundary that decides who reads those. So the interesting
 * assertions here are about absence: no payload, and no number that was not
 * counted from a row.
 */

function respond(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  } as Response);
}

function runWith(overrides: Record<string, unknown> = {}) {
  return {
    graphRunId: "run-1",
    graphId: "graph-1",
    goal: "Add world-class backtesting to the trading platform.",
    topology: "DAG",
    riskLevel: "yellow",
    projectId: "project-1",
    state: "COMPLETED",
    startedAt: "2026-08-23T10:00:00.000Z",
    completedAt: "2026-08-23T10:30:00.000Z",
    nodes: [],
    edges: [],
    artifactCounts: {},
    isLifecycle: true,
    iteration: 1,
    maxIterations: 3,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the artifacts page", () => {
  it("says nothing has been produced when nothing has run", async () => {
    vi.stubGlobal("fetch", vi.fn(() => respond({ runs: [] })));
    render(<ArtifactsConsole />);

    expect(await screen.findByText("No artifact has been recorded")).toBeInTheDocument();
    expect(screen.getByText(/Nothing has been launched yet/)).toBeInTheDocument();
  });

  it("distinguishes runs that produced nothing from no runs at all", async () => {
    // An undispatched run is a real state today, and "nothing has been
    // launched" would be false about it.
    vi.stubGlobal("fetch", vi.fn(() => respond({ runs: [runWith(), runWith({ graphRunId: "run-2" })] })));
    render(<ArtifactsConsole />);

    expect(
      await screen.findByText(/2 runs have been recorded and none of them produced an artifact/),
    ).toBeInTheDocument();
  });

  it("counts each kind and says what the kind means", async () => {
    vi.stubGlobal("fetch", vi.fn(() => respond({
      runs: [runWith({
        artifactCounts: { RAW: 4, ANCHOR: 2 },
        nodes: [
          { node_key: "discover_packages", state: "COMPLETED", lifecycle_stage: "DISCOVER",
            artifact_count: 2, anchor_count: 2 },
          { node_key: "build_server", state: "COMPLETED", lifecycle_stage: "BUILD",
            artifact_count: 4, anchor_count: 0 },
        ],
      })],
    })));
    render(<ArtifactsConsole />);

    expect(await screen.findByText("4 RAW")).toBeInTheDocument();
    expect(screen.getByText("2 ANCHOR")).toBeInTheDocument();
    expect(
      screen.getByText(/the only kind that satisfies an evidence rule/),
    ).toBeInTheDocument();
  });

  it("attributes each artifact to the node and stage that produced it", async () => {
    vi.stubGlobal("fetch", vi.fn(() => respond({
      runs: [runWith({
        artifactCounts: { ANCHOR: 2 },
        nodes: [
          { node_key: "discover_packages", state: "COMPLETED", lifecycle_stage: "DISCOVER",
            artifact_count: 2, anchor_count: 2 },
        ],
      })],
    })));
    render(<ArtifactsConsole />);

    const row = (await screen.findByText("discover_packages")).closest("tr");
    expect(row).not.toBeNull();
    expect(within(row!).getByRole("link", { name: "2 Discover" }))
      .toHaveAttribute("href", "/solutions/factory/discover");
  });

  it("shows no payload anywhere", async () => {
    vi.stubGlobal("fetch", vi.fn(() => respond({
      runs: [runWith({
        artifactCounts: { RAW: 1 },
        nodes: [{ node_key: "n", state: "COMPLETED", lifecycle_stage: "BUILD", artifact_count: 1 }],
      })],
    })));
    render(<ArtifactsConsole />);

    await screen.findByText("1 RAW");
    expect(screen.queryByText(/payload/i)).not.toBeInTheDocument();
  });

  it("says so when a run's artifacts belong to no node", async () => {
    vi.stubGlobal("fetch", vi.fn(() => respond({
      runs: [runWith({ artifactCounts: { RAW: 3 }, nodes: [] })],
    })));
    render(<ArtifactsConsole />);

    expect(await screen.findByText(/none of them is attributed to a node/)).toBeInTheDocument();
  });

  it("sends someone signed out to sign in", async () => {
    vi.stubGlobal("fetch", vi.fn(() => respond({}, 401)));
    render(<ArtifactsConsole />);

    expect(await screen.findByRole("link", { name: "Sign in" }))
      .toHaveAttribute("href", "/auth/sign-in");
  });

  it("reports a failed read as a failed read", async () => {
    vi.stubGlobal("fetch", vi.fn(() => respond(
      { error: { message: "Artifacts could not be loaded." } },
      500,
    )));
    render(<ArtifactsConsole />);

    expect(await screen.findByText("Artifacts could not be read")).toBeInTheDocument();
  });
});
