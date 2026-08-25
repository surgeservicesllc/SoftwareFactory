"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { Card, EmptyState, Notice, SectionTitle } from "@/components/ui";

/**
 * Search: query live job boards and save what is worth keeping.
 *
 * Every posting shown here came back from a board in this request. Nothing is
 * seeded, cached or illustrated — an empty result is rendered as empty, and a
 * board that failed is named with its reason rather than omitted. Those two
 * rules are why there is no placeholder state in this file.
 *
 * Saving reuses the job list's own recording chain, so a saved posting is
 * scored and enters the pipeline exactly as a manually recorded one does. The
 * button reports what actually happened, including "already saved", which is
 * a real outcome and not an error.
 */

type BoardView = { key: string; name: string; summary: string; coverage: string };

type Hit = {
  job: {
    externalId: string | null;
    url: string | null;
    title: string;
    company: string;
    salaryText: string | null;
    location: string | null;
    workModel: "remote" | "hybrid" | "onsite" | null;
    description: string | null;
  };
  publishedOn: string | null;
  closesOn: string | null;
};

type BoardResult = {
  board: string;
  boardName: string;
  totalAvailable: number | null;
  hits: Hit[];
};

type BoardFailure = { board: string; boardName: string; code: string; message: string };

type SaveState = "idle" | "saving" | "saved" | "already" | "failed";

function hitKey(board: string, hit: Hit): string {
  return `${board}:${hit.job.externalId ?? hit.job.url ?? `${hit.job.company}:${hit.job.title}`}`;
}

