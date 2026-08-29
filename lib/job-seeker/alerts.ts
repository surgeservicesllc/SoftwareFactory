import {
  applyUnifiedFilters,
  dedupeAcrossBoards,
  EMPTY_FILTERS,
  type UnifiedFilters,
} from "@/lib/job-seeker/board-search/unify";
import { evaluateJob, type Evaluation } from "@/lib/job-seeker/evaluate";
import type { EvaluationInputs } from "@/lib/job-seeker/record";
import type { SavedSearchQuery } from "@/lib/job-seeker/saved-search-query";

/**
 * The alert engine's pure core: what one scan decides, with no I/O in it.
 *
 * The runner fetches boards and crosses the definer boundary; everything
 * between those two — which unified hits pass the saved filters, which score
 * high enough, which were already delivered, and what the email says — is
 * decided here, deterministically, so a test can hold every branch of the
 * decision without a network or a database.
 *
 * The dedupe → filter → score → select order is the goal's own pipeline, and
 * the never-repeat rule appears twice on purpose: `deliveredUrls` excludes
 * known jobs here, and the ledger's unique constraint refuses them again at
 * insert, so a race can waste a comparison but never a person's attention.
 */

export type AlertCandidate = Readonly<{
  jobUrl: string;
  jobTitle: string;
  jobCompany: string;
  board: string;
  boardName: string;
  location: string | null;
  salaryText: string | null;
  publishedOn: string | null;
  matchScore: number | null;
  matchReasons: readonly string[];
}>;

export function toUnifiedFilters(query: SavedSearchQuery): UnifiedFilters {
  const filters = query.filters ?? {};
  return {
    ...EMPTY_FILTERS,
    keywordMode: filters.keywordMode ?? "and",
    keywords: filters.keywords ?? [],
    excludeKeywords: filters.excludeKeywords ?? [],
    excludeCompanies: filters.excludeCompanies ?? [],
    workModel: filters.workModel ?? null,
    seniority: filters.seniority ?? null,
    salaryMinimum: filters.salaryMinimum ?? null,
    requireSalary: filters.requireSalary ?? false,
    postedWithinDays: filters.postedWithinDays ?? null,
  };
}

type TaggedBoardHit = Parameters<typeof dedupeAcrossBoards>[0][number];

export function planAlertCandidates(args: Readonly<{
  query: SavedSearchQuery;
  tagged: readonly TaggedBoardHit[];
  boardNames: ReadonlyMap<string, string>;
  deliveredUrls: ReadonlySet<string>;
  evaluation: EvaluationInputs | null;
  now?: Date;
  limit?: number;
}>): AlertCandidate[] {
  const filters = toUnifiedFilters(args.query);
  const minimumScore = args.query.filters?.minimumScore ?? null;
  const unified = applyUnifiedFilters(
    dedupeAcrossBoards(args.tagged),
    filters,
    args.now ?? new Date(),
  );

  const candidates: AlertCandidate[] = [];
  for (const hit of unified) {
    // A job the email cannot link to is a job the email cannot honestly
    // offer; and a job already delivered for this search was already offered.
    if (hit.job.url === null) continue;
    if (args.deliveredUrls.has(hit.job.url)) continue;

    let match: Evaluation | null = null;
    if (args.evaluation !== null && args.evaluation.profileRecorded) {
      match = evaluateJob(args.evaluation.profile, args.evaluation.preferences, {
        title: hit.job.title,
        company: hit.job.company,
        description: hit.job.description,
        salaryText: hit.job.salaryText,
        location: hit.job.location,
        workModel: hit.job.workModel,
      });
      if (match.excluded !== null) continue;
    }
    // A minimum-score condition on the saved search is a promise to only
    // interrupt for matches at least that strong; with no profile there are
    // no scores, so nothing can clear the bar and nothing is sent.
    if (minimumScore !== null && (match === null || match.score < minimumScore)) continue;

    const primary = hit.sources[hit.primarySourceIndex]!;
    candidates.push({
      jobUrl: hit.job.url,
      jobTitle: hit.job.title,
      jobCompany: hit.job.company,
      board: primary.board,
      boardName: args.boardNames.get(primary.board) ?? primary.boardName,
      location: hit.job.location,
      salaryText: hit.job.salaryText,
      publishedOn: hit.publishedOn,
      matchScore: match?.score ?? null,
      matchReasons: match?.reasons.slice(0, 3) ?? [],
    });
    if (candidates.length >= (args.limit ?? 20)) break;
  }
  return candidates;
}

export function composeAlertEmail(args: Readonly<{
  searchName: string;
  candidates: readonly AlertCandidate[];
  siteUrl: string;
}>): Readonly<{ subject: string; text: string }> {
  const count = args.candidates.length;
  const subject = `${count} new ${count === 1 ? "job matches" : "jobs match"} “${args.searchName}”`;

  const lines: string[] = [
    `Your saved search “${args.searchName}” found ${count} new ${count === 1 ? "posting" : "postings"}.`,
    "",
  ];
  for (const job of args.candidates) {
    lines.push(`${job.jobCompany} — ${job.jobTitle}`);
    const facts = [
      job.location,
      job.salaryText,
      job.publishedOn === null ? null : `posted ${job.publishedOn}`,
      job.matchScore === null ? null : `match score ${job.matchScore}/100`,
      `via ${job.boardName}`,
    ].filter((fact): fact is string => fact !== null);
    lines.push(`  ${facts.join(" · ")}`);
    for (const reason of job.matchReasons) lines.push(`  • ${reason}`);
    lines.push(`  Apply: ${job.jobUrl}`);
    lines.push("");
  }
  lines.push(`Manage this search and its alert: ${args.siteUrl}/JobSearch`);
  lines.push(
    "Scores are computed from your recorded Career Profile; a job you were "
    + "already told about for this search is never sent again.",
  );
  return { subject, text: lines.join("\n") };
}

export type DeliveryRow = Readonly<{
  jobUrl: string;
  jobTitle: string;
  jobCompany: string;
  board: string;
  matchScore: number | null;
  emailStatus: "sent" | "failed";
}>;

export function toDeliveryRows(
  candidates: readonly AlertCandidate[],
  emailStatus: "sent" | "failed",
): DeliveryRow[] {
  return candidates.map((candidate) => ({
    jobUrl: candidate.jobUrl,
    jobTitle: candidate.jobTitle,
    jobCompany: candidate.jobCompany,
    board: candidate.board,
    matchScore: candidate.matchScore,
    emailStatus,
  }));
}
