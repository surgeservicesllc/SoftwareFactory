"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { Card, EmptyState, Notice, SectionTitle } from "@/components/ui";
import {
  applyUnifiedFilters,
  dedupeAcrossBoards,
  EMPTY_FILTERS,
  salaryCeiling,
  type UnifiedFilters,
  type UnifiedHit,
} from "@/lib/job-seeker/board-search/unify";

/**
 * Search: query live job boards and save what is worth keeping.
 *
 * Every posting shown here came back from a board in this request. Nothing is
 * seeded, cached or illustrated — an empty result is rendered as empty, and a
 * board that failed is named with its reason rather than omitted. Those two
 * rules are why there is no placeholder state in this file.
 *
 * The default view is unified: the same posting found on several boards is
 * one card carrying every board's badge and link, deduplicated by the shared
 * `unify` module — the same functions the API applies server-side, so the
 * browser and the server cannot disagree about what "the same job" means.
 * Filters run on the unified set in the browser, instantly, through that same
 * shared module. The by-board view shows each board's answer untouched.
 *
 * Saving reuses the job list's own recording chain, so a saved posting is
 * scored and enters the pipeline exactly as a manually recorded one does. A
 * unified card saves through its primary source — the board whose exact copy
 * the card shows — because save tokens are sealed over one board's fields.
 *
 * The source picker is the full researched catalogue, statuses and all: the
 * boards genuinely searched are checkboxes, sources that need credentials say
 * **Not Connected**, and sources that only permit an ordinary web link open
 * in a new tab. No entry pretends.
 */

type BoardView = {
  key: string;
  name: string;
  summary: string;
  coverage: string;
  supportsLocation: boolean;
};

type CatalogueSourceView = {
  key: string;
  name: string;
  focus: "general" | "marketing";
  status: "live" | "needs_credentials" | "external_link" | "not_supported";
  adapterKey?: string;
  searchUrl?: string;
  note: string;
};

type Hit = {
  job: {
    externalId: string;
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
  saveToken: string;
};

type BoardResult = {
  board: string;
  boardName: string;
  totalAvailable: number | null;
  hits: Hit[];
  locationApplied: boolean;
};

type BoardFailure = { board: string; boardName: string; code: string; message: string };

type SaveState = "idle" | "saving" | "saved" | "already" | "failed" | "expired";

type SortOrder = "returned" | "newest" | "salary";

function hitKey(board: string, hit: Hit): string {
  return `${board}:${hit.job.externalId ?? hit.job.url ?? `${hit.job.company}:${hit.job.title}`}`;
}

/** The unified card's identity is its primary source's identity, so save
 *  state stays in step between the unified and by-board views. */
function unifiedKey(card: UnifiedHit): string {
  const primary = card.sources[card.primarySourceIndex]!;
  return `${primary.board}:${primary.externalId ?? primary.url ?? `${card.job.company}:${card.job.title}`}`;
}

function fillLinkTemplate(template: string, text: string, location: string): string {
  return template
    .replace("{query}", encodeURIComponent(text.trim()))
    .replace("{location}", encodeURIComponent(location.trim()));
}

function isNew(publishedOn: string | null): boolean {
  if (publishedOn === null) return false;
  const age = Date.now() - new Date(publishedOn).getTime();
  return Number.isFinite(age) && age >= 0 && age <= 3 * 86_400_000;
}

function Chip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2 py-0.5 text-xs">
      {label}
      <button
        type="button"
        aria-label={`Remove filter ${label}`}
        onClick={onRemove}
        className="text-[var(--muted)] hover:text-[var(--foreground)]"
      >
        ×
      </button>
    </span>
  );
}

