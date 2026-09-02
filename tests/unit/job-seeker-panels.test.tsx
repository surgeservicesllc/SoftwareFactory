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
  application: { id: "a1", stage: "READY_FOR_REVIEW", approvalStatus: "pending_review", applicationUrl: null, notes: null, followUpAt: null },
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
      if (url === "/api/job-seeker/import-sources") {
        return jsonResponse({ sources: [
          { key: "greenhouse", name: "Greenhouse job boards", summary: "Reads public postings.", configured: false, requiredConfiguration: ["SOFTWAREFACTORY_GREENHOUSE_BOARDS"] },
        ] });
      }
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
      if (url === "/api/job-seeker/import-sources") return jsonResponse({ sources: [] });
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
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === "/api/job-seeker/import-sources") return jsonResponse({ sources: [] });
      return jsonResponse({ jobs: [SCORED_JOB] });
    }));
    render(<JobSeekerJobsPanel />);

    expect(await screen.findByText("Staff Engineer")).toBeInTheDocument();
    fireEvent.click(screen.getByText(/score breakdown/i));
    expect(screen.getByText("experience")).toBeInTheDocument();
    expect(screen.getByText(/names TypeScript from your profile/)).toBeInTheDocument();
    expect(screen.getByText(/No leadership evidence/)).toBeInTheDocument();
  });

  it("renders a public source with its import form, and a credentialed one as Not Connected", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/job-seeker/import-sources") {
        return jsonResponse({ sources: [
          { key: "greenhouse", name: "Greenhouse job boards", summary: "Reads public postings — no credential needed.", mode: "public", identifierLabel: "Board token", identifierHint: "boards.greenhouse.io/{token}", configured: true, requiredConfiguration: [] },
          { key: "linkedin", name: "LinkedIn job search", summary: "Searches LinkedIn jobs.", mode: "credentialed", identifierLabel: null, identifierHint: null, configured: false, requiredConfiguration: ["SOFTWAREFACTORY_LINKEDIN_CLIENT_ID", "SOFTWAREFACTORY_LINKEDIN_CLIENT_SECRET"] },
        ] });
      }
      return jsonResponse({ jobs: [] });
    }));

    render(<JobSeekerJobsPanel />);

    expect(await screen.findByText("Greenhouse job boards")).toBeInTheDocument();
    expect(screen.getByText("Public API")).toBeInTheDocument();
    expect(screen.getByLabelText("Board token")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Import postings" })).toBeInTheDocument();
    // The credentialed adapter stays honest: Not Connected, needs named,
    // and no import control anywhere near it.
    expect(screen.getByText("Not Connected")).toBeInTheDocument();
    expect(screen.getByText(/Needs: SOFTWAREFACTORY_LINKEDIN_CLIENT_ID/)).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Import postings" })).toHaveLength(1);
  });

  it("imports from a public board and reports every count honestly", async () => {
    const posts: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/job-seeker/import" && init?.method === "POST") {
        posts.push(JSON.parse(String(init.body)));
        return jsonResponse({
          source: "greenhouse", identifier: "stripe", company: "Stripe",
          totalAvailable: 575, considered: 40, imported: 38, duplicates: 2, skippedSensitive: 0,
        });
      }
      if (url === "/api/job-seeker/import-sources") {
        return jsonResponse({ sources: [
          { key: "greenhouse", name: "Greenhouse job boards", summary: "Reads public postings.", mode: "public", identifierLabel: "Board token", identifierHint: null, configured: true, requiredConfiguration: [] },
        ] });
      }
      return jsonResponse({ jobs: [] });
    }));

    render(<JobSeekerJobsPanel />);
    fireEvent.change(await screen.findByLabelText("Board token"), { target: { value: "Stripe" } });
    fireEvent.click(screen.getByRole("button", { name: "Import postings" }));

    await waitFor(() => expect(posts).toEqual([{ source: "greenhouse", identifier: "Stripe" }]));
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent("Imported 38 of 40 postings from Stripe");
    expect(status).toHaveTextContent("2 already recorded");
    expect(status).toHaveTextContent(/lists 575 in total/);
  });

  it("surfaces a missing board as the provider's honest refusal", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/job-seeker/import" && init?.method === "POST") {
        return jsonResponse(
          { error: { code: "source_not_found", message: 'No public Greenhouse board is published at "ghost".' } },
          404,
        );
      }
      if (url === "/api/job-seeker/import-sources") {
        return jsonResponse({ sources: [
          { key: "greenhouse", name: "Greenhouse job boards", summary: "Reads public postings.", mode: "public", identifierLabel: "Board token", identifierHint: null, configured: true, requiredConfiguration: [] },
        ] });
      }
      return jsonResponse({ jobs: [] });
    }));

    render(<JobSeekerJobsPanel />);
    fireEvent.change(await screen.findByLabelText("Board token"), { target: { value: "ghost" } });
    fireEvent.click(screen.getByRole("button", { name: "Import postings" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/No public Greenhouse board is published at "ghost"/);
  });
});

