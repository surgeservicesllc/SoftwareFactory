import { z } from "zod";

import {
  CRM_DEVICE_CONDITIONS,
  toFieldSettledView,
  type CrmFieldSettledRow,
} from "@/lib/services/crm";
import { ApiRequestError, jsonNoStore, readBoundedJson, requestErrorResponse } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

/**
 * The field app's sync endpoint.
 *
 * Every write here is idempotent on a token the DEVICE minted before its
 * first attempt, so this route may be called with the same body any number
 * of times. That is not a nicety — a queue draining through a tunnel will
 * do exactly that, and the alternative to idempotence is a duplicate
 * completed visit or a double-counted station scan in an append-only
 * ledger that cannot be corrected.
 *
 * The response always says whether the write was NEW or a REPLAY, because
 * a device that cannot tell those apart cannot report honestly what it
 * still owes.
 */

const UUID = z.string().uuid();
const ISO = z.string().datetime({ offset: true });

const completeSchema = z.object({
  kind: z.literal("complete_work_order"),
  clientToken: UUID,
  workOrderId: UUID,
  occurredAt: ISO,
  notes: z.string().trim().min(1).max(3500).nullish(),
}).strict();

const scanSchema = z.object({
  kind: z.literal("device_scan"),
  clientToken: UUID,
  deviceId: UUID,
  occurredAt: ISO,
  condition: z.enum(CRM_DEVICE_CONDITIONS as unknown as [string, ...string[]]).nullish(),
  activityCount: z.number().int().min(0).max(100_000).nullish(),
  pestObserved: z.string().trim().min(1).max(120).nullish(),
  note: z.string().trim().min(1).max(1000).nullish(),
}).strict();

const submitSchema = z.discriminatedUnion("kind", [completeSchema, scanSchema]);

const reconcileSchema = z.object({
  tokens: z.array(UUID).min(1).max(500),
}).strict();

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = submitSchema.parse(await readBoundedJson(request, 32_000));
    const { client } = await requireActiveOrganization();

    if (payload.kind === "complete_work_order") {
      const { data, error } = await client.rpc("crm_field_complete_visit", {
        p_token: payload.clientToken,
        p_work_order: payload.workOrderId,
        p_occurred_at: payload.occurredAt,
        p_notes: payload.notes ?? null,
      });
      if (error) return submissionFailure(error);
      const row = ((data ?? []) as { work_order_id: string; replayed: boolean }[])[0];
      return jsonNoStore({
        settled: true,
        replayed: row?.replayed ?? false,
        resultId: row?.work_order_id ?? null,
      });
    }

    const { data, error } = await client.rpc("crm_field_record_scan", {
      p_token: payload.clientToken,
      p_device: payload.deviceId,
      p_occurred_at: payload.occurredAt,
      p_condition: payload.condition ?? null,
      p_activity_count: payload.activityCount ?? null,
      p_pest_observed: payload.pestObserved ?? null,
      p_note: payload.note ?? null,
    });
    if (error) return submissionFailure(error);
    const row = ((data ?? []) as { device_event_id: string; replayed: boolean }[])[0];
    return jsonNoStore({
      settled: true,
      replayed: row?.replayed ?? false,
      resultId: row?.device_event_id ?? null,
    });
  } catch (error) {
    return failure(error, "invalid_field_submission", "field_submission_failed",
      "That could not be sent.");
  }
}

/**
 * Which of these tokens did the server actually get?
 *
 * A device coming back after a week asks this before replaying anything.
 * The server's answer settles it — a client trusting only its own storage
 * can be wrong in the one direction that matters, believing a write landed
 * when it never arrived.
 */
export async function PUT(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = reconcileSchema.parse(await readBoundedJson(request, 32_000));
    const { client } = await requireActiveOrganization();

    const { data, error } = await client.rpc("crm_field_settled_tokens", {
      p_tokens: payload.tokens,
    });
    if (error) throw error;

    const settled = ((data ?? []) as CrmFieldSettledRow[]).map(toFieldSettledView);
    const settledTokens = new Set(settled.map((entry) => entry.clientToken));

    return jsonNoStore({
      settled,
      /*
       * The tokens the server has NOT got. The device keeps these queued.
       * Naming them explicitly rather than leaving the client to diff two
       * lists is the point: this is the number a technician is shown, and
       * it has to come from the server.
       */
      outstanding: payload.tokens.filter((token) => !settledTokens.has(token)),
    });
  } catch (error) {
    return failure(error, "invalid_reconcile", "field_reconcile_failed",
      "Your queue could not be checked.");
  }
}

/**
 * The database refuses a work order or station that is not the caller's by
 * name, and says the same thing whether it does not exist or is not theirs.
 * That refusal is permanent, so the device must STOP retrying it — a queue
 * that retries a refusal forever never drains.
 */
function submissionFailure(error: { code?: string; message?: string }): Response {
  const message = error.message ?? "";
  if (error.code === "P0002" || /no such (work order|station)/.test(message)) {
    return jsonNoStore(
      {
        settled: false,
        permanent: true,
        error: { code: "field_target_not_found", message: "That job is not on this account." },
      },
      { status: 404 },
    );
  }
  if (/crm_field_submissions_sync_after_event/.test(message)) {
    // A device clock claiming the future. Refused loudly rather than
    // silently clamped into something plausible.
    return jsonNoStore(
      {
        settled: false,
        permanent: true,
        error: {
          code: "device_clock_ahead",
          message: "This device's clock is ahead of the server. Correct the time and try again.",
        },
      },
      { status: 422 },
    );
  }
  return jsonNoStore(
    { settled: false, permanent: false, error: { code: "field_submission_failed", message: "That could not be sent." } },
    { status: 503 },
  );
}

function failure(error: unknown, invalidCode: string, failureCode: string, message: string) {
  if (error instanceof ApiRequestError) return requestErrorResponse(error);
  if (error instanceof z.ZodError) {
    return jsonNoStore(
      { settled: false, permanent: true, error: { code: invalidCode, message: error.issues[0]?.message ?? message } },
      { status: 422 },
    );
  }
  const boundary = supabaseBoundaryErrorResponse(error);
  if (boundary) return boundary;
  return jsonNoStore(
    { settled: false, permanent: false, error: { code: failureCode, message } },
    { status: 500 },
  );
}
