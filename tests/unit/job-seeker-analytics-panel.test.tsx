import { render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JobSeekerAnalyticsPanel } from "@/components/job-seeker/analytics-panel";

/**
 * The analytics page's new sections (ADR-243): the funnel, the closure
 * reasons and the replies per source — rendered from the route's counts,
 * with a missing median shown as "—" rather than a zero.
 */

function jsonResponse(body: unknown) {
  return new Response(JSON.stringify(body), { headers: { "Content-Type": "application/json" } });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("JobSeekerAnalyticsPanel", () => {
  it("shows where applications stall, why they ended, and replies by source", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      analytics: {
        jobsFound: 5, qualified: 3, applications: 3, responseRate: 33, interviews: 1, offers: 0, averageMatchScore: 71,
        byTitle: [], bySource: [{ source: "remotive", count: 5 }],
        funnel: [
          { stage: "FOUND", reached: 5 }, { stage: "QUALIFIED", reached: 3 }, { stage: "RESUME_CREATED", reached: 3 },
          { stage: "READY_FOR_REVIEW", reached: 3 }, { stage: "APPLIED", reached: 3 }, { stage: "FOLLOW_UP", reached: 0 },
          { stage: "RECRUITER_RESPONSE", reached: 1 }, { stage: "INTERVIEW", reached: 1 }, { stage: "FINAL_INTERVIEW", reached: 0 },
          { stage: "OFFER", reached: 0 }, { stage: "CLOSED", reached: 2 },
        ],
        closedReasons: [{ reason: "no_response", count: 1 }, { reason: "unstated", count: 1 }],
        responseBySource: [
          { source: null, applied: 3, replied: 1, silent: 1, medianDaysToReply: 6 },
          { source: "manual", applied: 1, replied: 0, silent: 1, medianDaysToReply: null },
        ],
      },
    })));

    render(<JobSeekerAnalyticsPanel />);
    const funnel = await screen.findByTestId("funnel");
    expect(within(funnel).getByText("Recruiter Response").closest("tr")).toHaveTextContent("1");
    expect(within(funnel).getAllByRole("row")).toHaveLength(12);

    const reasons = screen.getByTestId("closed-reasons");
    expect(reasons).toHaveTextContent("No response");
    expect(reasons).toHaveTextContent("Not said");

    const replies = screen.getByTestId("replies-by-source");
    expect(within(replies).getByText("All sources").closest("tr")).toHaveTextContent("3");
    expect(within(replies).getByText("manual").closest("tr")).toHaveTextContent("—");
  });

  it("omits the ledger sections when the route answers null for them", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      analytics: {
        jobsFound: 1, qualified: 0, applications: 0, responseRate: null, interviews: 0, offers: 0, averageMatchScore: null,
        byTitle: [], bySource: [{ source: "manual", count: 1 }], funnel: null, closedReasons: [], responseBySource: null,
      },
    })));
    render(<JobSeekerAnalyticsPanel />);
    await screen.findByText("Jobs by source");
    expect(screen.queryByTestId("funnel")).not.toBeInTheDocument();
    expect(screen.queryByTestId("closed-reasons")).not.toBeInTheDocument();
    expect(screen.queryByTestId("replies-by-source")).not.toBeInTheDocument();
  });
});

describe("skills that keep costing you (ADR-245)", () => {
  const base = {
    jobsFound: 3, qualified: 1, applications: 0, responseRate: null, interviews: 0, offers: 0, averageMatchScore: 60,
    byTitle: [], bySource: [{ source: "manual", count: 3 }], funnel: null, closedReasons: [], responseBySource: null,
  };

  it("lists each term with its counts, the basis, and the way to record it", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      analytics: {
        ...base,
        skillsGap: [
          { term: "Terraform", postings: 2, qualifiedPostings: 1, sentence: "Terraform — named in 2 of your 3 recorded postings (1 of them qualified); not in your profile." },
          { term: "Python", postings: 2, qualifiedPostings: 0, sentence: "Python — named in 2 of your 3 recorded postings; not in your profile." },
        ],
        skillsGapBasis: "Counted over your 3 recorded postings against the 2 skills and technologies in your Career Profile; a term named by fewer than 2 postings is not a pattern and is left out.",
      },
    })));

    render(<JobSeekerAnalyticsPanel />);
    const section = await screen.findByTestId("skills-gap");
    expect(section).toHaveTextContent("Skills that keep costing you");
    expect(section).toHaveTextContent("a term named by fewer than 2 postings is not a pattern");
    const terraform = within(section).getByText("Terraform").closest("tr");
    expect(terraform).toHaveTextContent("2");
    expect(terraform).toHaveTextContent("1");
    expect(within(section).getAllByRole("link", { name: "Record it if true" })).toHaveLength(2);
    expect(within(section).getAllByRole("link", { name: "Record it if true" })[0]).toHaveAttribute("href", "/job-seeker/profile");
  });

  it("points to the profile when there is nothing to measure against, and says so when the gap is empty", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      analytics: { ...base, skillsGap: null, skillsGapBasis: "No Career Profile is recorded yet, so the skills gap is not computed — a gap measured against nothing would list every term in every posting." },
    })));
    const { unmount } = render(<JobSeekerAnalyticsPanel />);
    const section = await screen.findByTestId("skills-gap");
    expect(section).toHaveTextContent("No Career Profile is recorded yet");
    expect(within(section).getByRole("link", { name: "Open your Career Profile" })).toHaveAttribute("href", "/job-seeker/profile");
    unmount();

    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      analytics: { ...base, skillsGap: [], skillsGapBasis: "Counted over your 3 recorded postings against the 4 skills and technologies in your Career Profile; a term named by fewer than 2 postings is not a pattern and is left out." },
    })));
    render(<JobSeekerAnalyticsPanel />);
    expect(await screen.findByTestId("skills-gap")).toHaveTextContent("Nothing named by two or more of your recorded postings is missing from your profile.");
  });
});
