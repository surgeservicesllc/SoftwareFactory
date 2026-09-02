import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { InterviewPrepSheet } from "@/components/job-seeker/interview-prep";

/**
 * The prep sheet component (ADR-246): fetched on open, every section
 * rendered from the route's answer, the model lane labeled honestly —
 * Not Connected with the reason, or the model's name on what it wrote.
 */

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

const SHEET = {
  strengths: [{ term: "Kubernetes", evidence: "listed under your skills; used at Acme as Platform Engineer" }],
  gaps: [{ term: "Terraform", sentence: "The posting names Terraform; your profile does not. Decide what you will say about it." }],
  toAnswer: [{ line: "Must be authorized to work in Denmark.", verdict: "unknown", reason: "Answer the work authorization question in your Application Kit." }],
  history: [{ organization: "Acme", title: "Platform Engineer", span: "2021 – present", sharedTerms: ["Kubernetes"], highlights: ["Ran Kubernetes for 40 services."] }],
  questionsToAsk: ["What is the salary range for this role? The posting does not state pay."],
  memory: { sentence: "You applied to Nordisk Teknik A/S on 2026-08-10 and heard back (interview)." },
  contacts: [{ name: "Mette Holm", role: "Engineering Manager", source: "LinkedIn" }],
  notes: "Second round with the CTO.",
  basis: "Composed from your recorded profile, screening answers, this posting's own text, your application and its contacts — nothing on this sheet is generated.",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("InterviewPrepSheet", () => {
  it("fetches on open and renders every section, with the model lane Not Connected", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({
      jobId: "j1", sheet: SHEET, profileRecorded: true,
      model: { available: false, model: null, detail: "ANTHROPIC_API_KEY is not set on the server." },
    }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<InterviewPrepSheet jobId="j1" />);
    expect(fetchMock).not.toHaveBeenCalled();

    await user.click(screen.getByText("Interview prep sheet"));
    expect(await screen.findByTestId("prep-strengths")).toHaveTextContent("Kubernetes — listed under your skills; used at Acme as Platform Engineer");
    expect(fetchMock).toHaveBeenCalledWith("/api/job-seeker/jobs/j1/prep", { cache: "no-store" });
    expect(screen.getByTestId("prep-gaps")).toHaveTextContent("The posting names Terraform; your profile does not.");
    expect(screen.getByTestId("prep-to-answer")).toHaveTextContent("Unknown");
    expect(screen.getByTestId("prep-to-answer")).toHaveTextContent("Must be authorized to work in Denmark.");
    expect(screen.getByTestId("prep-history")).toHaveTextContent("Platform Engineer at Acme (2021 – present) — shares Kubernetes");
    expect(screen.getByTestId("prep-history")).toHaveTextContent("Ran Kubernetes for 40 services.");
    expect(screen.getByTestId("prep-questions")).toHaveTextContent("salary range");
    expect(screen.getByTestId("prep-memory")).toHaveTextContent("heard back (interview)");
    expect(screen.getByTestId("prep-contacts")).toHaveTextContent("Mette Holm — Engineering Manager (LinkedIn)");
    expect(screen.getByTestId("prep-notes")).toHaveTextContent("Second round with the CTO.");
    const modelLane = screen.getByTestId("prep-model");
    expect(modelLane).toHaveTextContent("Not Connected — ANTHROPIC_API_KEY is not set on the server.");
    expect(within(modelLane).queryByRole("button")).not.toBeInTheDocument();
  });

  it("asks the model only on request and labels what came back with the model's name", async () => {
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? jsonResponse({ jobId: "j1", model: { status: "generated", model: "claude-opus-5", questions: ["How did you run Kubernetes at Acme?"], detail: "Written by claude-opus-5 from the posting and your recorded facts — check each against the posting; none of them is a recorded fact." } })
        : jsonResponse({ jobId: "j1", sheet: SHEET, profileRecorded: true, model: { available: true, model: "claude-opus-5", detail: "Questions are written by claude-opus-5 when you ask; none of them is a recorded fact." } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    render(<InterviewPrepSheet jobId="j1" />);
    await user.click(screen.getByText("Interview prep sheet"));
    const button = await screen.findByRole("button", { name: "Ask the model for likely questions" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await user.click(button);
    expect(await screen.findByTestId("prep-model-label")).toHaveTextContent("Written by claude-opus-5");
    expect(screen.getByTestId("prep-model")).toHaveTextContent("How did you run Kubernetes at Acme?");
    expect(fetchMock).toHaveBeenCalledWith("/api/job-seeker/jobs/j1/prep", { method: "POST", cache: "no-store" });
  });

  it("says when the sheet could not be composed, and when the profile is missing", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 500 })));
    const user = userEvent.setup();
    const { unmount } = render(<InterviewPrepSheet jobId="j1" />);
    await user.click(screen.getByText("Interview prep sheet"));
    expect(await screen.findByText("The prep sheet could not be composed.")).toBeInTheDocument();
    unmount();

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      jobId: "j1", sheet: { ...SHEET, strengths: [], history: [], memory: null, contacts: [], notes: null }, profileRecorded: false,
      model: { available: false, model: null, detail: "ANTHROPIC_API_KEY is not set on the server." },
    })));
    render(<InterviewPrepSheet jobId="j1" />);
    await user.click(screen.getByText("Interview prep sheet"));
    expect(await screen.findByText(/No Career Profile is recorded/)).toBeInTheDocument();
    expect(screen.getByTestId("prep-strengths")).toHaveTextContent("The posting names none of your recorded skills");
    expect(screen.queryByTestId("prep-memory")).not.toBeInTheDocument();
    expect(screen.queryByTestId("prep-notes")).not.toBeInTheDocument();
  });
});
