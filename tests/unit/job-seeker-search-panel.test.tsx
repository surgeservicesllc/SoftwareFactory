import { render, screen } from "@testing-library/react";
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
});
