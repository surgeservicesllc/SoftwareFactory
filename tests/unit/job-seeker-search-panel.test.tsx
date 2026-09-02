import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { JobSearchPanel } from "@/components/job-seeker/search-panel";

/**
 * The Search page as a person meets it.
 *
 * The rules being checked are the honesty ones, because they are the ones a
 * plausible-looking UI breaks quietly: an empty result must read as empty, a
 * board that failed must be named rather than omitted, a sample must not be
 * presented as the whole, and a second click must not save a second copy.
 */

const BOARDS = {
  boards: [
    { key: "jobnet", name: "Jobnet", summary: "Danish public job bank.", coverage: "Denmark", supportsLocation: true },
    { key: "freehire", name: "Freehire", summary: "Developer jobs.", coverage: "International", supportsLocation: true },
  ],
};

function hit(title: string) {
  return {
    job: {
      externalId: `id-${title}`,
      url: "https://jobnet.dk/find-job/1",
      title,
      company: "Nordisk Teknik A/S",
      salaryText: null,
      location: "København",
      workModel: null,
      description: null,
    },
    publishedOn: "2026-08-20",
    closesOn: null,
    saveToken: `token-${title}`,
  };
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

/** Board list on mount, then whatever the search should answer. */
function respond(searchBody: unknown, searchStatus = 200) {
  fetchMock.mockImplementation((url: string, init?: RequestInit) => {
    if (typeof url === "string" && url.includes("/search/save")) {
      return Promise.resolve(json({ saved: true, jobId: "job-1", score: 70, qualified: false }, 201));
    }
    if (init?.method === "POST") return Promise.resolve(json(searchBody, searchStatus));
    return Promise.resolve(json(BOARDS));
  });
}

async function search(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByPlaceholderText("Job title, skill or keyword"), "engineer");
  await user.click(screen.getByRole("button", { name: /^search$/i }));
}

