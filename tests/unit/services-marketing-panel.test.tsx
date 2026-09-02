import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { ServicesMarketingPanel } from "@/components/services/marketing-panel";

/**
 * A rule's dry run: the button fetches the real endpoint for that rule and
 * the result states coverage first — how many would be acted on, how many
 * skipped and why — before listing each record with what would happen to
 * it. The send behind the rule stays labelled Not Connected.
 */

const automationId = "30000000-0000-4000-8000-0000000e0001";

const automation = {
  id: automationId, name: "Welcome new leads", triggerOn: "lead_created", action: "send_email", delayHours: 24,
  template: "Thanks for reaching out.", active: false, lastRunAt: null, runCount: 0,
  createdAt: "2026-04-01T00:00:00Z", updatedAt: "2026-04-01T00:00:00Z",
};

const payloads: Record<string, unknown> = {
  "/api/services/marketing/lists": { lists: [], counts: { total: 0, active: 0, members: 0, unsubscribed: 0 } },
  "/api/services/marketing/campaigns": { campaigns: [], counts: { total: 0, messages: 0, providerConnected: false } },
  "/api/services/marketing/automations": { automations: [automation] },
  "/api/services/attribution": { touches: [], firstTouch: {}, lastTouch: {}, counts: { total: 0, accounts: 0 } },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("the automation dry run", () => {
  it("fetches the rule's dry run and states coverage before listing what would happen", async () => {
    const calls: string[] = [];
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.startsWith("/api/services/marketing/automations/dry-run")) {
        return Promise.resolve(json({
          automation,
          window: { days: 30 },
          records: [
            { recordKind: "account", recordId: "r1", accountId: "a1", accountName: "Northgate Lead", occurredAt: "2026-04-10T09:00:00Z", firesAt: "2026-04-11T09:00:00Z", wouldDo: 'Would email nobody: "Thanks for reaching out."', blockedReason: "no email on file" },
            { recordKind: "account", recordId: "r2", accountId: "a2", accountName: "Ridgeway Bakery", occurredAt: "2026-04-09T09:00:00Z", firesAt: "2026-04-10T09:00:00Z", wouldDo: 'Would email dana@ridgeway.example: "Thanks for reaching out."', blockedReason: null },
          ],
          summary: { records: 2, wouldAct: 1, blocked: 1, byReason: [{ reason: "no email on file", count: 1 }] },
          execution: { connected: false, label: "Not Connected" },
        }));
      }
      return Promise.resolve(json(payloads[url] ?? {}));
    }));
    const user = userEvent.setup();
    render(<ServicesMarketingPanel />);
    await user.click(await screen.findByRole("tab", { name: /Automations/ }));
    await screen.findByTestId("services-automations-table");
    await user.click(screen.getByRole("button", { name: "Dry run Welcome new leads" }));

    const panel = await screen.findByTestId("services-automation-dry-run");
    expect(calls).toContain(`/api/services/marketing/automations/dry-run?automationId=${automationId}`);
    expect(screen.getByTestId("services-automation-dry-run-summary")).toHaveTextContent(
      "2 records match; the rule would act on 1 and skip 1 (1 no email on file).",
    );
    expect(within(panel).getByText(/Nothing ran; the send behind it is Not Connected\./)).toBeInTheDocument();
    await waitFor(() => expect(within(panel).getByText("Northgate Lead")).toBeInTheDocument());
    expect(within(panel).getByText("Would not: no email on file.")).toBeInTheDocument();
    expect(within(panel).getByText('Would email dana@ridgeway.example: "Thanks for reaching out."')).toBeInTheDocument();
  });
});
