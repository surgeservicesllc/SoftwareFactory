import { describe, expect, it } from "vitest";

import {
  figureKeyProblem,
  summarizeDryRun,
  summarizeFindings,
  toDashboardRowView,
  toDryRunRecordView,
  toScheduleFindingView,
} from "@/lib/services/nothing-hidden";

/**
 * The pure side of "nothing hidden": findings are counted by severity and
 * by kind in a fixed order; a dry run's summary separates what would act
 * from what would be skipped and names each reason; a figure's key is
 * checked in code so the database never parses a key meant for another
 * figure.
 */

describe("summarizeFindings", () => {
  it("counts by severity and by finding, in the audit's own order, with unknown kinds appended", () => {
    const findings = [
      { finding: "unrouted", severity: "medium", occurs_on: "2026-04-16" },
      { finding: "double_booked", severity: "high", occurs_on: "2026-04-15" },
      { finding: "double_booked", severity: "high", occurs_on: "2026-04-15" },
      { finding: "future_rule", severity: "silly", occurs_on: "2026-04-15" },
    ].map((row) =>
      toScheduleFindingView({
        ...row,
        work_order_id: null, other_work_order_id: null, plan_id: null, route_id: null,
        account_id: "a", account_name: "Acme", technician_id: null, technician_name: null, detail: "x",
      }),
    );
    const summary = summarizeFindings(findings);
    expect(summary.total).toBe(4);
    expect(summary.bySeverity).toEqual({ high: 2, medium: 1, low: 1 });
    expect(summary.byFinding).toEqual([
      { finding: "double_booked", label: "Double-booked technician", count: 2 },
      { finding: "unrouted", label: "Scheduled but on no route", count: 1 },
      { finding: "future_rule", label: "future rule", count: 1 },
    ]);
    expect(findings[3].severity).toBe("low");
    expect(findings[3].label).toBe("future rule");
  });
});

describe("summarizeDryRun", () => {
  it("separates what would act from what would be skipped and names each reason, most common first", () => {
    const records = [
      { blocked_reason: null },
      { blocked_reason: "no email on file" },
      { blocked_reason: "no email on file" },
      { blocked_reason: "do not contact by email" },
    ].map((row, index) => ({
      record_kind: "account", record_id: `r${index}`, account_id: "a", account_name: "Acme",
      occurred_at: "2026-04-01T00:00:00Z", fires_at: "2026-04-02T00:00:00Z", would_do: "Would email",
      ...row,
    }));
    const summary = summarizeDryRun(records.map(toDryRunRecordView));
    expect(summary).toEqual({
      records: 4,
      wouldAct: 1,
      blocked: 3,
      byReason: [
        { reason: "no email on file", count: 2 },
        { reason: "do not contact by email", count: 1 },
      ],
    });
    expect(summarizeDryRun([])).toEqual({ records: 0, wouldAct: 0, blocked: 0, byReason: [] });
  });
});

describe("figureKeyProblem", () => {
  it("accepts each figure's own key shape and refuses every other", () => {
    const technician = "70000000-0000-4000-8000-0000000c0001";
    expect(figureKeyProblem("invoiced_month", "2026-04-01")).toBeNull();
    expect(figureKeyProblem("invoiced_month", "April")).toMatch(/YYYY-MM-DD/);
    expect(figureKeyProblem("aging", "31-60")).toBeNull();
    expect(figureKeyProblem("aging", "ancient")).toMatch(/bucket/);
    expect(figureKeyProblem("retention", "inactive")).toBeNull();
    expect(figureKeyProblem("retention", "lost")).toMatch(/customer, inactive or prospect/);
    expect(figureKeyProblem("technician", technician)).toBeNull();
    expect(figureKeyProblem("technician", "rosa")).toMatch(/technician id/);
    expect(figureKeyProblem("route_day", `2026-04-14|${technician}`)).toBeNull();
    expect(figureKeyProblem("route_day", `2026-04-14|${technician}|extra`)).toMatch(/route_day takes/);
    expect(figureKeyProblem("route_day", "2026-04-14")).toMatch(/route_day takes/);
    expect(figureKeyProblem("overdue", null)).toBeNull();
    expect(figureKeyProblem("overdue", "")).toBeNull();
    expect(figureKeyProblem("no_plan", "x")).toBe("no_plan takes no key.");
  });
});

describe("toDashboardRowView", () => {
  it("keeps a null amount null and reads a bigint string as a number", () => {
    expect(toDashboardRowView({
      row_kind: "invoice", row_id: "i1", account_id: "a", account_name: "Acme", label: "INV-1",
      occurred_on: "2026-04-01T00:00:00.000Z", amount_cents: "12345", status: "open",
    })).toEqual({
      rowKind: "invoice", rowId: "i1", accountId: "a", accountName: "Acme", label: "INV-1",
      occurredOn: "2026-04-01", amountCents: 12345, status: "open",
    });
    expect(toDashboardRowView({
      row_kind: "account", row_id: "a", account_id: "a", account_name: "Acme", label: "Acme",
      occurred_on: null, amount_cents: null, status: "customer",
    })).toMatchObject({ occurredOn: null, amountCents: null });
  });
});
