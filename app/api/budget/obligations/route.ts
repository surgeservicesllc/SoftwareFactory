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
 * Recurring obligations — the bill schedule.
 *
 * This is the half of the spreadsheet that was doing the real work: what is
 * owed, when it is due, what it costs to carry, and which one to clear next.
 */

const OBLIGATION_STATUSES = ["scheduled", "paid", "repeats_monthly", "overdue", "closed"] as const;

const obligationSchema = z
  .object({
    accountId: z.string().uuid().nullish(),
    name: z.string().trim().min(1).max(200),
    dueDay: z.number().int().min(1).max(31),
    amountCents: z.number().int().min(0).max(1_000_000_000_000).default(0),
    balanceCents: z.number().int().min(0).max(1_000_000_000_000).nullish(),
    creditLimitCents: z.number().int().min(0).max(1_000_000_000_000).nullish(),
    aprBps: z.number().int().min(0).max(100_000).nullish(),
    status: z.enum(OBLIGATION_STATUSES).default("scheduled"),
    paidFrom: z.string().trim().min(1).max(160).nullish(),
    ownerLabel: z.string().trim().min(1).max(80).nullish(),
    payoffRank: z.number().int().min(1).max(999).nullish(),
    autopay: z.boolean().default(false),
    notes: z.string().trim().max(2000).nullish(),
  })
  .strict();

const patchSchema = obligationSchema.partial().extend({ id: z.string().uuid() }).strict();

const OBLIGATION_COLUMNS =
  "id, account_id, name, due_day, amount_cents, balance_cents, monthly_interest_cents, credit_limit_cents, apr_bps, status, paid_from, owner_label, payoff_rank, autopay, last_paid_on, next_due_on, notes";

type ObligationRow = {
  id: string;
  account_id: string | null;
  name: string;
  due_day: number;
  amount_cents: number;
  balance_cents: number | null;
  monthly_interest_cents: number | null;
  credit_limit_cents: number | null;
  apr_bps: number | null;
  status: string;
  paid_from: string | null;
  owner_label: string | null;
  payoff_rank: number | null;
  autopay: boolean;
  last_paid_on: string | null;
  next_due_on: string | null;
  notes: string | null;
};

export function toObligationView(row: ObligationRow) {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    dueDay: row.due_day,
    amountCents: Number(row.amount_cents),
    balanceCents: row.balance_cents === null ? null : Number(row.balance_cents),
    monthlyInterestCents:
      row.monthly_interest_cents === null ? null : Number(row.monthly_interest_cents),
    creditLimitCents: row.credit_limit_cents === null ? null : Number(row.credit_limit_cents),
    aprBps: row.apr_bps,
    status: row.status,
    paidFrom: row.paid_from,
    ownerLabel: row.owner_label,
    payoffRank: row.payoff_rank,
    autopay: row.autopay,
    lastPaidOn: row.last_paid_on,
    nextDueOn: row.next_due_on,
    notes: row.notes,
  };
}

function toColumns(payload: Partial<z.infer<typeof obligationSchema>>) {
  const columns: Record<string, unknown> = {};
  if (payload.accountId !== undefined) columns.account_id = payload.accountId ?? null;
  if (payload.name !== undefined) columns.name = payload.name;
  if (payload.dueDay !== undefined) columns.due_day = payload.dueDay;
  if (payload.amountCents !== undefined) columns.amount_cents = payload.amountCents;
  if (payload.balanceCents !== undefined) columns.balance_cents = payload.balanceCents ?? null;
  if (payload.creditLimitCents !== undefined) columns.credit_limit_cents = payload.creditLimitCents ?? null;
  if (payload.aprBps !== undefined) columns.apr_bps = payload.aprBps ?? null;
  if (payload.status !== undefined) columns.status = payload.status;
  if (payload.paidFrom !== undefined) columns.paid_from = payload.paidFrom ?? null;
  if (payload.ownerLabel !== undefined) columns.owner_label = payload.ownerLabel ?? null;
  if (payload.payoffRank !== undefined) columns.payoff_rank = payload.payoffRank ?? null;
  if (payload.autopay !== undefined) columns.autopay = payload.autopay;
  if (payload.notes !== undefined) columns.notes = payload.notes ?? null;
  return columns;
}

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("budget_obligations")
      .select(OBLIGATION_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .order("due_day", { ascending: true })
      .order("name", { ascending: true })
      .limit(300);
    if (error) return databaseErrorResponse(error);
    return jsonNoStore({
      obligations: ((data ?? []) as unknown as ObligationRow[]).map(toObligationView),
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "budget_obligations_unavailable", message: "Obligations could not be listed." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = obligationSchema.parse(await readBoundedJson(request, 32_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const { data, error } = await client
      .from("budget_obligations")
      .insert({
        organization_id: activeOrganization.id,
        user_id: user.id,
        ...toColumns(payload),
      })
      .select(OBLIGATION_COLUMNS)
      .single();
    if (error) return databaseErrorResponse(error);

    return jsonNoStore(
      { obligation: toObligationView(data as unknown as ObligationRow) },
      { status: 201 },
    );
  } catch (error) {
    return failure(error, "budget_obligation_not_recorded", "The obligation could not be recorded.");
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOriginRequest(request);
    const { id, ...rest } = patchSchema.parse(await readBoundedJson(request, 32_000));
    const columns = toColumns(rest);
    if (Object.keys(columns).length === 0) {
      throw new ApiRequestError(422, "nothing_to_change", "The update named no fields to change.");
    }

    const { client, activeOrganization } = await requireActiveOrganization();
    const { data, error } = await client
      .from("budget_obligations")
      .update(columns)
      .eq("id", id)
      .eq("organization_id", activeOrganization.id)
      .select(OBLIGATION_COLUMNS)
      .maybeSingle();
    if (error) return databaseErrorResponse(error);
    if (!data) {
      return jsonNoStore(
        { error: { code: "obligation_not_found", message: "That obligation is not yours to change." } },
        { status: 404 },
      );
    }

    return jsonNoStore({ obligation: toObligationView(data as unknown as ObligationRow) });
  } catch (error) {
    return failure(error, "budget_obligation_not_updated", "The obligation could not be updated.");
  }
}

function failure(error: unknown, code: string, message: string): Response {
  if (error instanceof ApiRequestError) return requestErrorResponse(error);
  if (error instanceof z.ZodError) {
    return jsonNoStore(
      {
        error: {
          code: "invalid_obligation",
          message: error.issues[0]?.message ?? "The obligation could not be read.",
        },
      },
      { status: 422 },
    );
  }
  const boundary = supabaseBoundaryErrorResponse(error);
  if (boundary) return boundary;
  return jsonNoStore({ error: { code, message } }, { status: 500 });
}
