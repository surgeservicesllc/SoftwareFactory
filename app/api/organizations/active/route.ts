import { z } from "zod";

import {
  ApiRequestError,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { requireAuthenticatedUser } from "@/lib/supabase/auth";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import {
  listOrganizationMemberships,
  setActiveOrganizationId,
} from "@/lib/supabase/tenant";

export const runtime = "nodejs";

const selectionSchema = z
  .object({ organizationId: z.string().uuid() })
  .strict();

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const parsed = selectionSchema.safeParse(await readBoundedJson(request, 4 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_organization_selection",
            message: "Select a valid organization.",
          },
        },
        { status: 400 },
      );
    }

    const { client, user } = await requireAuthenticatedUser();
    const organizations = await listOrganizationMemberships(client, user.id);
    const selected = organizations.find(
      (organization) => organization.id === parsed.data.organizationId,
    );

    if (!selected) {
      return jsonNoStore(
        {
          error: {
            code: "active_organization_forbidden",
            message: "The selected organization is not available to this user.",
          },
        },
        { status: 403 },
      );
    }

    await setActiveOrganizationId(selected.id);
    return jsonNoStore({
      activeOrganizationId: selected.id,
      organization: selected,
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;

    return jsonNoStore(
      {
        error: {
          code: "organization_selection_failed",
          message: "The active organization was not changed.",
        },
      },
      { status: 500 },
    );
  }
}
