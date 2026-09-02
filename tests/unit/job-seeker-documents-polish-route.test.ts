// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
  generatePolishedDocument: vi.fn(),
  polishAvailability: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization: harness.requireActiveOrganization,
}));
vi.mock("@/lib/job-seeker/polish", () => ({
  generatePolishedDocument: harness.generatePolishedDocument,
  polishAvailability: harness.polishAvailability,
}));

import { GET, POST } from "@/app/api/job-seeker/applications/[applicationId]/documents/route";

/**
 * The polish action on the documents route (ADR-248): a passing variant
 * is stored as the next version with its model and check; a rejected one
 * is returned with the additions named and nothing is inserted; the lane's
 * availability rides on GET so the page can label the button honestly.
 */

const organizationId = "10000000-0000-4000-8000-000000000047";
const applicationId = "20000000-0000-4000-8000-000000000003";

function chain(result: unknown, calls: unknown[][] = []) {
  const node: Record<string, unknown> = {};
  for (const method of ["select", "insert", "update", "eq", "order", "limit", "maybeSingle", "single"]) {
    node[method] = vi.fn((...args: unknown[]) => {
      calls.push([method, ...args]);
      return node;
    });
  }
  node.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return node;
}

const PROFILE_ROW = {
  full_name: "Dana Reyes", email: "dana@example.com", phone: null, linkedin_url: null, location: "Austin, TX",
  summary: "Platform engineer.", skills: ["Kubernetes"], technologies: ["PostgreSQL"], certifications: [],
  employment_history: [{ organization: "Acme", title: "Staff Engineer", started: "2019", highlights: ["Ran Kubernetes for 40 services."] }], education: [],
};

function stub(calls: unknown[][], documents: unknown[] = []) {
  const byTable: Record<string, unknown> = {
    job_seeker_applications: { data: { id: applicationId, job_id: "j1", stage: "READY_FOR_REVIEW" }, error: null },
    job_seeker_profiles: { data: PROFILE_ROW, error: null },
    job_seeker_jobs: { data: { title: "Platform Engineer", company: "Nordisk Teknik A/S", description: "Kubernetes and PostgreSQL." }, error: null },
    job_seeker_documents: { data: documents, error: null },
  };
  harness.requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId },
    user: { id: "user-1" },
    client: { from: vi.fn((table: string) => chain(byTable[table], calls)) },
  });
}

function post(body: unknown) {
  return POST(
    new Request(`https://factory.example/api/job-seeker/applications/${applicationId}/documents`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: "https://factory.example" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ applicationId }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.polishAvailability.mockReturnValue({ available: false, model: null, detail: "ANTHROPIC_API_KEY is not set on the server." });
});

describe("GET documents", () => {
  it("lists documents with their provenance and says whether the polish lane is usable", async () => {
    const calls: unknown[][] = [];
    stub(calls, [
      { id: "d2", kind: "resume", version: 2, content: "polished", created_at: "2026-09-02T00:00:00Z", origin: "polished", model: "claude-opus-5" },
      { id: "d1", kind: "resume", version: 1, content: "baseline", created_at: "2026-09-01T00:00:00Z", origin: "baseline", model: null },
    ]);
    const payload = (await (await GET(new Request("https://factory.example/x"), { params: Promise.resolve({ applicationId }) })).json()) as {
      documents: Array<{ version: number; origin: string; model: string | null }>;
      polish: { available: boolean; detail: string };
    };
    expect(payload.documents.map((document) => [document.version, document.origin, document.model])).toEqual([[2, "polished", "claude-opus-5"], [1, "baseline", null]]);
    expect(payload.polish).toEqual({ available: false, model: null, detail: "ANTHROPIC_API_KEY is not set on the server." });
  });
});

describe("POST { action: 'polish' }", () => {
  it("stores a passing variant as the next version with the model and the check", async () => {
    const calls: unknown[][] = [];
    stub(calls, [{ kind: "resume", version: 1 }, { kind: "cover_letter", version: 1 }]);
    harness.generatePolishedDocument.mockResolvedValue({
      status: "polished", model: "claude-opus-5", content: "Dana Reyes\nSUMMARY\nPlatform engineer.",
      check: { passed: true, violations: [], verified: { terms: 1, numbers: 0, names: 1 } }, detail: "Polished by claude-opus-5; nothing added.",
    });
    const response = await post({ action: "polish", kind: "resume" });
    expect(response.status).toBe(201);
    const inserted = calls.find(([method]) => method === "insert")![1] as Array<Record<string, unknown>>;
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ kind: "resume", version: 2, origin: "polished", model: "claude-opus-5", content: "Dana Reyes\nSUMMARY\nPlatform engineer." });
    expect((inserted[0]!.polish_check as { passed: boolean }).passed).toBe(true);
    const input = harness.generatePolishedDocument.mock.calls[0]![0] as { kind: string; baseline: string; profileTerms: string[] };
    expect(input.kind).toBe("resume");
    expect(input.baseline).toContain("Dana Reyes");
    expect(input.profileTerms).toEqual(["Kubernetes", "PostgreSQL"]);
    const payload = (await response.json()) as { polish: { status: string; violations: unknown[] } };
    expect(payload.polish.status).toBe("polished");
  });

  it("stores nothing for a rejected variant and names the additions", async () => {
    const calls: unknown[][] = [];
    stub(calls, [{ kind: "resume", version: 1 }]);
    harness.generatePolishedDocument.mockResolvedValue({
      status: "rejected", model: "claude-opus-5", content: "an invented text",
      check: { passed: false, violations: [{ kind: "term", value: "Terraform" }], verified: { terms: 1, numbers: 0, names: 0 } },
      detail: "claude-opus-5 added things your record does not contain, so nothing was saved.",
    });
    const response = await post({ action: "polish", kind: "cover_letter" });
    expect(response.status).toBe(200);
    expect(calls.some(([method]) => method === "insert")).toBe(false);
    const payload = (await response.json()) as { polish: { status: string; violations: Array<{ value: string }>; content?: unknown } };
    expect(payload.polish.status).toBe("rejected");
    expect(payload.polish.violations).toEqual([{ kind: "term", value: "Terraform" }]);
    expect(payload.polish.content).toBeUndefined();
  });

  it("answers Not Connected without a credential, storing nothing, and refuses a polish with no kind", async () => {
    const calls: unknown[][] = [];
    stub(calls);
    harness.generatePolishedDocument.mockResolvedValue({ status: "not_connected", model: null, detail: "ANTHROPIC_API_KEY is not set on the server." });
    const response = await post({ action: "polish", kind: "resume" });
    expect(response.status).toBe(200);
    expect(((await response.json()) as { polish: { status: string } }).polish.status).toBe("not_connected");
    expect(calls.some(([method]) => method === "insert")).toBe(false);
    expect((await post({ action: "polish" })).status).toBe(400);
  });

  it("still generates the fact-only pair by default, with no model involved", async () => {
    const calls: unknown[][] = [];
    stub(calls);
    const response = await post({});
    expect(response.status).toBe(201);
    expect(harness.generatePolishedDocument).not.toHaveBeenCalled();
    const inserted = calls.find(([method]) => method === "insert")![1] as Array<Record<string, unknown>>;
    expect(inserted.map((row) => row.kind)).toEqual(["resume", "cover_letter"]);
    expect(inserted.every((row) => row.origin === undefined)).toBe(true);
  });
});
