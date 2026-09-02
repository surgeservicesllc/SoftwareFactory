import { z } from "zod";

import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import {
  buildKitBlocks,
  SCREENING_KEYS,
  SCREENING_QUESTIONS,
  toScreeningAnswers,
  type KitProfile,
  type ScreeningKey,
} from "@/lib/job-seeker/application-kit";
import { findSensitiveData } from "@/lib/server/sensitive-data";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * The application kit (ADR-244): the profile as the blocks an ATS form has
 * fields for, plus the screening answers the person keeps. GET composes;
 * PUT stores answers — one row per question from a fixed vocabulary, an
 * empty answer deleting the row. Every read and write is the caller's own
 * row under forced RLS.
 */

const PROFILE_COLUMNS =
  "full_name, email, phone, linkedin_url, location, summary, skills, technologies, certifications, employment_history, education";

type ProfileRow = {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  location: string | null;
  summary: string | null;
  skills: unknown;
  technologies: unknown;
  certifications: unknown;
  employment_history: unknown;
  education: unknown;
};

export function toKitProfile(row: ProfileRow): KitProfile {
  const list = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry) => typeof entry === "string") : []);
  return {
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    linkedinUrl: row.linkedin_url,
    location: row.location,
    summary: row.summary,
    skills: list(row.skills),
    technologies: list(row.technologies),
    certifications: list(row.certifications),
    employmentHistory: (Array.isArray(row.employment_history) ? row.employment_history : []) as KitProfile["employmentHistory"],
    education: (Array.isArray(row.education) ? row.education : []) as KitProfile["education"],
  };
}

// One optional field per known question, strict, so a partial save parses
// and an unknown question is refused rather than stored under a key nothing
// reads.
const answersSchema = z
  .object({
    answers: z
      .object(
        Object.fromEntries(
          SCREENING_KEYS.map((key) => [key, z.string().trim().max(500).nullable().optional()]),
        ) as Record<ScreeningKey, z.ZodOptional<z.ZodNullable<z.ZodString>>>,
      )
      .strict(),
  })
  .strict();

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const [{ data: profileRow, error: profileError }, { data: answerRows, error: answersError }] = await Promise.all([
      client.from("job_seeker_profiles").select(PROFILE_COLUMNS).eq("organization_id", activeOrganization.id).maybeSingle<ProfileRow>(),
      client.from("job_seeker_screening_answers").select("question_key, answer").eq("organization_id", activeOrganization.id),
    ]);
    if (profileError) return databaseErrorResponse(profileError);
    if (answersError) return databaseErrorResponse(answersError);
    const answers = toScreeningAnswers((answerRows ?? []) as Array<{ question_key: string; answer: string }>);
    return jsonNoStore({
      profileRecorded: profileRow !== null,
      blocks: profileRow === null ? [] : buildKitBlocks(toKitProfile(profileRow), answers),
      answers,
      questions: SCREENING_QUESTIONS,
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "application_kit_unavailable", message: "The application kit could not be read." } },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = answersSchema.parse(await readBoundedJson(request, 32_000));
    const sensitive = findSensitiveData(payload);
    if (sensitive) {
      throw new ApiRequestError(
        422,
        "sensitive_content",
        `An answer appears to contain a credential-shaped value at ${sensitive.path}; remove it and save again.`,
      );
    }
    const { client, user, activeOrganization } = await requireActiveOrganization();

    for (const [key, value] of Object.entries(payload.answers)) {
      const answer = (value ?? "").trim();
      if (answer.length === 0) {
        const { error } = await client
          .from("job_seeker_screening_answers")
          .delete()
          .eq("organization_id", activeOrganization.id)
          .eq("user_id", user.id)
          .eq("question_key", key);
        if (error) return databaseErrorResponse(error);
        continue;
      }
      const { error } = await client
        .from("job_seeker_screening_answers")
        .upsert(
          {
            organization_id: activeOrganization.id,
            user_id: user.id,
            question_key: key,
            answer,
            updated_at: new Date().toISOString(),
          },
          { onConflict: "organization_id,user_id,question_key" },
        );
      if (error) return databaseErrorResponse(error);
    }

    const { data: answerRows, error: readError } = await client
      .from("job_seeker_screening_answers")
      .select("question_key, answer")
      .eq("organization_id", activeOrganization.id);
    if (readError) return databaseErrorResponse(readError);
    return jsonNoStore({
      answers: toScreeningAnswers((answerRows ?? []) as Array<{ question_key: string; answer: string }>),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        { error: { code: "invalid_answers", message: "The answers payload is not valid.", issues: error.issues.slice(0, 5) } },
        { status: 422 },
      );
    }
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "application_kit_unavailable", message: "The answers could not be saved." } },
      { status: 500 },
    );
  }
}
