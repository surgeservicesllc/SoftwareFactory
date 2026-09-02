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

import { GET as analytics } from "@/app/api/job-seeker/analytics/route";

/**
 * The skills gap on the analytics route (ADR-245): counted over the
 * recorded postings against the recorded profile, with the basis printed;
 * null with the reason when there is no profile to measure against.
 */

const organizationId = "10000000-0000-4000-8000-000000000044";

function chain(result: unknown) {
  const node: Record<string, unknown> = {};
  for (const method of ["select", "eq", "order", "limit", "maybeSingle", "single"]) {
    node[method] = vi.fn(() => node);
  }
  node.then = (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return node;
}

const jobs = [
  { id: "j1", title: "Platform Engineer", source: "remotive", company: "A", description: "Kubernetes and Terraform.", discovered_at: "2026-08-01T00:00:00Z" },
  { id: "j2", title: "SRE", source: "manual", company: "B", description: "Terraform, Go, Python.", discovered_at: "2026-08-02T00:00:00Z" },
  { id: "j3", title: "Developer", source: "manual", company: "C", description: "TypeScript and Python.", discovered_at: "2026-08-03T00:00:00Z" },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("the skills gap on analytics", () => {
  it("ranks the terms the postings keep naming that the profile lacks, and prints the basis", async () => {
    const byTable: Record<string, unknown> = {
      job_seeker_jobs: { data: jobs, error: null },
      job_seeker_matches: { data: [{ job_id: "j1", score: 80, qualified: true }, { job_id: "j2", score: 40, qualified: false }], error: null },
      job_seeker_applications: { data: [], error: null },
      job_seeker_application_transitions: { data: [], error: null },
      job_seeker_profiles: { data: { skills: ["TypeScript"], technologies: ["Go"] }, error: null },
    };
    harness.requireActiveOrganization.mockResolvedValue({
      activeOrganization: { id: organizationId },
      user: { id: "user-1" },
      client: { from: vi.fn((table: string) => chain(byTable[table])), rpc: vi.fn(async () => ({ data: [], error: null })) },
    });
    const payload = (await (await analytics()).json()) as {
      analytics: { skillsGap: Array<{ term: string; postings: number; qualifiedPostings: number }>; skillsGapBasis: string };
    };
    expect(payload.analytics.skillsGap.map((row) => [row.term, row.postings, row.qualifiedPostings])).toEqual([
      ["Terraform", 2, 1],
      ["Python", 2, 0],
    ]);
    expect(payload.analytics.skillsGapBasis).toBe(
      "Counted over your 3 recorded postings against the 2 skills and technologies in your Career Profile; a term named by fewer than 2 postings is not a pattern and is left out.",
    );
  });

  it("answers null with the reason when no profile is recorded, and when the profile cannot be read", async () => {
    const byTable: Record<string, unknown> = {
      job_seeker_jobs: { data: jobs, error: null },
      job_seeker_matches: { data: [], error: null },
      job_seeker_applications: { data: [], error: null },
      job_seeker_application_transitions: { data: [], error: null },
      job_seeker_profiles: { data: null, error: null },
    };
    const client = { from: vi.fn((table: string) => chain(byTable[table])), rpc: vi.fn(async () => ({ data: [], error: null })) };
    harness.requireActiveOrganization.mockResolvedValue({ activeOrganization: { id: organizationId }, user: { id: "user-1" }, client });
    const none = (await (await analytics()).json()) as { analytics: { skillsGap: unknown; skillsGapBasis: string } };
    expect(none.analytics.skillsGap).toBeNull();
    expect(none.analytics.skillsGapBasis).toContain("No Career Profile is recorded yet");

    byTable.job_seeker_profiles = { data: null, error: { message: "permission denied" } };
    const unreadable = (await (await analytics()).json()) as { analytics: { skillsGap: unknown; skillsGapBasis: string } };
    expect(unreadable.analytics.skillsGap).toBeNull();
    expect(unreadable.analytics.skillsGapBasis).toContain("could not be read");
  });
});