export function JobSearchPanel() {
  const [boards, setBoards] = useState<BoardView[] | null>(null);
  const [boardsError, setBoardsError] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [location, setLocation] = useState("");
  const [running, setRunning] = useState(false);
  /** null until a search has run: "no results" and "not searched yet" differ. */
  const [results, setResults] = useState<BoardResult[] | null>(null);
  const [failures, setFailures] = useState<BoardFailure[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [saves, setSaves] = useState<Record<string, SaveState>>({});

  /** Guards against an earlier slow search overwriting a later one's results. */
  const requestRef = useRef(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/job-seeker/search", { headers: { accept: "application/json" } });
        const payload = (await response.json()) as { boards?: BoardView[]; error?: { message?: string } };
        if (!active) return;
        if (!response.ok) {
          setBoardsError(payload.error?.message ?? "The board list could not be read.");
          return;
        }
        setBoards(payload.boards ?? []);
      } catch {
        if (active) setBoardsError("The board list could not be read.");
      }
    })();
    return () => { active = false; };
  }, []);

  const runSearch = useCallback(async () => {
    const term = text.trim();
    const place = location.trim();
    if (term.length === 0 && place.length === 0) {
      setSearchError("Give a search term or a location.");
      return;
    }

    const ticket = requestRef.current + 1;
    requestRef.current = ticket;
    setRunning(true);
    setSearchError(null);
    setSaves({});

    try {
      const response = await fetch("/api/job-seeker/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: term,
          location: place.length === 0 ? null : place,
          limit: 25,
        }),
      });
      const payload = (await response.json()) as {
        results?: BoardResult[];
        failures?: BoardFailure[];
        error?: { message?: string };
      };
      // A superseded search must not paint over the current one.
      if (requestRef.current !== ticket) return;

      if (!response.ok) {
        setSearchError(payload.error?.message ?? "The search could not be run.");
        setResults(null);
        setFailures([]);
        return;
      }
      setResults(payload.results ?? []);
      setFailures(payload.failures ?? []);
    } catch {
      if (requestRef.current === ticket) setSearchError("The search could not be run.");
    } finally {
      if (requestRef.current === ticket) setRunning(false);
    }
  }, [text, location]);

  const saveHit = useCallback(async (board: string, hit: Hit) => {
    const key = hitKey(board, hit);
    setSaves((current) => ({ ...current, [key]: "saving" }));
    try {
      const response = await fetch("/api/job-seeker/search/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ board, job: hit.job }),
      });
      const payload = (await response.json()) as { saved?: boolean; reason?: string };
      setSaves((current) => ({
        ...current,
        [key]: !response.ok
          ? "failed"
          : payload.saved === true
            ? "saved"
            : payload.reason === "already_saved"
              ? "already"
              : "failed",
      }));
    } catch {
      setSaves((current) => ({ ...current, [key]: "failed" }));
    }
  }, []);

  const totalHits = (results ?? []).reduce((sum, entry) => sum + entry.hits.length, 0);

  return (
    <div className="space-y-6">
      <Card>
        <SectionTitle
          title="Search job boards"
          description="Queries the boards below live. Results are not stored until you save one."
        />

        <form
          className="mt-4 grid gap-3 sm:grid-cols-[2fr_1fr_auto]"
          onSubmit={(event) => { event.preventDefault(); void runSearch(); }}
        >
          <label className="block">
            <span className="sr-only">What to search for</span>
            <input
              type="search"
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Job title, skill or keyword"
              maxLength={200}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            />
          </label>
          <label className="block">
            <span className="sr-only">Where</span>
            <input
              type="text"
              value={location}
              onChange={(event) => setLocation(event.target.value)}
              placeholder="Place or postcode"
              maxLength={120}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={running}
            className="rounded-md bg-[var(--accent)] px-4 py-2 text-sm font-medium text-[var(--accent-contrast)] disabled:opacity-60"
          >
            {running ? "Searching…" : "Search"}
          </button>
        </form>

        {searchError !== null ? (
          <div className="mt-3"><Notice tone="warning">{searchError}</Notice></div>
        ) : null}

        {boardsError !== null ? (
          <div className="mt-3"><Notice tone="warning">{boardsError}</Notice></div>
        ) : boards !== null ? (
          <p className="mt-3 text-xs text-[var(--muted)]">
            Searching {boards.length} {boards.length === 1 ? "board" : "boards"}:{" "}
            {boards.map((board) => `${board.name} (${board.coverage})`).join(", ")}.
          </p>
        ) : null}
      </Card>

      {failures.length > 0 ? (
        <Notice tone="warning">
          <span className="font-medium">
            {failures.length} of {failures.length + (results?.length ?? 0)} boards did not answer.
          </span>{" "}
          {failures.map((failure) => `${failure.boardName}: ${failure.message}`).join(" ")}
          {" "}These results are therefore not everything that is out there.
        </Notice>
      ) : null}

      {results === null ? null : totalHits === 0 ? (
        <EmptyState
          title="No postings matched"
          description="The boards answered and had nothing for this search. Try a broader term or a different place."
        />
      ) : (
        results.map((result) => (
          <div key={result.board} data-testid="search-result-card">
          <Card>
            <SectionTitle
              title={result.boardName}
              description={
                result.totalAvailable === null
                  ? `Showing ${result.hits.length}. This board does not report a total.`
                  : `Showing ${result.hits.length} of ${result.totalAvailable} the board reports.`
              }
            />
            {result.hits.length === 0 ? (
              <p className="mt-3 text-sm text-[var(--muted)]">Nothing from this board.</p>
            ) : (
              <ul className="mt-4 space-y-3">
                {result.hits.map((hit) => {
                  const key = hitKey(result.board, hit);
                  const state = saves[key] ?? "idle";
                  return (
                    <li key={key} className="rounded-md border border-[var(--border)] p-3">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="font-medium">
                            {hit.job.url === null ? (
                              hit.job.title
                            ) : (
                              <a
                                href={hit.job.url}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="underline underline-offset-2"
                              >
                                {hit.job.title}
                              </a>
                            )}
                          </p>
                          <p className="text-sm text-[var(--muted)]">
                            {hit.job.company}
                            {hit.job.location === null ? "" : ` · ${hit.job.location}`}
                            {hit.publishedOn === null ? "" : ` · posted ${hit.publishedOn}`}
                            {hit.closesOn === null ? "" : ` · closes ${hit.closesOn}`}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void saveHit(result.board, hit)}
                          disabled={state === "saving" || state === "saved" || state === "already"}
                          className="shrink-0 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm disabled:opacity-70"
                        >
                          {state === "saving"
                            ? "Saving…"
                            : state === "saved"
                              ? "Saved to your jobs"
                              : state === "already"
                                ? "Already in your jobs"
                                : state === "failed"
                                  ? "Save failed — retry"
                                  : "Save"}
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </Card>
          </div>
        ))
      )}
    </div>
  );
}
