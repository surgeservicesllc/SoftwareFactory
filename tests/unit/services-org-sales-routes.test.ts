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

import { GET as listBranches, PATCH as patchBranch, POST as createBranch } from "@/app/api/services/branches/route";
import { GET as listEmployees, PATCH as patchEmployee, POST as createEmployee } from "@/app/api/services/employees/route";
import { GET as listTerritories, POST as createTerritory } from "@/app/api/services/territories/route";
import { PATCH as patchCommission, POST as createCommission } from "@/app/api/services/commissions/route";
import { GET as leaderboard } from "@/app/api/services/sales/leaderboard/route";

/**
 * The company boundary's own conduct. The database owns the invariants —
 * derived payouts, the no-self-report rule, closed-means-inactive — and the
 * behavior suite proves those against real SQL. This file pins what the
 * routes promise: counts tallied from the rows rather than estimated, a
 * closure that deactivates without being asked twice, an amount the caller
 * cannot send at all, and a leaderboard that reports its own denominator.
 */

const organizationId = "10000000-0000-4000-8000-0000000a0001";
const userId = "00000000-0000-4000-8000-0000000a0001";
const branchId = "20000000-0000-4000-8000-0000000a0001";
const employeeId = "30000000-0000-4000-8000-0000000a0001";
const commissionId = "40000000-0000-4000-8000-0000000a0001";

type QueryResult = { data: unknown; error: unknown };

function stubTable(results: QueryResult[]) {
  let call = 0;
  const builder: Record<string, unknown> = {};
  const chain = () => builder;
  for (const method of ["select", "insert", "update", "eq", "in", "order", "limit"]) {
    builder[method] = vi.fn(chain);
  }
  const next = () => Promise.resolve(results[Math.min(call++, results.length - 1)]);
  builder.single = vi.fn(next);
  builder.maybeSingle = vi.fn(next);
  builder.then = (onFulfilled: (value: QueryResult) => unknown) => next().then(onFulfilled);
  return builder;
}

let from: ReturnType<typeof vi.fn>;
let tables: Map<string, ReturnType<typeof stubTable>>;

function client(results: Record<string, QueryResult[]>) {
  tables = new Map();
  from = vi.fn((table: string) => {
    const existing = tables.get(table);
    if (existing) return existing;
    const created = stubTable(results[table] ?? [{ data: [], error: null }]);
    tables.set(table, created);
    return created;
  });
  requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId },
    user: { id: userId },
    client: { from },
  });
}

function table(name: string) {
  return tables.get(name) as unknown as {
    insert: ReturnType<typeof vi.fn>;
    update: ReturnType<typeof vi.fn>;
  };
}

function send(method: "POST" | "PATCH", url: string, body: unknown, origin = "https://factory.example") {
  return new Request(url, {
    method,
    headers: { "content-type": "application/json", origin },
    body: JSON.stringify(body),
  });
}

const branchRow = {
  id: branchId,
  manager_id: null,
  code: "BR-NORTH",
  name: "North Branch",
  address: "1 Dock Road, Portsview, OR 97001",
  phone: "555-0100",
  email: "north@demo-pest-services.example",
  time_zone: "America/Los_Angeles",
  opened_on: "2020-01-01",
  closed_on: null,
  active: true,
  notes: null,
  created_at: "2026-08-01T10:00:00Z",
  updated_at: "2026-08-01T10:00:00Z",
};

