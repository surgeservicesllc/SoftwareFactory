// @vitest-environment node

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization: harness.requireActiveOrganization,
}));

import { GET, POST } from "@/app/api/job-seeker/jobs/[jobId]/prep/route";

/**
 * The prep route (ADR-246): composes the sheet from the caller's own rows,
 * refuses a job that is not theirs, and asks the model only on POST — and
 * answers Not Connected with the reason when no credential exists.
 */

const organizationId = "10000000-0000-4000-8000-000000000045";
const jobId = "30000000-0000-4000-8000-000000000002";
const applicationId = "20000000-0000-4000-8000-000000000002";

function chain(result: unknown, calls: unknown[] = []) {
  const node: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "maybeSingle", "single"]) {
    node[method] = vi.fn((...args: unknown[]) => {
      calls.push([method, ...args]);
      return node;
    });
  }
  node.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return node;
}

const JOB_ROW = {
  id: jobId, title: "Senior Platform Engineer", company: "Nordisk Teknik A/S",
  description: "You will run Kubernetes and Terraform. Must be authorized to work in Denmark. ".repeat(3),
  salary_text: null, location: "København", work_model: null,
  job_seeker_applications: { id: applicationId, stage: "INTERVIEW", notes: "Second round.", follow_up_at: null, applied_at: "2026-08-10T00:00:00Z" },
};
const PROFILE_ROW = {
  full_name: "Dana Reyes", email: null, phone: null, linkedin_url: null, location: null, summary: null,
  skills: ["Kubernetes"], technologies: [], certifications: [],
  employment_history: [{ organization: "Acme", title: "Platform Engineer", started: "2021", highlights: ["Ran Kubernetes."] }], education: [],
};

function tables(overrides: Record<string, unknown> = {}) {
  return {
    job_seeker_jobs: { data: JOB_ROW, error: null },
    job_seeker_profiles: { data: PROFILE_ROW, error: null },
    job_seeker_screening_answers: { data: [{ question_key: "work_authorization", answer: "Yes, authorized in Denmark." }], error: null },
    job_seeker_contacts: { data: [{ name: "Mette Holm", role: "Engineering Manager", source: "LinkedIn" }], error: null },
    ...overrides,
  };
}

const ANTHROPIC_KEYS = ["ANTHROPIC_API_KEY", "ANTHROPIC_BASE_URL", "ANTHROPIC_DEFAULT_MODEL", "ANTHROPIC_PROVIDER_DISABLED"];
let saved: Record<string, string | undefined> = {};

beforeEach(() => {
  vi.clearAllMocks();
  saved = Object.fromEntries(ANTHROPIC_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ANTHROPIC_KEYS) delete process.env[key];
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

function withClient(byTable: Record<string, unknown>, calls: unknown[] = []) {
  harness.requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: organizationId },
    user: { id: "user-1" },
    client: {
      from: vi.fn((table: string) => {
        // The recorded-postings read for company memory (ADR-245) shares the jobs table
        // and answers a list; the job read answers one row through maybeSingle.
        if (table === "job_seeker_jobs" && byTable.job_seeker_jobs_list !== undefined) {
          const node = chain(byTable.job_seeker_jobs_list, calls);
          (node as { maybeSingle: unknown }).maybeSingle = vi.fn(() => chain(byTable.job_seeker_jobs, calls));
          return node;
        }
        return chain(byTable[table], calls);
      }),
    },
  });
}

const params = { params: Promise.resolve({ jobId }) };

describe("GET /api/job-seeker/jobs/[jobId]/prep", () => {
  it("composes the sheet from the caller's rows and says the model lane is Not Connected", async () => {
    withClient(tables({
      job_seeker_jobs_list: {
        data: [{ id: jobId, company: "Nordisk Teknik A/S", title: "Senior Platform Engineer", discovered_at: "2026-08-01T00:00:00Z", job_seeker_matches: { qualified: true }, job_seeker_applications: { stage: "INTERVIEW", applied_at: "2026-08-10T00:00:00Z", closed_reason: null } }],
        error: null,
      },
    }));
    const payload = (await (await GET(new Request("https://factory.example/x"), params)).json()) as {
      jobId: string;
      profileRecorded: boolean;
      sheet: {
        strengths: Array<{ term: string }>; gaps: Array<{ term: string }>; toAnswer: Array<{ line: string; verdict: string }>;
        history: Array<{ organization: string }>; questionsToAsk: string[]; memory: { sentence: string } | null;
        contacts: Array<{ name: string }>; notes: string | null; basis: string;
      };
      model: { available: boolean; detail: string };
    };
    expect(payload.jobId).toBe(jobId);
    expect(payload.profileRecorded).toBe(true);
    expect(payload.sheet.strengths.map((strength) => strength.term)).toEqual(["Kubernetes"]);
    expect(payload.sheet.gaps.map((gap) => gap.term)).toEqual(["Terraform"]);
    expect(payload.sheet.toAnswer.map((check) => check.verdict)).not.toContain("met");
    expect(payload.sheet.history[0]!.organization).toBe("Acme");
    expect(payload.sheet.questionsToAsk[0]).toContain("salary range");
    expect(payload.sheet.memory?.sentence).toBe("You applied to Nordisk Teknik A/S on 2026-08-10 and heard back (interview).");
    expect(payload.sheet.contacts).toEqual([{ name: "Mette Holm", role: "Engineering Manager", source: "LinkedIn" }]);
    expect(payload.sheet.notes).toBe("Second round.");
    expect(payload.model.available).toBe(false);
    expect(payload.model.detail).toContain("ANTHROPIC_API_KEY");
  });

  it("refuses a job that is not the caller's, and an invalid id", async () => {
    withClient(tables({ job_seeker_jobs: { data: null, error: null } }));
    expect((await GET(new Request("https://factory.example/x"), params)).status).toBe(404);
    expect((await GET(new Request("https://factory.example/x"), { params: Promise.resolve({ jobId: "nope" }) })).status).toBe(400);
  });
});

describe("POST /api/job-seeker/jobs/[jobId]/prep", () => {
  it("answers Not Connected with the reason when no credential exists, without failing", async () => {
    withClient(tables());
    const response = await POST(
      new Request("https://factory.example/api/job-seeker/jobs/x/prep", { method: "POST", headers: { origin: "https://factory.example" } }),
      params,
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { model: { status: string; detail: string; questions: string[] } };
    expect(payload.model.status).toBe("not_connected");
    expect(payload.model.questions).toEqual([]);
    expect(payload.model.detail).toContain("ANTHROPIC_API_KEY");
  });

  it("refuses a cross-origin request", async () => {
    withClient(tables());
    const response = await POST(
      new Request("https://factory.example/api/job-seeker/jobs/x/prep", { method: "POST", headers: { origin: "https://evil.example" } }),
      params,
    );
    expect(response.ok).toBe(false);
  });
});
