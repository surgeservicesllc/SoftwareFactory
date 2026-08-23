/**
 * The shared portal contract: the shape a posting takes on the way in, the
 * bounds it must respect, the typed failures a route can answer with, and the
 * text normalization every provider needs.
 *
 * This module exists so the adapters and the registry that lists them do not
 * import each other. `import-adapters.ts` holds the registry and re-exports
 * these names, so nothing outside this directory changed its import; the
 * adapters in `portals/` import from here, and the cycle that would otherwise
 * put a module-level constant in its own temporal dead zone cannot form.
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

/** What one read of a provider actually found. */
export type FetchedPostings = Readonly<{
  company: string;
  totalAvailable: number;
  postings: readonly ImportedJob[];
}>;

export type ImportSourceErrorCode =
  | "identifier_invalid"
  | "query_invalid"
  | "source_not_found"
  | "provider_error"
  | "provider_unreachable";

/**
 * The HTTP answer each failure deserves, held beside the codes so a new code
 * cannot be added without deciding its status in the same edit. `satisfies`
 * makes an omission a compile error rather than an `undefined` status.
 */
export const IMPORT_ERROR_STATUS = {
  identifier_invalid: 422,
  query_invalid: 422,
  source_not_found: 404,
  provider_error: 502,
  provider_unreachable: 502,
} as const satisfies Record<ImportSourceErrorCode, number>;

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

/*
 * Bounds mirror the job_seeker_jobs CHECKs (migration 20260820000200):
 * title/company ≤ 300, url ≤ 800, external_id ≤ 200, location ≤ 200,
 * description ≤ 30000. One request records at most MAX_IMPORT_POSTINGS —
 * bounded work, and every response states the provider's true total so
 * nothing pretends the cap was the whole result.
 */
export const MAX_IMPORT_POSTINGS = 40;
export const TITLE_MAX = 300;
export const COMPANY_MAX = 300;
export const URL_MAX = 800;
export const EXTERNAL_ID_MAX = 200;
export const LOCATION_MAX = 200;
export const SALARY_MAX = 200;
export const DESCRIPTION_MAX = 30_000;

export const WORK_MODES = ["remote", "hybrid", "onsite"] as const;
export type WorkMode = (typeof WORK_MODES)[number];

/**
 * What one keyword search asks for. Every field maps to a documented provider
 * parameter — nothing is inferred from free text, because a guess about
 * whether "Austin" is a city or a country is a guess that silently returns the
 * wrong jobs and looks like a real answer.
 */
export type JobSearchQuery = Readonly<{
  keywords: string;
  city: string | null;
  /** ISO-3166 alpha-2, lowercased by each adapter's request builder. */
  country: string | null;
  workMode: WorkMode | null;
  postedWithinDays: number | null;
  limit: number;
}>;

export function decodeEntities(value: string): string {
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

export function httpsUrlOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!/^https?:\/\//.test(trimmed) || trimmed.length > URL_MAX) return null;
  return trimmed;
}

/**
 * Whether a description arrived as markup. Adapters that ask a provider for
 * plain text still check, because a self-hosted or older instance may not
 * honour the format parameter — and running the tag stripper over genuine
 * prose would eat everything between a "<" and the next ">", which in a
 * technical posting is a real sentence ("C++ <-> Python interop").
 */
export function looksLikeMarkup(value: string): boolean {
  return /<\/?(?:p|br|li|ul|ol|div|h[1-6]|strong|em|span)\b[^>]*>/i.test(value);
}
