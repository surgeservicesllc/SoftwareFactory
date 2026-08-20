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
 * Job preferences: what the discovery and qualification lanes hunt for, and
 * the person's own qualification threshold (design default 80). One row per
 * person per organization, RLS-scoped to membership and ownership.
 */

const textList = (maxItems: number, maxLength: number) =>
  z.array(z.string().trim().min(1).max(maxLength)).max(maxItems);

const preferencesSchema = z
  .object({
    targetTitles: textList(50, 160).default([]),
    seniority: z.string().trim().min(1).max(120).nullish(),
    compensationMinimum: z.number().int().min(0).max(100_000_000).nullish(),
    locations: textList(50, 160).default([]),
    workArrangements: z.array(z.enum(["remote", "hybrid", "onsite", "any"])).max(4).default([]),
    industries: textList(50, 120).default([]),
    requiredCriteria: textList(50, 300).default([]),
    preferredCriteria: textList(50, 300).default([]),
    exclusions: textList(50, 300).default([]),
    qualificationThreshold: z.number().int().min(0).max(100).default(80),
  })
  .strict();

type PreferencesRow = {
  target_titles: unknown;
  seniority: string | null;
  compensation_minimum: number | null;
  locations: unknown;
  work_arrangements: unknown;
  industries: unknown;
  required_criteria: unknown;
  preferred_criteria: unknown;
  exclusions: unknown;
  qualification_threshold: number;
  updated_at: string | null;
};

function toView(row: PreferencesRow) {
  return {
    targetTitles: row.target_titles ?? [],
    seniority: row.seniority,
    compensationMinimum: row.compensation_minimum,
    locations: row.locations ?? [],
    workArrangements: row.work_arrangements ?? [],
    industries: row.industries ?? [],
    requiredCriteria: row.required_criteria ?? [],
    preferredCriteria: row.preferred_criteria ?? [],
    exclusions: row.exclusions ?? [],
    qualificationThreshold: row.qualification_threshold,
    updatedAt: row.updated_at,
  };
}

const PREFERENCES_COLUMNS =
  "target_titles, seniority, compensation_minimum, locations, work_arrangements, "
  + "industries, required_criteria, preferred_criteria, exclusions, "
  + "qualification_threshold, updated_at";

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("job_seeker_preferences")
      .select(PREFERENCES_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .maybeSingle<PreferencesRow>();
    if (error) return databaseErrorResponse(error);
    return jsonNoStore({ preferences: data ? toView(data) : null });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "job_seeker_preferences_unavailable", message: "Job preferences could not be loaded." } },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = preferencesSchema.parse(await readBoundedJson(request, 64_000));
    const sensitive = findSensitiveData(payload);
    if (sensitive) {
      throw new ApiRequestError(
        422,
        "sensitive_content",
        `The preferences appear to contain a credential-shaped value at ${sensitive.path}; remove it and save again.`,
      );
    }

    const { client, user, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("job_seeker_preferences")
      .upsert(
        {
          organization_id: activeOrganization.id,
          user_id: user.id,
          target_titles: payload.targetTitles,
          seniority: payload.seniority ?? null,
          compensation_minimum: payload.compensationMinimum ?? null,
          locations: payload.locations,
          work_arrangements: payload.workArrangements,
          industries: payload.industries,
          required_criteria: payload.requiredCriteria,
          preferred_criteria: payload.preferredCriteria,
          exclusions: payload.exclusions,
          qualification_threshold: payload.qualificationThreshold,
        },
        { onConflict: "organization_id,user_id" },
      )
      .select(PREFERENCES_COLUMNS)
      .single<PreferencesRow>();
    if (error) return databaseErrorResponse(error);
    return jsonNoStore({ preferences: toView(data) });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        { error: { code: "invalid_preferences", message: "The preferences payload is not valid.", issues: error.issues.slice(0, 5) } },
        { status: 422 },
      );
    }
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "job_seeker_preferences_unavailable", message: "Job preferences could not be saved." } },
      { status: 500 },
    );
  }
}
