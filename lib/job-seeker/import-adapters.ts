import { searchFreehire } from "@/lib/job-seeker/portals/freehire";
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
  htmlToText,
  httpsUrlOrNull,
  type FetchedPostings,
  type ImportedJob,
  type JobSearchQuery,
} from "@/lib/job-seeker/portals/contract";

/**
 * Job import adapters: real discovery beyond manual entry.
 *
 * Three kinds of adapter live here, and the distinction is the whole design:
 *
 * - PUBLIC adapters (Greenhouse, Lever) read providers' public, keyless
 *   postings APIs. They need no credential — what they need is an
 *   *identifier*: which company's board to read, and that is the user's
 *   input on the page, not an environment secret. Their `fetchPostings`
 *   is real, bounded, and validated; what it returns is exactly what the
 *   provider published, normalized into the shape `job_seeker_jobs`
 *   stores, attributed by `source`.
 *
 * - CREDENTIALED adapters (LinkedIn) require provider credentials that do
 *   not exist yet. They carry no fetch implementation at all — an
 *   unconfigured adapter is incapable of inventing jobs because there is
 *   nothing to call — and `configured` flips only by detection of the
 *   named variables, never by assertion.
 *
 * - SEARCH adapters (freehire) read a public aggregator by KEYWORD rather
 *   than by company. The distinction from a public board adapter is not
 *   cosmetic: a board answers "what is this company hiring for", a search
 *   answers "who is hiring for this", and the two take different input, so
 *   they carry different call signatures rather than one overloaded string.
 *   `listSearchAdapters` is the registry for them; `searchPostings` returns
 *   the same `FetchedPostings` a board does, so everything downstream —
 *   scoring, dedupe, recording, attribution — is one code path.
 */

export {
  IMPORT_ERROR_STATUS,
  ImportSourceError,
  MAX_IMPORT_POSTINGS,
  htmlToText,
} from "@/lib/job-seeker/portals/contract";
export type {
  FetchedPostings,
  ImportSourceErrorCode,
  ImportedJob,
  JobSearchQuery,
} from "@/lib/job-seeker/portals/contract";

export type JobImportAdapter = Readonly<{
  /** The `source` value recorded on every job this adapter imports. */
  key: string;
  name: string;
  summary: string;
  mode: "public" | "credentialed" | "search";
  /** Public adapters: what the identifier field is called on the page. */
  identifierLabel?: string;
  /** Public adapters: where a person finds their identifier. */
  identifierHint?: string;
  /** Credentialed adapters: the exact configuration that must exist. */
  requiredConfiguration: readonly string[];
  /** Public and search adapters are always available; credentialed ones by detection. */
  configured: boolean;
  /** Present only where a real board integration exists. */
  fetchPostings?: (identifier: string) => Promise<FetchedPostings>;
  /** Search adapters only: a keyword query rather than a company identifier. */
  searchPostings?: (query: JobSearchQuery) => Promise<FetchedPostings>;
}>;

const FETCH_TIMEOUT_MS = 10_000;

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;

function assertIdentifier(value: string): string {
  const identifier = value.trim().toLowerCase();
  if (!IDENTIFIER_PATTERN.test(identifier)) {
    throw new ImportSourceError(
      "identifier_invalid",
      "Identifiers are lowercase letters, digits, hyphens, and underscores — the last path segment of the board's public URL.",
    );
  }
  return identifier;
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
      "The provider did not answer. Try again shortly.",
    );
  } finally {
    clearTimeout(timer);
  }
}

type GreenhouseJob = {
  id?: number | string;
  title?: string;
  company_name?: string;
  absolute_url?: string;
  location?: { name?: string };
  content?: string;
};

async function fetchGreenhouseBoard(identifier: string): Promise<FetchedPostings> {
  const token = assertIdentifier(identifier);
  const response = await timedFetch(
    `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}/jobs?content=true`,
  );
  if (response.status === 404) {
    throw new ImportSourceError(
      "source_not_found",
      `No public Greenhouse board is published at "${token}". The token is the last path segment of boards.greenhouse.io/{token}.`,
    );
  }
  if (!response.ok) {
    throw new ImportSourceError("provider_error", `Greenhouse answered HTTP ${response.status}.`);
  }
  const body = (await response.json().catch(() => null)) as { jobs?: GreenhouseJob[] } | null;
  const jobs = Array.isArray(body?.jobs) ? body.jobs : [];

  const postings = jobs.slice(0, MAX_IMPORT_POSTINGS).flatMap((job): ImportedJob[] => {
    const title = boundedOrNull(job?.title, TITLE_MAX);
    const id = job?.id;
    if (!title || (typeof id !== "number" && typeof id !== "string")) return [];
    const location = boundedOrNull(job?.location?.name, LOCATION_MAX);
    const description = boundedOrNull(htmlToText(String(job?.content ?? "")), DESCRIPTION_MAX);
    return [{
      externalId: bounded(String(id), EXTERNAL_ID_MAX),
      url: httpsUrlOrNull(job?.absolute_url),
      title,
      company: boundedOrNull(job?.company_name, COMPANY_MAX) ?? token,
      salaryText: null,
      location,
      workModel: location && /remote/i.test(location) ? "remote" : null,
      description,
    }];
  });

  return {
    company: postings[0]?.company ?? token,
    totalAvailable: jobs.length,
    postings,
  };
}

type LeverPosting = {
  id?: string;
  text?: string;
  hostedUrl?: string;
  workplaceType?: string;
  categories?: { location?: string };
  descriptionPlain?: string;
  description?: string;
  lists?: Array<{ text?: string; content?: string }>;
};

