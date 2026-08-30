import {
  COMPANY_MAX,
  DESCRIPTION_MAX,
  EXTERNAL_ID_MAX,
  ImportSourceError,
  LOCATION_MAX,
  MAX_IMPORT_POSTINGS,
  TITLE_MAX,
  bounded,
  boundedOrNull,
  externalIdOrNull,
  htmlToText,
  httpsUrlOrNull,
  timedFetch,
  type FetchedPostings,
  type ImportedJob,
} from "@/lib/job-seeker/boards/contract";

/**
 * Job boards that publish everyone's postings rather than one company's.
 *
 * These differ from the ATS adapters in what a person supplies: not "which
 * employer" but "what am I looking for". The identifier is therefore a search
 * term, and `assertIdentifier` is deliberately not used — its pattern forbids
 * spaces, which would reject "react developer", the most ordinary thing
 * anyone would type.
 *
 * Every posting still carries its own real employer. `FetchedPostings.company`
 * names the board instead, because there is no single company and putting the
 * search term there would report "imported 12 postings from react developer".
 *
 * ## Attribution these boards require, and where it is honoured
 *
 * Two of them attach conditions to API use, and they are met by construction
 * rather than by intention:
 *
 * - **Remote OK**: "Please link back (with follow, and without nofollow!) to
 *   the URL on Remote OK and mention Remote OK as a source". Every posting
 *   stores the provider's own `url`, and the jobs panel renders it as an
 *   ordinary followed anchor — this repository adds no `nofollow` anywhere.
 *   The `source` column records `remoteok`, which is the credit. Their logo is
 *   a registered trademark and is not used.
 * - **Jobicy**: "ensure Jobicy is clearly credited with a direct link to the
 *   source, and all application buttons redirect to the original job URL".
 *   Same mechanism: the stored `url` is Jobicy's own posting URL, never a
 *   rewritten one.
 *
 * Both are recorded in `THIRD_PARTY_NOTICES.md` so a later change that strips
 * job links has somewhere to discover what it would be breaking.
 */

/** A search term: free text, bounded, and not empty once trimmed. */
export function assertSearchTerm(value: string): string {
  const term = value.trim().replace(/\s+/g, " ");
  if (term.length === 0 || term.length > 120) {
    throw new ImportSourceError(
      "identifier_invalid",
      "Give a search term of up to 120 characters — a job title, a skill, or a keyword.",
    );
  }
  return term;
}

async function aggregatorJson<T>(url: string, board: string): Promise<T> {
  const response = await timedFetch(url);
  // Same reasoning as the company boards: a rate limit is a wait, not a fault.
  if (response.status === 429) {
    throw new ImportSourceError(
      "provider_error",
      `${board} is rate limiting requests right now. Wait a minute and search again.`,
    );
  }
  if (!response.ok) {
    throw new ImportSourceError("provider_error", `${board} answered HTTP ${response.status}.`);
  }
  const body = (await response.json().catch(() => null)) as T | null;
  if (body === null) {
    throw new ImportSourceError("provider_error", `${board} answered with something that is not JSON.`);
  }
  return body;
}

/**
 * A board returning nothing for a term is a real answer, not a failure.
 *
 * Every adapter here returns an empty posting list rather than throwing, so
 * "no remote React roles today" reads as an empty import instead of an error
 * that suggests the integration is broken.
 */
function emptyResult(board: string): FetchedPostings {
  return { company: board, totalAvailable: 0, postings: [] };
}

/* ── Remotive ───────────────────────────────────────────────────────────── */

type RemotiveJob = {
  id?: unknown;
  title?: unknown;
  company_name?: unknown;
  candidate_required_location?: unknown;
  job_type?: unknown;
  url?: unknown;
  salary?: unknown;
  description?: unknown;
};

