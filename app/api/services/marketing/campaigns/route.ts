import { z } from "zod";

import {
  CRM_CAMPAIGN_COLUMNS,
  CRM_CAMPAIGN_STATUSES,
  CRM_CHANNELS,
  CRM_MESSAGE_COLUMNS,
  toCampaignView,
  toMessageView,
  type CrmCampaignRow,
  type CrmMessageRow,
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
 * Campaigns, and the message log they produce.
 *
 * NOTHING HERE SENDS ANYTHING. No email or SMS provider is connected to
 * this product, and the surfaces say Not Connected rather than implying
 * delivery. A campaign can be drafted, scheduled and cancelled; `sending`
 * and `sent` are states a real integration would move it through, and this
 * route refuses to assert either — a status that claimed a send had
 * happened would be the hard-coded success this codebase refuses.
 *
 * The message log is append-only and its funnel only runs one way: a click
 * implies an open, an open implies delivery, delivery implies a send. Those
 * are the schema's CHECKs, so a reported open rate cannot exceed the
 * delivery it came from.
 */

/** What a caller may set. `sending` and `sent` belong to a provider. */
const SETTABLE_STATUSES = CRM_CAMPAIGN_STATUSES.filter(
  (status) => status === "draft" || status === "scheduled" || status === "cancelled",
) as unknown as ["draft", "scheduled", "cancelled"];

const createSchema = z
  .object({
    listId: z.string().uuid().nullish(),
    name: z.string().trim().min(1).max(160),
    channel: z.enum(CRM_CHANNELS),
    subject: z.string().trim().min(1).max(200).nullish(),
    body: z.string().trim().min(1).max(8000).nullish(),
    budgetCents: z.number().int().min(0).max(100_000_000_000).nullish(),
    scheduledAt: z.string().datetime().nullish(),
  })
  .strict()
  .refine((value) => value.channel !== "email" || Boolean(value.subject), {
    message: "An email campaign carries a subject.",
  });

const patchSchema = z
  .object({
    campaignId: z.string().uuid(),
    status: z.enum(SETTABLE_STATUSES).optional(),
    name: z.string().trim().min(1).max(160).optional(),
    subject: z.string().trim().min(1).max(200).nullable().optional(),
    body: z.string().trim().min(1).max(8000).nullable().optional(),
    budgetCents: z.number().int().min(0).max(100_000_000_000).nullable().optional(),
    scheduledAt: z.string().datetime().nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 1, { message: "Nothing to change." });

export async function GET() {
  try {
    const { client, activeOrganization } = await requireActiveOrganization();
    const [campaignRows, messageRows] = await Promise.all([
      client
        .from("crm_campaigns")
        .select(CRM_CAMPAIGN_COLUMNS)
        .eq("organization_id", activeOrganization.id)
        .order("created_at", { ascending: false })
        .limit(400),
      client
        .from("crm_messages")
        .select(CRM_MESSAGE_COLUMNS)
        .eq("organization_id", activeOrganization.id)
        .limit(5000),
    ]);
    if (campaignRows.error) return databaseErrorResponse(campaignRows.error);
    if (messageRows.error) return databaseErrorResponse(messageRows.error);

    const campaigns = ((campaignRows.data ?? []) as unknown as CrmCampaignRow[]).map(toCampaignView);
    const messages = ((messageRows.data ?? []) as unknown as CrmMessageRow[]).map(toMessageView);

    const tally = new Map<string, { sent: number; delivered: number; opened: number; clicked: number; failed: number }>();
    for (const message of messages) {
      const bucket = tally.get(message.campaignId) ?? {
        sent: 0, delivered: 0, opened: 0, clicked: 0, failed: 0,
      };
      if (message.sentAt !== null) bucket.sent += 1;
      if (message.deliveredAt !== null) bucket.delivered += 1;
      if (message.openedAt !== null) bucket.opened += 1;
      if (message.clickedAt !== null) bucket.clicked += 1;
      if (message.status === "bounced" || message.status === "failed") bucket.failed += 1;
      tally.set(message.campaignId, bucket);
    }

    return jsonNoStore({
      campaigns: campaigns.map((campaign) => {
        const counts = tally.get(campaign.id) ?? {
          sent: 0, delivered: 0, opened: 0, clicked: 0, failed: 0,
        };
        return {
          ...campaign,
          ...counts,
          // Rates over nothing are null, not zero — the same rule the
          // leaderboard uses for a rep with no decided deals.
          openRate: counts.delivered === 0 ? null : Math.round((counts.opened / counts.delivered) * 100),
          clickRate: counts.opened === 0 ? null : Math.round((counts.clicked / counts.opened) * 100),
        };
      }),
      counts: {
        total: campaigns.length,
        messages: messages.length,
        // Said plainly, because the page says it too: nothing here sent
        // anything. No provider is connected.
        providerConnected: false,
      },
    });
  } catch (error) {
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "crm_campaigns_unavailable", message: "Campaigns could not be listed." } },
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
      .from("crm_campaigns")
      .insert({
        organization_id: activeOrganization.id,
        list_id: payload.listId ?? null,
        name: payload.name,
        channel: payload.channel,
        // A new campaign is a draft, whatever it was sent with.
        status: payload.scheduledAt ? "scheduled" : "draft",
        subject: payload.subject ?? null,
        body: payload.body ?? null,
        budget_cents: payload.budgetCents ?? null,
        scheduled_at: payload.scheduledAt ?? null,
        created_by: user.id,
      })
      .select(CRM_CAMPAIGN_COLUMNS)
      .single();
    if (error) {
      if (error.code === "23503") {
        return jsonNoStore(
          { error: { code: "reference_not_found", message: "That list is not in this workspace." } },
          { status: 404 },
        );
      }
      return databaseErrorResponse(error);
    }
    return jsonNoStore({ campaign: toCampaignView(data as unknown as CrmCampaignRow) }, { status: 201 });
  } catch (error) {
    return failure(error, "invalid_campaign", "crm_campaign_not_recorded", "The campaign could not be recorded.");
  }
}

