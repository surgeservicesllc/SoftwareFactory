import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AutonomyConsole } from "@/components/autonomy-console";

// `useTenantList` renders the sign-in path unless the browser client is
// configured, which it is not in a unit environment.
vi.mock("@/lib/supabase/browser-config", () => ({
  isBrowserSupabaseConfigured: () => true,
}));

/**
 * The Autonomy page's Clear control.
 *
 * What is worth asserting is the honesty of it: the first press asks, the
 * reason is required before it can fire, and the result says that nothing was
 * deleted — because "cleared" over a list of projects is exactly the word that
 * could be read as "gone".
 */

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

function statusRow(projectId: string, projectName: string) {
  return {
    projectId,
    projectName,
    autonomousMode: false,
    riskCeiling: "green",
    riskCeilingSource: "organization",
    killSwitchActive: false,
    releaseFrozen: false,
    executorConnected: false,
    actions: { enabled: 0, total: 9 },
    decisionsRecorded: 0,
    lastDecisionAt: null,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AutonomyConsole clear control", () => {
  it("asks first, requires a reason, and says nothing was deleted", async () => {
    let statusCalls = 0;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/autonomy/clear")) {
        return jsonResponse({ cleared: { archivedCount: 2, alreadyArchived: 0 } });
      }
      if (url.startsWith("/api/autonomy/decisions")) return jsonResponse({ decisions: [] });
      statusCalls += 1;
      // The second read is after the clear, and the list is empty because
      // archived projects are excluded by the database.
      return jsonResponse({
        status: statusCalls === 1
          ? [statusRow("p1", "SoftwareFactory"), statusRow("p2", "SoftwareFactory_08.21.2026")]
          : [],
      });
      void init;
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<AutonomyConsole />);
    await screen.findByText("SoftwareFactory");

    // One press asks rather than firing.
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(fetchMock.mock.calls.some(([url]) => String(url).startsWith("/api/autonomy/clear"))).toBe(false);

    const confirm = screen.getByRole("button", { name: /yes, archive them all/i });
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByLabelText(/reason/i), "clearing the autonomy list");
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);

    const call = fetchMock.mock.calls.find(([url]) => String(url).startsWith("/api/autonomy/clear"));
    expect(JSON.parse(String((call?.[1] as RequestInit).body))).toEqual({
      reason: "clearing the autonomy list",
    });

    // The result never lets "cleared" read as "destroyed".
    expect(await screen.findByText(/2 projects archived\./)).toBeInTheDocument();
    expect(screen.getByText(/Nothing was deleted/)).toBeInTheDocument();

    // And the section it clears is empty afterwards.
    expect(await screen.findByText("No projects yet")).toBeInTheDocument();
  });

  it("reports the database's own refusal rather than a paraphrase", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/autonomy/clear")) {
        return jsonResponse(
          { error: { message: "only an owner or admin may clear the autonomy list" } },
          403,
        );
      }
      if (url.startsWith("/api/autonomy/decisions")) return jsonResponse({ decisions: [] });
      return jsonResponse({ status: [statusRow("p1", "SoftwareFactory")] });
    }));

    render(<AutonomyConsole />);
    await screen.findByText("SoftwareFactory");

    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    await userEvent.type(screen.getByLabelText(/reason/i), "clearing the autonomy list");
    await userEvent.click(screen.getByRole("button", { name: /yes, archive them all/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "only an owner or admin may clear the autonomy list",
    );
  });

  it("puts the control beside Refresh, in the section it clears", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.startsWith("/api/autonomy/decisions")) return jsonResponse({ decisions: [] });
      return jsonResponse({ status: [statusRow("p1", "SoftwareFactory")] });
    }));

    render(<AutonomyConsole />);
    await screen.findByText("SoftwareFactory");

    // "What the loop may do" is the section the owner marked; the other
    // section must not gain a Clear it does not own.
    const heading = screen.getByRole("heading", { name: "What the loop may do" });
    const section = heading.closest("section") ?? heading.parentElement?.parentElement;
    expect(section).not.toBeNull();
    expect(within(section as HTMLElement).getByRole("button", { name: "Clear" })).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Clear" })).toHaveLength(1);
  });
});