describe("JobSeekerApplicationsPanel", () => {
  it("offers Approve and Reject at Ready for Review, and records the decision", async () => {
    const patches: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/job-seeker/applications/") && init?.method === "PATCH") {
        patches.push(JSON.parse(String(init.body)));
        return jsonResponse({ application: { id: "a1", stage: "READY_FOR_REVIEW", approvalStatus: "approved", applicationUrl: null, notes: null, followUpAt: null } });
      }
      if (url === "/api/job-seeker/jobs") return jsonResponse({ jobs: [SCORED_JOB] });
      if (url === "/api/job-seeker/import-sources") return jsonResponse({ sources: [] });
      throw new Error(`Unexpected request: ${url}`);
    }));

    render(<JobSeekerApplicationsPanel />);
    expect(await screen.findByText("Awaiting your review")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(patches).toEqual([{ action: "approve" }]));
  });

  it("saves notes, application URL, and follow-up date through one PATCH", async () => {
    const patches: unknown[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/job-seeker/applications/") && init?.method === "PATCH") {
        patches.push(JSON.parse(String(init.body)));
        return jsonResponse({
          application: {
            id: "a1", stage: "READY_FOR_REVIEW", approvalStatus: "pending_review",
            applicationUrl: "https://apply.acme.example/42", notes: "Sent thank-you note", followUpAt: "2026-09-01T09:00:00.000Z",
          },
        });
      }
      if (url === "/api/job-seeker/jobs") return jsonResponse({ jobs: [SCORED_JOB] });
      if (url === "/api/job-seeker/import-sources") return jsonResponse({ sources: [] });
      throw new Error(`Unexpected request: ${url}`);
    }));

    render(<JobSeekerApplicationsPanel />);
    await screen.findByText("Awaiting your review");

    fireEvent.click(screen.getByText("Notes & follow-up"));
    fireEvent.change(screen.getByLabelText("Notes"), { target: { value: "Sent thank-you note" } });
    fireEvent.change(screen.getByLabelText("Application URL"), { target: { value: "https://apply.acme.example/42" } });
    fireEvent.change(screen.getByLabelText("Follow-up date"), { target: { value: "2026-09-01T09:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save details" }));

    await waitFor(() => expect(patches).toHaveLength(1));
    const sent = patches[0] as Record<string, unknown>;
    expect(sent.action).toBe("follow_up");
    expect(sent.notes).toBe("Sent thank-you note");
    expect(sent.applicationUrl).toBe("https://apply.acme.example/42");
    expect(String(sent.followUpAt)).toMatch(/^2026-09-01T\d{2}:00:00/);
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
      if (url === "/api/job-seeker/import-sources") return jsonResponse({ sources: [] });
      throw new Error(`Unexpected request: ${url}`);
    }));

    render(<JobSeekerApplicationsPanel />);
    await screen.findByText("Awaiting your review");
    fireEvent.click(screen.getByRole("button", { name: "Reject" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(/explicit approval first/);
  });
  it("measures silence, offers the computed follow-up date, and closes with a reason (ADR-243)", async () => {
    const patches: unknown[] = [];
    const applied = {
      ...SCORED_JOB,
      application: {
        id: "a3", stage: "APPLIED", approvalStatus: "approved", applicationUrl: null, notes: null, followUpAt: null,
        closedReason: null,
        silence: {
          daysSinceApplied: 10, daysSilent: 10, repliedAfterDays: null,
          sentence: "Silent for 10 days. Your median reply took 9 days across 1 reply on remotive.",
          suggestedFollowUpOn: "2026-09-16",
          suggestionSentence: "A follow-up was due 2026-09-16: applied 2026-09-07 + 9 days (your median 9 on remotive, held between 7 and 21).",
        },
      },
    };
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/job-seeker/applications/") && init?.method === "PATCH") {
        patches.push(JSON.parse(String(init.body)));
        return jsonResponse({ application: { ...applied.application, followUpAt: "2026-09-16T09:00:00.000Z" } });
      }
      if (url === "/api/job-seeker/jobs") return jsonResponse({ jobs: [applied] });
      if (url === "/api/job-seeker/import-sources") return jsonResponse({ sources: [] });
      throw new Error(`Unexpected request: ${url}`);
    }));

    render(<JobSeekerApplicationsPanel />);
    expect(await screen.findByTestId("silence")).toHaveTextContent("Silent for 10 days. Your median reply took 9 days across 1 reply on remotive.");
    expect(screen.getByTestId("silence-suggestion")).toHaveTextContent("A follow-up was due 2026-09-16: applied 2026-09-07 + 9 days");

    fireEvent.click(screen.getByRole("button", { name: "Use this date" }));
    await waitFor(() => expect(patches).toHaveLength(1));
    expect(patches[0]).toEqual({ action: "follow_up", followUpAt: "2026-09-16T09:00:00.000Z" });

    fireEvent.change(screen.getByLabelText("Why is it closing?"), { target: { value: "no_response" } });
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(patches).toHaveLength(2));
    expect(patches[1]).toEqual({ action: "close", closedReason: "no_response" });
  });

  it("checks the posting's requirements on demand, each line with its verdict and reason (ADR-244)", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/job-seeker/jobs/j1/requirements") {
        return jsonResponse({
          checks: [
            { line: "5+ years of experience with TypeScript required.", verdict: "met", reason: "Asks for 5+ years; your recorded history (10 years from its dates) covers it." },
            { line: "Must be authorized to work in the US without sponsorship.", verdict: "unknown", reason: "Answer the work-authorization and sponsorship screening questions to check this line." },
          ],
          counts: { met: 1, unmet: 0, unknown: 1 },
          basis: "Each line is the posting's own sentence, checked against your recorded profile and screening answers; nothing is assumed met.",
        });
      }
      if (url === "/api/job-seeker/jobs") return jsonResponse({ jobs: [SCORED_JOB] });
      if (url === "/api/job-seeker/import-sources") return jsonResponse({ sources: [] });
      throw new Error(`Unexpected request: ${url}`);
    }));

    render(<JobSeekerApplicationsPanel />);
    await screen.findByText("Awaiting your review");
    const details = screen.getByTestId("requirements-check");
    fireEvent(details, new Event("toggle", { bubbles: false }));
    (details as HTMLDetailsElement).open = true;
    fireEvent(details, new Event("toggle"));

    expect(await screen.findByText("1 met · 0 not met · 1 unknown.", { exact: false })).toBeInTheDocument();
    expect(screen.getByText("Met")).toBeInTheDocument();
    expect(screen.getByText("Unknown")).toBeInTheDocument();
    expect(screen.getByText(/Answer the work-authorization and sponsorship screening questions/)).toBeInTheDocument();
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
          application: { id: "a2", stage, approvalStatus: "pending_review", applicationUrl: null, notes: null, followUpAt: null },
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