export async function PATCH(request: Request) {
  try {
    assertSameOriginRequest(request);
    const payload = patchSchema.parse(await readBoundedJson(request, 32_000));
    const { client, activeOrganization } = await requireActiveOrganization();

    const changes: Record<string, unknown> = {};
    if (payload.name !== undefined) changes.name = payload.name;
    if (payload.subject !== undefined) changes.subject = payload.subject;
    if (payload.body !== undefined) changes.body = payload.body;
    if (payload.budgetCents !== undefined) changes.budget_cents = payload.budgetCents;
    if (payload.scheduledAt !== undefined) changes.scheduled_at = payload.scheduledAt;
    if (payload.status !== undefined) {
      changes.status = payload.status;
      // Scheduling needs a time; the schema refuses one without.
      if (payload.status === "scheduled" && payload.scheduledAt === undefined) {
        return jsonNoStore(
          {
            error: {
              code: "schedule_needs_a_time",
              message: "A scheduled campaign names when it goes out.",
            },
          },
          { status: 422 },
        );
      }
      if (payload.status === "draft") changes.scheduled_at = null;
    }

    const { data, error } = await client
      .from("crm_campaigns")
      .update(changes)
      .eq("organization_id", activeOrganization.id)
      .eq("id", payload.campaignId)
      .select(CRM_CAMPAIGN_COLUMNS)
      .maybeSingle();
    if (error) {
      if (error.code === "23514") {
        return jsonNoStore(
          {
            error: {
              code: "campaign_refused",
              message:
                "The campaign was refused — an email carries a subject, a scheduled campaign names its time, and a draft has not gone out.",
            },
          },
          { status: 409 },
        );
      }
      return databaseErrorResponse(error);
    }
    if (!data) {
      return jsonNoStore(
        { error: { code: "campaign_not_found", message: "No such campaign in this workspace." } },
        { status: 404 },
      );
    }
    return jsonNoStore({ campaign: toCampaignView(data as unknown as CrmCampaignRow) });
  } catch (error) {
    return failure(error, "invalid_campaign_change", "crm_campaign_not_updated", "The campaign could not be updated.");
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
