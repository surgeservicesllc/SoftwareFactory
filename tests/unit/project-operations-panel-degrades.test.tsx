// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ProjectOperationsPanel } from "@/components/project-operations-panel";

/**
 * A payload this panel cannot read must cost the panel, not the page.
 *
 * Found by accident and worth keeping: a My Projects test whose mock returned
 * `{}` for the operations endpoint blanked the entire screen. The panel checked
 * that `operations` existed and then read `operations.project.healthState`, so
 * a response that parsed as JSON but arrived without `project` threw inside
 * render — and because this panel renders inside every project row, one
 * undefined took the whole list down with it.
 *
 * That is not a contrived shape. An older deploy, a partially degraded read, or
 * a projection that lost a field all produce it, and the difference between a
 * missing panel and a blank page is the difference between a small problem and
 * an outage.
 */

function mockOperations(payload: unknown, status = 200) {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(payload), { status })));
}

async function renderPanel() {
  render(<ProjectOperationsPanel projectId="p1" />);
  // Waiting on /production/i would match "Loading production status…" and let
  // every assertion run against the loading state, which passes for the wrong
  // reason. Wait for that text to go instead.
  await waitFor(() =>
    expect(screen.queryByText(/loading production status/i)).toBeNull());
}

describe("the project operations panel degrades instead of throwing", () => {
  beforeEach(() => vi.restoreAllMocks());
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it.each([
    ["an empty object", {}],
    ["no project", { incidents: [], monitors: [] }],
    ["no incidents", { monitors: [], project: { healthState: "healthy" } }],
    ["no monitors", { incidents: [], project: { healthState: "healthy" } }],
    ["a null project", { incidents: [], monitors: [], project: null }],
    // The one that got away from the first version of the guard: the panel
    // joins releaseAuthority.blockers, so a payload without it crashed even
    // after project/incidents/monitors were checked.
    ["no releaseAuthority", {
      incidents: [], monitors: [], project: { healthState: "healthy" },
      repairs: [], rollbacks: [],
    }],
  ])("says unavailable when the payload has %s", async (_label, payload) => {
    mockOperations(payload);
    await renderPanel();

    // Every field the panel reads is checked, not just the envelope.
    expect(screen.getByText(/production status is unavailable/i)).toBeTruthy();
  });

  it("still renders the real thing when the payload is complete", async () => {
    mockOperations({
      deployments: [],
      incidents: [{ id: "i1", severity: null, status: "resolved" }],
      monitors: [{ connectionState: "connected", id: "m1" }],
      project: {
        healthReason: "All checks passed.",
        healthState: "healthy",
        ownerAttentionRequired: false,
        releasesFrozen: false,
      },
      releaseAuthority: { blockers: [] },
      repairs: [],
      rollbacks: [],
    });
    await renderPanel();

    // The guard must not be so eager that it hides a panel that would work.
    expect(screen.queryByText(/production status is unavailable/i)).toBeNull();
    expect(screen.getByText("Production")).toBeTruthy();
  });
});
