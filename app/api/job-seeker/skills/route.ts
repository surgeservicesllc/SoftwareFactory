import {
  SKILL_GAP_METHOD_LABEL,
  analyseSkillGaps,
  type PostingForGapAnalysis,
} from "@/lib/job-seeker/skill-gaps";
import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Skill gaps, counted from this person's own recorded postings.
 *
 * There is no market data behind this and the response says so: `analysed` is
 * the sample size and `skipped` names the postings that carried no text to
 * read. A person looking at a two-posting sample should be able to tell that
 * from the answer rather than from the shape of the chart.
 */
export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();

    const [{ data: jobRows, error: jobsError }, { data: matchRows, error: matchesError }, { data: profileRow, error: profileError }] =
      await Promise.all([
        client
          .from("job_seeker_jobs")
          .select("id, title, company, description")
          .eq("organization_id", activeOrganization.id),
        client
          .from("job_seeker_matches")
          .select("job_id, score")
          .eq("organization_id", activeOrganization.id),
        client
          .from("job_seeker_profiles")
          .select("skills, technologies, certifications")
          .eq("organization_id", activeOrganization.id)
          .maybeSingle<{ skills: unknown; technologies: unknown; certifications: unknown }>(),
      ]);
    if (jobsError) return databaseErrorResponse(jobsError);
    if (matchesError) return databaseErrorResponse(matchesError);
    if (profileError) return databaseErrorResponse(profileError);

    const scoreByJob = new Map((matchRows ?? []).map((row) => [row.job_id, row.score as number]));
    const postings: PostingForGapAnalysis[] = (jobRows ?? []).map((row) => ({
      title: row.title as string,
      company: row.company as string,
      description: (row.description ?? null) as string | null,
      score: scoreByJob.get(row.id as string) ?? null,
    }));

    const profileTerms = [
      ...((profileRow?.skills ?? []) as string[]),
      ...((profileRow?.technologies ?? []) as string[]),
      ...((profileRow?.certifications ?? []) as string[]),
    ];

    return jsonNoStore({
      skills: analyseSkillGaps(postings, profileTerms),
      // A profile with nothing recorded makes every term a "gap", which is
      // technically true and useless as advice. The surface needs to know.
      profileRecorded: profileTerms.length,
      method: SKILL_GAP_METHOD_LABEL,
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "skills_unavailable", message: "Skill gaps could not be computed." } },
      { status: 500 },
    );
  }
}
