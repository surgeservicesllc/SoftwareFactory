import { z } from "zod";

import {
  CRM_ACCOUNT_COLUMNS,
  CRM_CONTACT_COLUMNS,
  CRM_OPPORTUNITY_COLUMNS,
  CRM_PROPERTY_COLUMNS,
  toAccountView,
  toContactView,
  toOpportunityView,
  toPropertyView,
  type CrmAccountRow,
  type CrmContactRow,
  type CrmOpportunityRow,
  type CrmPropertyRow,
} from "@/lib/services/crm";
import { databaseErrorResponse, jsonNoStore } from "@/lib/server/http";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * Global search across the book of business: accounts, contacts, properties
 * and opportunities in one query, all inside the active organization under
 * RLS. One ilike probe per searchable column — a composed or() filter can
 * be broken by commas or quotes inside the search text, and an address
 * search that cannot contain a comma is not an address search.
 */

const querySchema = z.object({ q: z.string().trim().min(2).max(120) }).strict();

const GROUP_LIMIT = 10;

function escapeLikeNeedle(text: string): string {
  return text.replace(/[%_\\]/g, (ch) => `\\${ch}`);
}

function mergeById<Row extends { id: string }>(groups: Row[][]): Row[] {
  const seen = new Map<string, Row>();
  for (const group of groups) {
    for (const row of group) {
      if (!seen.has(row.id)) seen.set(row.id, row);
    }
  }
  return [...seen.values()].slice(0, GROUP_LIMIT);
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const parsed = querySchema.safeParse({ q: url.searchParams.get("q") ?? undefined });
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_search_query",
            message: "Search needs between 2 and 120 characters.",
          },
        },
        { status: 400 },
      );
    }

    const { client, activeOrganization } = await requireActiveOrganization();
    const pattern = `%${escapeLikeNeedle(parsed.data.q)}%`;

    const probe = (table: string, columns: string, column: string) =>
      client
        .from(table)
        .select(columns)
        .eq("organization_id", activeOrganization.id)
        .ilike(column, pattern)
        .limit(GROUP_LIMIT);

    const [
      accountsByName,
      accountsByEmail,
      contactsByFirst,
      contactsByLast,
      contactsByEmail,
      propertiesByLabel,
      propertiesByAddress,
      opportunitiesByName,
    ] = await Promise.all([
      probe("crm_accounts", CRM_ACCOUNT_COLUMNS, "name"),
      probe("crm_accounts", CRM_ACCOUNT_COLUMNS, "email"),
      probe("crm_contacts", CRM_CONTACT_COLUMNS, "first_name"),
      probe("crm_contacts", CRM_CONTACT_COLUMNS, "last_name"),
      probe("crm_contacts", CRM_CONTACT_COLUMNS, "email"),
      probe("crm_properties", CRM_PROPERTY_COLUMNS, "label"),
      probe("crm_properties", CRM_PROPERTY_COLUMNS, "address"),
      probe("crm_opportunities", CRM_OPPORTUNITY_COLUMNS, "name"),
    ]);
    for (const result of [
      accountsByName,
      accountsByEmail,
      contactsByFirst,
      contactsByLast,
      contactsByEmail,
      propertiesByLabel,
      propertiesByAddress,
      opportunitiesByName,
    ]) {
      if (result.error) return databaseErrorResponse(result.error);
    }

    return jsonNoStore({
      query: parsed.data.q,
      accounts: mergeById([
        (accountsByName.data ?? []) as unknown as CrmAccountRow[],
        (accountsByEmail.data ?? []) as unknown as CrmAccountRow[],
      ]).map(toAccountView),
      contacts: mergeById([
        (contactsByFirst.data ?? []) as unknown as CrmContactRow[],
        (contactsByLast.data ?? []) as unknown as CrmContactRow[],
        (contactsByEmail.data ?? []) as unknown as CrmContactRow[],
      ]).map(toContactView),
      properties: mergeById([
        (propertiesByLabel.data ?? []) as unknown as CrmPropertyRow[],
        (propertiesByAddress.data ?? []) as unknown as CrmPropertyRow[],
      ]).map(toPropertyView),
      opportunities: mergeById([
        (opportunitiesByName.data ?? []) as unknown as CrmOpportunityRow[],
      ]).map(toOpportunityView),
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_search_unavailable", message: "Search is unavailable." } },
      { status: 500 },
    );
  }
}
