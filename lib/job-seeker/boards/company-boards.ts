import {
  COMPANY_MAX,
  DESCRIPTION_MAX,
  EXTERNAL_ID_MAX,
  ImportSourceError,
  LOCATION_MAX,
  MAX_IMPORT_POSTINGS,
  TITLE_MAX,
  assertIdentifier,
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
 * Applicant-tracking systems whose job boards are public and keyless.
 *
 * Each of these was probed live before it was written: the endpoint, the
 * response shape, and the field names below are what the provider actually
 * returned, not what its documentation claims. That distinction matters here
 * because several of these APIs are undocumented board endpoints rather than
 * published products, and a shape taken from a blog post would be a guess.
 *
 * They all share Greenhouse and Lever's contract: a person supplies the
 * identifier from the board's own public URL, one request is made, and at most
 * `MAX_IMPORT_POSTINGS` normalized jobs come back. Nothing here holds a
 * credential, because none of these endpoints accepts one.
 */

/** Remote/hybrid/onsite only when the provider actually says so. */
function workModelFrom(
  explicit: string | null | undefined,
  location: string | null,
  remoteFlag?: boolean,
): ImportedJob["workModel"] {
  if (remoteFlag === true) return "remote";
  const value = explicit?.toLowerCase().trim() ?? "";
  if (value === "remote" || value === "fully_remote") return "remote";
  if (value === "hybrid") return "hybrid";
  if (value === "onsite" || value === "on-site" || value === "on_site") return "onsite";
  /*
   * The location fallback is deliberately one-directional: a location saying
   * "Remote" is evidence of remote, but a location naming a city is not
   * evidence of onsite — plenty of remote roles name a timezone anchor.
   */
  return location !== null && /\bremote\b/i.test(location) ? "remote" : null;
}

function notFound(board: string, identifier: string, where: string): ImportSourceError {
  return new ImportSourceError(
    "source_not_found",
    `No public ${board} board is published at "${identifier}". ${where}`,
  );
}

async function boardJson<T>(
  url: string,
  board: string,
  identifier: string,
  where: string,
): Promise<T> {
  const response = await timedFetch(url);
  if (response.status === 404) throw notFound(board, identifier, where);
  /*
   * 429 is not a defect and must not read like one. Several of these providers
   * sit behind Cloudflare and rate-limit per source IP, which on a shared
   * server means one busy tenant can throttle the next person's import.
   * Observed live: Workable begins answering 429 after a handful of requests
   * in quick succession. "Answered HTTP 429" is accurate and tells a person
   * nothing they can act on; this tells them to wait.
   */
  if (response.status === 429) {
    throw new ImportSourceError(
      "provider_error",
      `${board} is rate limiting requests right now. Wait a minute and import again.`,
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

/* ── Ashby ──────────────────────────────────────────────────────────────── */

type AshbyJob = {
  id?: unknown;
  title?: unknown;
  location?: unknown;
  employmentType?: unknown;
  jobUrl?: unknown;
  isRemote?: unknown;
  descriptionPlain?: unknown;
  descriptionHtml?: unknown;
};

export async function fetchAshbyBoard(identifier: string): Promise<FetchedPostings> {
  const name = assertIdentifier(identifier);
  /*
   * Ashby's board name is case-sensitive in the path but people type it as it
   * appears in the URL, which `assertIdentifier` has already lowercased. The
   * API resolves case-insensitively, so this is safe — verified against a
   * board whose published name is capitalised.
   */
  const body = await boardJson<{ jobs?: unknown }>(
    `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(name)}?includeCompensation=true`,
    "Ashby",
    name,
    "The name is the last path segment of jobs.ashbyhq.com/{name}.",
  );
  const jobs = Array.isArray(body.jobs) ? body.jobs : [];

  const postings = jobs.slice(0, MAX_IMPORT_POSTINGS).flatMap((entry): ImportedJob[] => {
    const job = entry as AshbyJob;
    const title = boundedOrNull(job.title, TITLE_MAX);
    const id = externalIdOrNull(job.id, EXTERNAL_ID_MAX);
    if (title === null || id === null) return [];
    const location = boundedOrNull(job.location, LOCATION_MAX);
    const description =
      boundedOrNull(job.descriptionPlain, DESCRIPTION_MAX)
      ?? boundedOrNull(
        typeof job.descriptionHtml === "string" ? htmlToText(job.descriptionHtml) : null,
        DESCRIPTION_MAX,
      );
    return [{
      externalId: id,
      url: httpsUrlOrNull(job.jobUrl),
      title,
      // Ashby's board payload names no employer; the board name a person typed
      // is the attribution they can verify.
      company: name,
      salaryText: null,
      location,
      workModel: workModelFrom(
        typeof job.employmentType === "string" ? job.employmentType : null,
        location,
        job.isRemote === true,
      ),
      description,
    }];
  });

  return { company: name, totalAvailable: jobs.length, postings };
}

/* ── SmartRecruiters ────────────────────────────────────────────────────── */

type SmartRecruitersPosting = {
  id?: unknown;
  name?: unknown;
  company?: { identifier?: unknown; name?: unknown };
  location?: { city?: unknown; region?: unknown; country?: unknown; remote?: unknown };
  ref?: unknown;
  releasedDate?: unknown;
};

function smartRecruitersLocation(location: SmartRecruitersPosting["location"]): string | null {
  const parts = [location?.city, location?.region, location?.country]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0);
  return parts.length === 0 ? null : bounded(parts.join(", "), LOCATION_MAX);
}

export async function fetchSmartRecruitersBoard(identifier: string): Promise<FetchedPostings> {
  const company = assertIdentifier(identifier);
  const body = await boardJson<{ content?: unknown; totalFound?: unknown }>(
    `https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(company)}/postings?limit=${MAX_IMPORT_POSTINGS}`,
    "SmartRecruiters",
    company,
    "The identifier is the company name in jobs.smartrecruiters.com/{company}.",
  );
  const content = Array.isArray(body.content) ? body.content : [];

  const postings = content.slice(0, MAX_IMPORT_POSTINGS).flatMap((entry): ImportedJob[] => {
    const posting = entry as SmartRecruitersPosting;
    const title = boundedOrNull(posting.name, TITLE_MAX);
    const id = externalIdOrNull(posting.id, EXTERNAL_ID_MAX);
    if (title === null || id === null) return [];
    const location = smartRecruitersLocation(posting.location);
    return [{
      externalId: id,
      // SmartRecruiters' posting payload carries no absolute apply URL; the
      // canonical public one is built from the company and the posting id.
      url: httpsUrlOrNull(`https://jobs.smartrecruiters.com/${company}/${id}`),
      title,
      company: boundedOrNull(posting.company?.name, COMPANY_MAX) ?? company,
      salaryText: null,
      location,
      workModel: workModelFrom(null, location, posting.location?.remote === true),
      description: null,
    }];
  });

  const total = body.totalFound;
  return {
    company: postings[0]?.company ?? company,
    totalAvailable: typeof total === "number" && total >= 0 ? total : content.length,
    postings,
  };
}

/* ── Workable ───────────────────────────────────────────────────────────── */

type WorkableJob = {
  id?: unknown;
  shortcode?: unknown;
  title?: unknown;
  location?: { city?: unknown; region?: unknown; country?: unknown };
  city?: unknown;
  country?: unknown;
  url?: unknown;
  application_url?: unknown;
  workplace?: unknown;
  description?: unknown;
};

function workableLocation(job: WorkableJob): string | null {
  const parts = [
    job.location?.city ?? job.city,
    job.location?.region,
    job.location?.country ?? job.country,
  ].filter((part): part is string => typeof part === "string" && part.trim().length > 0);
  return parts.length === 0 ? null : bounded(parts.join(", "), LOCATION_MAX);
}

export async function fetchWorkableBoard(identifier: string): Promise<FetchedPostings> {
  const account = assertIdentifier(identifier);
  const body = await boardJson<{ name?: unknown; jobs?: unknown }>(
    `https://apply.workable.com/api/v1/widget/accounts/${encodeURIComponent(account)}?details=true`,
    "Workable",
    account,
    "The account is the subdomain in apply.workable.com/{account}.",
  );
  const jobs = Array.isArray(body.jobs) ? body.jobs : [];
  const accountName = boundedOrNull(body.name, COMPANY_MAX) ?? account;

  const postings = jobs.slice(0, MAX_IMPORT_POSTINGS).flatMap((entry): ImportedJob[] => {
    const job = entry as WorkableJob;
    const title = boundedOrNull(job.title, TITLE_MAX);
    const id = externalIdOrNull(job.shortcode ?? job.id, EXTERNAL_ID_MAX);
    if (title === null || id === null) return [];
    const location = workableLocation(job);
    return [{
      externalId: id,
      url: httpsUrlOrNull(job.url) ?? httpsUrlOrNull(job.application_url),
      title,
      company: accountName,
      salaryText: null,
      location,
      workModel: workModelFrom(
        typeof job.workplace === "string" ? job.workplace : null,
        location,
      ),
      description: boundedOrNull(
        typeof job.description === "string" ? htmlToText(job.description) : null,
        DESCRIPTION_MAX,
      ),
    }];
  });

  return { company: accountName, totalAvailable: jobs.length, postings };
}

/* ── Breezy HR ──────────────────────────────────────────────────────────── */

type BreezyPosition = {
  id?: unknown;
  name?: unknown;
  type?: { name?: unknown };
  location?: {
    name?: unknown;
    city?: unknown;
    country?: { name?: unknown };
    is_remote?: unknown;
  };
  url?: unknown;
  description?: unknown;
};

function breezyLocation(position: BreezyPosition): string | null {
  const explicit = boundedOrNull(position.location?.name, LOCATION_MAX);
  if (explicit !== null) return explicit;
  const parts = [position.location?.city, position.location?.country?.name]
    .filter((part): part is string => typeof part === "string" && part.trim().length > 0);
  return parts.length === 0 ? null : bounded(parts.join(", "), LOCATION_MAX);
}

export async function fetchBreezyBoard(identifier: string): Promise<FetchedPostings> {
  const company = assertIdentifier(identifier);
  const body = await boardJson<unknown>(
    `https://${encodeURIComponent(company)}.breezy.hr/json`,
    "Breezy",
    company,
    "The company is the subdomain in {company}.breezy.hr.",
  );
  /*
   * Breezy answers with a bare array rather than an envelope. A non-array is
   * either an error object or a parked subdomain, and both mean the board a
   * person named is not there.
   */
  if (!Array.isArray(body)) throw notFound("Breezy", company, "The company is the subdomain in {company}.breezy.hr.");

  const postings = body.slice(0, MAX_IMPORT_POSTINGS).flatMap((entry): ImportedJob[] => {
    const position = entry as BreezyPosition;
    const title = boundedOrNull(position.name, TITLE_MAX);
    const id = externalIdOrNull(position.id, EXTERNAL_ID_MAX);
    if (title === null || id === null) return [];
    const location = breezyLocation(position);
    return [{
      externalId: id,
      url: httpsUrlOrNull(position.url),
      title,
      company,
      salaryText: null,
      location,
      workModel: workModelFrom(
        typeof position.type?.name === "string" ? position.type.name : null,
        location,
        position.location?.is_remote === true,
      ),
      description: boundedOrNull(
        typeof position.description === "string" ? htmlToText(position.description) : null,
        DESCRIPTION_MAX,
      ),
    }];
  });

  return { company, totalAvailable: body.length, postings };
}