const employeeRow = {
  id: employeeId,
  branch_id: branchId,
  reports_to_id: null,
  user_id: null,
  employee_code: "EMP-1",
  first_name: "Dev",
  last_name: "Okafor",
  email: "dev@demo-pest-services.example",
  phone: "555-0111",
  role: "sales_rep",
  title: "Sales Representative",
  hire_date: "2024-03-01",
  end_date: null,
  commission_bps: 750,
  monthly_quota_cents: 4_000_000,
  active: true,
  notes: null,
  created_at: "2026-08-01T10:00:00Z",
  updated_at: "2026-08-01T10:00:00Z",
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the branches boundary", () => {
  it("tallies what each branch carries from the rows themselves", async () => {
    client({
      crm_branches: [{ data: [branchRow], error: null }],
      crm_accounts: [
        {
          data: [{ branch_id: branchId }, { branch_id: branchId }, { branch_id: null }],
          error: null,
        },
      ],
      crm_employees: [
        { data: [{ branch_id: branchId, active: true }, { branch_id: branchId, active: false }], error: null },
      ],
      crm_technicians: [{ data: [{ branch_id: branchId, active: true }], error: null }],
    });
    const response = await listBranches();
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.branches[0]).toMatchObject({
      accountCount: 2,
      // Only the active ones are counted as roster.
      staffCount: 1,
      technicianCount: 1,
    });
    // The uncomfortable number is reported, not hidden.
    expect(body.counts.unassignedAccounts).toBe(1);
  });

  it("closes a branch by deactivating it, without being asked twice", async () => {
    client({ crm_branches: [{ data: { ...branchRow, active: false, closed_on: "2026-08-30" }, error: null }] });
    const response = await patchBranch(
      send("PATCH", "https://factory.example/api/services/branches", {
        branchId,
        closedOn: "2026-08-30",
      }),
    );
    expect(response.status).toBe(200);
    expect(table("crm_branches").update).toHaveBeenCalledWith(
      expect.objectContaining({ closed_on: "2026-08-30", active: false }),
    );
  });

  it("surfaces a duplicate branch code as a conflict", async () => {
    client({ crm_branches: [{ data: null, error: { code: "23505", message: "duplicate key" } }] });
    const response = await createBranch(
      send("POST", "https://factory.example/api/services/branches", {
        code: "BR-NORTH",
        name: "North Branch",
      }),
    );
    expect(response.status).toBe(409);
    expect((await response.json()).error.code).toBe("branch_code_taken");
  });

  it("refuses a branch code that is not a code", async () => {
    client({ crm_branches: [{ data: branchRow, error: null }] });
    const response = await createBranch(
      send("POST", "https://factory.example/api/services/branches", {
        code: "north branch!",
        name: "North Branch",
      }),
    );
    expect(response.status).toBe(422);
    expect(tables.has("crm_branches")).toBe(false);
  });
});

describe("the org chart boundary", () => {
  it("counts the active roster by role", async () => {
    client({
      crm_employees: [
        {
          data: [
            employeeRow,
            { ...employeeRow, id: "x", role: "csr" },
            { ...employeeRow, id: "y", role: "csr", active: false },
          ],
          error: null,
        },
      ],
    });
    const response = await listEmployees();
    const body = await response.json();
    expect(body.counts).toEqual({ total: 3, active: 2, byRole: { sales_rep: 1, csr: 1 } });
    // The login link is a fact about the person, never their identity.
    expect(body.employees[0].hasLogin).toBe(false);
    expect(body.employees[0]).not.toHaveProperty("userId");
  });

  it("refuses a person who would report to themselves, before the database has to", async () => {
    client({ crm_employees: [{ data: employeeRow, error: null }] });
    const response = await patchEmployee(
      send("PATCH", "https://factory.example/api/services/employees", {
        employeeId,
        reportsToId: employeeId,
      }),
    );
    expect(response.status).toBe(422);
    expect((await response.json()).error.code).toBe("self_report");
    expect(tables.has("crm_employees")).toBe(false);
  });

  it("ends employment by taking the person off the active roster", async () => {
    client({ crm_employees: [{ data: { ...employeeRow, active: false, end_date: "2026-08-30" }, error: null }] });
    await patchEmployee(
      send("PATCH", "https://factory.example/api/services/employees", {
        employeeId,
        endDate: "2026-08-30",
      }),
    );
    expect(table("crm_employees").update).toHaveBeenCalledWith(
      expect.objectContaining({ end_date: "2026-08-30", active: false }),
    );
  });

  it("records a new person with the exact tenant identity", async () => {
    client({ crm_employees: [{ data: employeeRow, error: null }] });
    const response = await createEmployee(
      send("POST", "https://factory.example/api/services/employees", {
        employeeCode: "EMP-1",
        firstName: "Dev",
        lastName: "Okafor",
        role: "sales_rep",
        commissionBps: 750,
      }),
    );
    expect(response.status).toBe(201);
    expect(table("crm_employees").insert).toHaveBeenCalledWith(
      expect.objectContaining({
        organization_id: organizationId,
        created_by: userId,
        role: "sales_rep",
        commission_bps: 750,
      }),
    );
  });
});