function leverWorkModel(posting: LeverPosting, location: string | null): ImportedJob["workModel"] {
  const type = posting.workplaceType?.toLowerCase() ?? "";
  if (type === "remote") return "remote";
  if (type === "hybrid") return "hybrid";
  if (type === "onsite" || type === "on-site") return "onsite";
  return location && /remote/i.test(location) ? "remote" : null;
}

function leverDescription(posting: LeverPosting): string | null {
  const parts: string[] = [];
  const opening = posting.descriptionPlain?.trim()
    || (posting.description ? htmlToText(posting.description) : "");
  if (opening) parts.push(opening);
  for (const list of posting.lists ?? []) {
    const heading = list.text?.trim();
    const content = list.content ? htmlToText(list.content) : "";
    if (heading || content) parts.push([heading, content].filter(Boolean).join("\n"));
  }
  const combined = parts.join("\n\n").trim();
  return combined ? bounded(combined, DESCRIPTION_MAX) : null;
}

async function fetchLeverSite(identifier: string): Promise<FetchedPostings> {
  const site = assertIdentifier(identifier);
  const response = await timedFetch(
    `https://api.lever.co/v0/postings/${encodeURIComponent(site)}?mode=json`,
  );
  if (response.status === 404) {
    throw new ImportSourceError(
      "source_not_found",
      `No public Lever site is published at "${site}". The site name is the last path segment of jobs.lever.co/{site}.`,
    );
  }
  if (!response.ok) {
    throw new ImportSourceError("provider_error", `Lever answered HTTP ${response.status}.`);
  }
  const body = (await response.json().catch(() => null)) as LeverPosting[] | null;
  if (!Array.isArray(body)) {
    throw new ImportSourceError("provider_error", "Lever answered with an unexpected shape.");
  }

  const postings = body.slice(0, MAX_IMPORT_POSTINGS).flatMap((posting): ImportedJob[] => {
    const title = boundedOrNull(posting?.text, TITLE_MAX);
    const id = boundedOrNull(posting?.id, EXTERNAL_ID_MAX);
    if (!title || !id) return [];
    const location = boundedOrNull(posting?.categories?.location, LOCATION_MAX);
    return [{
      externalId: id,
      url: httpsUrlOrNull(posting?.hostedUrl),
      title,
      // Lever's public payload names no company; the site identifier is the
      // truthful attribution a person typed and can verify.
      company: site,
      salaryText: null,
      location,
      workModel: leverWorkModel(posting ?? {}, location),
      description: leverDescription(posting ?? {}),
    }];
  });

  return { company: site, totalAvailable: body.length, postings };
}

function configuredIn(env: NodeJS.ProcessEnv, names: readonly string[]): boolean {
  return names.every((name) => Boolean(env[name]?.trim()));
}

/**
 * The BOARD registry, evaluated against the live environment. Greenhouse and
 * Lever are public-API adapters — always available, driven by a
 * user-supplied identifier. LinkedIn still needs its OAuth credential and
 * so remains detection-gated with no fetch implementation.
 *
 * LinkedIn stays credential-gated deliberately. The upstream `ai-job-search`
 * repository ships a LinkedIn adapter that reads the guest endpoints without
 * a credential, and its own skill scopes that to personal use under
 * LinkedIn's terms. That is a defensible posture for a tool on one person's
 * machine; making the same reads from a hosted product on its users' behalf
 * is a different one, so no scraping adapter was ported and this entry
 * remains incapable of reading anything until a real API credential exists.
 */
export function listImportAdapters(env: NodeJS.ProcessEnv = process.env): readonly JobImportAdapter[] {
  return [
    {
      key: "greenhouse",
      name: "Greenhouse job boards",
      summary: "Reads public postings from a company's Greenhouse board — no credential needed.",
      mode: "public",
      identifierLabel: "Board token",
      identifierHint: "The last path segment of boards.greenhouse.io/{token} — e.g. \"stripe\".",
      requiredConfiguration: [],
      configured: true,
      fetchPostings: fetchGreenhouseBoard,
    },
    {
      key: "lever",
      name: "Lever postings",
      summary: "Reads public postings from a company's Lever site — no credential needed.",
      mode: "public",
      identifierLabel: "Site name",
      identifierHint: "The last path segment of jobs.lever.co/{site} — e.g. \"palantir\".",
      requiredConfiguration: [],
      configured: true,
      fetchPostings: fetchLeverSite,
    },
    {
      key: "linkedin",
      name: "LinkedIn job search",
      summary: "Searches LinkedIn jobs matching your target titles and locations.",
      mode: "credentialed",
      requiredConfiguration: ["SOFTWAREFACTORY_LINKEDIN_CLIENT_ID", "SOFTWAREFACTORY_LINKEDIN_CLIENT_SECRET"],
      configured: configuredIn(env, [
        "SOFTWAREFACTORY_LINKEDIN_CLIENT_ID",
        "SOFTWAREFACTORY_LINKEDIN_CLIENT_SECRET",
      ]),
    },
  ];
}

/**
 * The SEARCH registry: adapters that answer "who is hiring for this" rather
 * than "what is this company hiring for".
 *
 * freehire.me aggregates postings from around fifty applicant-tracking
 * systems into one public, unauthenticated JSON API, which is why it is here
 * and a scraper is not: reading it needs no credential and breaks no one's
 * terms. It is a best-effort service with no SLA, so `searchFreehire` reports
 * an outage as an outage — never as a search that found nothing.
 */
export function listSearchAdapters(): readonly JobImportAdapter[] {
  return [
    {
      key: "freehire",
      name: "freehire job search",
      summary:
        "Searches live postings aggregated from around fifty applicant-tracking systems — global coverage, strongest on software, data, and engineering roles.",
      mode: "search",
      requiredConfiguration: [],
      configured: true,
      searchPostings: searchFreehire,
    },
  ];
}