describe("the search panel", () => {
  it("names the boards it will contact before contacting any", async () => {
    respond({ results: [], failures: [] });
    render(<JobSearchPanel />);

    // Stated up front, so a person knows what "no results" was measured over.
    expect(await screen.findByText(/Searching 2 boards:/)).toBeInTheDocument();
    expect(screen.getByText(/Jobnet \(Denmark\)/)).toBeInTheDocument();
  });

  it("says nothing about results before a search has run", async () => {
    respond({ results: [], failures: [] });
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);

    // "Not searched yet" and "found nothing" are different states.
    expect(screen.queryByText(/No postings matched/)).not.toBeInTheDocument();
  });

  it("reads an empty answer as empty rather than as nothing at all", async () => {
    respond({ results: [{ board: "jobnet", boardName: "Jobnet", totalAvailable: 0, hits: [], locationApplied: true }], failures: [] });
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);

    await search(user);

    expect(await screen.findByText(/No postings matched/)).toBeInTheDocument();
  });

  it("shows the board's own total, so a sample is not read as the whole", async () => {
    respond({
      results: [{ board: "jobnet", boardName: "Jobnet", totalAvailable: 812, hits: [hit("Platform Engineer")], locationApplied: true }],
      failures: [],
    });
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);

    await search(user);

    expect(await screen.findByText(/Showing 1 of 812 the board reports/)).toBeInTheDocument();
  });

  it("says so when a board does not report a total", async () => {
    respond({
      results: [{ board: "jobnet", boardName: "Jobnet", totalAvailable: null, hits: [hit("Platform Engineer")], locationApplied: true }],
      failures: [],
    });
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);

    await search(user);

    // Not "1 of 1": the board declined to say, which is not the same as one.
    expect(await screen.findByText(/does not report a total/)).toBeInTheDocument();
  });

  it("names a board that failed instead of quietly dropping it", async () => {
    /*
     * The load-bearing case. Omitting the failure would tell someone they had
     * searched everywhere when they had searched one board of two.
     */
    respond({
      results: [{ board: "jobnet", boardName: "Jobnet", totalAvailable: 3, hits: [hit("Platform Engineer")], locationApplied: true }],
      failures: [
        { board: "freehire", boardName: "Freehire", code: "board_unreachable", message: "Freehire did not answer in time." },
      ],
    });
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);

    await search(user);

    expect(await screen.findByText(/Freehire did not answer in time/)).toBeInTheDocument();
    expect(screen.getByText(/not everything that is out there/)).toBeInTheDocument();
    // And the board that did answer is still shown.
    expect(screen.getByText("Platform Engineer")).toBeInTheDocument();
  });

  it("refuses an empty search rather than asking the boards for everything", async () => {
    respond({ results: [], failures: [] });
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);

    await user.click(screen.getByRole("button", { name: /^search$/i }));

    expect(await screen.findByText(/Give a search term or a location/)).toBeInTheDocument();
    // No POST was made.
    expect(fetchMock.mock.calls.filter(([, init]) => (init as RequestInit | undefined)?.method === "POST")).toHaveLength(0);
  });

  it("reports a save and then refuses to save the same posting twice", async () => {
    respond({
      results: [{ board: "jobnet", boardName: "Jobnet", totalAvailable: 1, hits: [hit("Platform Engineer")], locationApplied: true }],
      failures: [],
    });
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);
    await search(user);
    await screen.findByText("Platform Engineer");

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    const saved = await screen.findByRole("button", { name: /saved to your jobs/i });
    // Disabled, so a second click cannot ask for a duplicate the server would
    // only have to refuse.
    expect(saved).toBeDisabled();
  });

  it("surfaces a search failure as a reason, not a blank page", async () => {
    respond({ error: { code: "search_failed", message: "The search could not be run." } }, 500);
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);

    await search(user);

    expect(await screen.findByText(/The search could not be run/)).toBeInTheDocument();
  });

  it("removes old results when a replacement search loses its connection", async () => {
    let searchCount = 0;
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method !== "POST") return Promise.resolve(json(BOARDS));
      searchCount += 1;
      if (searchCount === 1) {
        return Promise.resolve(json({
          results: [{
            board: "jobnet",
            boardName: "Jobnet",
            totalAvailable: 1,
            hits: [hit("Old Platform Engineer")],
            locationApplied: true,
          }],
          failures: [],
        }));
      }
      return Promise.reject(new Error("network down"));
    });
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);

    await search(user);
    expect(await screen.findByText("Old Platform Engineer")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^search$/i }));

    expect(await screen.findByText(/The search could not be run/)).toBeInTheDocument();
    expect(screen.queryByText("Old Platform Engineer")).not.toBeInTheDocument();
  });

  it("shows the server's expired-result instruction and prevents a futile retry", async () => {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/search/save")) {
        return Promise.resolve(json({
          error: {
            code: "search_result_invalid",
            message: "This search result is no longer valid. Run the search again before saving it.",
          },
        }, 422));
      }
      if (init?.method === "POST") {
        return Promise.resolve(json({
          results: [{
            board: "jobnet",
            boardName: "Jobnet",
            totalAvailable: 1,
            hits: [hit("Platform Engineer")],
            locationApplied: true,
          }],
          failures: [],
        }));
      }
      return Promise.resolve(json(BOARDS));
    });
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);
    await search(user);
    await screen.findByText("Platform Engineer");

    await user.click(screen.getByRole("button", { name: /^save$/i }));

    expect(await screen.findByText(/Run the search again before saving it/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Search again to save/i })).toBeDisabled();
  });

  it("links a posting to the board, opening it without handing over the referrer", async () => {
    respond({
      results: [{ board: "jobnet", boardName: "Jobnet", totalAvailable: 1, hits: [hit("Platform Engineer")], locationApplied: true }],
      failures: [],
    });
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);
    await search(user);

    const link = await screen.findByRole("link", { name: "Platform Engineer" });
    expect(link).toHaveAttribute("href", "https://jobnet.dk/find-job/1");
    expect(link).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("collapses the same posting from two boards into one card badged with both", async () => {
    const shared = hit("Platform Engineer");
    respond({
      results: [
        { board: "jobnet", boardName: "Jobnet", totalAvailable: 1, hits: [shared], locationApplied: true },
        {
          board: "freehire",
          boardName: "Freehire",
          totalAvailable: 1,
          hits: [{ ...shared, job: { ...shared.job, salaryText: "DKK 700000–900000" }, saveToken: "token-freehire" }],
          locationApplied: true,
        },
      ],
      failures: [],
    });
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);

    await search(user);

    // One card, not two; both boards' badges attached.
    expect(await screen.findByText(/1 unique posting/)).toBeInTheDocument();
    expect(screen.getByText("via Jobnet")).toBeInTheDocument();
    expect(screen.getByText("via Freehire")).toBeInTheDocument();
    // The richer copy (the one stating a salary) is the card.
    expect(screen.getByText(/DKK 700000–900000/)).toBeInTheDocument();

    // Saving goes through the primary source: the board whose exact copy the
    // card shows, because that board's token is the one sealed over it.
    await user.click(screen.getByRole("button", { name: /^save$/i }));
    await screen.findByRole("button", { name: /saved to your jobs/i });
    const saveCall = fetchMock.mock.calls.find(
      ([url]) => typeof url === "string" && (url as string).includes("/search/save"),
    );
    const saveBody = JSON.parse((saveCall?.[1] as RequestInit).body as string) as {
      board: string;
      resultToken: string;
      job: { salaryText: string | null };
    };
    expect(saveBody.board).toBe("freehire");
    expect(saveBody.resultToken).toBe("token-freehire");
    expect(saveBody.job.salaryText).toBe("DKK 700000–900000");
  });

  it("filters instantly in the browser and says how many cards are hidden", async () => {
    respond({
      results: [
        {
          board: "jobnet",
          boardName: "Jobnet",
          totalAvailable: 2,
          hits: [hit("Platform Engineer"), hit("Marketing Manager")],
          locationApplied: true,
        },
      ],
      failures: [],
    });
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);
    await search(user);
    await screen.findByText("Marketing Manager");

    await user.type(screen.getByPlaceholderText("Add word to exclude, press Enter"), "marketing{Enter}");

    // No refetch: the same response, narrowed, with the removal counted.
    expect(screen.queryByText("Marketing Manager")).not.toBeInTheDocument();
    expect(screen.getByText("Platform Engineer")).toBeInTheDocument();
    expect(screen.getByText(/1 posting is hidden by\s+your filters/)).toBeInTheDocument();

    await user.click(screen.getAllByRole("button", { name: /clear all filters/i })[0]!);
    expect(await screen.findByText("Marketing Manager")).toBeInTheDocument();
  });

  it("shows every result as hidden rather than pretending an empty search", async () => {
    respond({
      results: [
        { board: "jobnet", boardName: "Jobnet", totalAvailable: 1, hits: [hit("Platform Engineer")], locationApplied: true },
      ],
      failures: [],
    });
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);
    await search(user);
    await screen.findByText("Platform Engineer");

    await user.type(screen.getByPlaceholderText("Add word to exclude, press Enter"), "engineer{Enter}");

    // "Filters hid everything" and "the boards had nothing" are different
    // claims, and the first must not wear the second's words.
    expect(screen.getByText(/Every result is hidden by the filters above/)).toBeInTheDocument();
    expect(screen.queryByText(/No postings matched/)).not.toBeInTheDocument();
  });

  it("renders the catalogue honestly: Not Connected badges and outward links", async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.resolve(json({ results: [], failures: [] }));
      return Promise.resolve(json({
        ...BOARDS,
        sources: [
          {
            key: "adzuna",
            name: "Adzuna",
            focus: "general",
            status: "needs_credentials",
            searchUrl: "https://www.adzuna.com/search?q={query}",
            note: "Official API awaiting an app key.",
          },
          {
            key: "heymarketers",
            name: "Hey Marketers",
            focus: "marketing",
            status: "external_link",
            searchUrl: "https://www.heymarketers.com/",
            note: "Marketing-only job board without an open API.",
          },
        ],
      }));
    });
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);

    await user.type(screen.getByPlaceholderText("Job title, skill or keyword"), "growth marketer");
    await user.click(screen.getByText(/Sources \(2 searched live/));

    // A credential-gated source is labeled, never rendered as searchable.
    expect(screen.getByText("Adzuna")).toBeInTheDocument();
    expect(screen.getByText("Not Connected")).toBeInTheDocument();
    // A link-out source opens its own site, with the query interpolated.
    const links = screen.getAllByRole("link", { name: /open site/i });
    expect(links.some((link) => link.getAttribute("href") === "https://www.adzuna.com/search?q=growth%20marketer")).toBe(true);
    expect(links.every((link) => (link.getAttribute("rel") ?? "").includes("noopener"))).toBe(true);
  });

  it("renders the server's match score with its evidence, and offers match sort", async () => {
    const card = {
      job: hit("Platform Engineer").job,
      publishedOn: "2026-08-27",
      closesOn: null,
      sources: [{ board: "jobnet", boardName: "Jobnet", url: "https://example.org/jobs/jobnet-1", externalId: "id-1", saveToken: "t-1" }],
      primarySourceIndex: 0,
      match: {
        score: 84,
        reasons: ["The role's title aligns with your recorded \"Platform Engineer\"."],
        gaps: ["The posting names none of your recorded industries."],
        threshold: 80,
        qualified: true,
        excluded: null,
      },
    };
    respond({
      results: [{ board: "jobnet", boardName: "Jobnet", totalAvailable: 1, hits: [hit("Platform Engineer")], locationApplied: true }],
      failures: [],
      unified: {
        hits: [card],
        dedupedFrom: 1,
        beforeFilters: 1,
        matchBasis: { computed: true, method: "Rule-based match computed from your recorded profile and preferences." },
      },
    });
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);

    await search(user);

    expect(await screen.findByText("Match 84")).toBeInTheDocument();
    expect(screen.getByText(/Rule-based match computed from your recorded profile/)).toBeInTheDocument();
    await user.click(screen.getByText("Why this match score"));
    expect(screen.getByText(/aligns with your recorded/)).toBeInTheDocument();
    expect(screen.getByText(/Gap: The posting names none of your recorded industries/)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "Best match" })).toBeInTheDocument();
  });

  it("shows a likely-stale verdict with its numbers, and hides it only when asked (ADR-241)", async () => {
    const stale = {
      job: { ...hit("Platform Engineer").job, url: "https://jobnet.dk/find-job/stale" },
      publishedOn: "2026-08-20",
      closesOn: null,
      sources: [{ board: "jobnet", boardName: "Jobnet", url: "https://jobnet.dk/find-job/stale", externalId: "id-stale", saveToken: "t-stale" }],
      primarySourceIndex: 0,
      match: null,
      freshness: {
        level: "stale",
        postedDaysAgo: 72,
        firstSeenDaysAgo: 70,
        timesSeen: 9,
        reposts: 1,
        reasons: [
          "The board now dates it 2026-08-20, but it was first dated 2026-06-22: 72 days ago.",
          "First seen here 70 days ago, on 9 searches.",
          "Re-dated 1 time since first seen (the posting date moved forward).",
        ],
      },
    };
    const fresh = {
      job: { ...hit("Go Engineer").job, url: "https://jobnet.dk/find-job/fresh" },
      publishedOn: "2026-09-01",
      closesOn: null,
      sources: [{ board: "jobnet", boardName: "Jobnet", url: "https://jobnet.dk/find-job/fresh", externalId: "id-fresh", saveToken: "t-fresh" }],
      primarySourceIndex: 0,
      match: null,
      freshness: { level: "fresh", postedDaysAgo: 1, firstSeenDaysAgo: null, timesSeen: 0, reposts: 0, reasons: ["Posted 1 day ago by the board's own date."] },
    };
    respond({
      results: [{ board: "jobnet", boardName: "Jobnet", totalAvailable: 2, hits: [hit("Platform Engineer"), hit("Go Engineer")], locationApplied: true }],
      failures: [],
      unified: {
        hits: [stale, fresh],
        dedupedFrom: 2,
        beforeFilters: 2,
        matchBasis: { computed: false, reason: "No Career Profile is recorded yet." },
        freshnessBasis: "Freshness is computed from each board's own dates and this product's sightings ledger; every verdict prints its numbers.",
      },
    });
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);

    await search(user);

    // One badge, on the stale card only; a fresh card carries no warning.
    expect(await screen.findByTestId("freshness-badge")).toHaveTextContent("Likely stale");
    expect(screen.getAllByTestId("freshness-badge")).toHaveLength(1);
    expect(screen.getByTestId("freshness-basis")).toHaveTextContent(/sightings ledger/);
    expect(screen.getByTestId("stale-summary")).toHaveTextContent("1 posting looks likely stale");

    // The numbers are one click away, verbatim.
    await user.click(screen.getByText("Why likely stale"));
    expect(screen.getByText("First seen here 70 days ago, on 9 searches.")).toBeInTheDocument();
    expect(screen.getByText(/Re-dated 1 time since first seen/)).toBeInTheDocument();

    // Shown by default; hidden only by the person's choice, and reversible.
    expect(screen.getByText("Platform Engineer")).toBeInTheDocument();
    await user.click(screen.getByTestId("stale-toggle"));
    expect(screen.queryByText("Platform Engineer")).not.toBeInTheDocument();
    expect(screen.getByText("Go Engineer")).toBeInTheDocument();
    expect(screen.getByTestId("stale-toggle")).toHaveTextContent("Show them");
    await user.click(screen.getByTestId("stale-toggle"));
    expect(screen.getByText("Platform Engineer")).toBeInTheDocument();
  });

  it("shows the posting's own signals with their evidence, and filters on them only when asked (ADR-242)", async () => {
    // The signals below are what the server computed from this same text;
    // the browser's instant filters recompute from it through the shared
    // module, so the fixture carries the text the badges were derived from.
    const flagged = {
      job: {
        ...hit("Data Entry Clerk").job,
        url: "https://jobnet.dk/find-job/flagged",
        company: "Apex Recruiting",
        salaryText: "$30 per hour",
        description: "Fully remote. Contact us on Telegram to start. We cannot sponsor visas.",
      },
      publishedOn: "2026-09-01",
      closesOn: null,
      sources: [{ board: "jobnet", boardName: "Jobnet", url: "https://jobnet.dk/find-job/flagged", externalId: "id-flagged", saveToken: "t-flagged" }],
      primarySourceIndex: 0,
      match: null,
      signals: {
        redFlags: [{ code: "off_platform_messaging", label: "Asks you to continue on a messaging app instead of the platform — the FTC's first warning sign.", phrase: "Telegram" }],
        agency: { likely: true, phrase: "Recruiting" },
        sponsorship: { state: "stated_no", phrase: "cannot sponsor visas" },
        workModel: { model: "remote", derived: true, phrase: "Fully remote" },
        salary: { low: 30, high: 30, period: "hour", currency: "USD", annualized: 62_400, note: "30 per hour → about 62,400 per year, assuming 2080 hours a year." },
        completeness: { present: ["pay", "place", "work_model", "posted"], missing: ["level", "description"], score: 4 },
      },
    };
    const plain = {
      job: { ...hit("Go Engineer").job, url: "https://jobnet.dk/find-job/plain" },
      publishedOn: "2026-09-01",
      closesOn: null,
      sources: [{ board: "jobnet", boardName: "Jobnet", url: "https://jobnet.dk/find-job/plain", externalId: "id-plain", saveToken: "t-plain" }],
      primarySourceIndex: 0,
      match: null,
      signals: {
        redFlags: [],
        agency: { likely: false, phrase: null },
        sponsorship: { state: null, phrase: null },
        workModel: { model: null, derived: false, phrase: null },
        salary: null,
        completeness: { present: ["place", "posted"], missing: ["pay", "work_model", "level", "description"], score: 2 },
      },
    };
    respond({
      results: [{ board: "jobnet", boardName: "Jobnet", totalAvailable: 2, hits: [hit("Data Entry Clerk"), hit("Go Engineer")], locationApplied: true }],
      failures: [],
      unified: { hits: [flagged, plain], dedupedFrom: 2, beforeFilters: 2, matchBasis: { computed: false, reason: "No Career Profile is recorded yet." } },
    });
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);

    await search(user);

    // Badges on the flagged card only, each carrying its evidence.
    expect(await screen.findByTestId("redflag-badge")).toHaveTextContent("Red flag");
    expect(screen.getByTestId("agency-badge")).toHaveAttribute("title", "From the company name: “Recruiting”.");
    expect(screen.getByTestId("sponsorship-badge")).toHaveTextContent("No sponsorship");
    expect(screen.getByText(/· remote \(from the text\)/)).toBeInTheDocument();
    const signalLines = screen.getAllByTestId("posting-signals");
    expect(signalLines[0]).toHaveTextContent("30 per hour → about 62,400 per year, assuming 2080 hours a year. States 4 of 6 — missing level, a real description.");
    expect(signalLines[1]).toHaveTextContent("States 2 of 6 — missing pay, work model, level, a real description.");
    await user.click(screen.getByText("Why the red flags"));
    expect(screen.getByText(/Matched: “Telegram”/)).toBeInTheDocument();

    // Nothing is hidden until the person asks; then the chip says what was asked.
    expect(screen.getByText("Data Entry Clerk")).toBeInTheDocument();
    await user.click(screen.getByLabelText(/Hide postings with red flags/));
    expect(screen.queryByText("Data Entry Clerk")).not.toBeInTheDocument();
    expect(screen.getByText("no red flags")).toBeInTheDocument();
    await user.click(screen.getByLabelText(/Hide postings with red flags/));
    expect(screen.getByText("Data Entry Clerk")).toBeInTheDocument();

    await user.selectOptions(screen.getByLabelText(/Visa sponsorship \(from the posting text\)/), "stated_yes");
    expect(screen.queryByText("Data Entry Clerk")).not.toBeInTheDocument();
    expect(screen.queryByText("Go Engineer")).not.toBeInTheDocument();
    expect(screen.getByText("sponsors visas")).toBeInTheDocument();
  });

  it("says why scores are absent rather than inventing them", async () => {
    const card = {
      job: hit("Platform Engineer").job,
      publishedOn: null,
      closesOn: null,
      sources: [{ board: "jobnet", boardName: "Jobnet", url: null, externalId: "id-1", saveToken: "t-1" }],
      primarySourceIndex: 0,
      match: null,
    };
    respond({
      results: [{ board: "jobnet", boardName: "Jobnet", totalAvailable: 1, hits: [hit("Platform Engineer")], locationApplied: true }],
      failures: [],
      unified: {
        hits: [card],
        dedupedFrom: 1,
        beforeFilters: 1,
        matchBasis: { computed: false, reason: "No Career Profile is recorded yet." },
      },
    });
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);

    await search(user);

    expect(await screen.findByText(/No Career Profile is recorded yet/)).toBeInTheDocument();
    expect(screen.queryByText(/^Match \d+$/)).not.toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Best match" })).not.toBeInTheDocument();
    // The min-score filter cannot act without scores, so it says why.
    expect(screen.getByLabelText(/Match score at least/)).toBeDisabled();
  });

  it("saves the current search, runs it back, and deletes it", async () => {
    const savedRow = {
      id: "11111111-2222-4333-8444-555555555555",
      name: "Remote marketing",
      query: { text: "marketing manager", location: null, sort: "newest", filters: { keywords: ["remote"] } },
      lastRunAt: null,
      createdAt: "2026-08-29T14:00:00Z",
      updatedAt: "2026-08-29T14:00:00Z",
    };
    const calls: Array<{ method: string; url: string; body: unknown }> = [];
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      const method = init?.method ?? "GET";
      calls.push({ method, url, body: init?.body ? JSON.parse(init.body as string) : null });
      if (url.includes("/api/job-seeker/saved-searches")) {
        if (method === "GET") return Promise.resolve(json({ savedSearches: [] }));
        if (method === "POST") return Promise.resolve(json({ savedSearch: savedRow }, 201));
        if (method === "PATCH") {
          return Promise.resolve(json({ savedSearch: { ...savedRow, lastRunAt: "2026-08-29T14:05:00Z" } }));
        }
        return Promise.resolve(json({ deleted: savedRow.id }));
      }
      if (method === "POST") return Promise.resolve(json({ results: [], failures: [] }));
      return Promise.resolve(json(BOARDS));
    });
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);

    await user.type(screen.getByPlaceholderText("Job title, skill or keyword"), "marketing manager");
    await user.type(screen.getByPlaceholderText(/Name this search/), "Remote marketing");
    await user.click(screen.getByRole("button", { name: "Save this search" }));

    expect(await screen.findByText("Remote marketing")).toBeInTheDocument();
    const createCall = calls.find((c) => c.method === "POST" && c.url.includes("saved-searches"));
    expect((createCall?.body as { query: { text: string } }).query.text).toBe("marketing manager");

    // Run: records the run and executes the stored query as a real search.
    await user.click(screen.getByRole("button", { name: "Run" }));
    expect(await screen.findByText(/Never run|Last run/)).toBeInTheDocument();
    const patchCall = calls.find((c) => c.method === "PATCH");
    expect((patchCall?.body as { markRun?: boolean }).markRun).toBe(true);
    const searchCall = calls.filter((c) => c.method === "POST" && !c.url.includes("saved-searches")).at(-1);
    expect((searchCall?.body as { text: string }).text).toBe("marketing manager");

    await user.click(screen.getByRole("button", { name: "Delete" }));
    await waitFor(() => expect(screen.queryByText("Remote marketing")).not.toBeInTheDocument());
  });

  it("offers alert cadences only when the pipeline can deliver, else says Not Connected", async () => {
    const savedRow = {
      id: "11111111-2222-4333-8444-555555555555",
      name: "Remote marketing",
      query: { text: "marketing" },
      lastRunAt: null,
      alert: null,
    };
    const renderWith = (channel: { emailConnected: boolean; schedulerConfigured: boolean }) => {
      fetchMock.mockImplementation((url: string, init?: RequestInit) => {
        if (url.includes("/api/job-seeker/saved-searches")) {
          if ((init?.method ?? "GET") === "PATCH") {
            return Promise.resolve(json({
              savedSearch: { ...savedRow, alert: { cadence: "daily", lastScannedAt: null } },
            }));
          }
          return Promise.resolve(json({ savedSearches: [savedRow], alertsChannel: channel }));
        }
        if (init?.method === "POST") return Promise.resolve(json({ results: [], failures: [] }));
        return Promise.resolve(json(BOARDS));
      });
      return render(<JobSearchPanel />);
    };

    const user = userEvent.setup();
    const { unmount } = renderWith({ emailConnected: false, schedulerConfigured: false });
    expect(await screen.findByText("Alerts: Not Connected")).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: /Email alert/ })).not.toBeInTheDocument();
    unmount();

    renderWith({ emailConnected: true, schedulerConfigured: true });
    const select = await screen.findByRole("combobox", { name: /Email alert for Remote marketing/ });
    await user.selectOptions(select, "daily");
    expect(await screen.findByText(/alert daily/)).toBeInTheDocument();
  });

  it("searches only the boards left ticked", async () => {
    respond({ results: [], failures: [] });
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);

    await user.click(screen.getByText(/Sources \(2 searched live/));
    await user.click(screen.getByRole("checkbox", { name: /Freehire/ }));
    expect(screen.getByText(/Searching 1 board:/)).toBeInTheDocument();

    await search(user);

    const searchCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    );
    const body = JSON.parse((searchCall?.[1] as RequestInit).body as string) as { boards?: string[] };
    expect(body.boards).toEqual(["jobnet"]);
  });

  it("renders a long unified list incrementally, with the counts staying the whole truth", async () => {
    const many = Array.from({ length: 30 }, (_, index) =>
      hit(`Engineer ${String(index + 1).padStart(2, "0")}`));
    respond({
      results: [{ board: "jobnet", boardName: "Jobnet", totalAvailable: 30, hits: many, locationApplied: true }],
      failures: [],
    });
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);

    await search(user);

    // The headline counts every unique posting; the list renders a page of
    // them, and the remainder waits behind an honest "Showing X of Y".
    expect(await screen.findByText("30 unique postings")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: "Save" })).toHaveLength(25);
    expect(screen.getByText("Showing 25 of 30")).toBeInTheDocument();

    await user.click(screen.getByTestId("unified-show-more"));

    expect(screen.getAllByRole("button", { name: "Save" })).toHaveLength(30);
    expect(screen.queryByTestId("unified-show-more")).not.toBeInTheDocument();
  });

  it("offers LinkedIn, Indeed and company as pre-filled link-outs a person can deselect", async () => {
    const boardsWithSources = {
      ...BOARDS,
      sources: [
        {
          key: "linkedin", name: "LinkedIn Jobs", focus: "general", status: "external_link",
          searchUrl: "https://www.linkedin.com/jobs/search/?keywords={query}&location={location}",
          note: "Opens LinkedIn's own job search.",
        },
        {
          key: "indeed", name: "Indeed", focus: "general", status: "external_link",
          searchUrl: "https://www.indeed.com/jobs?q={query}&l={location}",
          note: "Opens Indeed's own search.",
        },
      ],
    };
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve(json({
          results: [{ board: "jobnet", boardName: "Jobnet", totalAvailable: 0, hits: [], locationApplied: true }],
          failures: [],
        }));
      }
      return Promise.resolve(json(boardsWithSources));
    });
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);

    // Not part of the results claim before a search has run.
    expect(screen.queryByTestId("linkout-strip")).not.toBeInTheDocument();

    await search(user);

    // The strip appears even when the connected boards found nothing — that
    // is exactly when the person most wants the big boards one click away —
    // and each chip carries the query into the site's own search.
    const strip = await screen.findByTestId("linkout-strip");
    const linkedin = within(strip).getByRole("link", { name: /LinkedIn Jobs/ });
    expect(linkedin).toHaveAttribute(
      "href",
      "https://www.linkedin.com/jobs/search/?keywords=engineer&location=",
    );
    expect(within(strip).getByRole("link", { name: /Indeed/ })).toBeInTheDocument();

    await user.click(screen.getByRole("checkbox", { name: "Include Indeed in the link-out row" }));
    expect(within(strip).queryByRole("link", { name: /Indeed/ })).not.toBeInTheDocument();
    expect(within(strip).getByRole("link", { name: /LinkedIn Jobs/ })).toBeInTheDocument();
  });

  it("makes LinkedIn and Indeed primary: one click from the search form, before any search runs", async () => {
    const boardsWithSources = {
      ...BOARDS,
      sources: [
        {
          key: "linkedin_jobs", name: "LinkedIn Jobs", focus: "general", status: "external_link",
          searchUrl: "https://www.linkedin.com/jobs/search/?keywords={query}&location={location}",
          note: "Opens LinkedIn's own job search.",
        },
        {
          key: "indeed", name: "Indeed", focus: "general", status: "external_link",
          searchUrl: "https://www.indeed.com/jobs?q={query}&l={location}",
          note: "Opens Indeed's own search.",
        },
        {
          key: "glassdoor", name: "Glassdoor", focus: "general", status: "external_link",
          searchUrl: "https://www.glassdoor.com/Job/jobs.htm?sc.keyword={query}&locKeyword={location}",
          note: "Opens Glassdoor's own search.",
        },
      ],
    };
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") return Promise.resolve(json({ results: [], failures: [] }));
      return Promise.resolve(json(boardsWithSources));
    });
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);

    // Primary means primary: the two sites sit beside the search button
    // before our boards have been asked anything — only the deeply wired
    // pair, not every link-out site.
    const primary = await screen.findByTestId("primary-linkouts");
    expect(within(primary).getByRole("link", { name: /LinkedIn Jobs/ })).toBeInTheDocument();
    expect(within(primary).getByRole("link", { name: /Indeed/ })).toBeInTheDocument();
    expect(within(primary).queryByRole("link", { name: /Glassdoor/ })).not.toBeInTheDocument();

    // The links live-update with what the person types, filters included.
    await user.type(screen.getByPlaceholderText("Job title, skill or keyword"), "designer");
    await user.type(screen.getByPlaceholderText("Place or postcode"), "78701");
    const linkedin = new URL(
      within(primary).getByRole("link", { name: /LinkedIn Jobs/ }).getAttribute("href")!,
    );
    expect(linkedin.searchParams.get("keywords")).toBe("designer");
    expect(linkedin.searchParams.get("location")).toBe("78701");

    // Deselecting a site under Sources removes it here too.
    await user.click(screen.getByText(/Sources \(2 searched live/));
    await user.click(screen.getByRole("checkbox", { name: "Include Indeed in the link-out row" }));
    expect(within(primary).queryByRole("link", { name: /Indeed/ })).not.toBeInTheDocument();
  });

  it("wires LinkedIn and Indeed deeply: their links carry the filters and sort first", async () => {
    const boardsWithSources = {
      ...BOARDS,
      sources: [
        {
          key: "glassdoor", name: "Glassdoor", focus: "general", status: "external_link",
          searchUrl: "https://www.glassdoor.com/Job/jobs.htm?sc.keyword={query}&locKeyword={location}",
          note: "Opens Glassdoor's own search.",
        },
        {
          key: "linkedin_jobs", name: "LinkedIn Jobs", focus: "general", status: "external_link",
          searchUrl: "https://www.linkedin.com/jobs/search/?keywords={query}&location={location}",
          note: "Opens LinkedIn's own job search.",
        },
        {
          key: "indeed", name: "Indeed", focus: "general", status: "external_link",
          searchUrl: "https://www.indeed.com/jobs?q={query}&l={location}",
          note: "Opens Indeed's own search.",
        },
      ],
    };
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve(json({
          results: [{ board: "jobnet", boardName: "Jobnet", totalAvailable: 0, hits: [], locationApplied: true }],
          failures: [],
        }));
      }
      return Promise.resolve(json(boardsWithSources));
    });
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);

    await user.type(screen.getByPlaceholderText("Job title, skill or keyword"), "engineer");
    await user.type(screen.getByPlaceholderText("Place or postcode"), "Copenhagen");
    await user.selectOptions(screen.getByRole("combobox", { name: "Within distance" }), "50");
    await user.selectOptions(screen.getByRole("combobox", { name: /Work model/ }), "remote");
    await user.selectOptions(screen.getByRole("combobox", { name: /Posted within/ }), "7");
    await user.type(screen.getByRole("spinbutton", { name: /Salary at least/ }), "90000");
    await user.click(screen.getByRole("button", { name: /^search$/i }));

    const strip = await screen.findByTestId("linkout-strip");

    // The two deeply wired sites sort ahead of template-only Glassdoor and
    // say visibly that the filters travel with them.
    const chips = within(strip).getAllByRole("link");
    expect(chips.map((chip) => chip.textContent)).toEqual([
      expect.stringContaining("LinkedIn Jobs"),
      expect.stringContaining("Indeed"),
      expect.stringContaining("Glassdoor"),
    ]);
    expect(within(strip).getAllByText("· your filters")).toHaveLength(2);

    // LinkedIn's link speaks LinkedIn's own parameters.
    const linkedin = new URL(
      within(strip).getByRole("link", { name: /LinkedIn Jobs/ }).getAttribute("href")!,
    );
    expect(linkedin.searchParams.get("keywords")).toBe("engineer");
    expect(linkedin.searchParams.get("location")).toBe("Copenhagen");
    expect(linkedin.searchParams.get("distance")).toBe("31");
    expect(linkedin.searchParams.get("f_TPR")).toBe("r604800");
    expect(linkedin.searchParams.get("f_WT")).toBe("2");
    expect(linkedin.searchParams.get("f_SB2")).toBe("3");

    // Indeed's link speaks Indeed's: radius/fromage as parameters, salary
    // and remote in the query text per Indeed's own search tips.
    const indeed = new URL(
      within(strip).getByRole("link", { name: /Indeed/ }).getAttribute("href")!,
    );
    expect(indeed.searchParams.get("q")).toBe("engineer $90,000 remote");
    expect(indeed.searchParams.get("l")).toBe("Copenhagen");
    expect(indeed.searchParams.get("radius")).toBe("35");
    expect(indeed.searchParams.get("fromage")).toBe("7");

    // Glassdoor has no verified parameter mapping, so its link stays the
    // plain query+location template — no invented filters.
    const glassdoor = within(strip).getByRole("link", { name: /Glassdoor/ }).getAttribute("href")!;
    expect(glassdoor).toBe(
      "https://www.glassdoor.com/Job/jobs.htm?sc.keyword=engineer&locKeyword=Copenhagen",
    );
  });

  it("filters by the seniority the title states, chips it, and saves it with the search", async () => {
    respond({
      results: [{
        board: "jobnet",
        boardName: "Jobnet",
        totalAvailable: 3,
        hits: [hit("Senior Platform Engineer"), hit("Platform Engineer"), hit("Engineering Manager")],
        locationApplied: true,
      }],
      failures: [],
    });
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);

    await search(user);
    expect(await screen.findByText("3 unique postings")).toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole("combobox", { name: /Seniority \(from the job title\)/ }),
      "senior",
    );

    // Only the title that says "senior" stays; the untitled and the manager
    // are counted as hidden by filters, and the chip names the derivation.
    expect(screen.getByText("1 unique posting")).toBeInTheDocument();
    expect(screen.getByText(/2 postings are hidden by\s+your filters/)).toBeInTheDocument();
    expect(screen.getByText("title: senior")).toBeInTheDocument();

    // The seniority travels into a saved search like every other filter.
    await user.type(screen.getByPlaceholderText(/Name this search/), "Senior only");
    await user.click(screen.getByRole("button", { name: "Save this search" }));
    const savedCall = fetchMock.mock.calls.find(([url, init]) =>
      typeof url === "string" && url.includes("/saved-searches") &&
      (init as RequestInit | undefined)?.method === "POST");
    const body = JSON.parse((savedCall?.[1] as RequestInit).body as string) as {
      query: { filters?: { seniority?: string } };
    };
    expect(body.query.filters?.seniority).toBe("senior");
  });

  it("filters by title-named specialty and posting-text industry, chipped and honest", async () => {
    const seoHit = { ...hit("SEO Manager"), job: { ...hit("SEO Manager").job, description: "Own organic search." } };
    const genericHit = {
      ...hit("Marketing Manager"),
      job: { ...hit("Marketing Manager").job, description: "Join our fast-growing SaaS platform." },
    };
    respond({
      results: [{ board: "jobnet", boardName: "Jobnet", totalAvailable: 2, hits: [seoHit, genericHit], locationApplied: true }],
      failures: [],
    });
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);

    await search(user);
    expect(await screen.findByText("2 unique postings")).toBeInTheDocument();

    await user.selectOptions(
      screen.getByRole("combobox", { name: /Marketing specialty \(from the job title\)/ }),
      "seo",
    );
    expect(screen.getByText("1 unique posting")).toBeInTheDocument();
    expect(screen.getByText("specialty: SEO")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove filter specialty: SEO" }));

    await user.selectOptions(
      screen.getByRole("combobox", { name: /Industry \(from the posting text\)/ }),
      "technology",
    );
    // Only the posting whose own text evidences SaaS/technology stays.
    expect(screen.getByText("1 unique posting")).toBeInTheDocument();
    expect(screen.getByText("Marketing Manager")).toBeInTheDocument();
    expect(screen.getByText("industry: Technology / SaaS")).toBeInTheDocument();
  });

  it("sends the radius only alongside a place, and renders the server's honest account", async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve(json({
          results: [{ board: "jobnet", boardName: "Jobnet", totalAvailable: 1, hits: [hit("Close Role")], locationApplied: true }],
          failures: [],
          unified: {
            radius: {
              applied: true,
              radiusKm: 50,
              center: { name: "Copenhagen", country: "DK" },
              excluded: 3,
              unresolvedKept: 2,
              remoteKept: 1,
            },
          },
        }));
      }
      return Promise.resolve(json(BOARDS));
    });
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);

    // No place, no distance: the select waits rather than pretending.
    const radiusSelect = screen.getByRole("combobox", { name: "Within distance" });
    expect(radiusSelect).toBeDisabled();

    await user.type(screen.getByPlaceholderText("Place or postcode"), "Copenhagen");
    expect(radiusSelect).toBeEnabled();
    await user.selectOptions(radiusSelect, "50");
    await search(user);

    const searchCall = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === "POST",
    );
    const body = JSON.parse((searchCall?.[1] as RequestInit).body as string) as { radiusKm?: number };
    expect(body.radiusKm).toBe(50);

    const report = await screen.findByTestId("radius-report");
    expect(report.textContent).toContain("Within 50 km of Copenhagen (DK)");
    expect(report.textContent).toContain("3 excluded by distance");
    expect(report.textContent).toContain("1 remote kept");
    expect(report.textContent).toContain("2 kept whose stated place is not in the city index");
  });

  it("shows why a distance was not applied instead of quietly ignoring it", async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        return Promise.resolve(json({
          results: [{ board: "jobnet", boardName: "Jobnet", totalAvailable: 1, hits: [hit("Some Role")], locationApplied: true }],
          failures: [],
          unified: {
            radius: { applied: false, reason: '"Anywhere" is not in the place index (cities of 15,000+ people), so distance was not applied.' },
          },
        }));
      }
      return Promise.resolve(json(BOARDS));
    });
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);

    await user.type(screen.getByPlaceholderText("Place or postcode"), "Anywhere");
    await user.selectOptions(screen.getByRole("combobox", { name: "Within distance" }), "25");
    await search(user);

    const report = await screen.findByTestId("radius-report");
    expect(report.textContent).toContain("Distance not applied:");
    expect(report.textContent).toContain("not in the place index");
  });

  /** Board list + marks on mount, search results on POST, marks writes OK. */
  function respondWithMarks(
    searchBody: unknown,
    stored: { favorite?: string[]; hidden?: string[]; viewed?: string[] } = {},
    markWriteStatus = 200,
  ) {
    fetchMock.mockImplementation((url: string, init?: RequestInit) => {
      if (typeof url === "string" && url.includes("/search/marks")) {
        if (init?.method === "POST" || init?.method === "DELETE") {
          return Promise.resolve(json(
            markWriteStatus < 300 ? { marked: {} } : { error: { message: "no" } },
            markWriteStatus,
          ));
        }
        return Promise.resolve(json({
          marks: {
            favorite: stored.favorite ?? [],
            hidden: stored.hidden ?? [],
            viewed: stored.viewed ?? [],
          },
        }));
      }
      if (init?.method === "POST") return Promise.resolve(json(searchBody));
      return Promise.resolve(json(BOARDS));
    });
  }

  function markableHit(title: string, url: string) {
    return { ...hit(title), job: { ...hit(title).job, url } };
  }

  const twoPostings = {
    results: [{
      board: "jobnet",
      boardName: "Jobnet",
      totalAvailable: 2,
      hits: [
        markableHit("Growth Engineer", "https://jobnet.dk/find-job/growth"),
        markableHit("Data Engineer", "https://jobnet.dk/find-job/data"),
      ],
      locationApplied: true,
    }],
    failures: [],
  };

  it("favorites persist through the marks API and can narrow the list to favorites only", async () => {
    respondWithMarks(twoPostings);
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);

    await search(user);
    expect(await screen.findByText("2 unique postings")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Favorite Growth Engineer" }));

    // The star flips and the write is the real API call, not local decor.
    expect(screen.getByRole("button", { name: "Unfavorite Growth Engineer" })).toBeInTheDocument();
    const write = fetchMock.mock.calls.find(([url, init]) =>
      typeof url === "string" && url.includes("/search/marks") &&
      (init as RequestInit | undefined)?.method === "POST");
    expect(JSON.parse((write?.[1] as RequestInit).body as string)).toEqual({
      jobUrl: "https://jobnet.dk/find-job/growth",
      mark: "favorite",
    });

    await user.click(screen.getByRole("checkbox", { name: "Favorites only" }));
    expect(screen.getByText("1 unique posting")).toBeInTheDocument();
    expect(screen.queryByText("Data Engineer")).not.toBeInTheDocument();
  });

  it("hides a posting, counts it honestly, and brings it back on request", async () => {
    respondWithMarks(twoPostings);
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);

    await search(user);
    expect(await screen.findByText("2 unique postings")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Hide Data Engineer" }));

    // Hidden-by-you is its own count, separate from hidden-by-filters.
    expect(screen.getByText("1 unique posting")).toBeInTheDocument();
    expect(screen.queryByText("Data Engineer")).not.toBeInTheDocument();
    expect(screen.getByText(/1 posting hidden by you/)).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Show hidden" }));
    expect(screen.getByText("Data Engineer")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Unhide Data Engineer" }));
    expect(screen.queryByText(/hidden by you/)).not.toBeInTheDocument();
  });

  it("records viewed when a posting is opened and badges it, without ceremony", async () => {
    respondWithMarks(twoPostings);
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);

    await search(user);
    expect(await screen.findByText("2 unique postings")).toBeInTheDocument();
    expect(screen.queryByText("Viewed")).not.toBeInTheDocument();

    await user.click(screen.getByRole("link", { name: "Growth Engineer" }));

    expect(await screen.findByText("Viewed")).toBeInTheDocument();
    const write = fetchMock.mock.calls.find(([url, init]) =>
      typeof url === "string" && url.includes("/search/marks") &&
      (init as RequestInit | undefined)?.method === "POST");
    expect(JSON.parse((write?.[1] as RequestInit).body as string)).toEqual({
      jobUrl: "https://jobnet.dk/find-job/growth",
      mark: "viewed",
    });
  });

  it("reverts a failed favorite and says the save did not happen", async () => {
    respondWithMarks(twoPostings, {}, 500);
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);

    await search(user);
    await screen.findByText("2 unique postings");

    await user.click(screen.getByRole("button", { name: "Favorite Growth Engineer" }));

    expect(await screen.findByText("The favorite could not be saved. Try again.")).toBeInTheDocument();
    // The optimistic star is taken back rather than left lying.
    expect(screen.getByRole("button", { name: "Favorite Growth Engineer" })).toBeInTheDocument();
  });

  it("keeps the mark controls unrendered while the person's marks are unknown", async () => {
    // respond() answers the marks load with a body that has no marks in it.
    respond(twoPostings);
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);

    await search(user);
    await screen.findByText("2 unique postings");

    // A star that would forget yesterday's favorites is worse than no star.
    expect(screen.queryByRole("button", { name: /Favorite/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Hide/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Favorites only" })).not.toBeInTheDocument();
  });
});

