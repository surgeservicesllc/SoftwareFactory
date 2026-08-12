import { z } from "zod";

import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { findSensitiveData } from "@/lib/server/sensitive-data";
import { requireAuthenticatedUser } from "@/lib/supabase/auth";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { setActiveOrganizationId } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

const onboardingSchema = z
  .object({
    organizationName: z.string().trim().min(1).max(120),
    organizationSlug: z
      .string()
      .trim()
      .toLowerCase()
      .max(63)
      .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
      .optional(),
  })
  .strict();

type OnboardingResult = {
  organization_id: string;
  organization_name: string;
  organization_role: "owner";
  organization_slug: string;
  was_created: boolean;
};

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const parsed = onboardingSchema.safeParse(
      await readBoundedJson(request, 8 * 1024),
    );
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_onboarding",
            message: "Enter a valid organization name and optional slug.",
          },
        },
        { status: 400 },
      );
    }

    if (
      findSensitiveData({
        organizationName: parsed.data.organizationName,
        organizationSlug: parsed.data.organizationSlug ?? "",
      })
    ) {
      return jsonNoStore(
        {
          error: {
            code: "sensitive_data_rejected",
            message: "Organization details appear to contain sensitive data.",
          },
        },
        { status: 400 },
      );
    }

    const { client } = await requireAuthenticatedUser();
    const { data, error } = await client
      .rpc("onboard_authenticated_organization", {
        p_name: parsed.data.organizationName,
        p_slug: parsed.data.organizationSlug ?? null,
      })
      .single();

    if (error) {
      if (error.code === "23505") {
        return jsonNoStore(
          {
            error: {
              code: "organization_slug_conflict",
              message: "That organization slug is already in use.",
            },
          },
          { status: 409 },
        );
      }
      return databaseErrorResponse(error);
    }

    const result = data as OnboardingResult;
    await setActiveOrganizationId(result.organization_id);

    return jsonNoStore(
      {
        activeOrganizationId: result.organization_id,
        organization: {
          id: result.organization_id,
          name: result.organization_name,
          role: result.organization_role,
          slug: result.organization_slug,
        },
        created: result.was_created,
      },
      { status: result.was_created ? 201 : 200 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;

    return jsonNoStore(
      {
        error: {
          code: "onboarding_failed",
          message: "Organization onboarding failed safely.",
        },
      },
      { status: 500 },
    );
  }
}
