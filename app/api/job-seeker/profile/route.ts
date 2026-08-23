import { z } from "zod";

import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { findSensitiveData } from "@/lib/server/sensitive-data";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * The career profile: the master source of truth every generated document
 * must draw from, and nothing else may. One row per person per organization,
 * RLS-scoped to organization membership AND row ownership — this endpoint
 * only ever reads or writes the caller's own row.
 */

const textList = (maxItems: number, maxLength: number) =>
  z.array(z.string().trim().min(1).max(maxLength)).max(maxItems);

const historyEntry = z
  .object({
    organization: z.string().trim().min(1).max(200),
    title: z.string().trim().min(1).max(200),
    started: z.string().trim().min(1).max(40).optional(),
    ended: z.string().trim().min(1).max(40).optional(),
    summary: z.string().trim().max(2000).optional(),
    highlights: textList(20, 500).optional(),
  })
  .strict();

const profileSchema = z
  .object({
    fullName: z.string().trim().min(1).max(200).nullish(),
    email: z.string().trim().email().max(320).nullish(),
    phone: z.string().trim().min(3).max(40).nullish(),
    linkedinUrl: z.string().trim().url().startsWith("https://").max(400).nullish(),
    location: z.string().trim().min(1).max(200).nullish(),
    summary: z.string().trim().max(4000).nullish(),
    salaryTarget: z.number().int().min(0).max(100_000_000).nullish(),
    salaryCurrency: z.string().regex(/^[A-Z]{3}$/).default("USD"),
    workArrangement: z.enum(["remote", "hybrid", "onsite", "any"]).default("any"),
    openToTravel: z.boolean().default(false),
    openToRelocation: z.boolean().default(false),
    employmentHistory: z.array(historyEntry).max(40).default([]),
    education: z.array(historyEntry).max(40).default([]),
    accomplishments: textList(100, 500).default([]),
    skills: textList(200, 120).default([]),
    certifications: textList(100, 200).default([]),
    technologies: textList(200, 120).default([]),
    industries: textList(50, 120).default([]),
  })
  .strict();

type ProfileRow = {
  full_name: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  location: string | null;
  summary: string | null;
  salary_target: number | null;
  salary_currency: string;
  work_arrangement: string;
  open_to_travel: boolean;
  open_to_relocation: boolean;
  employment_history: unknown;
  education: unknown;
  accomplishments: unknown;
  skills: unknown;
  certifications: unknown;
  technologies: unknown;
  industries: unknown;
  updated_at: string | null;
  resume_upload: ResumeUploadEmbed | ResumeUploadEmbed[] | null;
};

/*
 * Many-to-one embed via profiles.resume_upload_id — live PostgREST returns
 * it as a single object (or null); the array form is tolerated for the same
 * reason as the jobs route's embeds (the shape follows constraint detection).
 */
type ResumeUploadEmbed = {
  id: string;
  filename: string;
  byte_size: number;
  created_at: string;
};

function firstEmbed<T>(value: T | T[] | null | undefined): T | null {
  return Array.isArray(value) ? (value[0] ?? null) : (value ?? null);
}

function toView(row: ProfileRow) {
  const resumeUpload = firstEmbed(row.resume_upload);
  return {
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    linkedinUrl: row.linkedin_url,
    location: row.location,
    summary: row.summary,
    salaryTarget: row.salary_target,
    salaryCurrency: row.salary_currency,
    workArrangement: row.work_arrangement,
    openToTravel: row.open_to_travel,
    openToRelocation: row.open_to_relocation,
    employmentHistory: row.employment_history ?? [],
    education: row.education ?? [],
    accomplishments: row.accomplishments ?? [],
    skills: row.skills ?? [],
    certifications: row.certifications ?? [],
    technologies: row.technologies ?? [],
    industries: row.industries ?? [],
    updatedAt: row.updated_at,
    resumeUpload: resumeUpload
      ? {
        id: resumeUpload.id,
        filename: resumeUpload.filename,
        byteSize: resumeUpload.byte_size,
        createdAt: resumeUpload.created_at,
      }
      : null,
  };
}

const PROFILE_COLUMNS =
  "full_name, email, phone, linkedin_url, location, summary, salary_target, "
  + "salary_currency, work_arrangement, open_to_travel, open_to_relocation, "
  + "employment_history, education, accomplishments, skills, certifications, "
  + "technologies, industries, updated_at, "
  + "resume_upload:job_seeker_uploads ( id, filename, byte_size, created_at )";

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("job_seeker_profiles")
      .select(PROFILE_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .maybeSingle<ProfileRow>();
    if (error) return databaseErrorResponse(error);
    return jsonNoStore({ profile: data ? toView(data) : null });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "job_seeker_profile_unavailable", message: "The career profile could not be loaded." } },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = profileSchema.parse(await readBoundedJson(request, 256_000));

    // A pasted token has no place in a career profile; refuse it at the door
    // the way project descriptions are refused.
    const sensitive = findSensitiveData(payload);
    if (sensitive) {
      throw new ApiRequestError(
        422,
        "sensitive_content",
        `The profile appears to contain a credential-shaped value at ${sensitive.path}; remove it and save again.`,
      );
    }

    const { client, user, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("job_seeker_profiles")
      .upsert(
        {
          organization_id: activeOrganization.id,
          user_id: user.id,
          full_name: payload.fullName ?? null,
          email: payload.email ?? null,
          phone: payload.phone ?? null,
          linkedin_url: payload.linkedinUrl ?? null,
          location: payload.location ?? null,
          summary: payload.summary ?? null,
          salary_target: payload.salaryTarget ?? null,
          salary_currency: payload.salaryCurrency,
          work_arrangement: payload.workArrangement,
          open_to_travel: payload.openToTravel,
          open_to_relocation: payload.openToRelocation,
          employment_history: payload.employmentHistory,
          education: payload.education,
          accomplishments: payload.accomplishments,
          skills: payload.skills,
          certifications: payload.certifications,
          technologies: payload.technologies,
          industries: payload.industries,
        },
        { onConflict: "organization_id,user_id" },
      )
      .select(PROFILE_COLUMNS)
      .single<ProfileRow>();
    if (error) return databaseErrorResponse(error);
    return jsonNoStore({ profile: toView(data) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        { error: { code: "invalid_profile", message: "The profile payload is not valid.", issues: error.issues.slice(0, 5) } },
        { status: 422 },
      );
    }
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "job_seeker_profile_unavailable", message: "The career profile could not be saved." } },
      { status: 500 },
    );
  }
}
