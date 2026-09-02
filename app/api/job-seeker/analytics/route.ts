import {
  databaseErrorResponse,
  jsonNoStore,
} from "@/lib/server/http";
import { buildFunnel, toReplyStats } from "@/lib/job-seeker/silence";
import { GAP_MINIMUM_POSTINGS, skillsGap, type RecordedPosting, type SkillGap } from "@/lib/job-seeker/what-costs";
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
          .select("id, title, source, company, description, discovered_at")
          .eq("organization_id", activeOrganization.id),
        client
          .from("job_seeker_matches")
          .select("job_id, score, qualified")
          .eq("organization_id", activeOrganization.id),
        client
          .from("job_seeker_applications")
          .select("job_id, stage, closed_reason, applied_at")
          .eq("organization_id", activeOrganization.id),
      ]);
    if (jobsError) return databaseErrorResponse(jobsError);
    if (matchesError) return databaseErrorResponse(matchesError);
    if (applicationsError) return databaseErrorResponse(applicationsError);

    const jobs = (jobRows ?? []) as Array<{
      id: string;
      title: string;
      source: string;
      company?: string | null;
      description?: string | null;
      discovered_at?: string | null;
    }>;
    const matches = matchRows ?? [];
    const applications = (applicationRows ?? []) as Array<{
      job_id: string;
      stage: string;
      closed_reason?: string | null;
      applied_at?: string | null;
    }>;

    /*
     * The skills gap (ADR-245): vocabulary terms the recorded postings keep
     * naming that the Career Profile does not list, ranked by how many
     * postings name them. Computed only against a recorded profile — a gap
     * measured against nothing would list every term in every posting and
     * call it a shortfall. Failure-tolerant like the ledger sections: an
     * unreadable profile answers null with the reason, never a zero.
     */
    let gap: SkillGap[] | null = null;
    let gapBasis: string;
    try {
      const { data: profileRow, error: profileError } = await client
        .from("job_seeker_profiles")
        .select("skills, technologies")
        .eq("organization_id", activeOrganization.id)
        .maybeSingle();
      if (profileError) {
        gapBasis = "The skills gap could not be computed: your Career Profile could not be read.";
      } else if (!profileRow) {
        gapBasis = "No Career Profile is recorded yet, so the skills gap is not computed — a gap measured against nothing would list every term in every posting.";
      } else {
        const profile = profileRow as { skills?: unknown; technologies?: unknown };
        const listed = [
          ...(Array.isArray(profile.skills) ? profile.skills : []),
          ...(Array.isArray(profile.technologies) ? profile.technologies : []),
        ].map(String);
        const qualifiedByJob = new Map(matches.map((match) => [match.job_id, match.qualified]));
        const applicationByJob = new Map(applications.map((row) => [row.job_id, row]));
        const postings: RecordedPosting[] = jobs.map((job) => {
          const application = applicationByJob.get(job.id);
          return {
            id: job.id,
            company: job.company ?? "",
            title: job.title,
            description: job.description ?? null,
            qualified: qualifiedByJob.get(job.id) ?? null,
            discoveredAt: job.discovered_at ?? "",
            application: application
              ? { stage: application.stage, appliedAt: application.applied_at ?? null, closedReason: application.closed_reason ?? null }
              : null,
          };
        });
        gap = skillsGap(postings, listed);
        gapBasis = `Counted over your ${postings.length} recorded posting${postings.length === 1 ? "" : "s"} against the ${listed.length} skills and technologies in your Career Profile; a term named by fewer than ${GAP_MINIMUM_POSTINGS} postings is not a pattern and is left out.`;
      }
    } catch {
      gap = null;
      gapBasis = "The skills gap could not be computed: your Career Profile could not be read.";
    }

    /*
     * Silence measured (ADR-243): the funnel counts applications that ever
     * reached each stage from the transitions ledger, closure reasons are
     * the person's own words counted (null counted as "unstated"), and
     * replies by source come from the same statistics the applications
     * page prints. Each is failure-tolerant — an unapplied migration
     * answers null for that section, never a fabricated zero.
     */
    let funnel: Array<{ stage: string; reached: number }> | null = null;
    try {
      const { data, error } = await client
        .from("job_seeker_application_transitions")
        .select("application_id, to_stage")
        .eq("organization_id", activeOrganization.id);
      if (!error && Array.isArray(data)) {
        funnel = buildFunnel(
          (data as Array<{ application_id: string; to_stage: string }>).map((row) => ({
            applicationId: row.application_id,
            toStage: row.to_stage,
          })),
        );
      }
    } catch {
      funnel = null;
    }
    let responseBySource: ReturnType<typeof toReplyStats>[] | null = null;
    try {
      const stats = await client.rpc("job_seeker_response_stats", { p_organization_id: activeOrganization.id });
      if (stats && !stats.error && Array.isArray(stats.data)) {
        responseBySource = (stats.data as Record<string, unknown>[]).map(toReplyStats);
      }
    } catch {
      responseBySource = null;
    }
    const closedReasons = Object.entries(
      applications
        .filter((row) => row.stage === "CLOSED")
        .reduce<Record<string, number>>((acc, row) => {
          const reason = row.closed_reason ?? "unstated";
          acc[reason] = (acc[reason] ?? 0) + 1;
          return acc;
        }, {}),
    )
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count);

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
        funnel,
        closedReasons,
        responseBySource,
        skillsGap: gap,
        skillsGapBasis: gapBasis,
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
