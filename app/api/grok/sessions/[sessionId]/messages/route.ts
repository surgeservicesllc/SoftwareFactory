import { randomUUID } from "node:crypto";

import { z } from "zod";

import { GrokContextInputError, normalizeGrokContext } from "@/lib/grok/context";
import {
  appendGrokFollowUpContext,
  GrokStoreDatabaseError,
  mapGrokSessionDetail,
  readGrokBundle,
  readGrokProject,
} from "@/lib/grok/session-store";
import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

const paramsSchema = z.object({ sessionId: z.string().uuid() }).strict();
const requestSchema = z.object({
  prompt: z.string().min(1).max(4_000).refine((value) => value.trim().length > 0),
  context: z.array(z.unknown()).max(10).default([]),
  idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/).optional(),
}).strict();

function ownerRequired() {
  return jsonNoStore(
    { error: { code: "owner_required", message: "Only an organization owner can use Grok Bot." } },
    { status: 403 },
  );
}

export async function POST(
  request: Request,
  routeContext: { params: Promise<{ sessionId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const [params, body] = await Promise.all([
      routeContext.params.then((value) => paramsSchema.safeParse(value)),
      readBoundedJson(request, 80 * 1024).then((value) => requestSchema.safeParse(value)),
    ]);
    if (!params.success || !body.success) {
      return jsonNoStore(
        { error: { code: "invalid_grok_follow_up", message: "Provide one bounded follow-up and valid context references." } },
        { status: 400 },
      );
    }

    const tenant = await requireActiveOrganization();
    if (tenant.activeOrganization.role !== "owner") return ownerRequired();
    let bundle = await readGrokBundle(
      tenant.client,
      tenant.activeOrganization.id,
      params.data.sessionId,
    );
    const project = await readGrokProject(
      tenant.client,
      tenant.activeOrganization.id,
      bundle.session.project_id,
    );
    if (!project || project.status === "archived") {
      return jsonNoStore(
        { error: { code: "grok_project_not_ready", message: "The session's exact tenant project is unavailable." } },
        { status: 409 },
      );
    }
    const items = normalizeGrokContext(body.data.context, project);
    const latestMessage = bundle.messages.at(-1) ?? null;
    const result = await appendGrokFollowUpContext(tenant.client, {
      organizationId: tenant.activeOrganization.id,
      projectId: project.projectId,
      sessionId: bundle.session.id,
      content: body.data.prompt,
      items: items as unknown as readonly Record<string, unknown>[],
      idempotencyKey: body.data.idempotencyKey ?? `grok-follow-up:${randomUUID()}`,
      expectedMessageSequence: bundle.next.message_sequence,
      expectedEventSequence: bundle.next.event_sequence,
      replyToMessageId: latestMessage?.id ?? null,
    });
    bundle = await readGrokBundle(tenant.client, tenant.activeOrganization.id, bundle.session.id);
    const detail = await mapGrokSessionDetail(
      tenant.client,
      tenant.activeOrganization.id,
      project.name,
      bundle,
    );
    return jsonNoStore({
      ...detail,
      turn: {
        messageId: result.message.id,
        envelopeId: result.envelope.id,
        replayed: result.replayed,
        planChanged: false,
        replanRequired: result.replan_required,
      },
      workerWoken: false,
      automaticActionStarted: false,
    }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof GrokContextInputError) {
      return jsonNoStore(
        { error: { code: "invalid_grok_context", message: error.message } },
        { status: 400 },
      );
    }
    if (error instanceof GrokStoreDatabaseError) return databaseErrorResponse(error.databaseError);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "grok_follow_up_failed", message: "The Grok follow-up could not be recorded safely." } },
      { status: 500 },
    );
  }
}
