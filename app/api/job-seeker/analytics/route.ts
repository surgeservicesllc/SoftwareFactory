import {
  databaseErrorResponse,
  jsonNoStore,
} from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Analytics computed from recorded rows and nothing else. Every number here
 * is a count or an average over the person's own stored jobs, matches, and
 * applications — no estimate, no projection, no invented baseline. Rates
 * whose denominator is zero are null, not zero: "no applications yet" is a
 * different fact from "0% response rate".
 */

const RESPONSE_STAGES = ["RECRUITER_RESPONSE", "INTERVIEW", "FINAL_INTERVIEW", "OFFER"];
const APPLIED_STAGES = ["APPLIED", "FOLLOW_UP", ...RESPONSE_STAGES];
const INTERVIEW_STAGES = ["INTERVIEW", "FINAL_INTERVIEW", "OFFER"];

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();

    const [{ data: jobRows, error: jobsError }, { data: matchRows, error: matchesError }, { data: applicationRows, error: applicationsError }] =
      await Promise.all([
        client
          .from("job_seeker_jobs")
          .select("id, title, source")
          .eq("organization_id", activeOrganization.id),
        client
          .from("job_seeker_matches")
          .select("job_id, score, qualified")
          .eq("organization_id", activeOrganization.id),
        client
          .from("job_seeker_applications")
          .select("job_id, stage")
          .eq("organization_id", activeOrganization.id),
      ]);
    if (jobsError) return databaseErrorResponse(jobsError);
    if (matchesError) return databaseErrorResponse(matchesError);
    if (applicationsError) return databaseErrorResponse(applicationsError);

    const jobs = jobRows ?? [];
    const matches = matchRows ?? [];
    const applications = applicationRows ?? [];

    const applied = applications.filter((row) => APPLIED_STAGES.includes(row.stage));
    const responded = applications.filter((row) => RESPONSE_STAGES.includes(row.stage));
    const interviews = applications.filter((row) => INTERVIEW_STAGES.includes(row.stage));
    const offers = applications.filter((row) => row.stage === "OFFER");

    // Average score by recorded job title, for titles with a scored match.
    const scoreByJob = new Map(matches.map((match) => [match.job_id, match.score]));
    const byTitle = new Map<string, { total: number; count: number }>();
    for (const job of jobs) {
      const score = scoreByJob.get(job.id);
      if (score === undefined) continue;
      const entry = byTitle.get(job.title) ?? { total: 0, count: 0 };
      entry.total += score;
      entry.count += 1;
      byTitle.set(job.title, entry);
    }

    return jsonNoStore({
      analytics: {
        jobsFound: jobs.length,
        qualified: matches.filter((match) => match.qualified).length,
        applications: applied.length,
        responseRate: applied.length > 0 ? Math.round((responded.length / applied.length) * 100) : null,
        interviews: interviews.length,
        offers: offers.length,
        averageMatchScore:
          matches.length > 0
            ? Math.round(matches.reduce((sum, match) => sum + match.score, 0) / matches.length)
            : null,
        byTitle: [...byTitle.entries()]
          .map(([title, entry]) => ({
            title,
            jobs: entry.count,
            averageScore: Math.round(entry.total / entry.count),
          }))
          .sort((a, b) => b.averageScore - a.averageScore)
          .slice(0, 20),
        bySource: Object.entries(
          jobs.reduce<Record<string, number>>((acc, job) => {
            acc[job.source] = (acc[job.source] ?? 0) + 1;
            return acc;
          }, {}),
        ).map(([source, count]) => ({ source, count })),
      },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "job_seeker_analytics_unavailable", message: "Analytics could not be computed." } },
      { status: 500 },
    );
  }
}