export function JobSearchPanel() {
  const [boards, setBoards] = useState<BoardView[] | null>(null);
  const [sources, setSources] = useState<CatalogueSourceView[]>([]);
  const [boardsError, setBoardsError] = useState<string | null>(null);

  const [text, setText] = useState("");
  const [location, setLocation] = useState("");
  /** null means "every board" until the person deselects one. */
  const [deselected, setDeselected] = useState<ReadonlySet<string>>(new Set());
  const [running, setRunning] = useState(false);
  /** null until a search has run: "no results" and "not searched yet" differ. */
  const [results, setResults] = useState<BoardResult[] | null>(null);
  const [failures, setFailures] = useState<BoardFailure[]>([]);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [saves, setSaves] = useState<Record<string, SaveState>>({});
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});

  const [view, setView] = useState<"unified" | "byBoard">("unified");
  const [sort, setSort] = useState<SortOrder>("returned");

  // Result-level filters: chips over the unified set, applied instantly in
  // the browser through the shared unify module.
  const [keywordInput, setKeywordInput] = useState("");
  const [keywords, setKeywords] = useState<readonly string[]>([]);
  const [keywordMode, setKeywordMode] = useState<"and" | "or">("and");
  const [excludeInput, setExcludeInput] = useState("");
  const [excludeKeywords, setExcludeKeywords] = useState<readonly string[]>([]);
  const [excludeCompanyInput, setExcludeCompanyInput] = useState("");
  const [excludeCompanies, setExcludeCompanies] = useState<readonly string[]>([]);
  const [workModel, setWorkModel] = useState<"" | "remote" | "hybrid" | "onsite">("");
  const [salaryMinimumInput, setSalaryMinimumInput] = useState("");
  const [requireSalary, setRequireSalary] = useState(false);
  const [postedWithinDays, setPostedWithinDays] = useState<"" | "1" | "3" | "7" | "14" | "30">("");

  /** Guards against an earlier slow search overwriting a later one's results. */
  const requestRef = useRef(0);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch("/api/job-seeker/search", { headers: { accept: "application/json" } });
        const payload = (await response.json()) as {
          boards?: BoardView[];
          sources?: CatalogueSourceView[];
          error?: { message?: string };
        };
        if (!active) return;
        if (!response.ok) {
          setBoardsError(payload.error?.message ?? "The board list could not be read.");
          return;
        }
        setBoards(payload.boards ?? []);
        setSources(payload.sources ?? []);
      } catch {
        if (active) setBoardsError("The board list could not be read.");
      }
    })();
    return () => { active = false; };
  }, []);

  const selectedBoards = useMemo(
    () => (boards ?? []).filter((board) => !deselected.has(board.key)),
    [boards, deselected],
  );

  const runSearch = useCallback(async () => {
    const term = text.trim();
    const place = location.trim();
    if (term.length === 0 && place.length === 0) {
      setSearchError("Give a search term or a location.");
      return;
    }
    if (boards !== null && selectedBoards.length === 0) {
      setSearchError("Pick at least one board to search.");
      return;
    }

    const ticket = requestRef.current + 1;
    requestRef.current = ticket;
    setRunning(true);
    setSearchError(null);
    // A new request invalidates the visual authority of the old response.
    // Clear it immediately so a network failure cannot leave expired tokens
    // looking like results from the request that just failed.
    setResults(null);
    setFailures([]);
    setSaves({});
    setSaveErrors({});

    try {
      const response = await fetch("/api/job-seeker/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: term,
          location: place.length === 0 ? null : place,
          limit: 25,
          ...(boards !== null && selectedBoards.length < boards.length
            ? { boards: selectedBoards.map((board) => board.key) }
            : {}),
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
      if (requestRef.current === ticket) {
        setSearchError("The search could not be run.");
        setResults(null);
        setFailures([]);
      }
    } finally {
      if (requestRef.current === ticket) setRunning(false);
    }
  }, [text, location, boards, selectedBoards]);

  const saveHit = useCallback(async (board: string, job: Hit["job"], saveToken: string, key: string) => {
    setSaves((current) => ({ ...current, [key]: "saving" }));
    setSaveErrors((current) => {
      const next = { ...current };
      delete next[key];
      return next;
    });
    try {
      const response = await fetch("/api/job-seeker/search/save", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ board, job, resultToken: saveToken }),
      });
      const payload = (await response.json()) as {
        saved?: boolean;
        reason?: string;
        error?: { code?: string; message?: string };
      };
      const state: SaveState = !response.ok
        ? payload.error?.code === "search_result_invalid" ? "expired" : "failed"
        : payload.saved === true
          ? "saved"
          : payload.reason === "already_saved"
            ? "already"
            : "failed";
      setSaves((current) => ({
        ...current,
        [key]: state,
      }));
      if (state === "failed" || state === "expired") {
        setSaveErrors((current) => ({
          ...current,
          [key]: payload.error?.message ?? "The job could not be saved. Try again.",
        }));
      }
    } catch {
      setSaves((current) => ({ ...current, [key]: "failed" }));
      setSaveErrors((current) => ({
        ...current,
        [key]: "The job could not be saved because the connection failed. Try again.",
      }));
    }
  }, []);

  const filters: UnifiedFilters = useMemo(
    () => ({
      ...EMPTY_FILTERS,
      keywordMode,
      keywords,
      excludeKeywords,
      excludeCompanies,
      workModel: workModel === "" ? null : workModel,
      salaryMinimum:
        salaryMinimumInput.trim() === "" || Number.isNaN(Number(salaryMinimumInput))
          ? null
          : Math.max(0, Math.floor(Number(salaryMinimumInput))),
      requireSalary,
      postedWithinDays: postedWithinDays === "" ? null : Number(postedWithinDays),
    }),
    [keywordMode, keywords, excludeKeywords, excludeCompanies, workModel, salaryMinimumInput, requireSalary, postedWithinDays],
  );

  const filtersActive =
    keywords.length > 0 ||
    excludeKeywords.length > 0 ||
    excludeCompanies.length > 0 ||
    workModel !== "" ||
    filters.salaryMinimum !== null ||
    requireSalary ||
    postedWithinDays !== "";

  const clearFilters = useCallback(() => {
    setKeywords([]);
    setKeywordInput("");
    setExcludeKeywords([]);
    setExcludeInput("");
    setExcludeCompanies([]);
    setExcludeCompanyInput("");
    setWorkModel("");
    setSalaryMinimumInput("");
    setRequireSalary(false);
    setPostedWithinDays("");
  }, []);

  const unified = useMemo(() => {
    if (results === null) return null;
    return dedupeAcrossBoards(
      results.flatMap((result) =>
        result.hits.map((hit) => ({
          board: result.board,
          boardName: result.boardName,
          hit: { job: hit.job, publishedOn: hit.publishedOn, closesOn: hit.closesOn },
          saveToken: hit.saveToken,
        })),
      ),
    );
  }, [results]);

  const visibleUnified = useMemo(() => {
    if (unified === null) return null;
    const filtered = filtersActive ? applyUnifiedFilters(unified, filters) : [...unified];
    if (sort === "newest") {
      filtered.sort((a, b) => {
        if (a.publishedOn === b.publishedOn) return 0;
        if (a.publishedOn === null) return 1;
        if (b.publishedOn === null) return -1;
        return a.publishedOn < b.publishedOn ? 1 : -1;
      });
    } else if (sort === "salary") {
      filtered.sort((a, b) => {
        const ca = salaryCeiling(a.job.salaryText);
        const cb = salaryCeiling(b.job.salaryText);
        if (ca === cb) return 0;
        if (ca === null) return 1;
        if (cb === null) return -1;
        return cb - ca;
      });
    }
    return filtered;
  }, [unified, filters, filtersActive, sort]);

  const totalHits = (results ?? []).reduce((sum, entry) => sum + entry.hits.length, 0);
  const everyBoardFailed = results !== null && results.length === 0 && failures.length > 0;
  const locationUnsupported = selectedBoards.filter((board) => !board.supportsLocation);
  const hiddenByFilters =
    unified !== null && visibleUnified !== null ? unified.length - visibleUnified.length : 0;

  const generalSources = sources.filter((s) => s.focus === "general" && s.status !== "live");
  const marketingSources = sources.filter((s) => s.focus === "marketing" && s.status !== "live");

  const addChip = (raw: string, list: readonly string[], set: (next: readonly string[]) => void) => {
    const value = raw.trim();
    if (value.length === 0 || value.length > 80) return;
    if (list.some((entry) => entry.toLowerCase() === value.toLowerCase())) return;
    if (list.length >= 16) return;
    set([...list, value]);
  };

  const renderSaveButton = (key: string, board: string, job: Hit["job"], saveToken: string) => {
    const state = saves[key] ?? "idle";
    return (
      <button
        type="button"
        onClick={() => void saveHit(board, job, saveToken, key)}
        disabled={state === "saving" || state === "saved" || state === "already" || state === "expired"}
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
                : state === "expired"
                  ? "Search again to save"
                : "Save"}
      </button>
    );
  };

  const boardTotalsLine = (result: BoardResult) =>
    `${result.locationApplied ? "" : "Place not applied on this board. "}${result.totalAvailable === null
      ? `Showing ${result.hits.length}. This board does not report a total.`
      : `Showing ${result.hits.length} of ${result.totalAvailable} the board reports.`}`;

  return (
    <div className="space-y-6">
      <Card>
        <SectionTitle
          title="Search job boards"
          description="Queries the connected boards live. Results are not stored until you save one."
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
            Searching {selectedBoards.length} {selectedBoards.length === 1 ? "board" : "boards"}:{" "}
            {selectedBoards.map((board) => `${board.name} (${board.coverage})`).join(", ")}.
          </p>
        ) : null}

        {location.trim().length > 0 && locationUnsupported.length > 0 ? (
          <p className="mt-2 text-xs text-[var(--muted)]">
            {locationUnsupported.map((board) => board.name).join(", ")} does not expose a
            free-text place filter, so its results use the keyword only. The other boards apply
            the place.
          </p>
        ) : null}

        {/* ── Result filters ─────────────────────────────────────────── */}
        <fieldset className="mt-4 rounded-md border border-[var(--border)] p-3">
          <legend className="px-1 text-xs font-medium text-[var(--muted)]">Filters</legend>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block text-xs">
              <span className="text-[var(--muted)]">Must contain ({keywordMode.toUpperCase()})</span>
              <div className="mt-1 flex gap-2">
                <input
                  type="text"
                  value={keywordInput}
                  onChange={(event) => setKeywordInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") {
                      event.preventDefault();
                      addChip(keywordInput, keywords, setKeywords);
                      setKeywordInput("");
                    }
                  }}
                  placeholder="Add keyword, press Enter"
                  className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
                />
                <button
                  type="button"
                  onClick={() => setKeywordMode((mode) => (mode === "and" ? "or" : "and"))}
                  className="shrink-0 rounded-md border border-[var(--border)] px-2 py-1 text-xs"
                  title="Toggle whether every keyword must match (AND) or any may (OR)"
                >
                  {keywordMode === "and" ? "AND" : "OR"}
                </button>
              </div>
            </label>
            <label className="block text-xs">
              <span className="text-[var(--muted)]">Exclude keywords</span>
              <input
                type="text"
                value={excludeInput}
                onChange={(event) => setExcludeInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addChip(excludeInput, excludeKeywords, setExcludeKeywords);
                    setExcludeInput("");
                  }
                }}
                placeholder="Add word to exclude, press Enter"
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs">
              <span className="text-[var(--muted)]">Exclude companies</span>
              <input
                type="text"
                value={excludeCompanyInput}
                onChange={(event) => setExcludeCompanyInput(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    addChip(excludeCompanyInput, excludeCompanies, setExcludeCompanies);
                    setExcludeCompanyInput("");
                  }
                }}
                placeholder="Add company, press Enter"
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs">
              <span className="text-[var(--muted)]">Work model</span>
              <select
                value={workModel}
                onChange={(event) => setWorkModel(event.target.value as typeof workModel)}
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
              >
                <option value="">Any (unlabeled kept)</option>
                <option value="remote">Remote</option>
                <option value="hybrid">Hybrid</option>
                <option value="onsite">On-site</option>
              </select>
            </label>
            <label className="block text-xs">
              <span className="text-[var(--muted)]">Salary at least</span>
              <input
                type="number"
                min={0}
                value={salaryMinimumInput}
                onChange={(event) => setSalaryMinimumInput(event.target.value)}
                placeholder="e.g. 90000"
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
              />
            </label>
            <label className="block text-xs">
              <span className="text-[var(--muted)]">Posted within</span>
              <select
                value={postedWithinDays}
                onChange={(event) => setPostedWithinDays(event.target.value as typeof postedWithinDays)}
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
              >
                <option value="">Any time (undated kept)</option>
                <option value="1">1 day</option>
                <option value="3">3 days</option>
                <option value="7">7 days</option>
                <option value="14">14 days</option>
                <option value="30">30 days</option>
              </select>
            </label>
          </div>
          <label className="mt-3 flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={requireSalary}
              onChange={(event) => setRequireSalary(event.target.checked)}
            />
            Only show postings that state a salary
          </label>

          {filtersActive ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              {keywords.map((word) => (
                <Chip
                  key={`kw-${word}`}
                  label={`${keywordMode.toUpperCase()}: ${word}`}
                  onRemove={() => setKeywords(keywords.filter((entry) => entry !== word))}
                />
              ))}
              {excludeKeywords.map((word) => (
                <Chip
                  key={`ex-${word}`}
                  label={`not: ${word}`}
                  onRemove={() => setExcludeKeywords(excludeKeywords.filter((entry) => entry !== word))}
                />
              ))}
              {excludeCompanies.map((name) => (
                <Chip
                  key={`exc-${name}`}
                  label={`not company: ${name}`}
                  onRemove={() => setExcludeCompanies(excludeCompanies.filter((entry) => entry !== name))}
                />
              ))}
              {workModel !== "" ? <Chip label={workModel} onRemove={() => setWorkModel("")} /> : null}
              {filters.salaryMinimum !== null ? (
                <Chip label={`salary ≥ ${filters.salaryMinimum}`} onRemove={() => setSalaryMinimumInput("")} />
              ) : null}
              {requireSalary ? <Chip label="salary stated" onRemove={() => setRequireSalary(false)} /> : null}
              {postedWithinDays !== "" ? (
                <Chip label={`≤ ${postedWithinDays}d old`} onRemove={() => setPostedWithinDays("")} />
              ) : null}
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-md border border-[var(--border)] px-2 py-0.5 text-xs"
              >
                Clear all filters
              </button>
            </div>
          ) : null}
        </fieldset>

        {/* ── Source catalogue ───────────────────────────────────────── */}
        {boards !== null ? (
          <details className="mt-4 rounded-md border border-[var(--border)] p-3">
            <summary className="cursor-pointer text-sm font-medium">
              Sources ({boards.length} searched live
              {sources.length > 0 ? ` · ${sources.length} in the catalogue` : ""})
            </summary>
            <div className="mt-3 space-y-4">
              <div>
                <p className="text-xs font-medium text-[var(--muted)]">
                  Connected boards — searched live on every search
                </p>
                <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                  {boards.map((board) => (
                    <li key={board.key}>
                      <label className="flex items-start gap-2 text-sm">
                        <input
                          type="checkbox"
                          checked={!deselected.has(board.key)}
                          onChange={(event) => {
                            setDeselected((current) => {
                              const next = new Set(current);
                              if (event.target.checked) next.delete(board.key);
                              else next.add(board.key);
                              return next;
                            });
                          }}
                          className="mt-0.5"
                        />
                        <span>
                          {board.name}
                          <span className="block text-xs text-[var(--muted)]">{board.summary}</span>
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
              {[
                { title: "More general sources", entries: generalSources },
                { title: "Marketing-focused sources", entries: marketingSources },
              ].map((group) =>
                group.entries.length === 0 ? null : (
                  <div key={group.title}>
                    <p className="text-xs font-medium text-[var(--muted)]">{group.title}</p>
                    <ul className="mt-2 grid gap-1 sm:grid-cols-2">
                      {group.entries.map((source) => (
                        <li key={source.key} className="flex items-start justify-between gap-2 text-sm">
                          <span className="min-w-0">
                            {source.name}
                            <span className="block text-xs text-[var(--muted)]">{source.note}</span>
                          </span>
                          <span className="shrink-0 text-right">
                            {source.status === "needs_credentials" ? (
                              <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]">
                                Not Connected
                              </span>
                            ) : null}
                            {source.searchUrl !== undefined ? (
                              <a
                                href={fillLinkTemplate(source.searchUrl, text, location)}
                                target="_blank"
                                rel="noreferrer noopener"
                                className="ml-2 text-xs underline underline-offset-2"
                              >
                                Open site ↗
                              </a>
                            ) : null}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ),
              )}
            </div>
          </details>
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

      {results === null ? null : everyBoardFailed ? (
        <EmptyState
          title="No board completed the search"
          description="Every board reported a failure. Nothing here is an empty-result claim; try again shortly."
        />
      ) : totalHits === 0 ? (
        <EmptyState
          title="No postings matched"
          description="The boards answered and had nothing for this search. Try a broader term or a different place."
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2" role="group" aria-label="Result view">
              <button
                type="button"
                onClick={() => setView("unified")}
                aria-pressed={view === "unified"}
                className={`rounded-md border border-[var(--border)] px-3 py-1.5 text-sm ${view === "unified" ? "bg-[var(--accent)] text-[var(--accent-contrast)]" : ""}`}
              >
                Unified
              </button>
              <button
                type="button"
                onClick={() => setView("byBoard")}
                aria-pressed={view === "byBoard"}
                className={`rounded-md border border-[var(--border)] px-3 py-1.5 text-sm ${view === "byBoard" ? "bg-[var(--accent)] text-[var(--accent-contrast)]" : ""}`}
              >
                By board
              </button>
            </div>
            {view === "unified" ? (
              <label className="text-sm">
                <span className="mr-2 text-xs text-[var(--muted)]">Sort</span>
                <select
                  value={sort}
                  onChange={(event) => setSort(event.target.value as SortOrder)}
                  className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm"
                >
                  <option value="returned">As returned</option>
                  <option value="newest">Newest first</option>
                  <option value="salary">Highest stated salary</option>
                </select>
              </label>
            ) : null}
          </div>

          {view === "unified" && visibleUnified !== null ? (
            <div data-testid="unified-results">
              <Card>
                <SectionTitle
                  title={`${visibleUnified.length} unique ${visibleUnified.length === 1 ? "posting" : "postings"}`}
                  description={`Deduplicated from ${totalHits} board ${totalHits === 1 ? "result" : "results"}. ${(results ?? [])
                    .map((result) => `${result.boardName}: ${boardTotalsLine(result)}`)
                    .join(" ")}`}
                />
                {hiddenByFilters > 0 ? (
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    {hiddenByFilters} {hiddenByFilters === 1 ? "posting is" : "postings are"} hidden by
                    your filters.{" "}
                    <button type="button" onClick={clearFilters} className="underline underline-offset-2">
                      Clear all filters
                    </button>
                  </p>
                ) : null}
                {visibleUnified.length === 0 ? (
                  <p className="mt-3 text-sm text-[var(--muted)]">
                    Every result is hidden by the filters above — the boards did return{" "}
                    {totalHits} {totalHits === 1 ? "posting" : "postings"}.
                  </p>
                ) : (
                  <ul className="mt-4 space-y-3">
                    {visibleUnified.map((card) => {
                      const key = unifiedKey(card);
                      const primary = card.sources[card.primarySourceIndex]!;
                      const saveError = saveErrors[key] ?? null;
                      return (
                        <li key={key} className="rounded-md border border-[var(--border)] p-3">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="font-medium">
                                {card.job.url === null ? (
                                  card.job.title
                                ) : (
                                  <a
                                    href={card.job.url}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    className="underline underline-offset-2"
                                  >
                                    {card.job.title}
                                  </a>
                                )}
                                {isNew(card.publishedOn) ? (
                                  <span className="ml-2 rounded-full border border-[var(--border)] px-1.5 py-0.5 align-middle text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
                                    New
                                  </span>
                                ) : null}
                              </p>
                              <p className="text-sm text-[var(--muted)]">
                                {card.job.company}
                                {card.job.location === null ? "" : ` · ${card.job.location}`}
                                {card.job.workModel === null ? "" : ` · ${card.job.workModel}`}
                                {card.job.salaryText === null ? "" : ` · ${card.job.salaryText}`}
                                {card.publishedOn === null ? "" : ` · posted ${card.publishedOn}`}
                                {card.closesOn === null ? "" : ` · closes ${card.closesOn}`}
                              </p>
                              <p className="mt-1 flex flex-wrap gap-1.5">
                                {card.sources.map((source, index) => (
                                  <a
                                    key={`${source.board}-${index}`}
                                    href={source.url ?? undefined}
                                    target="_blank"
                                    rel="noreferrer noopener"
                                    className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]"
                                  >
                                    via {source.boardName}
                                  </a>
                                ))}
                              </p>
                            </div>
                            {renderSaveButton(key, primary.board, card.job, primary.saveToken)}
                          </div>
                          {saveError !== null ? (
                            <div className="mt-3">
                              <Notice tone="warning">{saveError}</Notice>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
            </div>
          ) : (
            (results ?? []).map((result) => (
              <div key={result.board} data-testid="search-result-card">
              <Card>
                <SectionTitle
                  title={result.boardName}
                  description={boardTotalsLine(result)}
                />
                {result.hits.length === 0 ? (
                  <p className="mt-3 text-sm text-[var(--muted)]">Nothing from this board.</p>
                ) : (
                  <ul className="mt-4 space-y-3">
                    {result.hits.map((hit) => {
                      const key = hitKey(result.board, hit);
                      const saveError = saveErrors[key] ?? null;
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
                            {renderSaveButton(key, result.board, hit.job, hit.saveToken)}
                          </div>
                          {saveError !== null ? (
                            <div className="mt-3">
                              <Notice tone="warning">{saveError}</Notice>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </Card>
              </div>
            ))
          )}
        </>
      )}
    </div>
  );
}