export async function fetchRemotiveJobs(identifier: string): Promise<FetchedPostings> {
  const term = assertSearchTerm(identifier);
  const body = await aggregatorJson<{ jobs?: unknown }>(
    `https://remotive.com/api/remote-jobs?search=${encodeURIComponent(term)}&limit=${MAX_IMPORT_POSTINGS}`,
    "Remotive",
  );
  const jobs = Array.isArray(body.jobs) ? body.jobs : [];
  if (jobs.length === 0) return emptyResult("Remotive");

  const postings = jobs.slice(0, MAX_IMPORT_POSTINGS).flatMap((entry): ImportedJob[] => {
    const job = entry as RemotiveJob;
    const title = boundedOrNull(job.title, TITLE_MAX);
    const company = boundedOrNull(job.company_name, COMPANY_MAX);
    const id = externalIdOrNull(job.id, EXTERNAL_ID_MAX);
    if (title === null || company === null || id === null) return [];
    return [{
      externalId: id,
      url: httpsUrlOrNull(job.url),
      title,
      company,
      // Remotive sends "" for a job with no stated pay; that is absent, not a
      // salary of nothing.
      salaryText: boundedOrNull(job.salary, 200),
      location: boundedOrNull(job.candidate_required_location, LOCATION_MAX),
      // Every posting on Remotive is a remote posting; that is the board.
      workModel: "remote",
      description: boundedOrNull(
        typeof job.description === "string" ? htmlToText(job.description) : null,
        DESCRIPTION_MAX,
      ),
    }];
  });

  return { company: "Remotive", totalAvailable: jobs.length, postings };
}

/* ── Arbeitnow ──────────────────────────────────────────────────────────── */

type ArbeitnowJob = {
  slug?: unknown;
  title?: unknown;
  company_name?: unknown;
  location?: unknown;
  remote?: unknown;
  url?: unknown;
  description?: unknown;
};

/*
 * How many Arbeitnow pages one search may walk.
 *
 * Its board endpoint takes no query parameter, so the term is matched here
 * rather than by the API. Reading only the first page made that worse than it
 * had to be: a term with matches on page three returned nothing at all, and
 * the board looked empty when it was not. Pagination exists (`?page=N`, with
 * a `links.next`), so the search walks it — bounded, because "no query
 * parameter" must not become "read the whole board on every keystroke".
 *
 * Three pages is roughly 525 postings at the ~175 per page observed live, and
 * the walk stops early as soon as it has more matches than one import can
 * take. Five was tried first and Arbeitnow rate-limited the walk, which is the
 * reason for both this number and the partial-result rule below.
 */
const ARBEITNOW_MAX_PAGES = 3;

