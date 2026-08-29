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
 * Accounts: the things a household's money sits in or is owed on.
 *
 * Every row written here carries `user_id = auth.uid()` explicitly even
 * though RLS also requires it. The policy is the guarantee; the column is how
 * the row satisfies it, and omitting it would produce an insert that fails at
 * the boundary rather than a row that belongs to nobody.
 *
 * There is deliberately no column, and so no field here, for a full account
 * or card number. `last4` is what a statement prints and all this product
 * needs to tell two cards apart.
 */

const ACCOUNT_KINDS = [
  "checking",
  "savings",
  "credit_card",
  "loan",
  "mortgage",
  "brokerage",
  "other",
] as const;

const accountSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    institution: z.string().trim().min(1).max(160).nullish(),
    kind: z.enum(ACCOUNT_KINDS),
    last4: z
      .string()
      .trim()
      .regex(/^[0-9]{4}$/, "Last four digits only.")
      .nullish(),
    currentBalanceCents: z.number().int().min(-1_000_000_000_000).max(1_000_000_000_000).default(0),
    creditLimitCents: z.number().int().min(0).max(1_000_000_000_000).nullish(),
    aprBps: z.number().int().min(0).max(100_000).nullish(),
    promoAprEndsOn: z.string().trim().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    notes: z.string().trim().max(2000).nullish(),
  })
  .strict()
  .refine((value) => value.creditLimitCents === null || value.creditLimitCents === undefined || value.kind === "credit_card", {
    message: "A credit limit belongs to a credit card. Utilization means nothing without one.",
    path: ["creditLimitCents"],
  });

const ACCOUNT_COLUMNS =
  "id, name, institution, kind, last4, current_balance_cents, credit_limit_cents, apr_bps, promo_apr_ends_on, is_active, sort_rank, notes, updated_at";

type AccountRow = {
  id: string;
  name: string;
  institution: string | null;
  kind: string;
  last4: string | null;
  current_balance_cents: number;
  credit_limit_cents: number | null;
  apr_bps: number | null;
  promo_apr_ends_on: string | null;
  is_active: boolean;
  sort_rank: number;
  notes: string | null;
  updated_at: string;
};

export function toAccountView(row: AccountRow) {
  return {
    id: row.id,
    name: row.name,
    institution: row.institution,
    kind: row.kind,
    last4: row.last4,
    currentBalanceCents: Number(row.current_balance_cents),
    creditLimitCents: row.credit_limit_cents === null ? null : Number(row.credit_limit_cents),
    aprBps: row.apr_bps,
    promoAprEndsOn: row.promo_apr_ends_on,
    isActive: row.is_active,
    sortRank: row.sort_rank,
    notes: row.notes,
    updatedAt: row.updated_at,
  };
}

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("budget_accounts")
      .select(ACCOUNT_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .order("sort_rank", { ascending: true })
      .order("name", { ascending: true })
      .limit(200);
    if (error) return databaseErrorResponse(error);
    return jsonNoStore({ accounts: ((data ?? []) as unknown as AccountRow[]).map(toAccountView) });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "budget_accounts_unavailable", message: "Accounts could not be listed." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = accountSchema.parse(await readBoundedJson(request, 32_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const { data, error } = await client
      .from("budget_accounts")
      .insert({
        organization_id: activeOrganization.id,
        user_id: user.id,
        name: payload.name,
        institution: payload.institution ?? null,
        kind: payload.kind,
        last4: payload.last4 ?? null,
        current_balance_cents: payload.currentBalanceCents,
        credit_limit_cents: payload.creditLimitCents ?? null,
        apr_bps: payload.aprBps ?? null,
        promo_apr_ends_on: payload.promoAprEndsOn ?? null,
        notes: payload.notes ?? null,
      })
      .select(ACCOUNT_COLUMNS)
      .single();
    if (error) return databaseErrorResponse(error);

    return jsonNoStore({ account: toAccountView(data as unknown as AccountRow) }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_account",
            message: error.issues[0]?.message ?? "The account could not be read.",
          },
        },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "budget_account_not_recorded", message: "The account could not be recorded." } },
      { status: 500 },
    );
  }
}
