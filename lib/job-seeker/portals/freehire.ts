import {
  COMPANY_MAX,
  DESCRIPTION_MAX,
  EXTERNAL_ID_MAX,
  ImportSourceError,
  LOCATION_MAX,
  MAX_IMPORT_POSTINGS,
  SALARY_MAX,
  TITLE_MAX,
  bounded,
  boundedOrNull,
  htmlToText,
  httpsUrlOrNull,
  looksLikeMarkup,
  type FetchedPostings,
  type ImportedJob,
  type JobSearchQuery,
} from "@/lib/job-seeker/portals/contract";

/**
 * freehire.me: keyword job SEARCH, as opposed to reading one company's board.
 *
 * Adapted from `ai-job-search`'s `freehire-search` skill (MIT, Mads Lorentzen —
 * see THIRD_PARTY_NOTICES.md). Upstream this is a Bun CLI a person runs on
 * their own machine and reads as a table; here it is a server-side adapter
 * whose results go through the same evaluate → job → match → application chain
 * as every other recorded posting, so a searched job is indistinguishable from
 * a manually recorded one once stored — except for its `source`, which names
 * where it came from.
 *
 * The endpoint is public and unauthenticated: there is no credential in this
 * file and none is needed. `SOFTWAREFACTORY_FREEHIRE_API_URL` repoints it at a
 * self-hosted instance of the same open-source backend.
 */

const DEFAULT_BASE_URL = "https://freehire.me";
const SEARCH_PATH = "/api/v1/agent/jobs/search";

const FETCH_TIMEOUT_MS = 15_000;
/** One search is one request. Retrying a user-facing read past this turns a
 *  slow provider into a slow page; the honest answer is to say it is slow. */
const MAX_ATTEMPTS = 2;
const RETRY_DELAY_MS = 500;

export const FREEHIRE_MAX_RESULTS = MAX_IMPORT_POSTINGS;

/** The freehire fields this adapter reads; the wire shape carries more. */
type FreehireJob = {
  public_slug?: unknown;
  url?: unknown;
  title?: unknown;
  company?: unknown;
  location?: unknown;
  description?: unknown;
  work_mode?: unknown;
  enrichment?: {
    salary_min?: unknown;
    salary_max?: unknown;
    salary_currency?: unknown;
  };
};

type Envelope = {
  data?: unknown;
  meta?: { total?: unknown };
  error?: unknown;
};

export function freehireBaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  const configured = env.SOFTWAREFACTORY_FREEHIRE_API_URL?.trim();
  return (configured || DEFAULT_BASE_URL).replace(/\/+$/, "");
}

const COUNTRY_PATTERN = /^[a-z]{2}$/;

/**
 * The query string for one search.
 *
 * `description_format=text` is the load-bearing one, verified live: the same
 * posting comes back as `<h2>The Reality</h2>…` under `html` and as prose
 * under `text`. Asking for text is what keeps a description readable in the
 * database and scoreable by `evaluateJob`.
 *
 * `include_description` and `semantic_ratio` are sent and the hosted API now
 * reports both in `meta.ignored_params` — it hydrates descriptions
 * unconditionally and runs keyword search by default. They stay because a
 * self-hosted instance behind `SOFTWAREFACTORY_FREEHIRE_API_URL` may predate
 * those defaults, where dropping them would silently serve the index's
 * truncated preview: a lower skills score for a job that does name your
 * skills, and no sign anything was cut.
 */
export function buildFreehireQuery(query: JobSearchQuery): URLSearchParams {
  const params = new URLSearchParams();
  const keywords = query.keywords.trim();
  if (keywords) params.set("q", keywords);
  params.set("limit", String(Math.min(FREEHIRE_MAX_RESULTS, Math.max(1, Math.trunc(query.limit)))));
  params.set("offset", "0");
  // Keyword search; freehire's semantic index is opt-in and ranks differently.
  params.set("semantic_ratio", "0");
  params.set("include_description", "true");
  params.set("description_format", "text");
  if (query.postedWithinDays !== null && query.postedWithinDays > 0) {
    params.set("posted_within_days", String(Math.trunc(query.postedWithinDays)));
  }
  if (query.workMode) params.set("work_mode", query.workMode);
  const city = query.city?.trim();
  if (city) params.append("cities", city);
  const country = query.country?.trim().toLowerCase();
  if (country && COUNTRY_PATTERN.test(country)) params.append("countries", country);
  return params;
}

/**
 * The search asks for `text`, and a current instance answers with text. A
 * self-hosted instance behind `SOFTWAREFACTORY_FREEHIRE_API_URL` may predate
 * `description_format` and answer with HTML, so markup is normalized when it
 * is actually present — and only then. Running the tag stripper over genuine
 * prose would eat everything between a "<" and the next ">", which in a
 * technical posting is a real sentence ("C++ <-> Python interop").
 */
