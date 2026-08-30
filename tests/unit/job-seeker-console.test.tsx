import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { JobSeekerConsole } from "@/components/job-seeker/console";

const searchParams = vi.fn(() => new URLSearchParams());
vi.mock("next/navigation", () => ({ useSearchParams: () => searchParams() }));

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
    status,
  });
}

const PROFILE = {
  fullName: "Daniel H",
  email: "daniel@example.com",
  phone: null,
  linkedinUrl: null,
  location: "Austin, TX",
  summary: "Builder of factories.",
  salaryTarget: 250000,
  salaryCurrency: "USD",
  workArrangement: "remote",
  openToTravel: false,
  openToRelocation: false,
  employmentHistory: [
    { organization: "Surge Services", title: "Founder", started: "2020", highlights: ["Shipped the control plane"] },
  ],
  education: [],
  accomplishments: ["Shipped the graph engine"],
  skills: ["TypeScript", "Postgres"],
  certifications: [],
  technologies: ["Next.js"],
  industries: ["Software"],
  updatedAt: "2026-08-20T00:00:00.000Z",
  resumeUpload: { id: "11111111-2222-4333-8444-555555555555", filename: "daniel-cv.txt", byteSize: 2048 },
};

const PREFERENCES = {
  targetTitles: ["Staff Engineer"],
  seniority: "Staff",
  compensationMinimum: 220000,
  locations: ["Remote — US"],
  workArrangements: ["remote"],
  industries: ["Software"],
  requiredCriteria: ["Remote-first"],
  preferredCriteria: [],
  exclusions: ["Crypto"],
  qualificationThreshold: 80,
  updatedAt: "2026-08-20T00:00:00.000Z",
};

function stubFetch(overrides: Record<string, unknown> = {}) {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url === "/api/job-seeker/jobs") {
      return jsonResponse({ jobs: overrides.jobs ?? [] });
    }
    if (url === "/api/job-seeker/contacts") {
      return jsonResponse({ contacts: overrides.contacts ?? [] });
    }
    if (url === "/api/job-seeker/outreach") {
      return jsonResponse({ outreach: overrides.outreach ?? [] });
    }
    if (url === "/api/job-seeker/import-sources") {
      return jsonResponse({ sources: [] });
    }
    if (url === "/api/job-seeker/analytics") {
      return jsonResponse({
        analytics: overrides.analytics ?? {
          jobsFound: 0, qualified: 0, applications: 0, responseRate: null,
          interviews: 0, offers: 0, averageMatchScore: null, byTitle: [], bySource: [],
        },
      });
    }
    if (url === "/api/job-seeker/profile" && (!init || init.method === undefined)) {
      return jsonResponse({ profile: overrides.profile === undefined ? PROFILE : overrides.profile });
    }
    if (url === "/api/job-seeker/profile" && init?.method === "PUT") {
      return jsonResponse({ profile: PROFILE });
    }
    if (url === "/api/job-seeker/preferences" && (!init || init.method === undefined)) {
      return jsonResponse({ preferences: overrides.preferences === undefined ? PREFERENCES : overrides.preferences });
    }
    if (url === "/api/job-seeker/preferences" && init?.method === "PUT") {
      return jsonResponse({ preferences: PREFERENCES });
    }
    throw new Error(`Unexpected request: ${url}`);
  }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  searchParams.mockReset();
  searchParams.mockReturnValue(new URLSearchParams());
});

