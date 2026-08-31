import { z } from "zod";

import {
  CRM_LIST_MEMBER_COLUMNS,
  CRM_MARKETING_LIST_COLUMNS,
  toListMemberView,
  toMarketingListView,
  type CrmListMemberRow,
  type CrmMarketingListRow,
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
 * Marketing lists and the consent on them.
 *
 * Consent is a record, not a flag someone can quietly flip back: an
 * unsubscribe keeps the moment it happened and the reason given, and the
 * list's subscriber count is derived from those moments rather than stored.
 * A dynamic list has to say what it selects; a static one does not pretend
 * to.
 */

const createSchema = z
  .object({
    name: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(2000).nullish(),
    isDynamic: z.boolean().default(false),
    criteria: z.string().trim().min(1).max(1000).nullish(),
  })
  .strict()
  .refine((value) => value.isDynamic === Boolean(value.criteria), {
    message: "A dynamic list states its criteria, and a static one carries none.",
  });

const patchSchema = z
  .object({
    listId: z.string().uuid(),
    name: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().min(1).max(2000).nullable().optional(),
    active: z.boolean().optional(),
    /** Add accounts to a static list. */
    addAccountIds: z.array(z.string().uuid()).max(500).optional(),
    /** Withdraw consent for one member, with the reason given. */
    unsubscribeAccountId: z.string().uuid().optional(),
    unsubscribeReason: z.string().trim().min(1).max(300).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 1, { message: "Nothing to change." })
  .refine(
    (value) => value.unsubscribeReason === undefined || value.unsubscribeAccountId !== undefined,
    { message: "A reason belongs to an unsubscribe." },
  );

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const [listRows, memberRows] = await Promise.all([
      client
        .from("crm_marketing_lists")
        .select(CRM_MARKETING_LIST_COLUMNS)
        .eq("organization_id", activeOrganization.id)
        .order("active", { ascending: false })
        .order("name", { ascending: true })
        .limit(400),
      client
        .from("crm_list_members")
        .select(CRM_LIST_MEMBER_COLUMNS)
        .eq("organization_id", activeOrganization.id)
        .limit(5000),
    ]);
    if (listRows.error) return databaseErrorResponse(listRows.error);
    if (memberRows.error) return databaseErrorResponse(memberRows.error);

    const lists = ((listRows.data ?? []) as unknown as CrmMarketingListRow[]).map(toMarketingListView);
    const members = ((memberRows.data ?? []) as unknown as CrmListMemberRow[]).map(toListMemberView);

    const subscribed = new Map<string, number>();
    const unsubscribed = new Map<string, number>();
    for (const member of members) {
      const bucket = member.subscribed ? subscribed : unsubscribed;
      bucket.set(member.listId, (bucket.get(member.listId) ?? 0) + 1);
    }

    return jsonNoStore({
      lists: lists.map((list) => ({
        ...list,
        subscriberCount: subscribed.get(list.id) ?? 0,
        // Reported beside the subscribers rather than netted out of them.
        unsubscribedCount: unsubscribed.get(list.id) ?? 0,
      })),
      counts: {
        total: lists.length,
        active: lists.filter((list) => list.active).length,
        members: members.length,
        unsubscribed: members.filter((member) => !member.subscribed).length,
      },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_lists_unavailable", message: "Marketing lists could not be listed." } },
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
      .from("crm_marketing_lists")
      .insert({
        organization_id: activeOrganization.id,
        name: payload.name,
        description: payload.description ?? null,
        is_dynamic: payload.isDynamic,
        criteria: payload.criteria ?? null,
        created_by: user.id,
      })
      .select(CRM_MARKETING_LIST_COLUMNS)
      .single();
    if (error) {
      if (error.code === "23505") {
        return jsonNoStore(
          { error: { code: "list_name_taken", message: "A list with that name already exists here." } },
          { status: 409 },
        );
      }
      return databaseErrorResponse(error);
    }
    return jsonNoStore(
      { list: toMarketingListView(data as unknown as CrmMarketingListRow) },
      { status: 201 },
    );
  } catch (error) {
    return failure(error, "invalid_list", "crm_list_not_recorded", "The list could not be recorded.");
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = patchSchema.parse(await readBoundedJson(request, 200_000));
    const { client, user, activeOrganization } = await requireActiveOrganization();

    const changes: Record<string, unknown> = {};
    if (payload.name !== undefined) changes.name = payload.name;
    if (payload.description !== undefined) changes.description = payload.description;
    if (payload.active !== undefined) changes.active = payload.active;

    if (Object.keys(changes).length > 0) {
      const updated = await client
        .from("crm_marketing_lists")
        .update(changes)
        .eq("organization_id", activeOrganization.id)
        .eq("id", payload.listId)
        .select("id")
        .maybeSingle();
      if (updated.error) return databaseErrorResponse(updated.error);
      if (!updated.data) {
        return jsonNoStore(
          { error: { code: "list_not_found", message: "No such list in this workspace." } },
          { status: 404 },
        );
      }
    }

    if (payload.addAccountIds !== undefined && payload.addAccountIds.length > 0) {
      const added = await client.from("crm_list_members").insert(
        Array.from(new Set(payload.addAccountIds)).map((accountId) => ({
          organization_id: activeOrganization.id,
          list_id: payload.listId,
          account_id: accountId,
          source: "manual",
          created_by: user.id,
        })) as never,
      );
      if (added.error) {
        // A membership already on the list is not an error worth failing the
        // whole request over — a person is on a list or they are not.
        if (added.error.code !== "23505") return databaseErrorResponse(added.error);
      }
    }

    if (payload.unsubscribeAccountId !== undefined) {
      const withdrawn = await client
        .from("crm_list_members")
        .update({
          unsubscribed_at: new Date().toISOString(),
          unsubscribe_reason: payload.unsubscribeReason ?? null,
        } as never)
        .eq("organization_id", activeOrganization.id)
        .eq("list_id", payload.listId)
        .eq("account_id", payload.unsubscribeAccountId)
        .select("id")
        .maybeSingle();
      if (withdrawn.error) return databaseErrorResponse(withdrawn.error);
      if (!withdrawn.data) {
        return jsonNoStore(
          {
            error: {
              code: "member_not_found",
              message: "That customer is not on this list.",
            },
          },
          { status: 404 },
        );
      }
    }

    const { data, error } = await client
      .from("crm_marketing_lists")
      .select(CRM_MARKETING_LIST_COLUMNS)
      .eq("organization_id", activeOrganization.id)
      .eq("id", payload.listId)
      .maybeSingle();
    if (error) return databaseErrorResponse(error);
    if (!data) {
      return jsonNoStore(
        { error: { code: "list_not_found", message: "No such list in this workspace." } },
        { status: 404 },
      );
    }
    return jsonNoStore({ list: toMarketingListView(data as unknown as CrmMarketingListRow) });
  } catch (error) {
    return failure(error, "invalid_list_change", "crm_list_not_updated", "The list could not be updated.");
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
