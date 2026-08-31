import { z } from "zod";

import {
  CRM_PLAN_STEP_COLUMNS,
  toPlanStepView,
  type CrmPlanStepRow,
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
 * A plan's schedule: the ordered steps that say WHEN it runs, as opposed
 * to the recurrence, which only says how often (ADR-211).
 *
 * The read returns the steps, the next dates the database itself
 * generates from them, and the cadence — visits a year beside bills a
 * year, because level billing means those two are allowed to disagree and
 * an operator should be able to see which arrangement they have.
 *
 * The write replaces the whole sequence through `crm_plan_set_sequence`,
 * one statement, because a half-applied schedule is a plan that silently
 * stops producing visits.
 */

const paramsSchema = z.object({ planId: z.string().uuid() }).strict();

const stepSchema = z
  .object({
    position: z.number().int().min(1).max(24),
    monthOffset: z.number().int().min(0).max(11),
    anchor: z.enum(["day_of_month", "nth_weekday"]),
    dayOfMonth: z.number().int().min(1).max(31).nullish(),
    weekOfMonth: z.number().int().min(1).max(5).nullish(),
    weekday: z.number().int().min(0).max(6).nullish(),
    serviceType: z.string().trim().min(1).max(120).nullish(),
  })
  .strict()
  .refine(
    (step) => step.anchor === "day_of_month"
      ? step.dayOfMonth != null && step.weekOfMonth == null && step.weekday == null
      : step.dayOfMonth == null && step.weekOfMonth != null && step.weekday != null,
    { message: "A step carries one anchor: a day of the month, or an nth weekday." },
  );

const writeSchema = z
  .object({
    cycleMonths: z
      .union([z.literal(1), z.literal(2), z.literal(3), z.literal(4), z.literal(6), z.literal(12)])
      .nullable(),
    steps: z.array(stepSchema).max(24),
  })
  .strict()
  .refine((body) => body.cycleMonths !== null || body.steps.length === 0, {
    message: "A sequence needs a cycle length.",
  })
  .refine(
    (body) => body.steps.every((step) => body.cycleMonths === null || step.monthOffset < body.cycleMonths),
    { message: "Every step has to fall inside the cycle." },
  )
  .refine(
    (body) => new Set(body.steps.map((step) => step.position)).size === body.steps.length,
    { message: "Two steps cannot share a position." },
  );

type Sequenced = {
  cycleMonths: number | null;
  steps: ReturnType<typeof toPlanStepView>[];
  occurrences: { stepPosition: number; occursOn: string; serviceType: string | null }[];
  cadence: { sequenced: boolean; visitsPerYear: number | null; billsPerYear: number };
};

async function readSequence(
  client: Awaited<ReturnType<typeof requireActiveOrganization>>["client"],
  organizationId: string,
  planId: string,
): Promise<Sequenced | { notFound: true } | { error: unknown }> {
  const plan = await client
    .from("crm_service_plans")
    .select("id, cycle_months")
    .eq("organization_id", organizationId)
    .eq("id", planId)
    .maybeSingle();
  if (plan.error) return { error: plan.error };
  if (!plan.data) return { notFound: true };

  const steps = await client
    .from("crm_plan_steps")
    .select(CRM_PLAN_STEP_COLUMNS)
    .eq("organization_id", organizationId)
    .eq("plan_id", planId)
    .order("position", { ascending: true });
  if (steps.error) return { error: steps.error };

  const today = new Date().toISOString().slice(0, 10);
  const occurrences = await client.rpc("crm_plan_occurrences", {
    p_plan: planId,
    p_from: today,
    p_count: 12,
  });
  if (occurrences.error) return { error: occurrences.error };

  const cadence = await client.rpc("crm_plan_cadence", { p_plan: planId });
  if (cadence.error) return { error: cadence.error };

  const measured = (cadence.data as
    | { sequenced: boolean; visits_per_year: number | string | null; bills_per_year: number | string }[]
    | null)?.[0];

  return {
    cycleMonths: (plan.data as { cycle_months: number | null }).cycle_months,
    steps: ((steps.data ?? []) as unknown as CrmPlanStepRow[]).map(toPlanStepView),
    occurrences: ((occurrences.data ?? []) as {
      step_position: number; occurs_on: string; service_type: string | null;
    }[]).map((row) => ({
      stepPosition: row.step_position,
      occursOn: row.occurs_on,
      serviceType: row.service_type,
    })),
    cadence: {
      sequenced: measured?.sequenced ?? false,
      visitsPerYear:
        measured?.visits_per_year == null ? null : Number(measured.visits_per_year),
      billsPerYear: Number(measured?.bills_per_year ?? 0),
    },
  };
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ planId: string }> },
) {
  try {
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_plan_id", message: "The plan id is not a UUID." } },
        { status: 400 },
      );
    }
    const { client, activeOrganization } = await requireActiveOrganization();
    const sequence = await readSequence(client, activeOrganization.id, parsed.data.planId);

    if ("error" in sequence) return databaseErrorResponse(sequence.error as never);
    if ("notFound" in sequence) {
      return jsonNoStore(
        { error: { code: "plan_not_found", message: "No such service plan in this workspace." } },
        { status: 404 },
      );
    }
    return jsonNoStore(sequence);
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_plan_sequence_unavailable", message: "The schedule could not be read." } },
      { status: 500 },
    );
  }
}

export async function PUT(
  request: Request,
  context: { params: Promise<{ planId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const parsed = paramsSchema.safeParse(await context.params);
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_plan_id", message: "The plan id is not a UUID." } },
        { status: 400 },
      );
    }
    const payload = writeSchema.parse(await readBoundedJson(request, 32_000));
    const { client, activeOrganization } = await requireActiveOrganization();

    const written = await client.rpc("crm_plan_set_sequence", {
      p_plan: parsed.data.planId,
      p_cycle_months: payload.cycleMonths,
      p_steps: payload.steps.map((step) => ({
        position: step.position,
        month_offset: step.monthOffset,
        anchor: step.anchor,
        day_of_month: step.dayOfMonth ?? null,
        week_of_month: step.weekOfMonth ?? null,
        weekday: step.weekday ?? null,
        service_type: step.serviceType ?? null,
      })),
    });
    if (written.error) {
      // A plan in another book reads as absent, exactly as it does above.
      if (/no such service plan/i.test(written.error.message ?? "")) {
        return jsonNoStore(
          { error: { code: "plan_not_found", message: "No such service plan in this workspace." } },
          { status: 404 },
        );
      }
      return databaseErrorResponse(written.error);
    }

    // Re-read rather than echoing the request: the database clamps and
    // guards, and the caller should see what it actually holds.
    const sequence = await readSequence(client, activeOrganization.id, parsed.data.planId);
    if ("error" in sequence) return databaseErrorResponse(sequence.error as never);
    if ("notFound" in sequence) {
      return jsonNoStore(
        { error: { code: "plan_not_found", message: "No such service plan in this workspace." } },
        { status: 404 },
      );
    }
    return jsonNoStore(sequence);
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_sequence",
            message: error.issues[0]?.message ?? "That schedule is not a valid one.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_plan_sequence_not_saved", message: "The schedule could not be saved." } },
      { status: 500 },
    );
  }
}
