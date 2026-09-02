// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization: harness.requireActiveOrganization,
}));

import { GET } from "@/app/api/job-seeker/export/route";
import { EXPORT_LIMIT, EXPORT_TABLES } from "@/lib/job-seeker/export";
import { SupabaseAuthenticationError } from "@/lib/supabase/auth";

/**
 * The export route (ADR-247): every roster table read once through the
 * caller's client, each outcome in the manifest, a failed table named
 * rather than dropped, truncation reported, and the file served as an
 * attachment. A signed-out caller gets nothing.
 */

const organizationId = "10000000-0000-4000-8000-000000000046";

function chain(result: unknown, calls: unknown[][] = []) {
  const node: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit"]) {
    node[method] = vi.fn((...args: unknown[]) => {
      calls.push([method, ...args]);
      return node;
    });
  }
  node.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return node;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/job-seeker/export", () => {
  it("reads every roster table under the caller's organization and names each outcome", async () => {
    const calls: unknown[][] = [];
    const from = vi.fn((table: string) => {
      if (table === "job_seeker_jobs") return chain({ data: [{ id: "j1", title: "Engineer" }, { id: "j2", title: "Designer" }], error: null }, calls);
      if (table === "job_seeker_search_events") return chain({ data: null, error: { message: "relation does not exist" } }, calls);
      if (table === "job_seeker_result_marks") return chain({ data: Array.from({ length: EXPORT_LIMIT + 1 }, (_, i) => ({ id: `m${i}` })), error: null }, calls);
      return chain({ data: [], error: null }, calls);
    });
    harness.requireActiveOrganization.mockResolvedValue({ activeOrganization: { id: organizationId }, user: { id: "user-1" }, client: { from } });

    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toMatch(/^attachment; filename="job-seeker-export-\d{4}-\d{2}-\d{2}\.json"$/);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const payload = (await response.json()) as {
      manifest: { tables: Array<{ table: string; rows: number; truncated: boolean; error: string | null }>; limitPerTable: number };
      data: Record<string, unknown[]>;
    };
    expect(from.mock.calls.map(([table]) => table)).toEqual(EXPORT_TABLES.map((entry) => entry.table));
    // Every read is scoped to the caller's organization; RLS narrows it to their own rows.
    expect(calls.filter(([method]) => method === "eq").every(([, column, value]) => column === "organization_id" && value === organizationId)).toBe(true);
    const outcome = (table: string) => payload.manifest.tables.find((entry) => entry.table === table)!;
    expect(outcome("job_seeker_jobs")).toMatchObject({ rows: 2, truncated: false, error: null });
    expect(payload.data.job_seeker_jobs).toHaveLength(2);
    expect(outcome("job_seeker_search_events")).toMatchObject({ rows: 0, error: "This table could not be read." });
    expect(payload.data.job_seeker_search_events).toEqual([]);
    expect(outcome("job_seeker_result_marks")).toMatchObject({ rows: EXPORT_LIMIT, truncated: true });
    expect(payload.data.job_seeker_result_marks).toHaveLength(EXPORT_LIMIT);
    expect(payload.manifest.limitPerTable).toBe(EXPORT_LIMIT);
  });

  it("does not read the bytes of uploaded files", async () => {
    const calls: unknown[][] = [];
    harness.requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId },
      user: { id: "user-1" },
      client: { from: vi.fn(() => chain({ data: [], error: null }, calls)) },
    });
    await GET();
    const selects = calls.filter(([method]) => method === "select").map(([, columns]) => String(columns));
    expect(selects.some((columns) => columns.includes("filename"))).toBe(true);
    expect(selects.every((columns) => !/\bdata\b/.test(columns))).toBe(true);
  });

  it("refuses a signed-out caller before reading anything", async () => {
    harness.requireActiveOrganization.mockRejectedValue(
      new SupabaseAuthenticationError("authentication_required", "Authentication is required."),
    );
    const response = await GET();
    expect(response.status).toBeGreaterThanOrEqual(401);
    expect(response.headers.get("Content-Disposition")).toBeNull();
  });
});