export async function fetchArbeitnowJobs(identifier: string): Promise<FetchedPostings> {
  const term = assertSearchTerm(identifier).toLowerCase();

  const matches = (entries: readonly unknown[]) => entries.filter((entry) => {
    const job = entry as ArbeitnowJob;
    const haystack = [job.title, job.company_name, job.location]
      .filter((part): part is string => typeof part === "string")
      .join(" ")
      .toLowerCase();
    return haystack.includes(term);
  });

  const matched: unknown[] = [];
  for (let page = 1; page <= ARBEITNOW_MAX_PAGES; page += 1) {
    let body: { data?: unknown; links?: { next?: unknown } };
    try {
      body = await aggregatorJson<{ data?: unknown; links?: { next?: unknown } }>(
        `https://www.arbeitnow.com/api/job-board-api?page=${page}`,
        "Arbeitnow",
      );
    } catch (error) {
      /*
       * A later page failing is not the search failing. Arbeitnow rate-limits
       * a quick walk, and throwing there would discard a first page that
       * already answered the question — so the walk stops and returns what it
       * has. The first page is different: with nothing in hand there is
       * nothing to degrade to, and the caller needs the real reason.
       */
      if (page === 1) throw error;
      break;
    }
    const entries = Array.isArray(body.data) ? body.data : [];
    if (entries.length === 0) break;
    matched.push(...matches(entries));
    // Enough to fill an import, or the board says there is nothing after this.
    if (matched.length >= MAX_IMPORT_POSTINGS) break;
    if (typeof body.links?.next !== "string" || body.links.next.length === 0) break;
  }

  /*
   * `totalAvailable` is how many of the postings actually read matched, not
   * how many exist on Arbeitnow. The walk is bounded, so this adapter still
   * cannot know the latter and does not claim to.
   */
  if (matched.length === 0) return emptyResult("Arbeitnow");

  const postings = matched.slice(0, MAX_IMPORT_POSTINGS).flatMap((entry): ImportedJob[] => {
    const job = entry as ArbeitnowJob;
    const title = boundedOrNull(job.title, TITLE_MAX);
    const company = boundedOrNull(job.company_name, COMPANY_MAX);
    const slug = boundedOrNull(job.slug, EXTERNAL_ID_MAX);
    if (title === null || company === null || slug === null) return [];
    const location = boundedOrNull(job.location, LOCATION_MAX);
    return [{
      externalId: slug,
      url: httpsUrlOrNull(job.url),
      title,
      company,
      salaryText: null,
      location,
      workModel: job.remote === true ? "remote" : null,
      description: boundedOrNull(
        typeof job.description === "string" ? htmlToText(job.description) : null,
        DESCRIPTION_MAX,
      ),
    }];
  });

  return { company: "Arbeitnow", totalAvailable: matched.length, postings };
}

/* ── Jobicy ─────────────────────────────────────────────────────────────── */

type JobicyJob = {
  id?: unknown;
  jobTitle?: unknown;
  companyName?: unknown;
  jobGeo?: unknown;
  jobType?: unknown;
  url?: unknown;
  jobDescription?: unknown;
  annualSalaryMin?: unknown;
  annualSalaryMax?: unknown;
  salaryCurrency?: unknown;
};

function jobicySalary(job: JobicyJob): string | null {
  const min = typeof job.annualSalaryMin === "number" ? job.annualSalaryMin : null;
  const max = typeof job.annualSalaryMax === "number" ? job.annualSalaryMax : null;
  if (min === null && max === null) return null;
  const currency = typeof job.salaryCurrency === "string" ? `${job.salaryCurrency} ` : "";
  const range = min !== null && max !== null ? `${min}–${max}` : `${min ?? max}`;
  return bounded(`${currency}${range}`, 200);
}

export async function fetchJobicyJobs(identifier: string): Promise<FetchedPostings> {
  const term = assertSearchTerm(identifier);
  const body = await aggregatorJson<{ jobs?: unknown }>(
    `https://jobicy.com/api/v2/remote-jobs?count=${MAX_IMPORT_POSTINGS}&tag=${encodeURIComponent(term)}`,
    "Jobicy",
  );
  const jobs = Array.isArray(body.jobs) ? body.jobs : [];
  if (jobs.length === 0) return emptyResult("Jobicy");

  const postings = jobs.slice(0, MAX_IMPORT_POSTINGS).flatMap((entry): ImportedJob[] => {
    const job = entry as JobicyJob;
    const title = boundedOrNull(job.jobTitle, TITLE_MAX);
    const company = boundedOrNull(job.companyName, COMPANY_MAX);
    const id = externalIdOrNull(job.id, EXTERNAL_ID_MAX);
    if (title === null || company === null || id === null) return [];
    return [{
      externalId: id,
      // Jobicy's terms require the link to be their posting URL, unrewritten.
      url: httpsUrlOrNull(job.url),
      title,
      company,
      salaryText: jobicySalary(job),
      location: boundedOrNull(job.jobGeo, LOCATION_MAX),
      workModel: "remote",
      description: boundedOrNull(
        typeof job.jobDescription === "string" ? htmlToText(job.jobDescription) : null,
        DESCRIPTION_MAX,
      ),
    }];
  });

  return { company: "Jobicy", totalAvailable: jobs.length, postings };
}

