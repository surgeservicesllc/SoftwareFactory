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

const JOB_COLUMNS = `
  id, source, url, title, company, salary_text, location, work_model,
  description, discovered_at, saved_at,
  job_seeker_matches ( score, breakdown, reasons, gaps, threshold_used, qualified ),
  job_seeker_applications ( id, stage )
`;

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

    const [jobs, applied, alerts, searches, preferences] = await Promise.all([
      client
        .from("job_seeker_jobs")
        .select(JOB_COLUMNS)
        .eq("organization_id", activeOrganization.id)
        .order("discovered_at", { ascending: false })
        .limit(500),
      client
        .from("job_seeker_applications")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", activeOrganization.id)
        .gte("applied_at", since),
      client
        .from("job_seeker_search_alerts")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", activeOrganization.id)
        .eq("active", true),
      client
        .from("job_seeker_search_events")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", activeOrganization.id)
        .gte("created_at", since),
      client
        .from("job_seeker_preferences")
        .select("weekly_search_allowance, qualification_threshold")
        .eq("organization_id", activeOrganization.id)
        .maybeSingle(),
    ]);

    if (jobs.error) return databaseErrorResponse(jobs.error);

    const rows = (jobs.data ?? []) as unknown as JobRow[];
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
          savedAt: row.saved_at,
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
      appliedThisWeek: applied.count ?? null,
      activeAlerts: alerts.count ?? null,
      searchesThisWeek: searches.count ?? null,
      weeklySearchAllowance: preferences.data?.weekly_search_allowance ?? null,
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
