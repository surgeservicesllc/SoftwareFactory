/**
 * The job-import contract: the shape every board adapter answers in, the
 * bounds every field is held to, and the one outbound fetch they share.
 *
 * This lives apart from `import-adapters.ts` for a structural reason rather
 * than a stylistic one. The registry there must import each board's fetch
 * function, and every board must import these primitives — so leaving them in
 * the registry made the two files import each other. A cycle like that
 * typechecks and usually works, then resolves to `undefined` at module init in
 * some bundler's ordering, which is a production failure no test here would
 * have caught. One direction only: boards depend on this, the registry depends
 * on boards, and nothing depends on the registry.
 *
 * The bounds are not arbitrary. Each mirrors a CHECK on `job_seeker_jobs`
 * (migration 20260820000200), so a posting that passes here is one PostgreSQL
 * will accept — the alternative is discovering a provider's 400-character
 * title as a constraint violation halfway through an import.
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
export const FETCH_TIMEOUT_MS = 10_000;
export const TITLE_MAX = 300;
export const COMPANY_MAX = 300;
export const URL_MAX = 800;
export const EXTERNAL_ID_MAX = 200;
export const LOCATION_MAX = 200;
export const DESCRIPTION_MAX = 30_000;

const IDENTIFIER_PATTERN = /^[a-z0-9][a-z0-9_-]{0,62}$/;

export function assertIdentifier(value: string): string {
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

export function bounded(value: string, max: number): string {
  return value.length > max ? value.slice(0, max) : value;
}

export function boundedOrNull(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? bounded(trimmed, max) : null;
}

/**
 * A provider's identifier, whether it sent a string or a number.
 *
 * `boundedOrNull` refuses anything that is not a string, which is right for
 * free text and wrong for ids: Remotive and Jobicy both send `id` as a JSON
 * number, and dropping those postings silently made two boards report
 * "19 found, 0 imported" with nothing in the logs. Greenhouse's adapter had
 * always coerced its numeric id inline; this is that rule, shared, so the next
 * board that sends a number does not rediscover the same empty import.
 */
export function externalIdOrNull(value: unknown, max: number): string | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? bounded(String(value), max) : null;
  }
  return boundedOrNull(value, max);
}

export function httpsUrlOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^https?:\/\//.test(trimmed) || trimmed.length > URL_MAX) return null;
  return trimmed;
}

export async function timedFetch(url: string): Promise<Response> {
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
