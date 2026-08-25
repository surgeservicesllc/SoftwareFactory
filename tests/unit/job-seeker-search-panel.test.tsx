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
    { key: "jobnet", name: "Jobnet", summary: "Danish public job bank.", coverage: "Denmark" },
    { key: "freehire", name: "Freehire", summary: "Developer jobs.", coverage: "International" },
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
    respond({ results: [{ board: "jobnet", boardName: "Jobnet", totalAvailable: 0, hits: [] }], failures: [] });
    const user = userEvent.setup();
    render(<JobSearchPanel />);
    await screen.findByText(/Searching 2 boards:/);

    await search(user);

    expect(await screen.findByText(/No postings matched/)).toBeInTheDocument();
  });

  it("shows the board's own total, so a sample is not read as the whole", async () => {
    respond({
      results: [{ board: "jobnet", boardName: "Jobnet", totalAvailable: 812, hits: [hit("Platform Engineer")] }],
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
      results: [{ board: "jobnet", boardName: "Jobnet", totalAvailable: null, hits: [hit("Platform Engineer")] }],
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
      results: [{ board: "jobnet", boardName: "Jobnet", totalAvailable: 3, hits: [hit("Platform Engineer")] }],
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
      results: [{ board: "jobnet", boardName: "Jobnet", totalAvailable: 1, hits: [hit("Platform Engineer")] }],
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

  it("links a posting to the board, opening it without handing over the referrer", async () => {
    respond({
      results: [{ board: "jobnet", boardName: "Jobnet", totalAvailable: 1, hits: [hit("Platform Engineer")] }],
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
});
