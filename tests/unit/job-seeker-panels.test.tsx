import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JobSeekerApplicationsPanel } from "@/components/job-seeker/applications-panel";
import { JobSeekerJobsPanel, type JobView } from "@/components/job-seeker/jobs-panel";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

const SCORED_JOB: JobView = {
  id: "j1",
  source: "manual",
  externalId: "acme-1",
  url: "https://jobs.acme.example/1",
  title: "Staff Engineer",
  company: "Acme",
  salaryText: "$240k",
  location: "Remote — US",
  workModel: "remote",
  description: "TypeScript platform role",
  discoveredAt: "2026-08-20T00:00:00.000Z",
  match: {
    score: 89,
    breakdown: { experience: 30, skills: 18, leadership: 12, industry: 8, compensation: 9, location: 10, career_growth: 2 },
    reasons: ["The posting names TypeScript from your profile."],
    gaps: ["No leadership evidence is recorded in your history."],
    threshold: 80,
    qualified: true,
  },
  application: { id: "a1", stage: "READY_FOR_REVIEW", approvalStatus: "pending_review" },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("JobSeekerJobsPanel", () => {
  it("records a job and reports its score honestly", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/job-seeker/jobs" && init?.method === "POST") {
        return jsonResponse({ job: SCORED_JOB }, 201);
      }
      if (url === "/api/job-seeker/jobs") return jsonResponse({ jobs: [] });
      throw new Error(`Unexpected request: ${url}`);
    }));

    render(<JobSeekerJobsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /record a job/i }));
    fireEvent.change(screen.getByLabelText("Job title"), { target: { value: "Staff Engineer" } });
    fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: /record and score/i }));

    await waitFor(() =>
      expect(screen.getByRole("status")).toHaveTextContent("Recorded and scored 89/100 — qualified."));
    expect(screen.getByText("89")).toBeInTheDocument();
    expect(screen.getByText("Qualified")).toBeInTheDocument();
  });

  it("surfaces the duplicate refusal in the provider's words", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/job-seeker/jobs" && init?.method === "POST") {
        return jsonResponse(
          { error: { code: "duplicate_job", message: "This job is already recorded: same company, title, and job id." } },
          409,
        );
      }
      if (url === "/api/job-seeker/jobs") return jsonResponse({ jobs: [SCORED_JOB] });
      throw new Error(`Unexpected request: ${url}`);
    }));

    render(<JobSeekerJobsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /record a job/i }));
    fireEvent.change(screen.getByLabelText("Job title"), { target: { value: "Staff Engineer" } });
    fireEvent.change(screen.getByLabelText("Company"), { target: { value: "Acme" } });
    fireEvent.click(screen.getByRole("button", { name: /record and score/i }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/already recorded/);
  });

  it("shows the breakdown, reasons, and gaps behind a score", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ jobs: [SCORED_JOB] })));
    render(<JobSeekerJobsPanel />);

    expect(await screen.findByText("Staff Engineer")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/score breakdown/i));
    expect(screen.getByText("experience")).toBeInTheDocument();
    expect(screen.getByText(/names TypeScript from your profile/)).toBeInTheDocument();
    expect(screen.getByText(/No leadership evidence/)).toBeInTheDocument();
  });
});

describe("JobSeekerApplicationsPanel", () => {
  it("offers Approve and Reject at Ready for Review, and records the decision", async () => {
    const patches: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/job-seeker/applications/") && init?.method === "PATCH") {
        patches.push(JSON.parse(String(init.body)));
        return jsonResponse({ application: { id: "a1", stage: "READY_FOR_REVIEW", approvalStatus: "approved" } });
      }
      if (url === "/api/job-seeker/jobs") return jsonResponse({ jobs: [SCORED_JOB] });
      throw new Error(`Unexpected request: ${url}`);
    }));

    render(<JobSeekerApplicationsPanel />);
    expect(await screen.findByText("Awaiting your review")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(patches).toEqual([{ action: "approve" }]));
  });

  it("never offers a post-approval stage while the decision is pending", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ jobs: [SCORED_JOB] })));
    render(<JobSeekerApplicationsPanel />);

    await screen.findByText("Awaiting your review");
    // The gate in the UI mirrors the gate in the schema: no Applied button
    // exists before approval.
    expect(screen.queryByRole("button", { name: /move to applied/i })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
  });

  it("surfaces the schema's approval refusal in plain words", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/job-seeker/applications/") && init?.method === "PATCH") {
        return jsonResponse(
          { error: { code: "approval_required", message: "This stage needs your explicit approval first. Review the application and approve it before applying." } },
          409,
        );
      }
      if (url === "/api/job-seeker/jobs") return jsonResponse({ jobs: [SCORED_JOB] });
      throw new Error(`Unexpected request: ${url}`);
    }));

    render(<JobSeekerApplicationsPanel />);
    await screen.findByText("Awaiting your review");
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/explicit approval first/);
  });
  it("prepares an application: generates fact-only documents and shows them versioned", async () => {
    const posts: string[] = [];
    // The real route advances the stage to READY_FOR_REVIEW; the stub
    // mirrors that so the reload shows the post-generation truth.
    let stage = "QUALIFIED";
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/job-seeker/applications/a2/documents" && init?.method === "POST") {
        posts.push(url);
        stage = "READY_FOR_REVIEW";
        return jsonResponse({
          documents: [
            { id: "d1", kind: "resume", version: 1, content: "SUMMARY\nPlatform engineer.", createdAt: "2026-08-20T01:00:00.000Z" },
            { id: "d2", kind: "cover_letter", version: 1, content: "Dear Acme hiring team,", createdAt: "2026-08-20T01:00:00.000Z" },
          ],
        }, 201);
      }
      if (url === "/api/job-seeker/jobs") {
        return jsonResponse({ jobs: [{
          ...SCORED_JOB,
          application: { id: "a2", stage, approvalStatus: "pending_review" },
        }] });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));

    render(<JobSeekerApplicationsPanel />);
    fireEvent.click(await screen.findByRole("button", { name: /prepare application/i }));

    await waitFor(() => expect(posts).toHaveLength(1));
    fireEvent.click(await screen.findByText(/generated documents/i));
    expect(await screen.findByText(/resume · v1/i)).toBeInTheDocument();
    expect(screen.getByText(/Dear Acme hiring team/)).toBeInTheDocument();
    expect(screen.getByText(/a term you have\s+not recorded never appears/i)).toBeInTheDocument();
  });
});