describe("the territories boundary", () => {
  const territoryRow = {
    id: "50000000-0000-4000-8000-0000000a0001",
    branch_id: branchId,
    rep_id: employeeId,
    name: "North One",
    code: "TR-N1",
    city: "Portsview",
    region: "OR",
    postal_codes: ["97001", "97010"],
    active: true,
    notes: null,
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-01T10:00:00Z",
  };

  it("upper-cases and de-duplicates the postal codes it is sent", async () => {
    client({ crm_territories: [{ data: territoryRow, error: null }] });
    const response = await createTerritory(
      send("POST", "https://factory.example/api/services/territories", {
        branchId,
        name: "North One",
        code: "TR-N1",
        postalCodes: ["97001", "97001", "or1 2ab"],
      }),
    );
    expect(response.status).toBe(201);
    expect(table("crm_territories").insert).toHaveBeenCalledWith(
      expect.objectContaining({ postal_codes: ["97001", "OR1 2AB"] }),
    );
  });

  it("refuses a postal code the schema would refuse anyway, by name", async () => {
    client({ crm_territories: [{ data: territoryRow, error: null }] });
    const response = await createTerritory(
      send("POST", "https://factory.example/api/services/territories", {
        branchId,
        name: "Bad",
        code: "TR-BAD",
        postalCodes: ["not a postal code!"],
      }),
    );
    expect(response.status).toBe(422);
    expect(tables.has("crm_territories")).toBe(false);
  });

  it("reports how much of the map nobody works", async () => {
    client({
      crm_territories: [
        { data: [territoryRow, { ...territoryRow, id: "z", rep_id: null }], error: null },
      ],
      crm_accounts: [{ data: [{ territory_id: territoryRow.id }], error: null }],
    });
    const body = await (await listTerritories()).json();
    expect(body.counts.unworked).toBe(1);
    expect(body.territories[0].accountCount).toBe(1);
  });
});

describe("the commissions boundary", () => {
  const commissionRow = {
    id: commissionId,
    employee_id: employeeId,
    opportunity_id: "60000000-0000-4000-8000-0000000a0001",
    contract_id: null,
    invoice_id: null,
    basis_cents: 1_200_000,
    rate_bps: 750,
    amount_cents: 90_000,
    status: "accrued",
    earned_on: "2026-08-01",
    approved_at: null,
    paid_at: null,
    note: null,
    created_at: "2026-08-01T10:00:00Z",
    updated_at: "2026-08-01T10:00:00Z",
  };

  it("will not let a caller send the payout at all", async () => {
    client({ crm_commissions: [{ data: commissionRow, error: null }] });
    const response = await createCommission(
      send("POST", "https://factory.example/api/services/commissions", {
        employeeId,
        opportunityId: commissionRow.opportunity_id,
        basisCents: 1_200_000,
        rateBps: 750,
        amountCents: 999_999,
        earnedOn: "2026-08-01",
      }),
    );
    expect(response.status).toBe(422);
    expect(tables.has("crm_commissions")).toBe(false);
  });

  it("records the basis and the rate, and reports the amount the ledger computed", async () => {
    client({ crm_commissions: [{ data: commissionRow, error: null }] });
    const response = await createCommission(
      send("POST", "https://factory.example/api/services/commissions", {
        employeeId,
        opportunityId: commissionRow.opportunity_id,
        basisCents: 1_200_000,
        rateBps: 750,
        earnedOn: "2026-08-01",
      }),
    );
    expect(response.status).toBe(201);
    const insert = table("crm_commissions").insert.mock.calls[0][0] as Record<string, unknown>;
    expect(insert).not.toHaveProperty("amount_cents");
    expect((await response.json()).commission.amountCents).toBe(90_000);
  });

  it("refuses a commission earned on nothing", async () => {
    client({ crm_commissions: [{ data: commissionRow, error: null }] });
    const response = await createCommission(
      send("POST", "https://factory.example/api/services/commissions", {
        employeeId,
        basisCents: 1_200_000,
        rateBps: 750,
        earnedOn: "2026-08-01",
      }),
    );
    expect(response.status).toBe(422);
  });

  it("approves in the same moment as it pays, so the schema is never contradicted", async () => {
    client({
      crm_commissions: [
        { data: commissionRow, error: null },
        { data: { ...commissionRow, status: "paid" }, error: null },
      ],
    });
    await patchCommission(
      send("PATCH", "https://factory.example/api/services/commissions", {
        commissionId,
        status: "paid",
      }),
    );
    expect(table("crm_commissions").update).toHaveBeenCalledWith(
      expect.objectContaining({
        status: "paid",
        approved_at: expect.any(String),
        paid_at: expect.any(String),
      }),
    );
  });

  it("takes the moments back when a commission returns to accrued", async () => {
    client({
      crm_commissions: [
        { data: { ...commissionRow, status: "paid", approved_at: "2026-08-02T00:00:00Z", paid_at: "2026-08-03T00:00:00Z" }, error: null },
        { data: commissionRow, error: null },
      ],
    });
    await patchCommission(
      send("PATCH", "https://factory.example/api/services/commissions", {
        commissionId,
        status: "accrued",
      }),
    );
    expect(table("crm_commissions").update).toHaveBeenCalledWith(
      expect.objectContaining({ status: "accrued", approved_at: null, paid_at: null }),
    );
  });
});

