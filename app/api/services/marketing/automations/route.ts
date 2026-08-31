import { z } from "zod";

import {
  CRM_AUTOMATION_ACTIONS,
  CRM_AUTOMATION_COLUMNS,
  CRM_AUTOMATION_TRIGGERS,
  CRM_SENDING_ACTIONS,
  toAutomationView,
  type CrmAutomationRow,
} from "@/lib/services/crm";
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

/**
 * Automations: a rule someone wrote about what should follow what.
 *
 * NOTHING RUNS THESE YET. This route records intent — the trigger, the
 * action, the delay and the text that would go out — and reports the run
 * count the database holds. There is no executor, so `runCount` stays at
 * zero and `lastRunAt` stays null until one exists; the schema CHECKs that
 * those two agree, so neither can be quietly faked. The page says Not
 * Connected.
 *
 * A rule is created switched OFF. Arming something that will act on real
 * customers is a deliberate second step, not a side effect of writing it
 * down.
 */

const SENDING = new Set<string>(CRM_SENDING_ACTIONS);

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    triggerOn: z.enum(CRM_AUTOMATION_TRIGGERS),
    action: z.enum(CRM_AUTOMATION_ACTIONS),
    delayHours: z.number().int().min(0).max(8760).default(0),
    template: z.string().trim().min(1).max(4000).nullish(),
  })
  .strict()
  .refine((value) => !SENDING.has(value.action) || Boolean(value.template), {
    message: "A rule that sends something carries the text it would send.",
  });

const patchSchema = z
  .object({
    automationId: z.string().uuid(),
    name: z.string().trim().min(1).max(160).optional(),
    delayHours: z.number().int().min(0).max(8760).optional(),
    template: z.string().trim().min(1).max(4000).nullable().optional(),
    active: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 1, { message: "Nothing to change." });

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("crm_automations")
      .select(CRM_AUTOMATION_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .order("active", { ascending: false })
      .order("name", { ascending: true })
      .limit(400);
    if (error) return databaseErrorResponse(error);

    const automations = ((data ?? []) as unknown as CrmAutomationRow[]).map(toAutomationView);
    return jsonNoStore({
      automations,
      counts: {
        total: automations.length,
        active: automations.filter((automation) => automation.active).length,
        runs: automations.reduce((sum, automation) => sum + automation.runCount, 0),
      },
      // Stated in the payload as well as on the page: no executor runs
      // these, so an armed rule has still never fired.
      executorConnected: false,
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_automations_unavailable", message: "Automations could not be listed." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = createSchema.parse(await readBoundedJson(request, 32_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const { data, error } = await client
      .from("crm_automations")
      .insert({
        organization_id: activeOrganization.id,
        name: payload.name,
        trigger_on: payload.triggerOn,
        action: payload.action,
        delay_hours: payload.delayHours,
        template: payload.template ?? null,
        // Off by default: arming a rule that acts on customers is a
        // deliberate second step.
        active: false,
        created_by: user.id,
      })
      .select(CRM_AUTOMATION_COLUMNS)
      .single();
    if (error) {
      if (error.code === "23505") {
        return jsonNoStore(
          { error: { code: "automation_name_taken", message: "A rule with that name already exists here." } },
          { status: 409 },
        );
      }
      return databaseErrorResponse(error);
    }
    return jsonNoStore(
      { automation: toAutomationView(data as unknown as CrmAutomationRow) },
      { status: 201 },
    );
  } catch (error) {
    return failure(error, "invalid_automation", "crm_automation_not_recorded", "The rule could not be recorded.");
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = patchSchema.parse(await readBoundedJson(request, 32_000));
    const { client, activeOrganization } = await requireActiveOrganization();

    const changes: Record<string, unknown> = {};
    if (payload.name !== undefined) changes.name = payload.name;
    if (payload.delayHours !== undefined) changes.delay_hours = payload.delayHours;
    if (payload.template !== undefined) changes.template = payload.template;
    if (payload.active !== undefined) changes.active = payload.active;
    // run_count and last_run_at are deliberately not settable: they are what
    // an executor records, and there is no executor.

    const { data, error } = await client
      .from("crm_automations")
      .update(changes)
      .eq("organization_id", activeOrganization.id)
      .eq("id", payload.automationId)
      .select(CRM_AUTOMATION_COLUMNS)
      .maybeSingle();
    if (error) {
      if (error.code === "23514") {
        return jsonNoStore(
          {
            error: {
              code: "automation_refused",
              message: "A rule that sends something carries the text it would send.",
            },
          },
          { status: 409 },
        );
      }
      return databaseErrorResponse(error);
    }
    if (!data) {
      return jsonNoStore(
        { error: { code: "automation_not_found", message: "No such rule in this workspace." } },
        { status: 404 },
      );
    }
    return jsonNoStore({ automation: toAutomationView(data as unknown as CrmAutomationRow) });
  } catch (error) {
    return failure(error, "invalid_automation_change", "crm_automation_not_updated", "The rule could not be updated.");
  }
}

function failure(error: unknown, invalidCode: string, failureCode: string, message: string) {
  if (error instanceof ApiRequestError) return requestErrorResponse(error);
  if (error instanceof z.ZodError) {
    return jsonNoStore(
      { error: { code: invalidCode, message: error.issues[0]?.message ?? message } },
      { status: 422 },
    );
  }
  const boundary = supabaseBoundaryErrorResponse(error);
  if (boundary) return boundary;
  return jsonNoStore({ error: { code: failureCode, message } }, { status: 500 });
}
