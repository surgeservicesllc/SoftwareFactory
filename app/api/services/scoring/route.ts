import { z } from "zod";

import {
  CRM_SCORING_MODELS,
  toEffectiveRuleView,
  type CrmEffectiveRuleRow,
  type CrmScoreRow,
  type ScoredAccountView,
} from "@/lib/services/scoring";
import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * The scores for one model, each with its breakdown, and the rules that
 * produced them. Computed by `crm_score_accounts` at the moment of asking
 * under the caller's own RLS — nothing here is stored or cached.
 */

const querySchema = z.object({ model: z.enum(CRM_SCORING_MODELS).default("lead") });

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({ model: url.searchParams.get("model") ?? undefined });
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_model", message: "model must be lead, churn or upsell." } },
        { status: 422 },
      );
    }
    const model = parsed.data.model;
    const { client, activeOrganization } = await requireActiveOrganization();
    const organizationId = activeOrganization.id;

    const [scoresRead, rulesRead, accountsRead] = await Promise.all([
      client.rpc("crm_score_accounts", { p_organization: organizationId, p_model: model }),
      client.rpc("crm_effective_scoring_rules", { p_organization: organizationId, p_model: model }),
      client
        .from("crm_accounts")
        .select("id, name, kind, status")
        .eq("organization_id", organizationId)
        .limit(5000),
    ]);
    if (scoresRead.error) return databaseErrorResponse(scoresRead.error);
    if (rulesRead.error) return databaseErrorResponse(rulesRead.error);
    if (accountsRead.error) return databaseErrorResponse(accountsRead.error);

    const accountById = new Map(
      ((accountsRead.data ?? []) as Array<{ id: string; name: string; kind: string; status: string }>).map(
        (account) => [account.id, account],
      ),
    );
    const scores = (scoresRead.data ?? []) as unknown as CrmScoreRow[];
    const accounts: ScoredAccountView[] = scores.flatMap((row) => {
      const account = accountById.get(row.account_id);
      if (!account) return [];
      return [{
        accountId: row.account_id,
        name: account.name,
        kind: account.kind,
        status: account.status,
        score: Number(row.score),
        breakdown: Array.isArray(row.breakdown) ? row.breakdown : [],
      }];
    });

    const scoredCount = accounts.length;
    const total = accounts.reduce((sum, account) => sum + account.score, 0);
    return jsonNoStore({
      model,
      rules: ((rulesRead.data ?? []) as unknown as CrmEffectiveRuleRow[]).map(toEffectiveRuleView),
      accounts: accounts.slice(0, 300),
      counts: {
        scored: scoredCount,
        // Null rather than 0 over nobody: an average of no scores is not an average.
        average: scoredCount === 0 ? null : Math.round(total / scoredCount),
        top: accounts[0]?.score ?? null,
        overridden: ((rulesRead.data ?? []) as unknown as CrmEffectiveRuleRow[]).filter((rule) => rule.overridden).length,
      },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_scoring_unavailable", message: "Scores could not be computed." } },
      { status: 500 },
    );
  }
}
