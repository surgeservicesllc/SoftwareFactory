import { z } from "zod";

import {
  GrokStoreDatabaseError,
  mapGrokSessionDetail,
  readGrokBundle,
  readGrokProject,
} from "@/lib/grok/session-store";
import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

const paramsSchema = z.object({ sessionId: z.string().uuid() }).strict();

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_grok_session", message: "The Grok session id is invalid." } },
        { status: 400 },
      );
    }
    const tenant = await requireActiveOrganization();
    if (tenant.activeOrganization.role !== "owner") {
      return jsonNoStore(
        { error: { code: "owner_required", message: "Only an organization owner can use Grok Bot." } },
        { status: 403 },
      );
    }
    const bundle = await readGrokBundle(
      tenant.client,
      tenant.activeOrganization.id,
      parsed.data.sessionId,
    );
    const project = await readGrokProject(
      tenant.client,
      tenant.activeOrganization.id,
      bundle.session.project_id,
    );
    if (!project) {
      return jsonNoStore(
        { error: { code: "grok_project_unavailable", message: "The session's project is unavailable." } },
        { status: 409 },
      );
    }
    return jsonNoStore(await mapGrokSessionDetail(
      tenant.client,
      tenant.activeOrganization.id,
      project.name,
      bundle,
    ));
  } catch (error) {
    if (error instanceof GrokStoreDatabaseError) return databaseErrorResponse(error.databaseError);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "grok_session_unavailable", message: "The Grok session could not be loaded." } },
      { status: 500 },
    );
  }
}

