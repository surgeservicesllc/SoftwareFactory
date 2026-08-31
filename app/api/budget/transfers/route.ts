import { randomUUID } from "node:crypto";

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
 * Link the two sides of a transfer, or unlink them.
 *
 * `transfer_group_id` has had a schema and an index since the foundation
 * and nothing populated it. Both sides of a move between the person's own
 * accounts were typed correctly and excluded from spend, but nothing said
 * WHICH out matched WHICH in — which is what a person actually wants to
 * know when a transfer looks unmatched.
 *
 * A link is a claim about two specific rows, so the checks are exact:
 * one `transfer_out`, one `transfer_in`, amounts that negate each other,
 * DIFFERENT accounts (a transfer to the same account is a data-entry
 * mistake, not a transfer), and neither side already claimed by another
 * group. Anything looser would let one out-row "match" three in-rows and
 * the sum stop meaning anything.
 */

const linkSchema = z
  .object({ firstId: z.string().uuid(), secondId: z.string().uuid() })
  .strict()
  .refine((value) => value.firstId !== value.secondId, {
    message: "A transfer needs two different rows.",
  });

const unlinkSchema = z.object({ transferGroupId: z.string().uuid() }).strict();

type Row = {
  id: string;
  account_id: string;
  kind: string;
  amount_cents: number;
  transfer_group_id: string | null;
};

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const { firstId, secondId } = linkSchema.parse(await readBoundedJson(request, 8_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const { data, error } = await client
      .from("budget_transactions")
      .select("id, account_id, kind, amount_cents, transfer_group_id")
      .eq("organization_id", activeOrganization.id)
      .eq("user_id", user.id)
      .in("id", [firstId, secondId]);
    if (error) return databaseErrorResponse(error);
    const rows = (data ?? []) as Row[];
    if (rows.length !== 2) {
      return jsonNoStore(
        { error: { code: "transfer_rows_not_found", message: "Both rows must be yours." } },
        { status: 404 },
      );
    }

    const out = rows.find((row) => row.kind === "transfer_out");
    const inbound = rows.find((row) => row.kind === "transfer_in");
    const refusal = (message: string) =>
      jsonNoStore({ error: { code: "transfer_not_linkable", message } }, { status: 422 });
    if (!out || !inbound) {
      return refusal("A link joins one transfer-out row with one transfer-in row.");
    }
    if (out.transfer_group_id !== null || inbound.transfer_group_id !== null) {
      return refusal("One of these rows is already linked; unlink it first.");
    }
    if (out.account_id === inbound.account_id) {
      return refusal("Both rows are on the same account — that is not a transfer between accounts.");
    }
    if (Number(out.amount_cents) + Number(inbound.amount_cents) !== 0) {
      return refusal("The two amounts must negate each other exactly.");
    }

    const transferGroupId = randomUUID();
    const { error: updateError, data: updated } = await client
      .from("budget_transactions")
      .update({ transfer_group_id: transferGroupId })
      .in("id", [out.id, inbound.id])
      .eq("organization_id", activeOrganization.id)
      .eq("user_id", user.id)
      // Refuses the race where another tab linked one side after our read.
      .is("transfer_group_id", null)
      .select("id");
    if (updateError) return databaseErrorResponse(updateError);
    if ((updated ?? []).length !== 2) {
      return refusal("One of these rows was linked by another change; reload and try again.");
    }
    return jsonNoStore({ transferGroupId }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_transfer_link",
            message: error.issues[0]?.message ?? "The link could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "transfer_not_linked", message: "The transfer could not be linked." } },
      { status: 500 },
    );
  }
}

export async function DELETE(request: Request) {
  try {
    assertSameOriginRequest(request);
    const { transferGroupId } = unlinkSchema.parse(await readBoundedJson(request, 8_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("budget_transactions")
      .update({ transfer_group_id: null })
      .eq("organization_id", activeOrganization.id)
      .eq("user_id", user.id)
      .eq("transfer_group_id", transferGroupId)
      .select("id");
    if (error) return databaseErrorResponse(error);
    if ((data ?? []).length === 0) {
      return jsonNoStore(
        { error: { code: "transfer_group_not_found", message: "That link is not yours to remove." } },
        { status: 404 },
      );
    }
    return jsonNoStore({ unlinked: (data ?? []).length });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        { error: { code: "invalid_transfer_link", message: "A transferGroupId is required." } },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "transfer_not_unlinked", message: "The link could not be removed." } },
      { status: 500 },
    );
  }
}