describe("the inline LinkedIn/Indeed door", () => {
  const linkoutSources = [
    {
      key: "linkedin_jobs",
      name: "LinkedIn Jobs",
      focus: "general",
      status: "external_link",
      searchUrl: "https://www.linkedin.com/jobs/search/?keywords={query}&location={location}",
      note: "LinkedIn's terms prohibit automated collection.",
    },
    {
      key: "indeed",
      name: "Indeed",
      focus: "general",
      status: "external_link",
      searchUrl: "https://www.indeed.com/jobs?q={query}&l={location}",
      note: "Indeed's publisher API is closed to new partners.",
    },
  ];

  it("says exactly what is missing while the aggregator is Not Connected", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(json({ ...BOARDS, sources: linkoutSources })));
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);

    const strip = screen.getByTestId("primary-linkouts");
    expect(within(strip).getByText(/Not Connected/)).toBeInTheDocument();
    expect(within(strip).getByText(/JSEARCH_RAPIDAPI_KEY/)).toBeInTheDocument();
  });

  it("says the postings appear inline once the aggregator board is offered", async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(json({
        boards: [
          ...BOARDS.boards,
          {
            key: "jsearch",
            name: "JSearch",
            summary: "Google's job index.",
            coverage: "Worldwide aggregator",
            supportsLocation: true,
          },
        ],
        sources: linkoutSources,
      })));
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 3 boards:/);

    const strip = screen.getByTestId("primary-linkouts");
    expect(within(strip).getByText(/also appear inline/)).toBeInTheDocument();
    expect(within(strip).queryByText(/Not Connected/)).not.toBeInTheDocument();
  });

  it("labels an aggregator result with the site that hosts the posting", async () => {
    // The route badges an aggregator source with its publisher —
    // "LinkedIn (JSearch)" — so the card says which site hosts the posting.
    respond({
      results: [{
        board: "jsearch",
        boardName: "JSearch",
        totalAvailable: null,
        hits: [{ ...hit("Marketing Manager"), publisher: "LinkedIn" }],
        locationApplied: true,
      }],
      failures: [],
      unified: {
        hits: [{
          job: hit("Marketing Manager").job,
          publishedOn: "2026-08-28",
          closesOn: null,
          sources: [{
            board: "jsearch",
            boardName: "LinkedIn (JSearch)",
            url: "https://www.linkedin.com/jobs/view/12345",
            externalId: "li-1",
            saveToken: "t-li",
          }],
          primarySourceIndex: 0,
          match: null,
        }],
        dedupedFrom: 1,
        beforeFilters: 1,
        matchBasis: { computed: false, reason: "No Career Profile is recorded yet." },
      },
    });
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);
    await search(user);

    expect(await screen.findByText("via LinkedIn (JSearch)")).toBeInTheDocument();
  });
});

