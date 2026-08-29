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

type SortOrder = "returned" | "newest" | "salary" | "match";

const UNIFIED_PAGE_SIZE = 25;

/** The server-computed AI match, verbatim from the recorded-facts evaluator. */
type MatchView = {
  score: number;
  reasons: string[];
  gaps: string[];
  threshold: number;
  qualified: boolean;
  excluded: string | null;
};

type UnifiedCard = UnifiedHit & { match?: MatchView | null };

type MatchBasis =
  | { computed: true; method: string }
  | { computed: false; reason: string };

type SavedSearchQuery = {
  text?: string;
  location?: string | null;
  boards?: string[];
  sort?: SortOrder;
  filters?: {
    keywordMode?: "and" | "or";
    keywords?: string[];
    excludeKeywords?: string[];
    excludeCompanies?: string[];
    workModel?: "remote" | "hybrid" | "onsite" | null;
    salaryMinimum?: number | null;
    requireSalary?: boolean;
    postedWithinDays?: number | null;
    minimumScore?: number | null;
  };
};

type SavedSearchView = {
  id: string;
  name: string;
  query: SavedSearchQuery;
  lastRunAt: string | null;
  /** The search's email alert, when one is active. */
  alert?: { cadence: "asap" | "daily" | "weekly"; lastScannedAt: string | null } | null;
};