export function normalizeDescription(value: unknown): string | null {
  const raw = typeof value === "string" ? value : null;
  if (!raw?.trim()) return null;
  const text = looksLikeMarkup(raw) ? htmlToText(raw) : raw.trim();
  return text ? bounded(text, DESCRIPTION_MAX) : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * A salary line, or null. It is built only from figures the posting actually
 * carries — an absent range stays absent rather than becoming "competitive",
 * because `evaluateJob` reads this string for a real number and a filler
 * phrase would score as "no readable figure" while looking like data.
 */
export function formatSalary(enrichment: FreehireJob["enrichment"]): string | null {
  const min = readNumber(enrichment?.salary_min);
  const max = readNumber(enrichment?.salary_max);
  if (min === null && max === null) return null;
  const currency = boundedOrNull(enrichment?.salary_currency, 8);
  const prefix = currency ? `${currency} ` : "";
  const figures = min !== null && max !== null
    ? `${min.toLocaleString("en-US")}–${max.toLocaleString("en-US")}`
    : (min ?? max)!.toLocaleString("en-US");
  return bounded(`${prefix}${figures}`, SALARY_MAX);
}

function readWorkMode(value: unknown, location: string | null): ImportedJob["workModel"] {
  const mode = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (mode === "remote") return "remote";
  if (mode === "hybrid") return "hybrid";
  if (mode === "onsite" || mode === "on-site" || mode === "office") return "onsite";
  return location && /remote/i.test(location) ? "remote" : null;
}

/** One freehire job in the shape `job_seeker_jobs` stores, or nothing. */
export function toImportedJob(job: FreehireJob): ImportedJob[] {
  const title = boundedOrNull(job?.title, TITLE_MAX);
  const externalId = boundedOrNull(job?.public_slug, EXTERNAL_ID_MAX);
  const company = boundedOrNull(job?.company, COMPANY_MAX);
  // A posting with no title, no company, or no stable id cannot be recorded:
  // the title and company are NOT NULL, and the id is what the dedupe index
  // uses to tell a re-run from a second job.
  if (!title || !externalId || !company) return [];
  const location = boundedOrNull(job?.location, LOCATION_MAX);
  return [{
    externalId,
    url: httpsUrlOrNull(job?.url),
    title,
    company,
    salaryText: formatSalary(job?.enrichment),
    location,
    workModel: readWorkMode(job?.work_mode, location),
    description: normalizeDescription(job?.description),
  }];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function timedFetch(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
  } catch {
    throw new ImportSourceError(
      "provider_unreachable",
      "The job search provider did not answer. Try again shortly.",
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Run one search. A 404 here means the endpoint is missing — a self-hosted
 * instance older than the agent search surface — not that the search found
 * nothing, and reporting it as an empty result would hide a misconfiguration
 * behind a plausible "no matches". Rate limits and 5xx get exactly one retry.
 */
export async function searchFreehire(query: JobSearchQuery): Promise<FetchedPostings> {
  const url = `${freehireBaseUrl()}${SEARCH_PATH}?${buildFreehireQuery(query).toString()}`;

  let response: Response | null = null;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    response = await timedFetch(url);
    const transient = response.status === 429 || response.status >= 500;
    if (!transient || attempt === MAX_ATTEMPTS) break;
    await sleep(RETRY_DELAY_MS);
  }
  if (!response) {
    throw new ImportSourceError("provider_unreachable", "The job search provider did not answer.");
  }

  if (response.status === 404) {
    throw new ImportSourceError(
      "source_not_found",
      `The configured job search endpoint (${SEARCH_PATH}) does not exist on this instance.`,
    );
  }
  if (!response.ok) {
    throw new ImportSourceError("provider_error", `The job search provider answered HTTP ${response.status}.`);
  }

  const body = (await response.json().catch(() => null)) as Envelope | null;
  if (!body || !Array.isArray(body.data)) {
    throw new ImportSourceError("provider_error", "The job search provider answered with an unexpected shape.");
  }

  const postings = (body.data as FreehireJob[])
    .slice(0, FREEHIRE_MAX_RESULTS)
    .flatMap(toImportedJob);
  const total = readNumber(body.meta?.total);

  return {
    // A search spans companies, so there is no single company to name. The
    // query is what a person recognizes this result set by.
    company: query.keywords.trim() || "all roles",
    totalAvailable: total !== null && total >= postings.length ? Math.trunc(total) : postings.length,
    postings,
  };
}
