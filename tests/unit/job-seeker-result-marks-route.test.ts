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

import { DELETE, GET, POST } from "@/app/api/job-seeker/search/marks/route";
import { SupabaseAuthenticationError } from "@/lib/supabase/auth";

/**
 * Personal result marks: favorite, hidden, viewed.
 *
 * What matters here is ownership scoping (every query filters on the caller's
 * workspace and id, never on ids from the payload), idempotence in both
 * directions (marking twice is one row, unmarking the absent is not an
 * error), and the URL bound of the table's check constraint enforced at the
 * boundary so a bad write fails with a message instead of a database error.
 */

const organizationId = "10000000-0000-4000-8000-000000000042";
const jobUrl = "https://boards.example/jobs/123";

function stubTable(rows: unknown[]) {
  const calls: Array<[string, ...unknown[]]> = [];
  const chain: Record<string, unknown> = {};
  for (const method of ["select", "insert", "update", "delete", "upsert", "eq", "order", "limit"]) {
    chain[method] = vi.fn((...args: unknown[]) => {
      calls.push([method, ...args]);
      return chain;
    });
  }
  (chain as { then?: unknown }).then = (resolve: (value: unknown) => void) =>
    resolve({ data: rows, error: null });
  return { chain, calls };
}

function signIn(rows: unknown[] = []) {
  const { chain, calls } = stubTable(rows);
  harness.requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId },
    user: { id: "user-1" },
    client: { from: vi.fn(() => chain) },
  });
  return calls;
}

function request(method: string, body: unknown) {
  return new Request("https://factory.example/api/job-seeker/search/marks", {
    method,
    headers: { "content-type": "application/json", origin: "https://factory.example" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("result marks", () => {
  it("refuses a signed-out caller on every verb", async () => {
    harness.requireActiveOrganization.mockRejectedValue(
      new SupabaseAuthenticationError("authentication_required", "Authentication is required."),
    );
    expect((await GET()).status).toBeGreaterThanOrEqual(401);
    expect((await POST(request("POST", { jobUrl, mark: "favorite" }))).status)
      .toBeGreaterThanOrEqual(401);
    expect((await DELETE(request("DELETE", { jobUrl, mark: "favorite" }))).status)
      .toBeGreaterThanOrEqual(401);
  });

  it("lists the caller's marks grouped by kind, scoped to person and workspace", async () => {
    const calls = signIn([
      { job_url: "https://a.example/1", mark: "favorite" },
      { job_url: "https://a.example/2", mark: "hidden" },
      { job_url: "https://a.example/1", mark: "viewed" },
    ]);
    const response = await GET();
    const payload = (await response.json()) as {
      marks: { favorite: string[]; hidden: string[]; viewed: string[] };
    };

    expect(payload.marks.favorite).toEqual(["https://a.example/1"]);
    expect(payload.marks.hidden).toEqual(["https://a.example/2"]);
    expect(payload.marks.viewed).toEqual(["https://a.example/1"]);
    const eqs = calls.filter(([method]) => method === "eq").map(([, column, value]) => [column, value]);
    expect(eqs).toContainEqual(["organization_id", organizationId]);
    expect(eqs).toContainEqual(["user_id", "user-1"]);
  });

  it("marks with the caller's identity and the duplicate-ignoring upsert", async () => {
    const calls = signIn();
    const response = await POST(request("POST", { jobUrl, mark: "favorite" }));

    expect(response.status).toBe(201);
    const upsert = calls.find(([method]) => method === "upsert");
    const rowSent = upsert?.[1] as Record<string, unknown>;
    const options = upsert?.[2] as Record<string, unknown>;
    expect(rowSent.organization_id).toBe(organizationId);
    expect(rowSent.user_id).toBe("user-1");
    expect(rowSent.job_url).toBe(jobUrl);
    expect(rowSent.mark).toBe("favorite");
    // Marking what is already marked must be success, not a unique violation.
    expect(options.ignoreDuplicates).toBe(true);
    expect(options.onConflict).toBe("organization_id,user_id,job_url,mark");
  });

  it("refuses a mark it does not know and a URL the table would reject", async () => {
    signIn();
    expect((await POST(request("POST", { jobUrl, mark: "starred" }))).status).toBe(422);
    expect((await POST(request("POST", { jobUrl: "ftp://a.example/x", mark: "favorite" }))).status)
      .toBe(422);
    expect((await POST(request("POST", { jobUrl: `https://a.example/${"x".repeat(800)}`, mark: "viewed" }))).status)
      .toBe(422);
  });

  it("unmarks idempotently: deleting the absent row reports zero, not an error", async () => {
    const calls = signIn([]);
    const response = await DELETE(request("DELETE", { jobUrl, mark: "hidden" }));

    expect(response.status).toBe(200);
    expect(((await response.json()) as { removed: number }).removed).toBe(0);
    const eqs = calls.filter(([method]) => method === "eq").map(([, column, value]) => [column, value]);
    expect(eqs).toContainEqual(["organization_id", organizationId]);
    expect(eqs).toContainEqual(["user_id", "user-1"]);
    expect(eqs).toContainEqual(["job_url", jobUrl]);
    expect(eqs).toContainEqual(["mark", "hidden"]);
  });

  it("reports the removed row when the mark existed", async () => {
    signIn([{ id: "22222222-3333-4444-8555-666666666666" }]);
    const response = await DELETE(request("DELETE", { jobUrl, mark: "favorite" }));
    expect(((await response.json()) as { removed: number }).removed).toBe(1);
  });
});
