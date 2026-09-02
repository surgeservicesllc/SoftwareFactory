// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const { requireActiveOrganization } = vi.hoisted(() => ({ requireActiveOrganization: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization,
}));
vi.mock("@/lib/supabase/request", () => ({ assertSameOriginRequest: () => undefined }));

import { GET as scenario, PUT as saveAssumptions } from "@/app/api/services/forecast/scenario/route";
import { GET as hygiene } from "@/app/api/services/data/hygiene/route";

/**
 * The trust boundaries: the scenario applies the stored assumptions unless
 * the request supplies its own and says which it applied; a what-if is
 * never saved; an assumption outside 0–100% is refused before the
 * database; the hygiene route summarises what the function returned.
 */

const organizationId = "10000000-0000-4000-8000-000000100001";
const userId = "00000000-0000-4000-8000-000000100001";

let rpcCalls: Array<{ name: string; args: Record<string, unknown> | undefined }>;
let upserted: Record<string, unknown> | null;

function client(options: { stored?: Record<string, unknown> | null; rpc?: Record<string, unknown[]> } = {}) {
  rpcCalls = [];
  upserted = null;
  const rpc = vi.fn((name: string, args?: Record<string, unknown>) => {
    rpcCalls.push({ name, args });
    const response = { data: options.rpc?.[name] ?? [], error: null };
    return Object.assign(Promise.resolve(response), { limit: () => Promise.resolve(response) });
  });
  const from = vi.fn(() => ({
    select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: options.stored ?? null, error: null }) }) }),
    upsert: (row: Record<string, unknown>) => {
      upserted = row;
      return { select: () => ({ single: () => Promise.resolve({ data: { id: "f1", annual_churn_bps: row.annual_churn_bps, annual_growth_bps: row.annual_growth_bps, note: row.note, updated_by: row.updated_by, updated_at: "2026-04-01T00:00:00Z" }, error: null }) }) };
    },
  }));
  requireActiveOrganization.mockResolvedValue({ activeOrganization: { id: organizationId }, user: { id: userId }, client: { rpc, from } });
}

const monthRow = { month: "2026-09-01", months_ahead: 0, recorded_cents: "10000", scenario_cents: "10000", factor_bps: 10000, plans: 1, contracts: 0 };

beforeEach(() => vi.clearAllMocks());

describe("the forecast scenario route", () => {
  it("applies the stored assumptions and says so", async () => {
    client({ stored: { id: "f1", annual_churn_bps: 1200, annual_growth_bps: 300, note: "From cancellations.", updated_by: userId, updated_at: "2026-04-01T00:00:00Z" }, rpc: { crm_revenue_forecast_scenario: [monthRow] } });
    const body = await (await scenario(new Request("https://factory.example/api/services/forecast/scenario?months=99"))).json();
    expect(rpcCalls).toEqual([{ name: "crm_revenue_forecast_scenario", args: { p_months: 36, p_churn_bps: 1200, p_growth_bps: 300 } }]);
    expect(body.applied).toEqual({ churnBps: 1200, growthBps: 300, source: "stored" });
    expect(body.assumptions).toMatchObject({ annualChurnBps: 1200, note: "From cancellations." });
    expect(body.totals).toEqual({ recordedCents: 10000, scenarioCents: 10000, differenceCents: 0 });
  });

  it("applies a what-if from the query instead, clamped, without saving it, and says none when nothing is stored", async () => {
    client({ rpc: { crm_revenue_forecast_scenario: [monthRow] } });
    const body = await (await scenario(new Request("https://factory.example/api/services/forecast/scenario?churnBps=25000"))).json();
    expect(rpcCalls[0]?.args).toEqual({ p_months: 12, p_churn_bps: 10_000, p_growth_bps: 0 });
    expect(body.applied).toEqual({ churnBps: 10_000, growthBps: 0, source: "query" });
    expect(upserted).toBeNull();
    client({ rpc: { crm_revenue_forecast_scenario: [] } });
    const none = await (await scenario(new Request("https://factory.example/api/services/forecast/scenario"))).json();
    expect(none.applied).toEqual({ churnBps: 0, growthBps: 0, source: "none" });
  });

  it("refuses an assumption outside 0–100% and saves a sound one as the caller", async () => {
    client();
    const bad = await saveAssumptions(new Request("https://factory.example/api/services/forecast/scenario", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ annualChurnBps: 12000, annualGrowthBps: 0 }) }));
    expect(bad.status).toBe(422);
    expect(upserted).toBeNull();
    const ok = await saveAssumptions(new Request("https://factory.example/api/services/forecast/scenario", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ annualChurnBps: 1200, annualGrowthBps: 500, note: " Two years of cancellations. " }) }));
    expect(ok.status).toBe(200);
    expect(upserted).toEqual({ organization_id: organizationId, annual_churn_bps: 1200, annual_growth_bps: 500, note: "Two years of cancellations.", updated_by: userId });
  });
});

describe("the hygiene route", () => {
  it("summarises the report and labels every flag", async () => {
    client({ rpc: { crm_contact_hygiene: [
      { contact_id: "c1", account_id: "a1", account_name: "Old Mill", account_status: "inactive", contact_name: "Sam Ortiz", email: "s@o.m", phone: null, is_primary: true, last_touch_at: null, days_since_touch: null, flags: ["inactive_account", "untouched_year"], flag_count: 2 },
    ] } });
    const body = await (await hygiene()).json();
    expect(rpcCalls).toEqual([{ name: "crm_contact_hygiene", args: { p_organization: organizationId } }]);
    expect(body.summary).toEqual({ contacts: 1, multiFlagged: 1, byFlag: [
      { flag: "inactive_account", label: "Account is inactive", count: 1 },
      { flag: "untouched_year", label: "Nothing on the account in a year", count: 1 },
    ] });
    expect(body.contacts[0].labels).toEqual(["Account is inactive", "Nothing on the account in a year"]);
    expect(body.ceiling).toEqual({ contacts: 1000, reached: false });
  });
});
