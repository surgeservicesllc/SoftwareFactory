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

import { PATCH } from "@/app/api/job-seeker/applications/[applicationId]/route";
import { GET as listJobs } from "@/app/api/job-seeker/jobs/route";
import { GET as analytics } from "@/app/api/job-seeker/analytics/route";

/**
 * The three routes silence flows through (ADR-243): close carries the
 * person's reason, the jobs list measures silence from the two functions
 * and says so when it cannot, and analytics counts the funnel, the
 * reasons and the replies per source — each failure-tolerant.
 */

const organizationId = "10000000-0000-4000-8000-000000000043";
const applicationId = "20000000-0000-4000-8000-000000000001";

/** A PostgREST-shaped chain: every builder method returns the chain; awaiting it yields `result`. */
function chain(result: unknown, calls: unknown[] = []) {
  const node: Record<string, unknown> = {};
  for (const method of ["select", "insert", "update", "delete", "eq", "order", "limit", "maybeSingle", "single"]) {
    node[method] = vi.fn((...args: unknown[]) => {
      calls.push([method, ...args]);
      return node;
    });
  }
  node.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return node as Record<string, ReturnType<typeof vi.fn>> & PromiseLike<unknown>;
}

function request(body: unknown) {
  return new Request(`https://factory.example/api/job-seeker/applications/${applicationId}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", origin: "https://factory.example" },
    body: JSON.stringify(body),
  });
}

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
});

describe("closing an application with a reason", () => {
  it("writes CLOSED and the reason together, and reads the reason back", async () => {
    const calls: unknown[] = [];
    const row = {
      id: applicationId, job_id: "j1", stage: "CLOSED", approval_status: "approved", decided_at: daysAgo(3),
      applied_at: daysAgo(2), application_url: null, notes: null, follow_up_at: null, closed_reason: "no_response", updated_at: daysAgo(0),
    };
    harness.requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId },
      user: { id: "user-1" },
      client: { from: vi.fn(() => chain({ data: row, error: null }, calls)) },
    });
    const response = await PATCH(request({ action: "close", closedReason: "no_response" }), { params: Promise.resolve({ applicationId }) });
    const payload = (await response.json()) as { application: { stage: string; closedReason: string | null } };
    expect(response.status).toBe(200);
    expect(payload.application).toMatchObject({ stage: "CLOSED", closedReason: "no_response" });
    const update = calls.find((call) => (call as unknown[])[0] === "update") as [string, Record<string, unknown>];
    expect(update[1]).toEqual({ stage: "CLOSED", closed_reason: "no_response" });
  });

  it("refuses a reason the schema does not know", async () => {
    harness.requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId },
      user: { id: "user-1" },
      client: { from: vi.fn(() => chain({ data: null, error: null })) },
    });
    const response = await PATCH(request({ action: "close", closedReason: "ghosted_me" }), { params: Promise.resolve({ applicationId }) });
    expect(response.status).toBe(422);
  });
});

describe("the jobs list measures silence", () => {
  const jobRow = {
    id: "j1", source: "remotive", external_id: null, url: "https://remotive.com/x", title: "Engineer", company: "Acme",
    salary_text: null, location: null, work_model: null, description: null, discovered_at: daysAgo(12),
    job_seeker_matches: null,
    job_seeker_applications: {
      id: applicationId, stage: "APPLIED", approval_status: "approved", application_url: null, notes: null,
      follow_up_at: null, applied_at: daysAgo(10), closed_reason: null,
    },
  };

  it("attaches days silent against the person's own median and a follow-up with its arithmetic", async () => {
    harness.requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId },
      user: { id: "user-1" },
      client: {
        from: vi.fn(() => chain({ data: [jobRow], error: null })),
        rpc: vi.fn(async (fn: string) => fn === "job_seeker_application_replies"
          ? { data: [], error: null }
          : { data: [{ source: null, applied: 4, replied: 3, silent: 1, median_days_to_reply: "12.0" }, { source: "remotive", applied: 2, replied: 1, silent: 1, median_days_to_reply: "9.0" }], error: null }),
      },
    });
    const payload = (await (await listJobs()).json()) as {
      jobs: Array<{ application: { closedReason: string | null; silence: { daysSilent: number; sentence: string; suggestionSentence: string } } }>;
      silenceBasis: string;
    };
    const application = payload.jobs[0]!.application;
    expect(application.closedReason).toBeNull();
    expect(application.silence.daysSilent).toBe(10);
    expect(application.silence.sentence).toBe("Silent for 10 days. Your median reply took 9 days across 1 reply on remotive.");
    expect(application.silence.suggestionSentence).toMatch(/^A follow-up was due \d{4}-\d{2}-\d{2}: applied \d{4}-\d{2}-\d{2} \+ 9 days \(your median 9 on remotive, held between 7 and 21\)\.$/);
    expect(payload.silenceBasis).toContain("counted from your own applications");
  });

  it("answers the list with silence null, and says why, when the ledger cannot be read", async () => {
    harness.requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId },
      user: { id: "user-1" },
      client: {
        from: vi.fn(() => chain({ data: [jobRow], error: null })),
        rpc: vi.fn(async () => ({ data: null, error: { message: "function does not exist" } })),
      },
    });
    const payload = (await (await listJobs()).json()) as {
      jobs: Array<{ application: { silence: unknown } }>;
      silenceBasis: string;
    };
    expect(payload.jobs[0]!.application.silence).toBeNull();
    expect(payload.silenceBasis).toContain("could not be measured");
  });
});

describe("analytics counts the funnel, the reasons and the replies", () => {
  it("counts applications per stage, reasons with unstated named, and replies per source", async () => {
    const byTable: Record<string, unknown> = {
      job_seeker_jobs: { data: [{ id: "j1", title: "Engineer", source: "remotive" }, { id: "j2", title: "Designer", source: "manual" }], error: null },
      job_seeker_matches: { data: [{ job_id: "j1", score: 80, qualified: true }], error: null },
      job_seeker_applications: {
        data: [
          { job_id: "j1", stage: "CLOSED", closed_reason: "no_response" },
          { job_id: "j2", stage: "CLOSED", closed_reason: null },
          { job_id: "j3", stage: "APPLIED", closed_reason: null },
        ],
        error: null,
      },
      job_seeker_application_transitions: {
        data: [
          { application_id: "a1", to_stage: "FOUND" },
          { application_id: "a1", to_stage: "APPLIED" },
          { application_id: "a1", to_stage: "CLOSED" },
          { application_id: "a2", to_stage: "FOUND" },
          { application_id: "a2", to_stage: "APPLIED" },
          { application_id: "a2", to_stage: "APPLIED" },
        ],
        error: null,
      },
    };
    harness.requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId },
      user: { id: "user-1" },
      client: {
        from: vi.fn((table: string) => chain(byTable[table])),
        rpc: vi.fn(async () => ({ data: [{ source: null, applied: 3, replied: 1, silent: 1, median_days_to_reply: "6.0" }], error: null })),
      },
    });
    const payload = (await (await analytics()).json()) as {
      analytics: {
        funnel: Array<{ stage: string; reached: number }>;
        closedReasons: Array<{ reason: string; count: number }>;
        responseBySource: Array<{ source: string | null; medianDaysToReply: number | null }>;
      };
    };
    expect(payload.analytics.funnel.find((row) => row.stage === "APPLIED")).toEqual({ stage: "APPLIED", reached: 2 });
    expect(payload.analytics.funnel.find((row) => row.stage === "CLOSED")).toEqual({ stage: "CLOSED", reached: 1 });
    expect(payload.analytics.closedReasons).toEqual([{ reason: "no_response", count: 1 }, { reason: "unstated", count: 1 }]);
    expect(payload.analytics.responseBySource).toEqual([{ source: null, applied: 3, replied: 1, silent: 1, medianDaysToReply: 6 }]);
  });

  it("answers null for the ledger-backed sections when the ledger is unreadable", async () => {
    const byTable: Record<string, unknown> = {
      job_seeker_jobs: { data: [{ id: "j1", title: "Engineer", source: "remotive" }], error: null },
      job_seeker_matches: { data: [], error: null },
      job_seeker_applications: { data: [], error: null },
      job_seeker_application_transitions: { data: null, error: { message: "relation does not exist" } },
    };
    harness.requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId },
      user: { id: "user-1" },
      client: {
        from: vi.fn((table: string) => chain(byTable[table])),
        rpc: vi.fn(async () => { throw new Error("function does not exist"); }),
      },
    });
    const payload = (await (await analytics()).json()) as { analytics: { funnel: unknown; responseBySource: unknown; closedReasons: unknown[] } };
    expect(payload.analytics.funnel).toBeNull();
    expect(payload.analytics.responseBySource).toBeNull();
    expect(payload.analytics.closedReasons).toEqual([]);
  });
});