type AlertsChannel = { emailConnected: boolean; schedulerConfigured: boolean };

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
  /** The server's unified view, carrying per-card match scores. */
  const [serverUnified, setServerUnified] = useState<UnifiedCard[] | null>(null);
  const [matchBasis, setMatchBasis] = useState<MatchBasis | null>(null);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [saves, setSaves] = useState<Record<string, SaveState>>({});
  const [saveErrors, setSaveErrors] = useState<Record<string, string>>({});

  const [view, setView] = useState<"unified" | "byBoard">("unified");
  const [sort, setSort] = useState<SortOrder>("returned");
  // Cards rendered at once in the unified view. Thirteen boards can answer
  // with hundreds of unique postings; rendering them incrementally keeps the
  // page responsive while the counts above stay the whole truth.
  const [shownCount, setShownCount] = useState(UNIFIED_PAGE_SIZE);

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
  const [minimumScoreInput, setMinimumScoreInput] = useState("");

  // Saved searches, persisted per person under RLS.
  const [savedSearches, setSavedSearches] = useState<SavedSearchView[]>([]);
  const [alertsChannel, setAlertsChannel] = useState<AlertsChannel | null>(null);
  const [savedError, setSavedError] = useState<string | null>(null);
  const [saveSearchName, setSaveSearchName] = useState("");
  const [savedBusy, setSavedBusy] = useState<string | null>(null);

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
    void (async () => {
      try {
        const response = await fetch("/api/job-seeker/saved-searches", { headers: { accept: "application/json" } });
        if (!active) return;
        if (!response.ok) return;
        const payload = (await response.json()) as {
          savedSearches?: SavedSearchView[];
          alertsChannel?: AlertsChannel;
        };
        if (active) {
          setSavedSearches(payload.savedSearches ?? []);
          setAlertsChannel(payload.alertsChannel ?? null);
        }
      } catch {
        // The list stays empty; saving later will surface any real problem.
      }
    })();
    return () => { active = false; };
  }, []);

  const selectedBoards = useMemo(
    () => (boards ?? []).filter((board) => !deselected.has(board.key)),
    [boards, deselected],
  );

  const executeSearch = useCallback(async (
    rawTerm: string,
    rawPlace: string,
    boardKeys: readonly string[] | null,
  ) => {
    const term = rawTerm.trim();
    const place = rawPlace.trim();
    if (term.length === 0 && place.length === 0) {
      setSearchError("Give a search term or a location.");
      return;
    }
    if (boardKeys !== null && boardKeys.length === 0) {
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
    setServerUnified(null);
    setMatchBasis(null);
    setSaves({});
    setSaveErrors({});
    setShownCount(UNIFIED_PAGE_SIZE);

    try {
      const response = await fetch("/api/job-seeker/search", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: term,
          location: place.length === 0 ? null : place,
          limit: 25,
          ...(boardKeys !== null && boards !== null && boardKeys.length < boards.length
            ? { boards: [...boardKeys] }
            : {}),
        }),
      });
      const payload = (await response.json()) as {
        results?: BoardResult[];
        failures?: BoardFailure[];
        unified?: { hits?: UnifiedCard[]; matchBasis?: MatchBasis };
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
      setServerUnified(payload.unified?.hits ?? null);
      setMatchBasis(payload.unified?.matchBasis ?? null);
    } catch {
      if (requestRef.current === ticket) {
        setSearchError("The search could not be run.");
        setResults(null);
        setFailures([]);
      }
    } finally {
      if (requestRef.current === ticket) setRunning(false);
    }
  }, [boards]);

  const runSearch = useCallback(
    () => executeSearch(text, location, boards === null ? null : selectedBoards.map((b) => b.key)),
    [executeSearch, text, location, boards, selectedBoards],
  );

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
    postedWithinDays !== "" ||
    minimumScoreInput.trim() !== "";

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
    setMinimumScoreInput("");
  }, []);

  const unified = useMemo<UnifiedCard[] | null>(() => {
    if (results === null) return null;
    // The server's unified view carries the match scores; the local dedupe is
    // the fallback for a response without one, and computes the same grouping
    // because both sides run the same shared module.
    if (serverUnified !== null) return serverUnified;
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
  }, [results, serverUnified]);

  const minimumScore = useMemo(() => {
    const value = Number(minimumScoreInput);
    return minimumScoreInput.trim() === "" || Number.isNaN(value)
      ? null
      : Math.min(100, Math.max(0, Math.floor(value)));
  }, [minimumScoreInput]);

  const visibleUnified = useMemo(() => {
    if (unified === null) return null;
    let filtered = filtersActive ? applyUnifiedFilters(unified, filters) : [...unified];
    if (minimumScore !== null) {
      // No profile means no scores; the input is disabled in that state, so
      // this branch only runs over scored cards.
      filtered = filtered.filter((card) => (card.match?.score ?? -1) >= minimumScore);
    }
    if (sort === "match") {
      filtered.sort((a, b) => (b.match?.score ?? -1) - (a.match?.score ?? -1));
    } else if (sort === "newest") {
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
  }, [unified, filters, filtersActive, sort, minimumScore]);

  // ── Saved searches ────────────────────────────────────────────────────
  const currentQuery = useCallback((): SavedSearchQuery => ({
    text: text.trim(),
    location: location.trim() === "" ? null : location.trim(),
    ...(boards !== null && selectedBoards.length < boards.length
      ? { boards: selectedBoards.map((board) => board.key) }
      : {}),
    sort,
    filters: {
      keywordMode,
      keywords: [...keywords],
      excludeKeywords: [...excludeKeywords],
      excludeCompanies: [...excludeCompanies],
      workModel: workModel === "" ? null : workModel,
      salaryMinimum: filters.salaryMinimum,
      requireSalary,
      postedWithinDays: postedWithinDays === "" ? null : Number(postedWithinDays),
      minimumScore,
    },
  }), [text, location, boards, selectedBoards, sort, keywordMode, keywords, excludeKeywords, excludeCompanies, workModel, filters.salaryMinimum, requireSalary, postedWithinDays, minimumScore]);

  const savedSearchRequest = useCallback(async (
    method: "POST" | "PATCH" | "DELETE",
    body: unknown,
  ): Promise<{ ok: boolean; payload: { savedSearch?: SavedSearchView; deleted?: string; error?: { message?: string } } }> => {
    const response = await fetch("/api/job-seeker/saved-searches", {
      method,
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { ok: response.ok, payload: await response.json() };
  }, []);

  const createSavedSearch = useCallback(async (name: string, query: SavedSearchQuery) => {
    setSavedError(null);
    setSavedBusy("create");
    try {
      const { ok, payload } = await savedSearchRequest("POST", { name, query });
      if (!ok || payload.savedSearch === undefined) {
        setSavedError(payload.error?.message ?? "The search could not be saved.");
        return;
      }
      setSavedSearches((current) => [payload.savedSearch!, ...current]);
      setSaveSearchName("");
    } catch {
      setSavedError("The search could not be saved because the connection failed.");
    } finally {
      setSavedBusy(null);
    }
  }, [savedSearchRequest]);

  const applySavedSearch = useCallback(async (saved: SavedSearchView) => {
    const query = saved.query ?? {};
    const savedFilters = query.filters ?? {};
    setText(query.text ?? "");
    setLocation(query.location ?? "");
    setSort(query.sort ?? "returned");
    setKeywordMode(savedFilters.keywordMode ?? "and");
    setKeywords(savedFilters.keywords ?? []);
    setExcludeKeywords(savedFilters.excludeKeywords ?? []);
    setExcludeCompanies(savedFilters.excludeCompanies ?? []);
    setWorkModel(savedFilters.workModel ?? "");
    setSalaryMinimumInput(savedFilters.salaryMinimum == null ? "" : String(savedFilters.salaryMinimum));
    setRequireSalary(savedFilters.requireSalary ?? false);
    setPostedWithinDays(
      savedFilters.postedWithinDays == null
        ? ""
        : (String(savedFilters.postedWithinDays) as "" | "1" | "3" | "7" | "14" | "30"),
    );
    setMinimumScoreInput(savedFilters.minimumScore == null ? "" : String(savedFilters.minimumScore));
    if (boards !== null && query.boards !== undefined) {
      const wanted = new Set(query.boards);
      setDeselected(new Set(boards.filter((board) => !wanted.has(board.key)).map((board) => board.key)));
    } else {
      setDeselected(new Set());
    }
    setSavedBusy(saved.id);
    try {
      // Record the run, then run: last_run_at is an observation of this.
      void savedSearchRequest("PATCH", { id: saved.id, markRun: true }).then(({ ok, payload }) => {
        if (ok && payload.savedSearch !== undefined) {
          setSavedSearches((current) =>
            current.map((entry) => (entry.id === saved.id ? payload.savedSearch! : entry)));
        }
      }).catch(() => {});
      await executeSearch(
        query.text ?? "",
        query.location ?? "",
        boards === null ? null : query.boards ?? boards.map((board) => board.key),
      );
    } finally {
      setSavedBusy(null);
    }
  }, [boards, executeSearch, savedSearchRequest]);

  const deleteSavedSearch = useCallback(async (id: string) => {
    setSavedError(null);
    setSavedBusy(id);
    try {
      const { ok, payload } = await savedSearchRequest("DELETE", { id });
      if (!ok) {
        setSavedError(payload.error?.message ?? "The saved search could not be deleted.");
        return;
      }
      setSavedSearches((current) => current.filter((entry) => entry.id !== id));
    } catch {
      setSavedError("The saved search could not be deleted because the connection failed.");
    } finally {
      setSavedBusy(null);
    }
  }, [savedSearchRequest]);

  const duplicateSavedSearch = useCallback(async (saved: SavedSearchView) => {
    await createSavedSearch(`${saved.name} (copy)`.slice(0, 120), saved.query);
  }, [createSavedSearch]);

  const setAlert = useCallback(async (saved: SavedSearchView, value: string) => {
    setSavedError(null);
    setSavedBusy(saved.id);
    try {
      const body = value === "off"
        ? { id: saved.id, alert: { off: true as const } }
        : { id: saved.id, alert: { cadence: value as "asap" | "daily" | "weekly" } };
      const { ok, payload } = await savedSearchRequest("PATCH", body);
      if (!ok || payload.savedSearch === undefined) {
        setSavedError(payload.error?.message ?? "The alert could not be changed.");
        return;
      }
      setSavedSearches((current) =>
        current.map((entry) => (entry.id === saved.id ? payload.savedSearch! : entry)));
    } catch {
      setSavedError("The alert could not be changed because the connection failed.");
    } finally {
      setSavedBusy(null);
    }
  }, [savedSearchRequest]);

  const updateSavedSearchQuery = useCallback(async (saved: SavedSearchView) => {
    setSavedError(null);
    setSavedBusy(saved.id);
    try {
      const { ok, payload } = await savedSearchRequest("PATCH", { id: saved.id, query: currentQuery() });
      if (!ok || payload.savedSearch === undefined) {
        setSavedError(payload.error?.message ?? "The saved search could not be updated.");
        return;
      }
      setSavedSearches((current) =>
        current.map((entry) => (entry.id === saved.id ? payload.savedSearch! : entry)));
    } catch {
      setSavedError("The saved search could not be updated because the connection failed.");
    } finally {
      setSavedBusy(null);
    }
  }, [savedSearchRequest, currentQuery]);

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
              <span className="text-[var(--muted)]">Match score at least</span>
              <input
                type="number"
                min={0}
                max={100}
                value={minimumScoreInput}
                onChange={(event) => setMinimumScoreInput(event.target.value)}
                placeholder="e.g. 70"
                disabled={matchBasis !== null && !matchBasis.computed}
                title={matchBasis !== null && !matchBasis.computed
                  ? "Record your Career Profile to score results."
                  : "Computed from your recorded Career Profile."}
                className="mt-1 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-sm disabled:opacity-60"
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
              {minimumScore !== null ? (
                <Chip label={`match ≥ ${minimumScore}`} onRemove={() => setMinimumScoreInput("")} />
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

      <Card>
        <SectionTitle
          title="Saved searches"
          description="Keep a search — term, place, boards, filters and sort — and run it again in one click. Stored to your workspace under row-level security."
        />
        <form
          className="mt-3 flex flex-wrap gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const name = saveSearchName.trim();
            if (name.length === 0) {
              setSavedError("Give the saved search a name.");
              return;
            }
            void createSavedSearch(name, currentQuery());
          }}
        >
          <label className="min-w-0 grow">
            <span className="sr-only">Name for this search</span>
            <input
              type="text"
              value={saveSearchName}
              onChange={(event) => setSaveSearchName(event.target.value)}
              placeholder="Name this search, e.g. Senior marketing, remote, 90k+"
              maxLength={120}
              className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm"
            />
          </label>
          <button
            type="submit"
            disabled={savedBusy === "create"}
            className="rounded-md border border-[var(--border)] px-3 py-2 text-sm disabled:opacity-60"
          >
            {savedBusy === "create" ? "Saving…" : "Save this search"}
          </button>
        </form>
        {savedError !== null ? (
          <div className="mt-3"><Notice tone="warning">{savedError}</Notice></div>
        ) : null}
        {savedSearches.length === 0 ? (
          <p className="mt-3 text-sm text-[var(--muted)]">
            Nothing saved yet. Build a search above and give it a name.
          </p>
        ) : (
          <ul className="mt-3 space-y-2">
            {savedSearches.map((saved) => (
              <li
                key={saved.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-[var(--border)] p-2"
              >
                <span className="min-w-0">
                  <span className="text-sm font-medium">{saved.name}</span>
                  <span className="block text-xs text-[var(--muted)]">
                    {saved.lastRunAt === null
                      ? "Never run"
                      : `Last run ${saved.lastRunAt.slice(0, 10)}`}
                    {saved.alert != null
                      ? ` · alert ${saved.alert.cadence === "asap" ? "as soon as possible" : saved.alert.cadence}`
                      : ""}
                  </span>
                </span>
                <span className="flex shrink-0 flex-wrap items-center gap-1.5">
                  {alertsChannel !== null &&
                  alertsChannel.emailConnected &&
                  alertsChannel.schedulerConfigured ? (
                    <label className="text-xs text-[var(--muted)]">
                      <span className="sr-only">Email alert for {saved.name}</span>
                      <select
                        value={saved.alert?.cadence ?? "off"}
                        onChange={(event) => void setAlert(saved, event.target.value)}
                        disabled={savedBusy !== null}
                        className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs disabled:opacity-60"
                      >
                        <option value="off">Alerts off</option>
                        <option value="asap">Email ASAP</option>
                        <option value="daily">Email daily</option>
                        <option value="weekly">Email weekly</option>
                      </select>
                    </label>
                  ) : alertsChannel !== null ? (
                    <span
                      className="rounded-full border border-[var(--border)] px-2 py-0.5 text-xs text-[var(--muted)]"
                      title={alertsChannel.emailConnected
                        ? "The alert scheduler needs CRON_SECRET set in Vercel."
                        : "Email alerts need JOB_ALERT_EMAIL_FROM plus RESEND_API_KEY (or a dev-stack JOB_ALERT_SMTP_URL)."}
                    >
                      Alerts: Not Connected
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => void applySavedSearch(saved)}
                    disabled={savedBusy !== null}
                    className="rounded-md border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-60"
                  >
                    {savedBusy === saved.id ? "Working…" : "Run"}
                  </button>
                  <button
                    type="button"
                    onClick={() => void updateSavedSearchQuery(saved)}
                    disabled={savedBusy !== null}
                    title="Overwrite this saved search with the search currently built above."
                    className="rounded-md border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-60"
                  >
                    Update to current
                  </button>
                  <button
                    type="button"
                    onClick={() => void duplicateSavedSearch(saved)}
                    disabled={savedBusy !== null}
                    className="rounded-md border border-[var(--border)] px-2 py-1 text-xs disabled:opacity-60"
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    onClick={() => void deleteSavedSearch(saved.id)}
                    disabled={savedBusy !== null}
                    className="rounded-md border border-[var(--border)] px-2 py-1 text-xs text-[var(--danger)] disabled:opacity-60"
                  >
                    Delete
                  </button>
                </span>
              </li>
            ))}
          </ul>
        )}
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
                  {matchBasis?.computed === true ? (
                    <option value="match">Best match</option>
                  ) : null}
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
                {matchBasis !== null ? (
                  <p className="mt-2 text-xs text-[var(--muted)]">
                    {matchBasis.computed
                      ? matchBasis.method
                      : `${matchBasis.reason} Match scores appear once your Career Profile is recorded.`}
                  </p>
                ) : null}
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
                    {visibleUnified.slice(0, shownCount).map((card) => {
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
                                {card.match != null ? (
                                  <span
                                    className={`rounded-full border px-2 py-0.5 text-xs font-medium ${card.match.qualified ? "border-[var(--accent)] text-[var(--accent)]" : "border-[var(--border)] text-[var(--muted)]"}`}
                                    title={`Threshold ${card.match.threshold}. Computed from your recorded Career Profile.`}
                                  >
                                    Match {card.match.score}
                                  </span>
                                ) : null}
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
                              {card.match != null &&
                              (card.match.reasons.length > 0 || card.match.gaps.length > 0) ? (
                                <details className="mt-1 text-xs text-[var(--muted)]">
                                  <summary className="cursor-pointer">Why this match score</summary>
                                  {card.match.excluded !== null ? (
                                    <p className="mt-1">Excluded: matches your exclusion “{card.match.excluded}”.</p>
                                  ) : null}
                                  {card.match.reasons.length > 0 ? (
                                    <ul className="mt-1 list-disc pl-4">
                                      {card.match.reasons.slice(0, 4).map((reason) => (
                                        <li key={reason}>{reason}</li>
                                      ))}
                                    </ul>
                                  ) : null}
                                  {card.match.gaps.length > 0 ? (
                                    <ul className="mt-1 list-disc pl-4">
                                      {card.match.gaps.slice(0, 3).map((gap) => (
                                        <li key={gap}>Gap: {gap}</li>
                                      ))}
                                    </ul>
                                  ) : null}
                                </details>
                              ) : null}
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
                {visibleUnified.length > shownCount ? (
                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button
                      type="button"
                      data-testid="unified-show-more"
                      onClick={() => setShownCount((count) => count + UNIFIED_PAGE_SIZE)}
                      className="rounded-md border border-[var(--border)] px-3 py-1.5 text-sm hover:bg-[var(--surface-2)]"
                    >
                      Show {Math.min(UNIFIED_PAGE_SIZE, visibleUnified.length - shownCount)} more
                    </button>
                    <span className="text-xs text-[var(--muted)]">
                      Showing {Math.min(shownCount, visibleUnified.length)} of {visibleUnified.length}
                    </span>
                  </div>
                ) : null}
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
