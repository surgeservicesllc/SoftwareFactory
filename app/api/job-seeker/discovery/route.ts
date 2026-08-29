import {
  databaseErrorResponse,
  jsonNoStore,
} from "@/lib/server/http";
import { DISCOVERY_WINDOW_DAYS } from "@/lib/job-seeker/discovery";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Everything the Job Discovery page shows, in one read.
 *
 * The page's five headline figures, its credit meter and its list all describe
 * the same set of postings, so they are answered from one request. Five
 * separate endpoints would eventually disagree — a headline saying 247 above a
 * list holding 246 is the most corrosive thing this page could do, and it is
 * exactly what independent queries drift into.
 *
 * Counts that cannot be derived from the postings themselves — applications
 * filed this week, active alerts, searches spent — are counted server-side
 * with `head: true`, so the browser never receives rows it would only measure.
 */

/*
 * Two column lists, and the reason is a production incident.
 *
 * `saved_at` and the three tables below arrive with 20260828000400. A hosted
 * apply is a separately gated step, so between a deploy and that apply the
 * code is ahead of the database — and the first version of this route selected
 * the new column unconditionally, which made every request 500 and the whole
 * page read "Job discovery could not be loaded".
 *
 * The postings are the page. A bookmark column and three metric tables are
 * additions to it, and their absence must cost only the additions. So the
 * fuller select is tried first and a missing column falls back to the columns
 * every deployment has had since 20260820000200.
 */
const BASE_COLUMNS = `
  id, source, url, title, company, salary_text, location, work_model,
  description, discovered_at,
  job_seeker_matches ( score, breakdown, reasons, gaps, threshold_used, qualified ),
  job_seeker_applications ( id, stage )
`;

const JOB_COLUMNS = `
  id, source, url, title, company, salary_text, location, work_model,
  description, discovered_at, saved_at,
  job_seeker_matches ( score, breakdown, reasons, gaps, threshold_used, qualified ),
  job_seeker_applications ( id, stage )
`;

/** PostgREST's codes for "that column is not there" and "that table is not there". */
function isMissingSchema(error: { code?: string } | null | undefined): boolean {
  return error?.code === "42703" || error?.code === "42P01"
    || error?.code === "PGRST204" || error?.code === "PGRST205";
}

type MatchRow = {
  score: number;
  breakdown: Record<string, number> | null;
  reasons: string[] | null;
  gaps: string[] | null;
  threshold_used: number;
  qualified: boolean;
};

type JobRow = {
  id: string;
  source: string;
  url: string | null;
  title: string;
  company: string;
  salary_text: string | null;
  location: string | null;
  work_model: string | null;
  description: string | null;
  discovered_at: string;
  saved_at: string | null;
  job_seeker_matches: MatchRow[] | MatchRow | null;
  job_seeker_applications: { id: string; stage: string }[] | { id: string; stage: string } | null;
};

/** Supabase returns an embedded row as an object or an array by cardinality. */
function first<T>(value: T[] | T | null | undefined): T | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

function windowStart(): string {
  return new Date(Date.now() - DISCOVERY_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
}

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const since = windowStart();

    /*
     * Each optional read is allowed to come back missing. A count that cannot
     * be taken is reported as null, which the page renders as an absent figure
     * rather than a zero it never measured.
     */
    /*
     * Each optional read may come back missing. A count that cannot be taken is
     * null, which the page renders as an absent figure rather than a zero it
     * never measured.
     */
    async function optionalCount(
      run: () => PromiseLike<{ count: number | null; error: unknown }>,
    ): Promise<number | null> {
      try {
        const { count, error } = await run();
        return error ? null : count ?? null;
      } catch {
        return null;
      }
    }

    type JobsResult = { data: unknown; error: ({ code?: string } & { message?: string }) | null };

    let savedSupported = true;
    let jobs = await (client
      .from("job_seeker_jobs")
      .select(JOB_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .order("discovered_at", { ascending: false })
      .limit(500) as unknown as PromiseLike<JobsResult>);

    // The database predates 20260828000400: read what it does have. Postings
    // without a bookmark are still the page; postings missing entirely are not.
    if (jobs.error && isMissingSchema(jobs.error)) {
      savedSupported = false;
      jobs = await (client
        .from("job_seeker_jobs")
        .select(BASE_COLUMNS)
        .eq("organization_id", activeOrganization.id)
        .order("discovered_at", { ascending: false })
        .limit(500) as unknown as PromiseLike<JobsResult>);
    }

    if (jobs.error) return databaseErrorResponse(jobs.error);

    const [applied, alerts, searches, allowance] = await Promise.all([
      optionalCount(() => client
        .from("job_seeker_applications")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", activeOrganization.id)
        .gte("applied_at", since) as unknown as PromiseLike<{ count: number | null; error: unknown }>),
      optionalCount(() => client
        .from("job_seeker_search_alerts")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", activeOrganization.id)
        .eq("active", true) as unknown as PromiseLike<{ count: number | null; error: unknown }>),
      optionalCount(() => client
        .from("job_seeker_search_events")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", activeOrganization.id)
        .gte("created_at", since) as unknown as PromiseLike<{ count: number | null; error: unknown }>),
      (async (): Promise<number | null> => {
        // The allowance column is new; a database without it has no meter, and
        // the page omits the meter rather than drawing an empty bar.
        try {
          const result = await (client
            .from("job_seeker_preferences")
            .select("weekly_search_allowance")
            .eq("organization_id", activeOrganization.id)
            .maybeSingle() as unknown as PromiseLike<{
              data: { weekly_search_allowance?: number | null } | null;
              error: unknown;
            }>);
          if (result.error) return null;
          return result.data?.weekly_search_allowance ?? null;
        } catch {
          return null;
        }
      })(),
    ]);


    const rows = (jobs.data ?? []) as JobRow[];
    return jsonNoStore({
      jobs: rows.map((row) => {
        const match = first(row.job_seeker_matches);
        const application = first(row.job_seeker_applications);
        return {
          id: row.id,
          title: row.title,
          company: row.company,
          location: row.location,
          salaryText: row.salary_text,
          workModel: row.work_model,
          source: row.source,
          url: row.url,
          description: row.description,
          discoveredAt: row.discovered_at,
          savedAt: savedSupported ? row.saved_at ?? null : null,
          match: match
            ? {
              score: match.score,
              breakdown: match.breakdown ?? {},
              reasons: match.reasons ?? [],
              gaps: match.gaps ?? [],
              threshold: match.threshold_used,
              qualified: match.qualified,
            }
            : null,
          application: application ? { id: application.id, stage: application.stage } : null,
        };
      }),
      /*
       * Counts, not rows. A null count from Supabase means the count did not
       * come back — reported as null so the page can omit the figure rather
       * than print a zero it did not measure.
       */
      appliedThisWeek: applied,
      activeAlerts: alerts,
      searchesThisWeek: searches,
      weeklySearchAllowance: allowance,
      // Told plainly, so the page can say what is missing instead of guessing.
      savedJobsSupported: savedSupported,
      windowDays: DISCOVERY_WINDOW_DAYS,
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "job_seeker_discovery_unavailable", message: "Job discovery could not be loaded." } },
      { status: 500 },
    );
  }
}
