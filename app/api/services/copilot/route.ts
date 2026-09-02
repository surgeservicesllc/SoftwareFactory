import { z } from "zod";

import {
  COPILOT_SKILLS,
  composeAutopayAnswer,
  composeFollowupsAnswer,
  composeLostMoneyAnswer,
  composeOverdueAnswer,
  composeRevenueAnswer,
  composeRoutesAnswer,
  composeSignalsAnswer,
  composeUnknownAnswer,
  composeVisitsAnswer,
  matchQuestion,
} from "@/lib/services/copilot";
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
 * Ask the workspace a question it can answer from its own rows.
 *
 * Every figure in a response comes from a bounded RLS-scoped read run at
 * answer time — nothing is generated, cached, or estimated. An unmatched
 * question is a 200 with the honest refusal, not an error: not knowing is
 * this copilot's normal, documented behaviour.
 */

const askSchema = z.object({ question: z.string().trim().min(3).max(300) }).strict();

function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function GET() {
  return jsonNoStore({
    skills: COPILOT_SKILLS.map(({ id, label, example }) => ({ id, label, example })),
    generation: { available: false, label: "Not Connected" },
  });
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const { question } = askSchema.parse(await readBoundedJson(request, 8_000));
    const { client, activeOrganization } = await requireActiveOrganization();
    const organizationId = activeOrganization.id;

    const skill = matchQuestion(question);
    if (skill === null) {
      return jsonNoStore({ skill: null, answer: composeUnknownAnswer() });
    }

    const today = new Date();
    const todayIso = isoDay(today);

    if (skill === "lost_money") {
      const days = 90;
      const read = await client
        .rpc("crm_visit_profitability", { p_organization: organizationId, p_days: days })
        .limit(5000);
      if (read.error) return databaseErrorResponse(read.error);
      const rows = (read.data ?? []) as Array<{
        account_name: string; service_type: string; margin_cents: number | null; revenue_cents: number | null;
      }>;
      const known = rows.filter((row) => row.margin_cents !== null);
      const losers = known
        .filter((row) => Number(row.margin_cents) < 0)
        .sort((a, b) => Number(a.margin_cents) - Number(b.margin_cents))
        .map((row) => ({
          account: row.account_name,
          service: row.service_type,
          marginCents: Number(row.margin_cents),
          revenueCents: Number(row.revenue_cents ?? 0),
        }));
      return jsonNoStore({
        skill,
        answer: composeLostMoneyAnswer({ days, completed: rows.length, known: known.length, losers }),
      });
    }

    if (skill === "hot_leads" || skill === "churn_risk" || skill === "upsell") {
      const model = skill === "hot_leads" ? "lead" : skill === "churn_risk" ? "churn" : "upsell";
      const scoresRead = await client.rpc("crm_score_accounts", { p_organization: organizationId, p_model: model });
      if (scoresRead.error) return databaseErrorResponse(scoresRead.error);
      const rows = (scoresRead.data ?? []) as Array<{
        account_id: string; score: number; breakdown: Array<{ fact: string }>;
      }>;
      const top = rows.filter((row) => Number(row.score) > 0).slice(0, 3);
      const nameById = new Map<string, string>();
      if (top.length > 0) {
        const namesRead = await client
          .from("crm_accounts")
          .select("id, name")
          .eq("organization_id", organizationId)
          .in("id", top.map((row) => row.account_id));
        if (namesRead.error) return databaseErrorResponse(namesRead.error);
        for (const account of (namesRead.data ?? []) as Array<{ id: string; name: string }>) {
          nameById.set(account.id, account.name);
        }
      }
      return jsonNoStore({
        skill,
        answer: composeSignalsAnswer({
          model,
          scored: rows.length,
          top: top.map((row) => ({
            name: nameById.get(row.account_id) ?? "an account",
            score: Number(row.score),
            facts: (Array.isArray(row.breakdown) ? row.breakdown : []).map((line) => line.fact),
          })),
        }),
      });
    }

    if (skill === "followups") {
      const [openRead, suggestRead] = await Promise.all([
        client
          .from("crm_tasks")
          .select("due_on")
          .eq("organization_id", organizationId)
          .eq("status", "open")
          .lte("due_on", todayIso)
          .limit(2000),
        client.rpc("crm_suggest_followups", { p_organization: organizationId }),
      ]);
      if (openRead.error) return databaseErrorResponse(openRead.error);
      if (suggestRead.error) return databaseErrorResponse(suggestRead.error);
      const due = (openRead.data ?? []) as Array<{ due_on: string }>;
      const suggestions = (suggestRead.data ?? []) as Array<{ title: string; reason: string }>;
      return jsonNoStore({
        skill,
        answer: composeFollowupsAnswer({
          overdue: due.filter((task) => task.due_on < todayIso).length,
          dueToday: due.filter((task) => task.due_on === todayIso).length,
          suggestions,
          suggestionCount: suggestions.length,
        }),
      });
    }

    if (skill === "overdue_invoices") {
      const { data, error } = await client
        .from("crm_invoices")
        .select("total_cents, paid_cents, due_on")
        .eq("organization_id", organizationId)
        .eq("status", "open")
        .lt("due_on", todayIso)
        .order("due_on", { ascending: true })
        .limit(2000);
      if (error) return databaseErrorResponse(error);
      const rows = (data ?? []) as Array<{ total_cents: number; paid_cents: number; due_on: string }>;
      const overdue = rows.filter((row) => Number(row.paid_cents) < Number(row.total_cents));
      const totalOutstandingCents = overdue.reduce(
        (sum, row) => sum + (Number(row.total_cents) - Number(row.paid_cents)),
        0,
      );
      return jsonNoStore({
        skill,
        answer: composeOverdueAnswer({
          count: overdue.length,
          totalOutstandingCents,
          oldestDueOn: overdue[0]?.due_on ?? null,
        }),
      });
    }

    if (skill === "todays_routes") {
      const [routesRead, techniciansRead] = await Promise.all([
        client
          .from("crm_routes")
          .select("id, technician_id, status")
          .eq("organization_id", organizationId)
          .eq("route_date", todayIso)
          .limit(200),
        client
          .from("crm_technicians")
          .select("id, first_name, last_name")
          .eq("organization_id", organizationId)
          .limit(1000),
      ]);
      if (routesRead.error) return databaseErrorResponse(routesRead.error);
      if (techniciansRead.error) return databaseErrorResponse(techniciansRead.error);
      const routes = (routesRead.data ?? []) as Array<{ id: string; technician_id: string; status: string }>;
      const stopCounts = new Map<string, number>();
      if (routes.length > 0) {
        const stopsRead = await client
          .from("crm_route_stops")
          .select("route_id")
          .eq("organization_id", organizationId)
          .in("route_id", routes.map((route) => route.id));
        if (stopsRead.error) return databaseErrorResponse(stopsRead.error);
        for (const stop of (stopsRead.data ?? []) as Array<{ route_id: string }>) {
          stopCounts.set(stop.route_id, (stopCounts.get(stop.route_id) ?? 0) + 1);
        }
      }
      const nameById = new Map(
        ((techniciansRead.data ?? []) as Array<{ id: string; first_name: string; last_name: string | null }>).map(
          (technician) => [
            technician.id,
            [technician.first_name, technician.last_name].filter(Boolean).join(" "),
          ],
        ),
      );
      return jsonNoStore({
        skill,
        answer: composeRoutesAnswer({
          day: todayIso,
          routes: routes.map((route) => ({
            technician: nameById.get(route.technician_id) ?? "An unnamed technician",
            stops: stopCounts.get(route.id) ?? 0,
            status: route.status,
          })),
        }),
      });
    }

    if (skill === "upcoming_visits") {
      const weekOut = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
      const { data, error, count } = await client
        .from("crm_work_orders")
        .select("scheduled_start", { count: "exact" })
        .eq("organization_id", organizationId)
        .gte("scheduled_start", today.toISOString())
        .lt("scheduled_start", weekOut.toISOString())
        .order("scheduled_start", { ascending: true })
        .limit(1);
      if (error) return databaseErrorResponse(error);
      const first = (data ?? [])[0] as { scheduled_start: string } | undefined;
      return jsonNoStore({
        skill,
        answer: composeVisitsAnswer({
          count: count ?? 0,
          firstStart: first ? first.scheduled_start : null,
        }),
      });
    }

    if (skill === "autopay_coverage") {
      const [enrollments, accounts] = await Promise.all([
        client
          .from("crm_autopay_enrollments")
          .select("account_id", { count: "exact", head: true })
          .eq("organization_id", organizationId)
          // Active means never revoked — the schema records revocation as a
          // timestamp, not a status flag (ADR-218).
          .is("revoked_at", null),
        client
          .from("crm_accounts")
          .select("id", { count: "exact", head: true })
          .eq("organization_id", organizationId),
      ]);
      if (enrollments.error) return databaseErrorResponse(enrollments.error);
      if (accounts.error) return databaseErrorResponse(accounts.error);
      return jsonNoStore({
        skill,
        answer: composeAutopayAnswer({
          enrolled: enrollments.count ?? 0,
          accounts: accounts.count ?? 0,
        }),
      });
    }

    // monthly_revenue
    const monthStart = `${todayIso.slice(0, 7)}-01`;
    const month = today.toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
    const { data, error } = await client
      .from("crm_invoices")
      .select("total_cents, paid_cents")
      .eq("organization_id", organizationId)
      .gte("issued_on", monthStart)
      .neq("status", "void")
      .limit(5000);
    if (error) return databaseErrorResponse(error);
    const rows = (data ?? []) as Array<{ total_cents: number; paid_cents: number }>;
    return jsonNoStore({
      skill,
      answer: composeRevenueAnswer({
        month,
        invoiced: rows.length,
        totalCents: rows.reduce((sum, row) => sum + Number(row.total_cents), 0),
        collectedCents: rows.reduce((sum, row) => sum + Number(row.paid_cents), 0),
      }),
    });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    if (error instanceof z.ZodError) {
      return jsonNoStore(
        { error: { code: "invalid_question", message: "A question is 3 to 300 characters." } },
        { status: 422 },
      );
    }
    const boundary = supabaseBoundaryErrorResponse(error);
    if (boundary) return boundary;
    return jsonNoStore(
      { error: { code: "copilot_unavailable", message: "The question could not be answered." } },
      { status: 500 },
    );
  }
}