describe("your history with the company (ADR-245)", () => {
  it("prints the sentence from your own rows on the card, and the basis once", async () => {
    const remembered = {
      job: { ...hit("Platform Engineer").job, url: "https://jobnet.dk/find-job/remembered" },
      publishedOn: "2026-09-01",
      closesOn: null,
      sources: [{ board: "jobnet", boardName: "Jobnet", url: "https://jobnet.dk/find-job/remembered", externalId: "id-remembered", saveToken: "t-remembered" }],
      primarySourceIndex: 0,
      match: null,
      history: {
        company: "Nordisk Teknik A/S",
        recorded: 2,
        applied: 1,
        sentence: "You applied to Nordisk Teknik A/S on 2026-08-10; closed with no response.",
      },
    };
    const unknown = {
      job: { ...hit("Go Engineer").job, company: "Elsewhere ApS", url: "https://jobnet.dk/find-job/unknown" },
      publishedOn: "2026-09-01",
      closesOn: null,
      sources: [{ board: "jobnet", boardName: "Jobnet", url: "https://jobnet.dk/find-job/unknown", externalId: "id-unknown", saveToken: "t-unknown" }],
      primarySourceIndex: 0,
      match: null,
      history: null,
    };
    respond({
      results: [{ board: "jobnet", boardName: "Jobnet", totalAvailable: 2, hits: [hit("Platform Engineer"), hit("Go Engineer")], locationApplied: true }],
      failures: [],
      unified: {
        hits: [remembered, unknown],
        dedupedFrom: 2,
        beforeFilters: 2,
        matchBasis: { computed: false, reason: "No Career Profile is recorded yet." },
        historyBasis: "Your history with each company is read from your own recorded postings and applications (2 recorded); nothing about an employer is asserted beyond what you recorded.",
      },
    });
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);

    await search(user);

    const lines = await screen.findAllByTestId("company-memory");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toHaveTextContent("Your history: You applied to Nordisk Teknik A/S on 2026-08-10; closed with no response.");
    expect(screen.getByTestId("history-basis")).toHaveTextContent("(2 recorded)");
  });
});

