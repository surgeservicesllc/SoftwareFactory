import { describe, expect, it, vi } from "vitest";

import { buildSeedReport, SEED_RECORD_FLOOR } from "@/lib/services/seed-validation";

/**
 * The seed audit's optional-column judgement is settled beyond the sample:
 * a column the thousand-row slice never saw populated is probed with one
 * exact query, and a value found anywhere in the table counts — with the
 * report saying so. This is the path the CRM seed hits only by chance, so
 * it is pinned here with a client that answers the probe directly.
 */

type Query = { table: string; columns: string; order: string | null; limit: number | null; head: boolean };

/** A PostgREST-shaped client whose answers depend on the query's shape. */
function stubClient(answer: (query: Query) => { data?: unknown[]; count?: number; error?: { message: string } | null }) {
  return {
    from: vi.fn((table: string) => {
      const query: Query = { table, columns: "", order: null, limit: null, head: false };
      const node: Record<string, unknown> = {};
      node.select = vi.fn((columns: string, options?: { head?: boolean }) => {
        query.columns = columns;
        query.head = options?.head === true;
        return node;
      });
      for (const method of ["eq", "in"]) node[method] = vi.fn(() => node);
      node.order = vi.fn((column: string) => { query.order = column; return node; });
      node.limit = vi.fn((value: number) => { query.limit = value; return node; });
      node.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
        Promise.resolve({ data: [], count: null, error: null, ...answer(query) }).then(resolve, reject);
      return node;
    }),
  };
}

describe("buildSeedReport optional-column probe", () => {
  it("proves a column populated beyond the sample with one exact query, and says so", async () => {
    const probes: Array<{ table: string; column: string }> = [];
    const client = stubClient((query) => {
      if (query.head) return { count: SEED_RECORD_FLOOR };
      if (query.order === "id") {
        // The sample: two rows, every optional column empty, two enum values, no references.
        const columns = query.columns.split(",").map((column) => column.trim());
        const row = (index: number) => Object.fromEntries(columns.map((column) => [column, column === "id" ? `row-${index}` : null]));
        const first = row(1);
        const second = row(2);
        // Any enum column sits after the optional ones; give it two values.
        for (const column of columns) {
          if (column === "id") continue;
          first[column] = null;
          second[column] = null;
        }
        return { data: [{ ...first, __enum: "a" }, { ...second, __enum: "b" }] };
      }
      if (query.limit === 1 && query.order !== null) {
        probes.push({ table: query.table, column: query.order });
        return { data: [{ id: "row-9", [query.order]: query.order === "cancelled_at" ? null : "found" }] };
      }
      return { data: [] };
    });

    const report = await buildSeedReport(client as never, "10000000-0000-4000-8000-000000000050");
    const notices = report.tables.find((table) => table.table === "crm_notices")!;
    expect(probes.some((probe) => probe.table === "crm_notices" && probe.column === "failure_reason")).toBe(true);
    expect(notices.populatedOptionalFields).toContain("failure_reason");
    expect(notices.emptyOptionalFields).toEqual(["cancelled_at"]);
    expect(notices.notes).toContain("failure_reason: populated beyond the 1000-row sample");
    expect(notices.notes).toContain("Optional columns empty in the sample: cancelled_at");
    // The probe ran once per column the sample missed, on exactly that column, ascending.
    expect(probes.filter((probe) => probe.table === "crm_notices").map((probe) => probe.column).sort()).toEqual(
      [...notices.populatedOptionalFields, ...notices.emptyOptionalFields].sort(),
    );
  });
});
