import { z } from "zod";

import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { insertScoredJob, loadEvaluationInputs } from "@/lib/job-seeker/record";
import { describeSilence, toReplyStats, type ReplyStats, type SilenceView } from "@/lib/job-seeker/silence";
import { findSensitiveData } from "@/lib/server/sensitive-data";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Recorded jobs, with their match evaluation. Recording is manual today —
 * the `source` column says so — and every score is computed from recorded
 * facts at recording time, stored with its breakdown, reasons, and gaps so
 * the number never stands without its evidence.
 */

const recordJobSchema = z
  .object({
    title: z.string().trim().min(1).max(300),
    company: z.string().trim().min(1).max(300),
    /*
     * `.url()` accepts `javascript:` — it is a valid URL — and this value is
     * rendered as an `href` on the jobs panel. The column's `^https?://`
     * CHECK does refuse it, so nothing unsafe was ever stored; what was wrong
     * is that the refusal arrived as a database error instead of as a clear
     * answer, and the scheme was never checked by the code that treats the
     * value as a link.
     */
    url: z
      .string()
      .trim()
      .url()
      .max(800)
      .refine((value) => /^https?:\/\//i.test(value), { message: "A job link must be http or https." })
      .nullish(),
    externalId: z.string().trim().min(1).max(200).nullish(),
    salaryText: z.string().trim().min(1).max(200).nullish(),
    location: z.string().trim().min(1).max(200).nullish(),
    workModel: z.enum(["remote", "hybrid", "onsite", "any"]).nullish(),
    description: z.string().trim().max(30_000).nullish(),
  })
  .strict();

type JobRow = {
  id: string;
  source: string;
  external_id: string | null;
  url: string | null;
  title: string;
  company: string;
  salary_text: string | null;
  location: string | null;
  work_model: string | null;
  description: string | null;
  discovered_at: string;
  job_seeker_matches: MatchEmbed | MatchEmbed[] | null;
  job_seeker_applications: ApplicationEmbed | ApplicationEmbed[] | null;
};

type MatchEmbed = {
  score: number;
  breakdown: Record<string, number>;
  reasons: string[];
  gaps: string[];
  threshold_used: number;
  qualified: boolean;
};

type ApplicationEmbed = {
  id: string;
  stage: string;
  approval_status: string;
  application_url: string | null;
  notes: string | null;
  follow_up_at: string | null;
  applied_at: string | null;
  closed_reason?: string | null;
};

/*
 * Both embeds are one-to-one — job_seeker_matches and job_seeker_applications
 * each carry `unique (job_id)` — so live PostgREST returns them as a single
 * object (or null), not an array. The array shape is still accepted because
 * shape detection follows the constraint, and a fixture or a schema cache
 * mid-reload can present the other form. Reading only `[0]` here made every
 * live record look unscored: the journey test caught it against the real
 * stack.
 */
function firstEmbed<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

const JOB_COLUMNS =
  "id, source, external_id, url, title, company, salary_text, location, work_model, "
  + "description, discovered_at, "
  + "job_seeker_matches ( score, breakdown, reasons, gaps, threshold_used, qualified ), "
  + "job_seeker_applications ( id, stage, approval_status, application_url, notes, follow_up_at, applied_at, closed_reason )";

/**
 * Silence measured (ADR-243): the first reply each application recorded
 * and the person's reply statistics, read once per request through the
 * two invoker functions. Both are failure-tolerant — an unapplied
 * migration leaves `silence` null on every application and the list
 * still answers — and nothing here is a guess about employers: the
 * comparison is the person's own medians.
 */
type SilenceInputs = Readonly<{ replies: ReadonlyMap<string, string>; stats: readonly ReplyStats[] }>;

async function loadSilenceInputs(
  client: Awaited<ReturnType<typeof requireActiveOrganization>>["client"],
  organizationId: string,
): Promise<SilenceInputs | null> {
  try {
    const [replies, stats] = await Promise.all([
      client.rpc("job_seeker_application_replies", { p_organization_id: organizationId }),
      client.rpc("job_seeker_response_stats", { p_organization_id: organizationId }),
    ]);
    if (!replies || replies.error || !Array.isArray(replies.data)) return null;
    if (!stats || stats.error || !Array.isArray(stats.data)) return null;
    return {
      replies: new Map(
        (replies.data as Array<{ application_id: string; replied_at: string }>).map((row) => [row.application_id, row.replied_at]),
      ),
      stats: (stats.data as Record<string, unknown>[]).map(toReplyStats),
    };
  } catch {
    return null;
  }
}

function toView(row: JobRow, silenceInputs: SilenceInputs | null = null) {
  const match = firstEmbed(row.job_seeker_matches);
  const application = firstEmbed(row.job_seeker_applications);
  return {
    id: row.id,
    source: row.source,
    externalId: row.external_id,
    url: row.url,
    title: row.title,
    company: row.company,
    salaryText: row.salary_text,
    location: row.location,
    workModel: row.work_model,
    description: row.description,
    discoveredAt: row.discovered_at,
    match: match
      ? {
        score: match.score,
        breakdown: match.breakdown,
        reasons: match.reasons ?? [],
        gaps: match.gaps ?? [],
        threshold: match.threshold_used,
        qualified: match.qualified,
      }
      : null,
    application: application
      ? {
        id: application.id,
        stage: application.stage,
        /*
         * When it was actually submitted, which is a different question from
         * when the job was discovered. The Overview plots submissions over
         * time, and plotting discovery instead would be a chart that answers
         * a question nobody asked while carrying the label of one they did.
         */
        appliedAt: application.applied_at,
        approvalStatus: application.approval_status,
        applicationUrl: application.application_url,
        notes: application.notes,
        followUpAt: application.follow_up_at,
        closedReason: application.closed_reason ?? null,
        silence: silenceInputs === null
          ? null
          : describeSilence({
              appliedAt: application.applied_at,
              repliedAt: silenceInputs.replies.get(application.id) ?? null,
              stage: application.stage,
              source: row.source,
              stats: silenceInputs.stats,
            }) satisfies SilenceView | null,
      }
      : null,
  };
}

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("job_seeker_jobs")
      .select(JOB_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .order("discovered_at", { ascending: false })
      .limit(200);
    if (error) return databaseErrorResponse(error);
    const silenceInputs = await loadSilenceInputs(client, activeOrganization.id);
    return jsonNoStore({
      jobs: ((data ?? []) as unknown as JobRow[]).map((row) => toView(row, silenceInputs)),
      /** Whether silence could be measured; null silence on every row otherwise. */
      silenceBasis: silenceInputs === null
        ? "Days silent could not be measured: the transitions ledger is not readable on this deployment."
        : "Days silent are counted from your own applications' recorded replies; suggested follow-ups print their arithmetic.",
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "job_seeker_jobs_unavailable", message: "Recorded jobs could not be listed." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = recordJobSchema.parse(await readBoundedJson(request, 128_000));
    const sensitive = findSensitiveData(payload);
    if (sensitive) {
      throw new ApiRequestError(
        422,
        "sensitive_content",
        `The job record appears to contain a credential-shaped value at ${sensitive.path}; remove it and record again.`,
      );
    }

    const { client, user, activeOrganization } = await requireActiveOrganization();

    // The evaluation draws on recorded facts; absent rows evaluate honestly
    // as absent facts (the gaps will say the profile is empty). Recording
    // crosses ONE database boundary: record_job_seeker_job commits the job,
    // its match, its pipeline entry, and the audit event together, exactly
    // as the automated scan path does — a manual record used to be three
    // separate inserts that could half-land.
    const inputs = await loadEvaluationInputs(client, activeOrganization.id);
    const outcome = await insertScoredJob(client, {
      organizationId: activeOrganization.id,
      userId: user.id,
      source: "manual",
      job: {
        externalId: payload.externalId ?? null,
        url: payload.url ?? null,
        title: payload.title,
        company: payload.company,
        salaryText: payload.salaryText ?? null,
        location: payload.location ?? null,
        workModel: payload.workModel === "any" ? null : payload.workModel ?? null,
        description: payload.description ?? null,
      },
      inputs,
    });
    if (outcome.outcome === "duplicate") {
      return jsonNoStore(
        { error: { code: "duplicate_job", message: "This job is already recorded: same company, title, and job id." } },
        { status: 409 },
      );
    }

    const { data: fullRow, error: readError } = await client
      .from("job_seeker_jobs")
      .select(JOB_COLUMNS)
      .eq("id", outcome.jobId)
      .single<JobRow>();
    if (readError) return databaseErrorResponse(readError);
    return jsonNoStore({ job: toView(fullRow as unknown as JobRow) }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        { error: { code: "invalid_job", message: "The job payload is not valid.", issues: error.issues.slice(0, 5) } },
        { status: 422 },
      );
    }
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "job_seeker_jobs_unavailable", message: "The job could not be recorded." } },
      { status: 500 },
    );
  }
}
