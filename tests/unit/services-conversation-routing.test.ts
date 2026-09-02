import { describe, expect, it } from "vitest";

import { composeUnassignedAnswer, toRequestQueueView, toRequestSuggestionView, waitingLabel } from "@/lib/services/conversation-routing";

describe("conversation routing's pure side", () => {
  it("labels waiting time in minutes, hours or days", () => {
    expect(waitingLabel(12)).toBe("12 min");
    expect(waitingLabel(390)).toBe("6.5 h");
    expect(waitingLabel(3 * 24 * 60)).toBe("3 d");
  });

  it("composes the unassigned answer: nothing open, everyone has a person, or the oldest with its suggestion", () => {
    expect(composeUnassignedAnswer({ open: 0, unassigned: [] })).toBe("Nothing is open on the help desk.");
    expect(composeUnassignedAnswer({ open: 3, unassigned: [] })).toBe("3 requests are open and every one has a person.");
    expect(composeUnassignedAnswer({
      open: 9,
      unassigned: [
        { account: "Harborview Foods", summary: "Ants in the dry store", waitingMinutes: 390, suggestedName: "Ana Cruz", reason: "branch manager of North; the address's postal code 93940 is in territory N1" },
        { account: "Old Mill", summary: "Gate code changed", waitingMinutes: 30, suggestedName: null, reason: "nobody: the address matches no active territory and no active CSR or dispatcher is on the book" },
      ],
    })).toBe("2 of 9 open requests have nobody. Oldest: Harborview Foods — “Ants in the dry store” (6.5 h), suggested Ana Cruz (branch manager of North; the address's postal code 93940 is in territory N1). Accept the suggestions on the Customer Portal page under Requests.");
    expect(composeUnassignedAnswer({
      open: 1,
      unassigned: [{ account: "Old Mill", summary: "Gate code changed", waitingMinutes: 30, suggestedName: null, reason: "nobody: the address matches no active territory and no active CSR or dispatcher is on the book" }],
    })).toBe("1 of 1 open request has nobody. Oldest: Old Mill — “Gate code changed” (30 min), nobody to suggest (the address matches no active territory and no active CSR or dispatcher is on the book). Accept the suggestions on the Customer Portal page under Requests.");
  });

  it("maps rows with numbers as numbers", () => {
    expect(toRequestSuggestionView({ employee_id: "e", employee_name: "Ana Cruz", role: "branch_manager", reason: "r", territory_code: "N1", postal_code: "93940", open_requests: "2" as unknown as number }))
      .toMatchObject({ employeeId: "e", openRequests: 2, territoryCode: "N1" });
    expect(toRequestQueueView({ request_id: "r", account_id: "a", account_name: "A", kind: "question", status: "submitted", summary: "s", submitted_at: "x", waiting_minutes: "45" as unknown as number, assignee_employee_id: null, assignee_name: null, assigned_at: null, suggested_employee_id: "e", suggested_name: "Ana Cruz", suggested_reason: "r" }))
      .toMatchObject({ waitingMinutes: 45, suggestedName: "Ana Cruz", assigneeEmployeeId: null });
  });
});