describe("still open? (ADR-249)", () => {
  it("rechecks on request, prints the answer, and takes the server's new verdict", async () => {
    const posts: unknown[] = [];
    const card = {
      job: { ...hit("Platform Engineer").job, url: "https://jobnet.dk/find-job/recheck" },
      publishedOn: "2026-06-01",
      closesOn: null,
      sources: [{ board: "jobnet", boardName: "Jobnet", url: "https://jobnet.dk/find-job/recheck", externalId: "id-recheck", saveToken: "t-recheck" }],
      primarySourceIndex: 0,
      match: null,
      freshness: { level: "stale", postedDaysAgo: 93, firstSeenDaysAgo: null, timesSeen: 0, reposts: 0, reasons: ["Posted 93 days ago by the board's own date."] },
    };
    respond({
      results: [{ board: "jobnet", boardName: "Jobnet", totalAvailable: 1, hits: [hit("Platform Engineer")], locationApplied: true }],
      failures: [],
      unified: { hits: [card], dedupedFrom: 1, beforeFilters: 1, matchBasis: { computed: false, reason: "No Career Profile is recorded yet." } },
    });
    const underlying = globalThis.fetch;
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/job-seeker/search/recheck") {
        posts.push(JSON.parse(String(init?.body)));
        return new Response(JSON.stringify({
          urlKey: "k", reused: false,
          recheck: { status: "open", note: "HTTP 200 — the page is up and does not say the position is closed.", checkedAt: new Date().toISOString(), minutesAgo: 0 },
          freshness: { level: "aging", postedDaysAgo: 93, firstSeenDaysAgo: 0, timesSeen: 1, reposts: 0, reasons: ["Posted 93 days ago by the board's own date.", "Rechecked today: HTTP 200 — the page is up and does not say the position is closed. That proves the page, not the vacancy."], recheck: { status: "open", checkedDaysAgo: 0, note: "HTTP 200 — the page is up and does not say the position is closed." } },
        }), { headers: { "Content-Type": "application/json" } });
      }
      return underlying(input, init);
    }));
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);
    await search(user);
    expect(await screen.findByTestId("freshness-badge")).toHaveTextContent("Likely stale");

    await user.click(screen.getByRole("button", { name: "Still open? Platform Engineer" }));
    expect(await screen.findByTestId("recheck-result")).toHaveTextContent("Rechecked just now: HTTP 200 — the page is up and does not say the position is closed.");
    expect(posts).toEqual([{ url: "https://jobnet.dk/find-job/recheck", publishedOn: "2026-06-01", closesOn: null }]);
    expect(screen.getByTestId("freshness-badge")).toHaveTextContent("Aging");
  });
});