describe("JobSeekerConsole", () => {
  it("loads and renders the career profile with its stored facts", async () => {
    stubFetch();
    render(<JobSeekerConsole />);

    expect(await screen.findByDisplayValue("Daniel H")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Surge Services")).toBeInTheDocument();
    const skills = screen.getByLabelText(/^Skills/) as HTMLTextAreaElement;
    expect(skills.value).toBe("TypeScript\nPostgres");
    // The truthfulness promise is on the page, not just in a document.
    expect(screen.getByText(/nothing is ever invented to fill a gap/i)).toBeInTheDocument();
  });

  it("shows the stored current resume as a link on load, not only after uploading", async () => {
    stubFetch();
    render(<JobSeekerConsole />);
    await screen.findByDisplayValue("Daniel H");

    const link = screen.getByRole("link", { name: "daniel-cv.txt" });
    expect(link).toHaveAttribute(
      "href",
      "/api/job-seeker/uploads/11111111-2222-4333-8444-555555555555",
    );
  });

  it("renders an empty profile as an editable blank form, not an error", async () => {
    stubFetch({ profile: null, preferences: null });
    render(<JobSeekerConsole />);

    expect(await screen.findByRole("button", { name: /save profile/i })).toBeInTheDocument();
    expect((screen.getByLabelText("Full name") as HTMLInputElement).value).toBe("");
  });

  it("saves the profile and confirms it", async () => {
    stubFetch();
    render(<JobSeekerConsole />);
    await screen.findByDisplayValue("Daniel H");

    fireEvent.click(screen.getByRole("button", { name: /save profile/i }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Profile saved."));
  });

  it("drops an added-but-untouched history entry instead of failing the save", async () => {
    stubFetch();
    render(<JobSeekerConsole />);
    await screen.findByDisplayValue("Daniel H");

    fireEvent.click(screen.getByRole("button", { name: /add employment history entry/i }));
    fireEvent.click(screen.getByRole("button", { name: /save profile/i }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Profile saved."));

    const put = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.find(
      ([url, init]) => String(url) === "/api/job-seeker/profile" && (init as RequestInit)?.method === "PUT",
    );
    expect(put).toBeDefined();
    const sent = JSON.parse(String((put?.[1] as RequestInit).body)) as {
      employmentHistory: Array<{ organization: string }>;
    };
    // The stored entry survives; the empty click-created one is pruned.
    expect(sent.employmentHistory).toHaveLength(1);
    expect(sent.employmentHistory[0]?.organization).toBe("Surge Services");
  });

  it("shows preferences with the configurable threshold on its own section", async () => {
    searchParams.mockReturnValue(new URLSearchParams("section=preferences"));
    stubFetch();
    render(<JobSeekerConsole />);

    expect(await screen.findByDisplayValue("Staff Engineer")).toBeInTheDocument();
    expect(screen.getByDisplayValue("80")).toBeInTheDocument();
    expect(screen.getByText(/Default 80/)).toBeInTheDocument();
  });

  it("shows discovery with the honest method label and both real ways in", async () => {
    searchParams.mockReturnValue(new URLSearchParams("section=discovery"));
    stubFetch();
    render(<JobSeekerConsole />);

    expect(await screen.findByText("No jobs recorded yet")).toBeInTheDocument();
    expect(screen.getByText(/Rule-based match computed from your recorded profile/)).toBeInTheDocument();
    expect(screen.getByText(/Record a posting yourself, or import from one of eleven public job boards/)).toBeInTheDocument();
    // The two kinds of input are named, because "identifier" and "search term"
    // are different questions and the cards ask both.
    expect(screen.getByText(/ask for a search term instead/)).toBeInTheDocument();
    expect(screen.getByText(/activates only when its\s+named configuration actually exists/)).toBeInTheDocument();
  });

  it("shows the applications pipeline with the gate stated", async () => {
    searchParams.mockReturnValue(new URLSearchParams("section=applications"));
    stubFetch();
    render(<JobSeekerConsole />);

    expect(await screen.findByText("No applications yet")).toBeInTheDocument();
    expect(screen.getByText(/the database enforces the gate/i)).toBeInTheDocument();
  });

  it("computes analytics from recorded rows and refuses to invent a rate", async () => {
    searchParams.mockReturnValue(new URLSearchParams("section=analytics"));
    stubFetch({
      analytics: {
        jobsFound: 4, qualified: 2, applications: 1, responseRate: null,
        interviews: 0, offers: 0, averageMatchScore: 74,
        byTitle: [{ title: "Staff Engineer", jobs: 3, averageScore: 81 }],
        bySource: [{ source: "manual", count: 4 }],
      },
    });
    render(<JobSeekerConsole />);

    const jobsFound = (await screen.findByText("Jobs found")).parentElement as HTMLElement;
    expect(jobsFound).toHaveTextContent("4");
    expect(screen.getByText("74/100")).toBeInTheDocument();
    // One application, zero responses recorded: the rate is withheld ("—"),
    // never rendered as an invented 0%.
    const responseRate = screen.getByText("Response rate").parentElement as HTMLElement;
    expect(responseRate).toHaveTextContent("—");
    expect(screen.getByText(/never an\s+estimate/i)).toBeInTheDocument();
  });

  it("names the next step when analytics has nothing recorded", async () => {
    searchParams.mockReturnValue(new URLSearchParams("section=analytics"));
    stubFetch();
    render(<JobSeekerConsole />);

    expect(await screen.findByText("No analytics yet")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open job discovery/i })).toHaveAttribute(
      "href",
      "/job-seeker?section=discovery",
    );
  });

  it("keeps follow-up honest: drafts for review, never a claimed send", async () => {
    searchParams.mockReturnValue(new URLSearchParams("section=follow-up"));
    stubFetch();
    render(<JobSeekerConsole />);

    expect(await screen.findByText("No contacts recorded yet")).toBeInTheDocument();
    expect(screen.getByText(/Nothing is ever sent from here/)).toBeInTheDocument();
  });

  it("reports a load failure as an alert instead of a blank page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({}, 500)));
    render(<JobSeekerConsole />);

    expect(await screen.findByRole("alert")).toHaveTextContent(/could not be loaded/i);
  });

  it("sends a person with no workspace to onboarding instead of an error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({ error: { code: "organization_onboarding_required" } }, 409),
      ),
    );
    render(<JobSeekerConsole />);

    const cta = await screen.findByRole("link", { name: /create your workspace/i });
    expect(cta).toHaveAttribute("href", "/auth/onboarding?next=%2Fjob-seeker");
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