/* ── Remote OK ──────────────────────────────────────────────────────────── */

type RemoteOkJob = {
  id?: unknown;
  position?: unknown;
  company?: unknown;
  location?: unknown;
  url?: unknown;
  description?: unknown;
  tags?: unknown;
  salary_min?: unknown;
  salary_max?: unknown;
  legal?: unknown;
};

function remoteOkSalary(job: RemoteOkJob): string | null {
  const min = typeof job.salary_min === "number" && job.salary_min > 0 ? job.salary_min : null;
  const max = typeof job.salary_max === "number" && job.salary_max > 0 ? job.salary_max : null;
  if (min === null && max === null) return null;
  return bounded(`USD ${min !== null && max !== null ? `${min}–${max}` : `${min ?? max}`}`, 200);
}

/**
 * Remote OK, filtered locally over a fixed window.
 *
 * `/api` takes no query parameter: it answers with the latest ~100 postings
 * and nothing else, so the search term is applied here rather than by the
 * provider. `totalAvailable` therefore counts matches *within that window*,
 * not Remote OK's whole catalogue — which this adapter cannot see and does not
 * claim to. The same caveat as Arbeitnow, for the same reason.
 *
 * The practical consequence is worth stating because it looks like a defect:
 * a perfectly working call can return zero. Probing on 2026-08-29, the window
 * held 16 postings matching "engineer" and 24 matching "sales", but **none**
 * matching "developer" — that term is simply absent from the most recent
 * hundred. An empty result here means "not in the latest hundred", not
 * "Remote OK has nothing".
 */
export async function fetchRemoteOkJobs(identifier: string): Promise<FetchedPostings> {
  const term = assertSearchTerm(identifier).toLowerCase();
  const body = await aggregatorJson<unknown>("https://remoteok.com/api", "Remote OK");
  if (!Array.isArray(body)) {
    throw new ImportSourceError("provider_error", "Remote OK answered with an unexpected shape.");
  }

  /*
   * The first element is not a job. Remote OK puts its API terms of service
   * there — an object carrying `legal` and no posting fields — so a reader
   * that maps the array straight through imports a job titled `undefined`.
   * Filtering on the absence of an id is more durable than skipping index 0,
   * because it survives them adding a second metadata entry.
   */
  const jobs = body.filter((entry) => {
    const job = entry as RemoteOkJob;
    return job.legal === undefined && job.id !== undefined && job.position !== undefined;
  });

  const matched = jobs.filter((entry) => {
    const job = entry as RemoteOkJob;
    const tags = Array.isArray(job.tags) ? job.tags.filter((t): t is string => typeof t === "string") : [];
    const haystack = [job.position, job.company, job.location, ...tags]
      .filter((part): part is string => typeof part === "string")
      .join(" ")
      .toLowerCase();
    return haystack.includes(term);
  });
  if (matched.length === 0) return emptyResult("Remote OK");

  const postings = matched.slice(0, MAX_IMPORT_POSTINGS).flatMap((entry): ImportedJob[] => {
    const job = entry as RemoteOkJob;
    const title = boundedOrNull(job.position, TITLE_MAX);
    const company = boundedOrNull(job.company, COMPANY_MAX);
    const id = externalIdOrNull(job.id, EXTERNAL_ID_MAX);
    if (title === null || company === null || id === null) return [];
    return [{
      externalId: id,
      // Their terms require the link back to be to the Remote OK URL itself.
      url: httpsUrlOrNull(job.url),
      title,
      company,
      salaryText: remoteOkSalary(job),
      location: boundedOrNull(job.location, LOCATION_MAX),
      workModel: "remote",
      description: boundedOrNull(
        typeof job.description === "string" ? htmlToText(job.description) : null,
        DESCRIPTION_MAX,
      ),
    }];
  });

  return { company: "Remote OK", totalAvailable: matched.length, postings };
}

