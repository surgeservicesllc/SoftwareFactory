import { z } from "zod";

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
 * Edit or remove one ledger row.
 *
 * The ledger was append-only through the UI while the policies underneath
 * always allowed update and delete — the surface was the missing piece,
 * not the permission. Two honesty rules carry over from the import path:
 *
 * `balance_after_cents` is never editable here. It is the STATEMENT'S
 * claim, imported verbatim, and `reconcile()` exists to show where that
 * claim disagrees with the amounts. Editing an amount may create such a
 * disagreement — that is the truth of what the person did, and the
 * reconciliation view is where it shows up; silently rewriting the stated
 * balance to match would erase the evidence.
 *
 * The sign-matches-kind agreement is checked here exactly as on insert,
 * so an edit cannot smuggle in a row the recording path would refuse.
 */

const paramsSchema = z.object({ transactionId: z.string().uuid() });

const TRANSACTION_KINDS = [
  "deposit",
  "debit",
  "check",
  "fee",
  "atm_credit",
  "transfer_in",
  "transfer_out",
  "adjustment",
] as const;

const patchSchema = z
  .object({
    categoryId: z.string().uuid().nullable().optional(),
    postedOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    kind: z.enum(TRANSACTION_KINDS).optional(),
    description: z.string().trim().min(1).max(500).optional(),
    amountCents: z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, { message: "Nothing to change." });

const TRANSACTION_COLUMNS =
  "id, account_id, category_id, posted_on, kind, description, amount_cents, balance_after_cents, created_at";

function signMatchesKind(kind: string, amountCents: number): boolean {
  if (amountCents === 0) return kind === "adjustment";
  const positive = amountCents > 0;
  if (["deposit", "atm_credit", "transfer_in"].includes(kind)) return positive;
  if (["debit", "check", "fee", "transfer_out"].includes(kind)) return !positive;
  return true;
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ transactionId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { transactionId } = paramsSchema.parse(await context.params);
    const payload = patchSchema.parse(await readBoundedJson(request, 16_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    // Kind and amount agree as a PAIR, so a change to either is validated
    // against the row's final state, not its old one.
    const { data: current, error: readError } = await client
      .from("budget_transactions")
      .select("kind, amount_cents")
      .eq("id", transactionId)
      .eq("organization_id", activeOrganization.id)
      .eq("user_id", user.id)
      .maybeSingle();
    if (readError) return databaseErrorResponse(readError);
    if (!current) {
      return jsonNoStore(
        { error: { code: "budget_transaction_not_found", message: "That row is not yours to edit." } },
        { status: 404 },
      );
    }
    const row = current as { kind: string; amount_cents: number };
    const finalKind = payload.kind ?? row.kind;
    const finalAmount = payload.amountCents ?? Number(row.amount_cents);
    if (!signMatchesKind(finalKind, finalAmount)) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_transaction_change",
            message: "The amount's sign must match the kind: money out is negative.",
          },
        },
        { status: 422 },
      );
    }

    const changes: Record<string, unknown> = {};
    if (payload.categoryId !== undefined) changes.category_id = payload.categoryId;
    if (payload.postedOn !== undefined) changes.posted_on = payload.postedOn;
    if (payload.kind !== undefined) changes.kind = payload.kind;
    if (payload.description !== undefined) changes.description = payload.description;
    if (payload.amountCents !== undefined) changes.amount_cents = payload.amountCents;

    const { data, error } = await client
      .from("budget_transactions")
      .update(changes)
      .eq("id", transactionId)
      .eq("organization_id", activeOrganization.id)
      .eq("user_id", user.id)
      .select(TRANSACTION_COLUMNS)
      .maybeSingle();
    if (error) return databaseErrorResponse(error);
    if (!data) {
      return jsonNoStore(
        { error: { code: "budget_transaction_not_found", message: "That row is not yours to edit." } },
        { status: 404 },
      );
    }
    return jsonNoStore({ transaction: data });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_transaction_change",
            message: error.issues[0]?.message ?? "The change could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "budget_transaction_not_updated", message: "The row could not be updated." } },
      { status: 500 },
    );
  }
}

export async function DELETE(
  request: Request,
  context: { params: Promise<{ transactionId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { transactionId } = paramsSchema.parse(await context.params);
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const { data, error } = await client
      .from("budget_transactions")
      .delete()
      .eq("id", transactionId)
      .eq("organization_id", activeOrganization.id)
      .eq("user_id", user.id)
      .select("id")
      .maybeSingle();
    if (error) return databaseErrorResponse(error);
    if (!data) {
      return jsonNoStore(
        { error: { code: "budget_transaction_not_found", message: "That row is not yours to delete." } },
        { status: 404 },
      );
    }
    return jsonNoStore({ deleted: true });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        { error: { code: "invalid_transaction", message: "The row id is not valid." } },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "budget_transaction_not_deleted", message: "The row could not be deleted." } },
      { status: 500 },
    );
  }
}
