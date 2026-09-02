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

import { GET as readKit, PUT as saveAnswers } from "@/app/api/job-seeker/application-kit/route";
import { GET as checkJob } from "@/app/api/job-seeker/jobs/[jobId]/requirements/route";

/**
 * The application kit routes (ADR-244): the kit composes blocks from the
 * caller's own profile row and answers; saving upserts one row per question
 * and deletes an emptied one; the requirements check names its basis and
 * refuses a job that is not the caller's.
 */

const organizationId = "10000000-0000-4000-8000-000000000044";
const jobId = "30000000-0000-4000-8000-000000000001";

function chain(result: unknown, calls: unknown[] = []) {
  const node: Record<string, unknown> = {};
  for (const method of ["select", "insert", "update", "delete", "upsert", "eq", "order", "limit", "maybeSingle", "single"]) {
    node[method] = vi.fn((...args: unknown[]) => {
      calls.push([method, ...args]);
      return node;
    });
  }
  node.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return node as Record<string, ReturnType<typeof vi.fn>> & PromiseLike<unknown>;
}

const PROFILE_ROW = {
  full_name: "Dana Reyes", email: "dana@example.com", phone: null, linkedin_url: null, location: "Austin, TX",
  summary: "Platform engineer.", skills: ["TypeScript"], technologies: ["PostgreSQL"], certifications: [],
  employment_history: [{ organization: "Acme", title: "Staff Engineer", started: "2019" }], education: [],
};

function client(byTable: Record<string, unknown>, calls: unknown[] = []) {
  return { from: vi.fn((table: string) => chain(byTable[table], calls)) };
}

function putRequest(body: unknown) {
  return new Request("https://factory.example/api/job-seeker/application-kit", {
    method: "PUT",
    headers: { "content-type": "application/json", origin: "https://factory.example" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("GET /api/job-seeker/application-kit", () => {
  it("composes the blocks from the profile and the answered questions", async () => {
    harness.requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId },
      user: { id: "user-1" },
      client: client({
        job_seeker_profiles: { data: PROFILE_ROW, error: null },
        job_seeker_screening_answers: { data: [{ question_key: "notice_period", answer: "30 days" }], error: null },
      }),
    });
    const payload = (await (await readKit()).json()) as {
      profileRecorded: boolean; blocks: Array<{ key: string; text: string }>; answers: Record<string, string>; questions: unknown[];
    };
    expect(payload.profileRecorded).toBe(true);
    expect(payload.blocks.map((block) => block.key)).toEqual(["contact", "summary", "experience", "skills", "screening"]);
    expect(payload.blocks.at(-1)!.text).toBe("Notice period at your current employer\n30 days");
    expect(payload.answers).toEqual({ notice_period: "30 days" });
    expect(payload.questions).toHaveLength(12);
  });

  it("says no profile is recorded instead of composing empty blocks", async () => {
    harness.requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId },
      user: { id: "user-1" },
      client: client({
        job_seeker_profiles: { data: null, error: null },
        job_seeker_screening_answers: { data: [], error: null },
      }),
    });
    const payload = (await (await readKit()).json()) as { profileRecorded: boolean; blocks: unknown[] };
    expect(payload).toMatchObject({ profileRecorded: false, blocks: [] });
  });
});

describe("PUT /api/job-seeker/application-kit", () => {
  it("upserts an answer per question, deletes an emptied one, and reads the result back", async () => {
    const calls: unknown[] = [];
    harness.requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId },
      user: { id: "user-1" },
      client: client({
        job_seeker_screening_answers: { data: [{ question_key: "needs_sponsorship", answer: "No" }], error: null },
      }, calls),
    });
    const response = await saveAnswers(putRequest({ answers: { needs_sponsorship: "No", notice_period: "" } }));
    expect(response.status).toBe(200);
    expect((await response.json()) as unknown).toEqual({ answers: { needs_sponsorship: "No" } });
    const upsert = calls.find((call) => (call as unknown[])[0] === "upsert") as [string, Record<string, unknown>, unknown];
    expect(upsert[1]).toMatchObject({ organization_id: organizationId, user_id: "user-1", question_key: "needs_sponsorship", answer: "No" });
    expect(upsert[2]).toEqual({ onConflict: "organization_id,user_id,question_key" });
    expect(calls.some((call) => (call as unknown[])[0] === "delete")).toBe(true);
  });

  it("refuses an unknown question and a credential-shaped answer", async () => {
    harness.requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId },
      user: { id: "user-1" },
      client: client({ job_seeker_screening_answers: { data: [], error: null } }),
    });
    expect((await saveAnswers(putRequest({ answers: { shoe_size: "42" } }))).status).toBe(422);
    const secret = await saveAnswers(putRequest({ answers: { references: "bearer abcdefghijklmnopqrstuvwxyz0123" } }));
    expect(secret.status).toBe(422);
    expect(((await secret.json()) as { error: { code: string } }).error.code).toBe("sensitive_content");
  });
});

describe("GET /api/job-seeker/jobs/[jobId]/requirements", () => {
  it("checks the posting's lines against the profile and answers, naming the basis", async () => {
    harness.requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId },
      user: { id: "user-1" },
      client: client({
        job_seeker_jobs: {
          data: {
            id: jobId, title: "Staff Engineer", company: "Acme",
            description: "5+ years of experience with TypeScript required. Must be authorized to work in the US without sponsorship.",
          },
          error: null,
        },
        job_seeker_profiles: { data: PROFILE_ROW, error: null },
        job_seeker_screening_answers: { data: [], error: null },
      }),
    });
    const payload = (await (await checkJob(new Request("https://factory.example"), { params: Promise.resolve({ jobId }) })).json()) as {
      checks: Array<{ verdict: string; reason: string }>; counts: { met: number; unmet: number; unknown: number }; basis: string;
    };
    expect(payload.checks.map((check) => check.verdict)).toEqual(["met", "unknown"]);
    expect(payload.checks[0]!.reason).toMatch(/your recorded history \(\d+ years from its dates\) covers it/);
    expect(payload.counts).toEqual({ met: 1, unmet: 0, unknown: 1 });
    expect(payload.basis).toContain("nothing is assumed met");
  });

  it("answers 404 for a job that is not the caller's", async () => {
    harness.requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId },
      user: { id: "user-1" },
      client: client({ job_seeker_jobs: { data: null, error: null } }),
    });
    const response = await checkJob(new Request("https://factory.example"), { params: Promise.resolve({ jobId }) });
    expect(response.status).toBe(404);
  });
});
