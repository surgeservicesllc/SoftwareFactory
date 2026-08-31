import { z } from "zod";

import {
  CRM_CLOSED_CONTRACT_STATUSES,
  CRM_CONTRACT_COLUMNS,
  CRM_CONTRACT_STATUSES,
  toContractView,
  type CrmContractRow,
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
 * Contracts: what an accepted estimate became. A contract names the term it
 * runs for, the recurring plan it governs and the signature that closed it —
 * and it is never deleted. A term that finished is `ended`; one abandoned
 * part-way is `cancelled`; both keep the paper.
 */

const CLOSED = new Set<string>(CRM_CLOSED_CONTRACT_STATUSES);
const DATE = /^\d{4}-\d{2}-\d{2}$/;

const createSchema = z
  .object({
    accountId: z.string().uuid(),
    estimateId: z.string().uuid().nullish(),
    planId: z.string().uuid().nullish(),
    number: z.string().trim().min(3).max(40),
    valueCents: z.number().int().min(0).max(100_000_000_000),
    startsOn: z.string().regex(DATE, "A date, as YYYY-MM-DD."),
    endsOn: z.string().regex(DATE, "A date, as YYYY-MM-DD.").nullish(),
    autoRenew: z.boolean().default(false),
    terms: z.string().trim().min(1).max(4000).nullish(),
    notes: z.string().trim().min(1).max(4000).nullish(),
    signedByName: z.string().trim().min(1).max(120).nullish(),
  })
  .strict()
  .refine((value) => !value.endsOn || value.endsOn >= value.startsOn, {
    message: "A term cannot end before it starts.",
  });

const patchSchema = z
  .object({
    contractId: z.string().uuid(),
    status: z.enum(CRM_CONTRACT_STATUSES),
    autoRenew: z.boolean().optional(),
    notes: z.string().trim().min(1).max(4000).nullable().optional(),
  })
  .strict();

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("crm_contracts")
      .select(CRM_CONTRACT_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .order("starts_on", { ascending: false })
      .limit(300);
    if (error) return databaseErrorResponse(error);

    const contracts = ((data ?? []) as unknown as CrmContractRow[]).map(toContractView);
    const today = new Date().toISOString().slice(0, 10);
    return jsonNoStore({
      contracts,
      activeValueCents: contracts
        .filter((contract) => contract.status === "active")
        .reduce((sum, contract) => sum + contract.valueCents, 0),
      // A term ending within 60 days is a renewal conversation, not a surprise.
      renewingCount: contracts.filter(
        (contract) =>
          contract.status === "active" &&
          contract.endsOn !== null &&
          contract.endsOn >= today &&
          contract.endsOn <= new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10),
      ).length,
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_contracts_unavailable", message: "Contracts could not be listed." } },
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
      .from("crm_contracts")
      .insert({
        organization_id: activeOrganization.id,
        account_id: payload.accountId,
        estimate_id: payload.estimateId ?? null,
        plan_id: payload.planId ?? null,
        number: payload.number,
        status: "active",
        value_cents: payload.valueCents,
        starts_on: payload.startsOn,
        ends_on: payload.endsOn ?? null,
        auto_renew: payload.autoRenew,
        terms: payload.terms ?? null,
        notes: payload.notes ?? null,
        // A signature is a name and a moment together, or neither.
        signed_at: payload.signedByName ? new Date().toISOString() : null,
        signed_by_name: payload.signedByName ?? null,
        created_by: user.id,
      })
      .select(CRM_CONTRACT_COLUMNS)
      .single();
    if (error) {
      if (error.code === "23505") {
        return jsonNoStore(
          {
            error: {
              code: "contract_number_taken",
              message: "That contract number is already in use in this workspace.",
            },
          },
          { status: 409 },
        );
      }
      if (error.code === "23503") {
        return jsonNoStore(
          {
            error: {
              code: "reference_not_found",
              message: "The account, estimate or service plan is not in this workspace.",
            },
          },
          { status: 404 },
        );
      }
      return databaseErrorResponse(error);
    }
    return jsonNoStore({ contract: toContractView(data as unknown as CrmContractRow) }, { status: 201 });
  } catch (error) {
    return failure(error, "invalid_contract", "crm_contract_not_recorded", "The contract could not be recorded.");
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = patchSchema.parse(await readBoundedJson(request, 32_000));
    const { client, activeOrganization } = await requireActiveOrganization();

    const changes: Record<string, unknown> = { status: payload.status };
    if (payload.autoRenew !== undefined) changes.auto_renew = payload.autoRenew;
    if (payload.notes !== undefined) changes.notes = payload.notes;
    // Closing a contract records when; reopening one takes that back, so the
    // schema's ended-iff-closed CHECK can never be contradicted from here.
    changes.ended_at = CLOSED.has(payload.status) ? new Date().toISOString() : null;

    const { data, error } = await client
      .from("crm_contracts")
      .update(changes)
      .eq("organization_id", activeOrganization.id)
      .eq("id", payload.contractId)
      .select(CRM_CONTRACT_COLUMNS)
      .maybeSingle();
    if (error) return databaseErrorResponse(error);
    if (!data) {
      return jsonNoStore(
        { error: { code: "contract_not_found", message: "No such contract in this workspace." } },
        { status: 404 },
      );
    }
    return jsonNoStore({ contract: toContractView(data as unknown as CrmContractRow) });
  } catch (error) {
    return failure(error, "invalid_contract_change", "crm_contract_not_updated", "The contract could not be updated.");
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
