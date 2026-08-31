import { randomUUID } from "node:crypto";

import { z } from "zod";

import { phase1CTargetSchema } from "@/lib/graph/phase1c-gate-bridge";
import {
  applyGrokGraphControl,
  GrokStoreDatabaseError,
  mapGrokSessionDetail,
  readGrokBundle,
  readGrokProject,
} from "@/lib/grok/session-store";
import {
  dispatchGraphWorker,
  type Phase1CDispatchTarget,
} from "@/lib/orchestration/dispatch";
import {
  recordGrokWakeDispatch,
  type GrokWakeDispatchFailureCode,
} from "@/lib/grok/wake-dispatch";
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
  action: z.enum(["pause", "resume", "stop"]),
  reason: z.string().trim().min(10).max(500).optional(),
  idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9._:-]+$/).optional(),
}).strict();

const graphRepositoryBindingSchema = z.object({
  github_repository_id: z.string().uuid(),
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  pause_requested_at: z.string().datetime({ offset: true }).nullable(),
  project_id: z.string().uuid(),
  withdrawn_at: z.string().datetime({ offset: true }).nullable(),
}).strict();

const DEFAULT_REASON = Object.freeze({
  pause: "Owner paused this Grok Bot graph.",
  resume: "Owner resumed this Grok Bot graph.",
  stop: "Owner withdrew this Grok Bot graph.",
});

type TenantClient = Awaited<ReturnType<typeof requireActiveOrganization>>["client"];

function dispatchTarget(target: z.infer<typeof phase1CTargetSchema>): Phase1CDispatchTarget {
  return {
    appId: target.app_id,
    externalInstallationId: target.external_installation_id,
    externalRepositoryId: target.external_repository_id,
    repositoryFullName: target.repository_full_name,
  };
}

/**
 * Best-effort wake after the durable resume has committed.
 *
 * A replay intentionally retries this dispatch. The repository event carries
 * only the exact graph UUID, while the worker's target-bound claim remains the
 * authority and serializes duplicate wakes. A missing, stale, or conflicting
 * repository binding therefore returns Not Connected rather than dispatching
 * to a repository inferred from the session or prompt.
 */
async function wakeResumedGraph(
  client: TenantClient,
  organizationId: string,
  projectId: string,
  sessionId: string,
  graphId: string,
  wakeIntentId: string,
  controlRevision: number,
): Promise<boolean> {
  const record = async (
    outcome: "accepted" | "failed",
    failureCode: GrokWakeDispatchFailureCode | null,
  ) => {
    try {
      await recordGrokWakeDispatch({
        organizationId,
        projectId,
        sessionId,
        graphId,
        wakeIntentId,
        controlRevision,
        outcome,
        failureCode,
        idempotencyKey: `wake-dispatch:${randomUUID()}`,
      });
      return outcome === "accepted";
    } catch {
      // Without the immutable database row, an accepted GitHub HTTP response
      // is not durable evidence and the worker receipt will fail closed.
      return false;
    }
  };
  try {
    const admissionRead = await client.rpc("assert_grok_graph_admission_as_member", {
      p_organization_id: organizationId,
      p_graph_id: graphId,
    });
    if (admissionRead.error || admissionRead.data !== true) {
      return record("failed", "ADMISSION_STALE");
    }
    const graphRead = await client.from("graphs")
      .select("id,organization_id,project_id,github_repository_id,pause_requested_at,withdrawn_at")
      .eq("id", graphId)
      .eq("organization_id", organizationId)
      .eq("project_id", projectId)
      .maybeSingle();
    if (graphRead.error) return record("failed", "GRAPH_STALE");
    const graph = graphRepositoryBindingSchema.safeParse(graphRead.data);
    if (
      !graph.success
      || graph.data.id !== graphId
      || graph.data.organization_id !== organizationId
      || graph.data.project_id !== projectId
      || graph.data.pause_requested_at !== null
      || graph.data.withdrawn_at !== null
    ) return record("failed", "GRAPH_STALE");
    const targetRead = await client.rpc("resolve_phase1c_command_target", {
      p_organization_id: organizationId,
      p_project_id: projectId,
    }).single();
    if (targetRead.error) return record("failed", "TARGET_UNAVAILABLE");
    const target = phase1CTargetSchema.safeParse(targetRead.data);
    if (
      !target.success
      || target.data.project_id !== projectId
      || target.data.repository_id !== graph.data.github_repository_id
    ) return record("failed", "TARGET_MISMATCH");
    const result = await dispatchGraphWorker(dispatchTarget(target.data), graphId, {
      wakeIntentId,
      controlRevision,
    });
    return result.dispatched
      ? record("accepted", null)
      : record("failed", "WORKER_DISABLED");
  } catch {
    return record("failed", "DISPATCH_ERROR");
  }
}

function resumeNote(
  dispatchAccepted: boolean,
  workerAcknowledged: boolean,
  replayed: boolean,
): string {
  if (workerAcknowledged) {
    return "The exact graph worker claim has a durable matching receipt. GitHub dispatch acceptance and worker acknowledgement are recorded separately.";
  }
  if (dispatchAccepted) {
    return replayed
      ? "The resume was already applied and GitHub accepted another exact recovery dispatch. The worker is not marked woken until it claims this graph and records the matching receipt."
      : "GitHub accepted the exact graph dispatch. The worker is not marked woken until it claims this graph and records the matching receipt.";
  }
  return replayed
    ? "The resume was already applied, but no durable recovery dispatch acceptance was recorded. The graph worker is Not Connected and no worker receipt exists."
    : "The resume committed, but no durable dispatch acceptance was recorded. The graph worker is Not Connected and no worker receipt exists.";
}

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
    const graphId = before.session.graphId;
    if (!graphId) {
      return jsonNoStore(
        {
          error: {
            code: "grok_graph_not_planned",
            message: "This session has no linked graph to control.",
          },
        },
        { status: 409 },
      );
    }
    const control = await applyGrokGraphControl(tenant.client, {
      organizationId: tenant.activeOrganization.id,
      sessionId: bundle.session.id,
      graphId,
      action: databaseAction,
      reason,
      idempotencyKey: parsedBody.data.idempotencyKey ?? `control:${randomUUID()}`,
    });
    let dispatchAccepted = false;
    if (
      databaseAction === "resume"
      && control.wake_intent_id !== null
      && control.control_revision !== null
    ) {
      dispatchAccepted = await wakeResumedGraph(
        tenant.client,
        tenant.activeOrganization.id,
        project.projectId,
        bundle.session.id,
        graphId,
        control.wake_intent_id,
        control.control_revision,
      );
    }
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
    const wakeEvidence = after.wakeEvidence ?? null;
    const workerAcknowledged = control.wake_intent_id !== null
      && control.control_revision !== null
      && wakeEvidence !== null
      && wakeEvidence.wakeIntentId === control.wake_intent_id
      && wakeEvidence.controlRevision === control.control_revision
      && wakeEvidence.workerAcknowledged === true
      && wakeEvidence.workerWoken === true;
    return jsonNoStore({
      ...after,
      control: {
        intentId: control.intent_id,
        action: parsedBody.data.action,
        state: "applied",
        wakeIntentId: control.wake_intent_id,
        controlRevision: control.control_revision,
      },
      replayed: control.replayed,
      dispatchAccepted,
      workerAcknowledged,
      workerWoken: workerAcknowledged,
      note: databaseAction === "resume"
        ? resumeNote(dispatchAccepted, workerAcknowledged, control.replayed)
        : control.replayed
          ? "The control was already durably applied; no worker dispatch was required."
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
