import { z } from "zod";

import { CRM_REQUEST_KINDS } from "@/lib/services/crm";
import {
  summarizeSla,
  toRequestSlaView,
  toSlaPolicyView,
  type CrmEffectiveSlaRow,
  type CrmRequestSlaRow,
} from "@/lib/services/customers-side";
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
 * The clock on every request. `crm_request_sla` computes the due moments
 * and the state of each promise from stamps the request row sets itself;
 * nothing here is stored, so a policy change re-clocks the queue at once.
 * The policy is per kind: the defaults live in the schema and a workspace
 * overrides only what it means to.
 */

const REQUEST_CEILING = 500;

function window(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

const policySchema = z
  .object({
    kind: z.enum(CRM_REQUEST_KINDS as unknown as [string, ...string[]]),
    acknowledgeHours: z.number().int().min(1).max(720),
    resolveHours: z.number().int().min(1).max(2160),
  })
  .strict()
  .refine((value) => value.resolveHours >= value.acknowledgeHours, {
    message: "A request cannot be due resolved before it is due acknowledged.",
  });

const resetSchema = z.object({ kind: z.enum(CRM_REQUEST_KINDS as unknown as [string, ...string[]]) }).strict();

async function readPolicies(client: Awaited<ReturnType<typeof requireActiveOrganization>>["client"], organizationId: string) {
  const read = await client.rpc("crm_effective_sla", { p_organization: organizationId });
  if (read.error) return { error: read.error, policies: [] };
  return { error: null, policies: ((read.data ?? []) as unknown as CrmEffectiveSlaRow[]).map(toSlaPolicyView) };
}

export async function GET(request: Request) {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const days = window(new URL(request.url).searchParams.get("days"), 30, 365);
    const [clock, policies] = await Promise.all([
      client.rpc("crm_request_sla", { p_organization: activeOrganization.id, p_days: days }).limit(REQUEST_CEILING),
      readPolicies(client, activeOrganization.id),
    ]);
    if (clock.error) return databaseErrorResponse(clock.error);
    if (policies.error) return databaseErrorResponse(policies.error);
    const requests = ((clock.data ?? []) as unknown as CrmRequestSlaRow[]).map(toRequestSlaView);
    return jsonNoStore({
      window: { days },
      requests,
      summary: summarizeSla(requests),
      policies: policies.policies,
      ceiling: { requests: REQUEST_CEILING, reached: requests.length >= REQUEST_CEILING },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_sla_unavailable", message: "The request clock could not be read." } },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = policySchema.parse(await readBoundedJson(request, 4_000));
    const { client, activeOrganization, user } = await requireActiveOrganization();
    const write = await client
      .from("crm_sla_policies")
      .upsert(
        {
          organization_id: activeOrganization.id,
          kind: payload.kind,
          acknowledge_hours: payload.acknowledgeHours,
          resolve_hours: payload.resolveHours,
          updated_by: user.id,
        },
        { onConflict: "organization_id,kind" },
      )
      .select("id");
    if (write.error) return databaseErrorResponse(write.error);
    const policies = await readPolicies(client, activeOrganization.id);
    if (policies.error) return databaseErrorResponse(policies.error);
    return jsonNoStore({ policies: policies.policies });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        { error: { code: "invalid_sla_policy", message: error.issues[0]?.message ?? "The policy could not be saved." } },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_sla_policy_not_saved", message: "The policy could not be saved." } },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = resetSchema.parse(await readBoundedJson(request, 1_000));
    const { client, activeOrganization } = await requireActiveOrganization();
    const write = await client
      .from("crm_sla_policies")
      .delete()
      .eq("organization_id", activeOrganization.id)
      .eq("kind", payload.kind);
    if (write.error) return databaseErrorResponse(write.error);
    const policies = await readPolicies(client, activeOrganization.id);
    if (policies.error) return databaseErrorResponse(policies.error);
    return jsonNoStore({ policies: policies.policies });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore({ error: { code: "invalid_sla_policy", message: "Name the kind to reset." } }, { status: 422 });
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_sla_policy_not_reset", message: "The policy could not be reset." } },
      { status: 500 },
    );
  }
}