/* ── Himalayas ──────────────────────────────────────────────────────────── */

type HimalayasJob = {
  guid?: unknown;
  title?: unknown;
  companyName?: unknown;
  locationRestrictions?: unknown;
  applicationLink?: unknown;
  excerpt?: unknown;
  minSalary?: unknown;
  maxSalary?: unknown;
  salaryCurrency?: unknown;
};

/**
 * Himalayas states a salary range without always stating its currency, and
 * without stating its period — the live feed carries `minSalary: 60` beside a
 * null currency, which is an hourly rate rather than an annual one.
 *
 * So the number is reported exactly as given and never dressed up: no invented
 * currency symbol, no assumed period. "60–70" is what the board said; "USD
 * 60,000–70,000/yr" would be this code inventing three facts.
 */
export function himalayasSalary(job: HimalayasJob): string | null {
  const min = typeof job.minSalary === "number" && job.minSalary > 0 ? job.minSalary : null;
  const max = typeof job.maxSalary === "number" && job.maxSalary > 0 ? job.maxSalary : null;
  if (min === null && max === null) return null;
  const currency = typeof job.salaryCurrency === "string" && job.salaryCurrency.trim().length > 0
    ? `${job.salaryCurrency.trim()} `
    : "";
  const range = min !== null && max !== null ? `${min}–${max}` : `${min ?? max}`;
  return bounded(`${currency}${range}`, 200);
}

export async function fetchHimalayasJobs(identifier: string): Promise<FetchedPostings> {
  const term = assertSearchTerm(identifier).toLowerCase();
  const body = await aggregatorJson<{ jobs?: unknown }>(
    `https://himalayas.app/jobs/api?limit=100`,
    "Himalayas",
  );
  const all = Array.isArray(body.jobs) ? body.jobs : [];
  const matched = all.filter((entry) => {
    const job = entry as HimalayasJob;
    const locations = Array.isArray(job.locationRestrictions)
      ? job.locationRestrictions.filter((l): l is string => typeof l === "string")
      : [];
    return [job.title, job.companyName, ...locations]
      .filter((part): part is string => typeof part === "string")
      .join(" ")
      .toLowerCase()
      .includes(term);
  });
  if (matched.length === 0) return emptyResult("Himalayas");

  const postings = matched.slice(0, MAX_IMPORT_POSTINGS).flatMap((entry): ImportedJob[] => {
    const job = entry as HimalayasJob;
    const title = boundedOrNull(job.title, TITLE_MAX);
    const company = boundedOrNull(job.companyName, COMPANY_MAX);
    /*
     * `guid`, not `id`. Himalayas sends `id: null` on every posting in the
     * live feed, so keying on it would drop the entire import silently — the
     * same failure Remotive and Jobicy's numeric ids caused, arriving by a
     * different route. The guid is the posting's canonical URL and is stable.
     */
    const id = boundedOrNull(job.guid, EXTERNAL_ID_MAX);
    if (title === null || company === null || id === null) return [];

    const locations = Array.isArray(job.locationRestrictions)
      ? job.locationRestrictions.filter((l): l is string => typeof l === "string")
      : [];
    return [{
      externalId: id,
      url: httpsUrlOrNull(job.applicationLink) ?? httpsUrlOrNull(job.guid),
      title,
      company,
      salaryText: himalayasSalary(job),
      // An array of permitted countries, not one place. Joined rather than
      // truncated to the first, because "Czechia" alone would misstate a role
      // open across six countries.
      location: locations.length === 0 ? null : bounded(locations.join(", "), LOCATION_MAX),
      workModel: "remote",
      description: boundedOrNull(
        typeof job.excerpt === "string" ? htmlToText(job.excerpt) : null,
        DESCRIPTION_MAX,
      ),
    }];
  });

  return { company: "Himalayas", totalAvailable: matched.length, postings };
}