describe("model polish on the application's documents (ADR-248)", () => {
  const SCORED = {
    id: "job-3", title: "Platform Engineer", company: "Acme", discoveredAt: "2026-08-20T00:00:00.000Z",
    match: { score: 88, qualified: true },
    application: { id: "a3", stage: "READY_FOR_REVIEW", approvalStatus: "pending_review", applicationUrl: null, notes: null, followUpAt: null },
  };

  it("labels the lane Not Connected with the reason, and shows no polish buttons", async () => {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/job-seeker/jobs") return jsonResponse({ jobs: [SCORED] });
      if (url === "/api/job-seeker/applications/a3/documents") {
        return jsonResponse({
          documents: [{ id: "d1", kind: "resume", version: 1, content: "SUMMARY\nPlatform engineer.", createdAt: "2026-08-20T01:00:00.000Z", origin: "baseline", model: null }],
          polish: { available: false, model: null, detail: "ANTHROPIC_API_KEY is not set on the server." },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));
    render(<JobSeekerApplicationsPanel />);
    fireEvent.click(await screen.findByText(/generated documents/i));
    const lane = await screen.findByTestId("polish-lane");
    expect(lane).toHaveTextContent("Not Connected — ANTHROPIC_API_KEY is not set on the server.");
    expect(screen.queryByRole("button", { name: /polish the resume/i })).not.toBeInTheDocument();
    expect(screen.queryByTestId("polished-badge")).not.toBeInTheDocument();
  });

  it("asks for a polish on request, names a rejected variant's additions, and badges a stored one", async () => {
    const posts: string[] = [];
    let polishedStored = false;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/job-seeker/jobs") return jsonResponse({ jobs: [SCORED] });
      if (url === "/api/job-seeker/applications/a3/documents" && init?.method === "POST") {
        const body = JSON.parse(String(init.body)) as { action: string; kind: string };
        posts.push(`${body.action}:${body.kind}`);
        if (body.kind === "cover_letter") {
          return jsonResponse({
            polish: { status: "rejected", model: "claude-opus-5", detail: "claude-opus-5 added things your record does not contain, so nothing was saved.", violations: [{ kind: "term", value: "Terraform" }] },
            documents: [{ id: "d1", kind: "resume", version: 1, content: "SUMMARY\nPlatform engineer.", createdAt: "2026-08-20T01:00:00.000Z", origin: "baseline", model: null }],
          });
        }
        polishedStored = true;
        return jsonResponse({
          polish: { status: "polished", model: "claude-opus-5", detail: "Polished by claude-opus-5; 1 term, 0 numbers and 1 name verified against the fact-only baseline; nothing added.", violations: [] },
          documents: [
            { id: "d2", kind: "resume", version: 2, content: "SUMMARY\nA platform engineer.", createdAt: "2026-08-20T02:00:00.000Z", origin: "polished", model: "claude-opus-5" },
            { id: "d1", kind: "resume", version: 1, content: "SUMMARY\nPlatform engineer.", createdAt: "2026-08-20T01:00:00.000Z", origin: "baseline", model: null },
          ],
        }, 201);
      }
      if (url === "/api/job-seeker/applications/a3/documents") {
        return jsonResponse({
          documents: [{ id: "d1", kind: "resume", version: 1, content: "SUMMARY\nPlatform engineer.", createdAt: "2026-08-20T01:00:00.000Z", origin: "baseline", model: null }],
          polish: { available: true, model: "claude-opus-5", detail: "Polished by claude-opus-5 when you ask, then checked term by term against the fact-only version; a variant that adds anything is not saved." },
        });
      }
      throw new Error(`Unexpected request: ${url}`);
    }));
    render(<JobSeekerApplicationsPanel />);
    fireEvent.click(await screen.findByText(/generated documents/i));
    expect(await screen.findByText(/checked term by term against the fact-only version/)).toBeInTheDocument();
    expect(posts).toEqual([]);

    fireEvent.click(screen.getByRole("button", { name: /polish the cover letter/i }));
    const rejected = await screen.findByTestId("polish-outcome");
    expect(rejected).toHaveTextContent("nothing was saved");
    expect(rejected).toHaveTextContent("Terraform — a term your record does not contain");
    expect(screen.queryByTestId("polished-badge")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /polish the resume/i }));
    await waitFor(() => expect(polishedStored).toBe(true));
    expect(await screen.findByTestId("polished-badge")).toHaveTextContent("Polished by claude-opus-5, checked against the fact-only version");
    expect(screen.getByTestId("polish-outcome")).toHaveTextContent("nothing added");
    expect(posts).toEqual(["polish:cover_letter", "polish:resume"]);
  });
});