describe("the sales leaderboard", () => {
  it("reports a rep with nothing decided as unrated, never as zero", async () => {
    client({
      crm_employees: [{ data: [employeeRow], error: null }],
      crm_opportunities: [
        {
          data: [
            {
              id: "o1", account_id: "a1", name: "Open deal", stage: "proposal", value_cents: 500_000,
              expected_close_date: null, notes: null, lost_reason: null, closed_at: null,
              created_at: "2026-08-01T10:00:00Z", updated_at: "2026-08-01T10:00:00Z",
              owner_employee_id: employeeId,
            },
          ],
          error: null,
        },
      ],
      crm_commissions: [{ data: [], error: null }],
    });
    const body = await (await leaderboard()).json();
    expect(body.rows[0]).toMatchObject({
      openCount: 1,
      openValueCents: 500_000,
      wonCount: 0,
      winRate: null,
    });
  });

  it("counts wins and losses, and names the deals nobody owns", async () => {
    const deal = (id: string, stage: string, value: number, owner: string | null) => ({
      id, account_id: "a1", name: id, stage, value_cents: value,
      expected_close_date: null, notes: null, lost_reason: null, closed_at: null,
      created_at: "2026-08-01T10:00:00Z", updated_at: "2026-08-01T10:00:00Z",
      owner_employee_id: owner,
    });
    client({
      crm_employees: [{ data: [employeeRow], error: null }],
      crm_opportunities: [
        {
          data: [
            deal("won-1", "won", 3_000_000, employeeId),
            deal("lost-1", "lost", 500_000, employeeId),
            deal("orphan", "new", 100_000, null),
          ],
          error: null,
        },
      ],
      crm_commissions: [
        {
          data: [
            { id: "c1", employee_id: employeeId, opportunity_id: "won-1", contract_id: null, invoice_id: null,
              basis_cents: 3_000_000, rate_bps: 750, amount_cents: 225_000, status: "paid",
              earned_on: "2026-08-01", approved_at: "2026-08-02T00:00:00Z", paid_at: "2026-08-03T00:00:00Z",
              note: null, created_at: "2026-08-01T10:00:00Z", updated_at: "2026-08-01T10:00:00Z" },
          ],
          error: null,
        },
      ],
    });
    const body = await (await leaderboard()).json();
    expect(body.rows[0]).toMatchObject({
      wonCount: 1,
      lostCount: 1,
      winRate: 50,
      // $30,000 closed against a $40,000 quota.
      quotaAttainment: 75,
      commissionPaidCents: 225_000,
    });
    expect(body.totals.unownedOpportunities).toBe(1);
  });
});
