import { z } from "zod";

import { contentHash } from "@/lib/budget/import";
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
 * The ledger.
 *
 * This is the one table that grows without bound — twenty years of a single
 * checking account is already eight thousand rows — so the read is paged and
 * filtered in the database rather than in the browser. A page that fetches
 * everything and filters client-side works fine on the sample and falls over
 * on the real thing, which is the failure mode worth designing out early.
 */

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

const MAX_PAGE = 200;

const transactionSchema = z
  .object({
    accountId: z.string().uuid(),
    categoryId: z.string().uuid().nullish(),
    postedOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/),
    kind: z.enum(TRANSACTION_KINDS),
    description: z.string().trim().min(1).max(500),
    amountCents: z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000),
  })
  .strict()
  .refine(
    (value) => {
      // The same agreement the database enforces, checked here so a mistake
      // comes back as a readable message rather than a constraint violation.
      const positive = value.amountCents > 0;
      if (value.amountCents === 0) return value.kind === "adjustment";
      if (["deposit", "atm_credit", "transfer_in"].includes(value.kind)) return positive;
      if (["debit", "check", "fee", "transfer_out"].includes(value.kind)) return !positive;
      return true;
    },
    { message: "The amount's sign must match the kind: money out is negative.", path: ["amountCents"] },
  );

const TRANSACTION_COLUMNS =
  "id, account_id, category_id, posted_on, kind, description, amount_cents, balance_after_cents, created_at";

type TransactionRow = {
  id: string;
  account_id: string;
  category_id: string | null;
  posted_on: string;
  kind: string;
  description: string;
  amount_cents: number;
  balance_after_cents: number | null;
  created_at: string;
};

export function toTransactionView(row: TransactionRow) {
  return {
    id: row.id,
    accountId: row.account_id,
    categoryId: row.category_id,
    postedOn: row.posted_on,
    kind: row.kind,
    description: row.description,
    amountCents: Number(row.amount_cents),
    balanceAfterCents: row.balance_after_cents === null ? null : Number(row.balance_after_cents),
    createdAt: row.created_at,
  };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? 100) || 100, 1), MAX_PAGE);
    const offset = Math.max(Number(url.searchParams.get("offset") ?? 0) || 0, 0);
    const accountId = url.searchParams.get("accountId");
    const search = url.searchParams.get("search")?.trim();
    const from = url.searchParams.get("from");
    const to = url.searchParams.get("to");

    const { client, activeOrganization } = await requireActiveOrganization();
    let query = client
      .from("budget_transactions")
      .select(TRANSACTION_COLUMNS, { count: "exact" })
      .eq("organization_id", activeOrganization.id);

    if (accountId && /^[0-9a-f-]{36}$/i.test(accountId)) query = query.eq("account_id", accountId);
    if (from && /^\d{4}-\d{2}-\d{2}$/.test(from)) query = query.gte("posted_on", from);
    if (to && /^\d{4}-\d{2}-\d{2}$/.test(to)) query = query.lte("posted_on", to);
    if (search) {
      // PostgREST treats these as pattern syntax; a payee with a comma or a
      // percent sign in it would otherwise change the shape of the filter.
      const escaped = search.replace(/[%,()\\]/g, " ").slice(0, 120).trim();
      if (escaped) query = query.ilike("description", `%${escaped}%`);
    }

    const { data, error, count } = await query
      .order("posted_on", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + limit - 1);
    if (error) return databaseErrorResponse(error);

    return jsonNoStore({
      transactions: ((data ?? []) as unknown as TransactionRow[]).map(toTransactionView),
      total: count ?? 0,
      limit,
      offset,
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "budget_transactions_unavailable", message: "Transactions could not be listed." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = transactionSchema.parse(await readBoundedJson(request, 32_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    /*
     * A hand-entered row hashes like an imported one so the two paths cannot
     * produce a duplicate of each other. `occurrence` counts what is already
     * stored for this exact row, which is what makes a second genuine charge
     * on the same day possible while a double-submit is not.
     */
    const { count, error: countError } = await client
      .from("budget_transactions")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", activeOrganization.id)
      .eq("account_id", payload.accountId)
      .eq("posted_on", payload.postedOn)
      .eq("kind", payload.kind)
      .eq("amount_cents", payload.amountCents)
      .eq("description", payload.description);
    if (countError) return databaseErrorResponse(countError);

    const { data, error } = await client
      .from("budget_transactions")
      .insert({
        organization_id: activeOrganization.id,
        user_id: user.id,
        account_id: payload.accountId,
        category_id: payload.categoryId ?? null,
        posted_on: payload.postedOn,
        kind: payload.kind,
        description: payload.description,
        amount_cents: payload.amountCents,
        content_hash: contentHash(
          payload.accountId,
          payload.postedOn,
          payload.kind,
          payload.description,
          payload.amountCents,
          (count ?? 0) + 1,
        ),
      })
      .select(TRANSACTION_COLUMNS)
      .single();
    if (error) return databaseErrorResponse(error);

    return jsonNoStore(
      { transaction: toTransactionView(data as unknown as TransactionRow) },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_transaction",
            message: error.issues[0]?.message ?? "The transaction could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "budget_transaction_not_recorded", message: "The transaction could not be recorded." } },
      { status: 500 },
    );
  }
}
