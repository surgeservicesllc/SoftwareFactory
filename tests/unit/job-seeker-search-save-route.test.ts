// @vitest-environment node

import { beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  requireActiveOrganization: vi.fn(),
  loadEvaluationInputs: vi.fn(),
  insertScoredJob: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/tenant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/supabase/tenant")>()),
  requireActiveOrganization: harness.requireActiveOrganization,
}));
vi.mock("@/lib/job-seeker/record", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/job-seeker/record")>()),
  loadEvaluationInputs: harness.loadEvaluationInputs,
  insertScoredJob: harness.insertScoredJob,
}));

import { POST } from "@/app/api/job-seeker/search/save/route";
import { SupabaseAuthenticationError } from "@/lib/supabase/auth";

const job = {
  externalId: "5901234",
  url: "https://jobnet.dk/find-job/5901234",
  title: "Senior Platform Engineer",
  company: "Nordisk Teknik A/S",
  salaryText: null,
  location: "København K",
  workModel: null,
  description: "Kubernetes depth wanted.",
};

function saveRequest(body: unknown) {
  return new Request("https://factory.example/api/job-seeker/search/save", {
    method: "POST",
    headers: { "content-type": "application/json", origin: "https://factory.example" },
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  harness.requireActiveOrganization.mockResolvedValue({
    activeOrganization: { id: "10000000-0000-4000-8000-000000000042" },
    user: { id: "user-1" },
    client: {},
  });
  harness.loadEvaluationInputs.mockResolvedValue({ profile: {}, preferences: {} });
  harness.insertScoredJob.mockResolvedValue({
    outcome: "recorded", jobId: "job-1", score: 76, qualified: false,
  });
});

describe("saving a search result", () => {
  it("records it through the same chain a manual job uses", async () => {
    const response = await POST(saveRequest({ board: "jobnet", job }));
    const payload = (await response.json()) as { saved: boolean; jobId: string; score: number };

    expect(response.status).toBe(201);
    expect(payload).toMatchObject({ saved: true, jobId: "job-1", score: 76 });
    expect(harness.insertScoredJob).toHaveBeenCalledTimes(1);
  });

  it("attributes the job to the board it came from, not to 'manual'", async () => {
    // job_seeker_jobs.source calls honest attribution "the anti-fabrication
    // rule in column form". This is the case that column was written for.
    await POST(saveRequest({ board: "jobnet", job }));
    expect(harness.insertScoredJob).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ source: "jobnet" }),
    );
  });

  it("refuses a board this deployment cannot read", async () => {
    /*
     * Otherwise a crafted request attributes an invented posting to a board
     * that was never queried, and the column's CHECK would store it happily.
     */
    const response = await POST(saveRequest({ board: "linkedin", job }));
    const payload = (await response.json()) as { error?: { code?: string } };

    expect(response.status).toBe(400);
    expect(payload.error?.code).toBe("board_unknown");
    expect(harness.insertScoredJob).not.toHaveBeenCalled();
  });

  it("refuses a signed-out caller", async () => {
    harness.requireActiveOrganization.mockRejectedValue(
      new SupabaseAuthenticationError("authentication_required", "Authentication is required."),
    );
    const response = await POST(saveRequest({ board: "jobnet", job }));
    expect(response.status).toBeGreaterThanOrEqual(401);
    expect(harness.insertScoredJob).not.toHaveBeenCalled();
  });

  it("refuses a cross-origin save", async () => {
    const response = await POST(
      new Request("https://factory.example/api/job-seeker/search/save", {
        method: "POST",
        headers: { "content-type": "application/json", origin: "https://evil.example" },
        body: JSON.stringify({ board: "jobnet", job }),
      }),
    );
    expect(response.ok).toBe(false);
    expect(harness.insertScoredJob).not.toHaveBeenCalled();
  });

  it("re-validates the posting rather than trusting what came back from the browser", async () => {
    const response = await POST(
      saveRequest({ board: "jobnet", job: { ...job, title: "", company: "x".repeat(400) } }),
    );
    expect(response.status).toBe(422);
    expect(harness.insertScoredJob).not.toHaveBeenCalled();
  });

  it("refuses a non-http url, which the column's CHECK would reject anyway", async () => {
    const response = await POST(saveRequest({ board: "jobnet", job: { ...job, url: "javascript:alert(1)" } }));
    expect(response.status).toBe(422);
    expect(harness.insertScoredJob).not.toHaveBeenCalled();
  });

  it("refuses a posting carrying a credential-shaped value", async () => {
    const response = await POST(
      saveRequest({
        board: "jobnet",
        job: { ...job, description: "Contact us. AWS key AKIAIOSFODNN7EXAMPLE secret wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
      }),
    );
    const payload = (await response.json()) as { error?: { code?: string } };
    expect(response.status).toBe(422);
    expect(payload.error?.code).toBe("sensitive_content");
    expect(harness.insertScoredJob).not.toHaveBeenCalled();
  });

  it("reports an already-saved posting as a state, not a failure", async () => {
    /*
     * Clicking Save twice is a person clicking twice. 200 with "already in
     * your list" is the truthful answer; a 409 would present the state they
     * wanted as an error.
     */
    harness.insertScoredJob.mockResolvedValue({ outcome: "duplicate" });

    const response = await POST(saveRequest({ board: "jobnet", job }));
    const payload = (await response.json()) as { saved: boolean; reason: string };

    expect(response.status).toBe(200);
    expect(payload).toEqual({ saved: false, reason: "already_saved" });
  });

  it("rejects unknown fields instead of storing a shape nothing validated", async () => {
    const response = await POST(saveRequest({ board: "jobnet", job: { ...job, score: 100 } }));
    expect(response.status).toBe(422);
  });
});
