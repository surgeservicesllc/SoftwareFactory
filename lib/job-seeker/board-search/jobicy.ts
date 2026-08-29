import { fetchBoardJson, htmlToText } from "@/lib/job-seeker/board-search/http";
import {
  type BoardFetchOverrides,
  type BoardSearchAdapter,
  type BoardSearchHit,
  type BoardSearchQuery,
  type BoardSearchResult,
} from "@/lib/job-seeker/board-search/types";

/**
 * Jobicy — the public API at jobicy.com/api/v2/remote-jobs.
 *
 * The API takes a free-text `tag` that its docs describe as searching title
 * and description, which is exactly what this route's `text` means. Results
 * carry industry and level fields richer than most boards; they stay in the
 * description-adjacent fields the shared schema has, never invented columns.
 */

const BASE_URL = "https://jobicy.com/api/v2/remote-jobs";
const BOARD = "jobicy";

type JobicyJob = {
  id?: unknown;
  url?: unknown;
  jobSlug?: unknown;
  jobTitle?: unknown;
  companyName?: unknown;
  jobGeo?: unknown;
  jobLevel?: unknown;
  jobDescription?: unknown;
  jobExcerpt?: unknown;
  pubDate?: unknown;
  annualSalaryMin?: unknown;
  annualSalaryMax?: unknown;
  salaryCurrency?: unknown;
};

type JobicyEnvelope = {
  jobs?: unknown;
  jobCount?: unknown;
};

function text(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}

function isoDate(value: unknown): string | null {
  const raw = text(value);
  if (raw === null) return null;
  const day = raw.slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : null;
}

function salaryText(job: JobicyJob): string | null {
  const min = typeof job.annualSalaryMin === "number" ? job.annualSalaryMin : null;
  const max = typeof job.annualSalaryMax === "number" ? job.annualSalaryMax : null;
  if (min === null && max === null) return null;
  const currency = text(job.salaryCurrency) ?? "";
  const range = min !== null && max !== null ? `${min}–${max}` : `${min ?? max}`;
  return `${currency} ${range}`.trim();
}

export function toJobicyHits(envelope: JobicyEnvelope, limit: number): BoardSearchHit[] {
  const rows = Array.isArray(envelope.jobs) ? envelope.jobs : [];
  const hits: BoardSearchHit[] = [];
  for (const entry of rows) {
    if (hits.length >= limit) break;
    if (entry === null || typeof entry !== "object") continue;
    const job = entry as JobicyJob;
    const title = text(job.jobTitle);
    const company = text(job.companyName);
    const id = typeof job.id === "number" ? String(job.id) : text(job.id) ?? text(job.jobSlug);
    if (title === null || company === null || id === null) continue;
    const url = text(job.url);
    hits.push({
      job: {
        externalId: id,
        url: url !== null && /^https?:\/\//i.test(url) ? url : null,
        title,
        company,
        salaryText: salaryText(job),
        location: text(job.jobGeo),
        workModel: "remote",
        description: htmlToText(
          typeof job.jobDescription === "string"
            ? job.jobDescription
            : typeof job.jobExcerpt === "string"
              ? job.jobExcerpt
              : null,
        ),
      },
      publishedOn: isoDate(job.pubDate),
      closesOn: null,
    });
  }
  return hits;
}

export const jobicyAdapter: BoardSearchAdapter = {
  key: BOARD,
  name: "Jobicy",
  summary: "Remote jobs API with a free-text search over title and description.",
  coverage: "Remote roles worldwide with industry and seniority facets.",
  supportsLocation: false,
  async search(query: BoardSearchQuery, overrides?: BoardFetchOverrides): Promise<BoardSearchResult> {
    const params = new URLSearchParams({ count: String(Math.min(query.limit, 50)) });
    const term = query.text.trim();
    if (term.length > 0) params.set("tag", term);
    const envelope = await fetchBoardJson<JobicyEnvelope>(
      `${BASE_URL}?${params.toString()}`,
      { board: BOARD, ...overrides },
    );
    const total = typeof envelope.jobCount === "number" ? envelope.jobCount : null;
    return { board: BOARD, hits: toJobicyHits(envelope, query.limit), totalAvailable: total };
  },
};
