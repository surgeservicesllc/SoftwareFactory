// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActiveOrganization } = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization,
}));

import { GET as audit } from "@/app/api/services/schedule/audit/route";
import { GET as dryRun } from "@/app/api/services/marketing/automations/dry-run/route";
import { GET as rows } from "@/app/api/services/dashboards/rows/route";

/**
 * The three "nothing hidden" boundaries. The behavior suite proves the SQL;
 * this file pins what the routes must not undo: windows are bounded, a key
 * is checked in code before the database sees it, an automation outside the
 * workspace is a 404 rather than an empty run, and the dry run is labelled
 * Not Connected.
 */

const organizationId = "10000000-0000-4000-8000-0000000e0001";
const automationId = "30000000-0000-4000-8000-0000000e0001";

let rpc: ReturnType<typeof vi.fn>;
let rpcCalls: Array<{ name: string; args: Record<string, unknown> }>;

function client(options: { rpcData?: unknown[]; automation?: Record<string, unknown> | null } = {}) {
  rpcCalls = [];
  rpc = vi.fn((name: string, args: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    return { limit: () => Promise.resolve({ data: options.rpcData ?? [], error: null }) };
  });
  const from = vi.fn(() => ({
    select: () => ({
      eq: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: options.automation ?? null, error: null }),
        }),
      }),
    }),
  }));
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId },
    user: { id: "00000000-0000-4000-8000-0000000e0001" },
    client: { rpc, from },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the schedule audit route", () => {
  it("bounds the window and summarises what came back", async () => {
    client({
      rpcData: [
        { finding: "double_booked", severity: "high", occurs_on: "2026-04-15", work_order_id: "w1", other_work_order_id: "w2", plan_id: null, route_id: null, account_id: "a", account_name: "Acme", technician_id: "t", technician_name: "Rosa Vega", detail: "Overlaps Acme, 10:30–11:30." },
      ],
    });
    const response = await audit(new Request("https://factory.example/api/services/schedule/audit?days=900"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(rpcCalls).toEqual([{ name: "crm_schedule_audit", args: { p_organization: organizationId, p_days: 90 } }]);
    expect(body.window).toEqual({ days: 90 });
    expect(body.summary).toEqual({
      total: 1,
      bySeverity: { high: 1, medium: 0, low: 0 },
      byFinding: [{ finding: "double_booked", label: "Double-booked technician", count: 1 }],
    });
    expect(body.findings[0]).toMatchObject({ label: "Double-booked technician", occursOn: "2026-04-15", technicianName: "Rosa Vega" });
    expect(body.ceiling).toEqual({ findings: 500, reached: false });
  });
});

describe("the automation dry-run route", () => {
  it("refuses a malformed id and reports a rule outside the workspace as not found, without running anything", async () => {
    client();
    const bad = await dryRun(new Request("https://factory.example/api/services/marketing/automations/dry-run?automationId=nope"));
    expect(bad.status).toBe(400);
    const missing = await dryRun(new Request(`https://factory.example/api/services/marketing/automations/dry-run?automationId=${automationId}`));
    expect(missing.status).toBe(404);
    expect(rpcCalls).toEqual([]);
  });

  it("returns the records, the summary, and the Not Connected label", async () => {
    client({
      automation: {
        id: automationId, organization_id: organizationId, name: "Welcome new leads", trigger_on: "lead_created", action: "send_email",
        delay_hours: 24, template: "Hello", active: false, last_run_at: null, run_count: 0,
        created_at: "2026-04-01T00:00:00Z", updated_at: "2026-04-01T00:00:00Z",
      },
      rpcData: [
        { record_kind: "account", record_id: "r1", account_id: "a1", account_name: "Northgate", occurred_at: "2026-04-10T00:00:00Z", fires_at: "2026-04-11T00:00:00Z", would_do: 'Would email nobody: "Hello"', blocked_reason: "no email on file" },
        { record_kind: "account", record_id: "r2", account_id: "a2", account_name: "Ridgeway", occurred_at: "2026-04-09T00:00:00Z", fires_at: "2026-04-10T00:00:00Z", would_do: 'Would email dana@ridgeway.example: "Hello"', blocked_reason: null },
      ],
    });
    const response = await dryRun(new Request(`https://factory.example/api/services/marketing/automations/dry-run?automationId=${automationId}&days=9999`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(rpcCalls).toEqual([{ name: "crm_automation_dry_run", args: { p_organization: organizationId, p_automation: automationId, p_days: 365 } }]);
    expect(body.automation).toMatchObject({ id: automationId, name: "Welcome new leads", triggerOn: "lead_created", action: "send_email" });
    expect(body.summary).toEqual({ records: 2, wouldAct: 1, blocked: 1, byReason: [{ reason: "no email on file", count: 1 }] });
    expect(body.execution).toEqual({ connected: false, label: "Not Connected" });
    expect(body.records[0]).toMatchObject({ accountName: "Northgate", blockedReason: "no email on file" });
  });
});

describe("the dashboard rows route", () => {
  it("refuses an unknown figure and a key shaped for another figure before the database sees it", async () => {
    client();
    expect((await rows(new Request("https://factory.example/api/services/dashboards/rows?figure=secret"))).status).toBe(400);
    const wrongKey = await rows(new Request("https://factory.example/api/services/dashboards/rows?figure=invoiced_month&key=customer"));
    expect(wrongKey.status).toBe(400);
    expect((await wrongKey.json()).error.message).toMatch(/YYYY-MM-DD/);
    expect(rpcCalls).toEqual([]);
  });

  it("passes a keyless figure with a null key, and a keyed figure with its key", async () => {
    client({ rpcData: [{ row_kind: "invoice", row_id: "i1", account_id: "a", account_name: "Acme", label: "INV-1", occurred_on: "2026-03-01", amount_cents: "5000", status: "open" }] });
    const overdue = await rows(new Request("https://factory.example/api/services/dashboards/rows?figure=overdue"));
    expect(overdue.status).toBe(200);
    expect((await overdue.json()).rows).toEqual([{ rowKind: "invoice", rowId: "i1", accountId: "a", accountName: "Acme", label: "INV-1", occurredOn: "2026-03-01", amountCents: 5000, status: "open" }]);
    await rows(new Request("https://factory.example/api/services/dashboards/rows?figure=aging&key=31-60"));
    expect(rpcCalls).toEqual([
      { name: "crm_dashboard_rows", args: { p_organization: organizationId, p_figure: "overdue", p_key: null, p_days: 90 } },
      { name: "crm_dashboard_rows", args: { p_organization: organizationId, p_figure: "aging", p_key: "31-60", p_days: 90 } },
    ]);
  });
});
