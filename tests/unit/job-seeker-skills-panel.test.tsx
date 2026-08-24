import { render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JobSeekerSkillsPanel } from "@/components/job-seeker/skills-panel";

/**
 * The skills page's honesty contract. Nothing here is market data, so the
 * sample has to be visible: the failure to prevent is a table of terms
 * reading as research when it is a count over two postings someone saved.
 */

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

const READY = {
  skills: {
    analysed: 12,
    skipped: 3,
    coverage: 45,
    gaps: [{
      term: "Kubernetes", postings: 7, recorded: false, averageScore: 82,
      examples: ["Platform Engineer — Acme", "Staff SRE — Globex"],
    }],
    strengths: [{
      term: "Postgres", postings: 9, recorded: true, averageScore: 74,
      examples: ["Platform Engineer — Acme"],
    }],
  },
  profileRecorded: 6,
  method: "Counted from the postings on your own board, not from a market survey.",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the skills panel", () => {
  it("shows every row with the sample it came from", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(READY)));
    render(<JobSeekerSkillsPanel />);

    expect(await screen.findByText("Kubernetes")).toBeInTheDocument();
    expect(screen.getByText("Postgres")).toBeInTheDocument();
    // The sample size, the terms' counts, and where each row came from.
    expect(screen.getByText(/12 postings read/)).toBeInTheDocument();
    expect(screen.getByText(/Platform Engineer — Acme; Staff SRE — Globex/)).toBeInTheDocument();
    expect(screen.getByText(/not from a market survey/)).toBeInTheDocument();
  });

  it("names the postings it could not read rather than dropping them", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(READY)));
    render(<JobSeekerSkillsPanel />);
    expect(await screen.findByText(/3 skipped — no description recorded/)).toBeInTheDocument();
  });

  it("renders an unscored term as a dash, never as zero", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      ...READY,
      skills: {
        ...READY.skills,
        gaps: [{ term: "Terraform", postings: 4, recorded: false, averageScore: null, examples: [] }],
      },
    })));
    render(<JobSeekerSkillsPanel />);

    expect(await screen.findByText("Terraform")).toBeInTheDocument();
    expect(screen.getByText("—")).toBeInTheDocument();
    expect(screen.queryByText("0/100")).not.toBeInTheDocument();
  });

  it("warns when an empty profile makes every term a gap", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ ...READY, profileRecorded: 0 })));
    render(<JobSeekerSkillsPanel />);
    // Technically true and useless as advice — the page has to say so.
    expect(await screen.findByText(/records no skills yet, so everything below reads as a gap/))
      .toBeInTheDocument();
  });

  it("says there is nothing to read rather than showing an empty table", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({
      skills: { analysed: 0, skipped: 2, coverage: null, gaps: [], strengths: [] },
      profileRecorded: 4, method: "",
    })));
    render(<JobSeekerSkillsPanel />);

    expect(await screen.findByText("Nothing to read yet")).toBeInTheDocument();
    // And it explains WHY there is nothing, which is actionable.
    expect(screen.getByText(/2 recorded postings carry no description/)).toBeInTheDocument();
  });

  it("reports a failed read as a failure, not as no gaps", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ error: {} }, 500)));
    render(<JobSeekerSkillsPanel />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be computed/);
  });
});
