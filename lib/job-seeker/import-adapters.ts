/**
 * Job import adapters: real discovery beyond manual entry.
 *
 * Two kinds of adapter live here, and the distinction is the whole design:
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
 */

export type ImportedJob = Readonly<{
  externalId: string;
  url: string | null;
  title: string;
  company: string;
  salaryText: string | null;
  location: string | null;
  workModel: "remote" | "hybrid" | "onsite" | null;
  description: string | null;
}>;

/** What one fetch of a public board actually found. */
export type FetchedPostings = Readonly<{
  company: string;
  totalAvailable: number;
  postings: readonly ImportedJob[];
}>;

export type ImportSourceErrorCode =
  | "identifier_invalid"
  | "source_not_found"
  | "provider_error"
  | "provider_unreachable";

/** A typed failure the route can map to an honest HTTP answer. */
export class ImportSourceError extends Error {
  constructor(
    readonly code: ImportSourceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ImportSourceError";
  }
}

export type JobImportAdapter = Readonly<{
  /** The `source` value recorded on every job this adapter imports. */
  key: string;
  name: string;
  summary: string;
  mode: "public" | "credentialed";
  /** Public adapters: what the identifier field is called on the page. */
  identifierLabel?: string;
  /** Public adapters: where a person finds their identifier. */
  identifierHint?: string;
  /** Credentialed adapters: the exact configuration that must exist. */
  requiredConfiguration: readonly string[];
  /** Public adapters are always available; credentialed ones by detection. */
  configured: boolean;
  /** Present only where a real integration exists. */
  fetchPostings?: (identifier: string) => Promise<FetchedPostings>;
}>;

/*
 * Bounds mirror the job_seeker_jobs CHECKs (migration 20260820000200):
 * title/company ≤ 300, url ≤ 800, external_id ≤ 200, location ≤ 200,
 * description ≤ 30000. One request imports at most MAX_IMPORT_POSTINGS —
 * bounded work, and the response states the board's true total so nothing
 * pretends the cap was the whole board.
 */
export const MAX_IMPORT_POSTINGS = 40;
const FETCH_TIMEOUT_MS = 10_000;
const TITLE_MAX = 300;
const COMPANY_MAX = 300;
const URL_MAX = 800;
const EXTERNAL_ID_MAX = 200;
const LOCATION_MAX = 200;
const DESCRIPTION_MAX = 30_000;

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

function decodeEntities(value: string): string {
  return value
    .replaceAll(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replaceAll(/&#(\d+);/g, (_, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replaceAll("&nbsp;", " ")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&apos;", "'")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&amp;", "&");
}

/**
 * Provider HTML to readable text. Greenhouse ships its content
 * entity-ESCAPED (the markup arrives as &lt;p&gt;), and that markup can
 * itself carry entities — so: decode to get the HTML, turn block
 * boundaries into newlines, strip the remaining tags, then decode once
 * more for the entities the first pass surfaced. Plain single-escaped
 * HTML (Lever's lists) passes through the same path unharmed.
 */
export function htmlToText(html: string): string {
  return decodeEntities(
    decodeEntities(html)
      .replaceAll(/<\s*(?:br|\/p|\/li|\/div|\/h[1-6]|\/ul|\/ol|\/tr)\b[^>]*>/gi, "\n")
      .replaceAll(/<[^>]*>/g, " "),
  )
    .replaceAll(/[ \t]+/g, " ")
    .replaceAll(/ ?\n ?/g, "\n")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();
}

function bounded(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

function boundedOrNull(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? bounded(trimmed, max) : null;
}

function httpsUrlOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^https?:\/\//.test(trimmed) || trimmed.length > URL_MAX) return null;
  return trimmed;
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
 * The registry, evaluated against the live environment. Greenhouse and
 * Lever are public-API adapters — always available, driven by a
 * user-supplied identifier. LinkedIn still needs its OAuth credential and
 * so remains detection-gated with no fetch implementation.
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
