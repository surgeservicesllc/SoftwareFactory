import { randomUUID } from "node:crypto";

import { z } from "zod";

import { createSupabaseGitHubWebhookClient } from "@/lib/github/service-role";
import {
  GrokStoreDatabaseError,
  mapGrokSessionDetail,
  readGrokBundle,
  readGrokProject,
  requestGrokControlIntent,
  resolveGrokControlIntent,
} from "@/lib/grok/session-store";
import { findSensitiveData } from "@/lib/security/sensitive-data";
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
const bodySchema = z.object({
  action: z.enum(["pause", "resume", "stop", "retry", "cancel"]),
  reason: z.string().trim().min(10).max(500).optional(),
  idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/).optional(),
}).strict();

const DEFAULT_REASON = Object.freeze({
  pause: "Owner paused this Grok Bot graph.",
  resume: "Owner resumed this Grok Bot graph.",
  stop: "Owner withdrew this Grok Bot graph.",
  retry: "Owner requested a bounded Grok Bot run retry.",
  cancel: "Owner requested safe-boundary cancellation of this Grok Bot run.",
});

type DatabaseError = { code?: string; message?: string };

export async function POST(
  request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const [params, body] = await Promise.all([
      context.params,
      readBoundedJson(request, 4 * 1024),
    ]);
    const parsedParams = paramsSchema.safeParse(params);
    const parsedBody = bodySchema.safeParse(body);
    if (!parsedParams.success || !parsedBody.success) {
      return jsonNoStore(
        { error: { code: "invalid_grok_control", message: "Provide a valid session, action, and bounded reason." } },
        { status: 400 },
      );
    }
    const reason = parsedBody.data.reason ?? DEFAULT_REASON[parsedBody.data.action];
    if (findSensitiveData(reason)) {
      return jsonNoStore(
        { error: { code: "sensitive_data_rejected", message: "Control reasons cannot contain credentials or secret values." } },
        { status: 400 },
      );
    }

    const tenant = await requireActiveOrganization();
    if (tenant.activeOrganization.role !== "owner") {
      return jsonNoStore(
        { error: { code: "owner_required", message: "Only an organization owner can control Grok Bot." } },
        { status: 403 },
      );
    }
    const bundle = await readGrokBundle(
      tenant.client,
      tenant.activeOrganization.id,
      parsedParams.data.sessionId,
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
    const before = await mapGrokSessionDetail(
      tenant.client,
      tenant.activeOrganization.id,
      project.name,
      bundle,
    );
    const databaseAction = parsedBody.data.action === "stop" ? "withdraw" : parsedBody.data.action;
    const graphAction = databaseAction === "pause" || databaseAction === "resume" || databaseAction === "withdraw";
    const targetId = graphAction ? before.session.graphId : before.session.graphRunId;
    if (!targetId) {
      return jsonNoStore(
        {
          error: {
            code: graphAction ? "grok_graph_not_planned" : "grok_run_not_started",
            message: graphAction
              ? "This session has no linked graph to control."
              : "This session has no durable graph run to control.",
          },
        },
        { status: 409 },
      );
    }

    const intent = await requestGrokControlIntent(tenant.client, {
      organizationId: tenant.activeOrganization.id,
      sessionId: bundle.session.id,
      targetKind: graphAction ? "graph" : "graph_run",
      targetId,
      action: databaseAction,
      reason,
      idempotencyKey: parsedBody.data.idempotencyKey ?? `control:${randomUUID()}`,
    });
    if (intent.state === "applied") {
      return jsonNoStore({
        ...before,
        control: { intentId: intent.id, action: parsedBody.data.action, state: "applied" },
        replayed: true,
        workerWoken: false,
      });
    }
    if (["failed", "rejected", "superseded"].includes(intent.state)) {
      return jsonNoStore(
        { error: { code: "grok_control_not_applied", message: "The recorded control intent was not applied." } },
        { status: 409 },
      );
    }

    let actionResult: { data: unknown; error: DatabaseError | null };
    if (databaseAction === "pause" || databaseAction === "resume") {
      actionResult = await tenant.client.rpc("set_graph_pause_as_member", {
        p_organization_id: tenant.activeOrganization.id,
        p_graph_id: targetId,
        p_paused: databaseAction === "pause",
      });
    } else if (databaseAction === "withdraw") {
      actionResult = await tenant.client.rpc("withdraw_graph_as_member", {
        p_organization_id: tenant.activeOrganization.id,
        p_graph_id: targetId,
        p_reason: reason,
      });
    } else if (databaseAction === "cancel") {
      actionResult = await tenant.client.rpc("request_phase1c_run_cancellation", {
        p_organization_id: tenant.activeOrganization.id,
        p_run_id: targetId,
        p_reason: reason,
      });
    } else {
      actionResult = await tenant.client.rpc("retry_phase1c_run", {
        p_organization_id: tenant.activeOrganization.id,
        p_run_id: targetId,
        p_reason: reason,
      });
    }

    const service = createSupabaseGitHubWebhookClient();
    if (actionResult.error) {
      await resolveGrokControlIntent(service, {
        organizationId: tenant.activeOrganization.id,
        intentId: intent.id,
        state: "failed",
        failureCode: "CONTROL_ACTION_FAILED",
        failureDetail: "The authorized control RPC refused or failed the requested action.",
      });
      return databaseErrorResponse(actionResult.error);
    }
    await resolveGrokControlIntent(service, {
      organizationId: tenant.activeOrganization.id,
      intentId: intent.id,
      state: "applied",
    });
    const afterBundle = await readGrokBundle(
      tenant.client,
      tenant.activeOrganization.id,
      bundle.session.id,
    );
    const after = await mapGrokSessionDetail(
      tenant.client,
      tenant.activeOrganization.id,
      project.name,
      afterBundle,
    );
    return jsonNoStore({
      ...after,
      control: { intentId: intent.id, action: parsedBody.data.action, state: "applied" },
      replayed: false,
      workerWoken: false,
      note: databaseAction === "resume"
        ? "The graph is claimable again; this control did not claim execution or wake a disabled worker."
        : "The control was durably applied by the existing audited runtime boundary.",
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof GrokStoreDatabaseError) return databaseErrorResponse(error.databaseError);
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "grok_control_failed", message: "The Grok control could not be applied safely." } },
      { status: 500 },
    );
  }
}
