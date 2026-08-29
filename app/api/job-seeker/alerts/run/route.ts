import { timingSafeEqual } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import { alertEmailConnected, sendAlertEmail } from "@/lib/job-seeker/alert-email";
import {
  composeAlertEmail,
  planAlertCandidates,
  toDeliveryRows,
} from "@/lib/job-seeker/alerts";
import { BOARD_SEARCH_ADAPTERS, boardSearchAdapter } from "@/lib/job-seeker/board-search/registry";
import { toEvaluationInputs } from "@/lib/job-seeker/record";
import { savedSearchQuerySchema } from "@/lib/job-seeker/saved-search-query";
import { jsonNoStore } from "@/lib/server/http";
import { getSupabasePublicEnvironment } from "@/lib/supabase/env";

export const runtime = "nodejs";
export const maxDuration = 300;

/**
 * The alert engine's scheduled entry point, driven by Vercel Cron.
 *
 * Authorization is the platform's own convention: the cron invocation
 * carries `Authorization: Bearer ${CRON_SECRET}`, and this route refuses
 * everything else — including every request while CRON_SECRET is unset,
 * which is the fail-closed default this repository requires of anything
 * that mutates or emails.
 *
 * The database is reached exclusively through the two definer functions of
 * 20260829000300. The service-role key signs those RPCs and nothing else:
 * the role holds no job-seeker table grant, so a bug here cannot widen into
 * a table scan the schema never granted.
 *
 * Per due alert: run the saved search against its boards, dedupe, filter,
 * score against the recorded profile facts the boundary returned, drop
 * everything already in the delivery ledger, email what is genuinely new,
 * then record the scan and its deliveries — where the ledger's unique
 * constraint enforces never-repeat a second time. One alert failing is
 * reported and does not stop the rest.
 */

type DueAlert = {
  alert_id: string;
  saved_search_id: string;
  organization_id: string;
  user_id: string;
  recipient_email: string;
  search_name: string;
  search_query: unknown;
  cadence: string;
  profile: Record<string, unknown>;
  preferences: Record<string, unknown>;
  profile_recorded: boolean;
  delivered_urls: string[] | null;
};

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const presented = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const a = Buffer.from(presented);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function runAlerts(request: Request) {
  if (!process.env.CRON_SECRET) {
    return jsonNoStore(
      { error: { code: "alerts_not_configured", message: "CRON_SECRET is not set; the alert engine is off." } },
      { status: 503 },
    );
  }
  if (!authorized(request)) {
    return jsonNoStore(
      { error: { code: "unauthorized", message: "This endpoint belongs to the scheduler." } },
      { status: 401 },
    );
  }
  if (!alertEmailConnected()) {
    // Scanning without a mailer would burn cadence windows on emails that
    // cannot exist; the honest state is "the engine is waiting for email".
    return jsonNoStore({
      ran: false,
      reason: "Email is Not Connected (RESEND_API_KEY, JOB_ALERT_EMAIL_FROM).",
    });
  }
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) {
    return jsonNoStore(
      { error: { code: "alerts_not_configured", message: "SUPABASE_SERVICE_ROLE_KEY is not set." } },
      { status: 503 },
    );
  }

  const { url } = getSupabasePublicEnvironment();
  const client = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
  });

  const due = await client.rpc("list_due_job_seeker_alerts", {});
  if (due.error) {
    return jsonNoStore(
      { error: { code: "alerts_unavailable", message: "Due alerts could not be listed." } },
      { status: 500 },
    );
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.theagoras.com";
  const boardNames = new Map(BOARD_SEARCH_ADAPTERS.map((adapter) => [adapter.key, adapter.name]));
  let scanned = 0;
  let emailed = 0;
  const failures: Array<{ alertId: string; detail: string }> = [];

  for (const alert of ((due.data ?? []) as DueAlert[]).slice(0, 10)) {
    try {
      const parsedQuery = savedSearchQuerySchema.safeParse(alert.search_query ?? {});
      if (!parsedQuery.success) {
        failures.push({ alertId: alert.alert_id, detail: "stored query did not parse" });
        continue;
      }
      const query = parsedQuery.data;
      const keys = query.boards ?? BOARD_SEARCH_ADAPTERS.map((adapter) => adapter.key);
      const adapters = keys
        .map((key) => boardSearchAdapter(key))
        .filter((adapter): adapter is NonNullable<typeof adapter> => adapter !== null);

      const settled = await Promise.allSettled(
        adapters.map((adapter) =>
          adapter.search({ text: query.text, location: query.location ?? null, limit: 25 })),
      );
      const tagged = settled.flatMap((outcome, index) =>
        outcome.status === "fulfilled"
          ? outcome.value.hits.map((hit) => ({
              board: adapters[index]!.key,
              boardName: adapters[index]!.name,
              hit,
              saveToken: "",
            }))
          : []);

      const candidates = planAlertCandidates({
        query,
        tagged,
        boardNames,
        deliveredUrls: new Set(alert.delivered_urls ?? []),
        evaluation: alert.profile_recorded
          ? toEvaluationInputs(alert.profile ?? {}, alert.preferences ?? {})
          : null,
      });

      let deliveries: ReturnType<typeof toDeliveryRows> = [];
      if (candidates.length > 0) {
        const email = composeAlertEmail({
          searchName: alert.search_name,
          candidates,
          siteUrl,
        });
        const outcome = await sendAlertEmail({
          to: alert.recipient_email,
          subject: email.subject,
          text: email.text,
        });
        deliveries = toDeliveryRows(candidates, outcome.sent ? "sent" : "failed");
        if (outcome.sent) emailed += 1;
        else failures.push({ alertId: alert.alert_id, detail: outcome.detail ?? "send failed" });
      }

      const recorded = await client.rpc("record_job_seeker_alert_scan", {
        p_alert_id: alert.alert_id,
        p_deliveries: deliveries,
      });
      if (recorded.error) {
        failures.push({ alertId: alert.alert_id, detail: "scan could not be recorded" });
        continue;
      }
      scanned += 1;
    } catch {
      failures.push({ alertId: alert.alert_id, detail: "scan threw" });
    }
  }

  return jsonNoStore({ ran: true, due: (due.data ?? []).length, scanned, emailed, failures });
}

export async function GET(request: Request) {
  return runAlerts(request);
}

export async function POST(request: Request) {
  return runAlerts(request);
}
