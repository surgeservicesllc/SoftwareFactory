import { z } from "zod";

import {
  OPERATIONS_EXECUTION_ENVELOPE,
  invalidRequest,
  operationsContext,
  operationsFailure,
  requireManager,
} from "@/lib/operations/route";
import {
  MAX_SYNTHETIC_STEPS,
  SYNTHETIC_PROFILE_DESCRIPTIONS,
  validateSyntheticJourney,
} from "@/lib/operations/synthetic";
import { validateMonitorTarget } from "@/lib/operations/target";
import { SYNTHETIC_PROFILES } from "@/lib/operations/types";
import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { findSensitiveData } from "@/lib/server/sensitive-data";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

const stepSchema = z
  .object({
    kind: z.enum(["app_shell", "login", "critical_read", "safe_write", "api", "workflow"]),
    name: z.string().trim().min(1).max(120),
    path: z.string().trim().min(1).max(200).startsWith("/"),
    method: z.enum(["GET", "HEAD", "POST"]),
    expectedStatus: z.number().int().min(100).max(599).default(200),
    reversalNote: z.string().trim().min(10).max(300).optional(),
  })
  .strict();

const journeySchema = z
  .object({
    monitorId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    profile: z.enum(SYNTHETIC_PROFILES),
    baseUrl: z.string().trim().max(208),
    steps: z.array(stepSchema).min(1).max(MAX_SYNTHETIC_STEPS),
  })
  .strict();

type JourneyRow = {
  id: string;
  project_id: string;
  project_name: string;
  monitor_id: string;
  monitor_name: string;
  name: string;
  profile: string;
  base_url: string;
  steps: unknown[];
  enabled: boolean;
  monitor_connection_state: string;
  last_outcome: string;
  last_observed_at: string | null;
};

export async function GET() {
  try {
    const context = await operationsContext();
    const { data, error } = await context.client.rpc("list_synthetic_journeys", {
      p_organization_id: context.activeOrganization.id,
      p_limit: 100,
    });
    if (error) return databaseErrorResponse(error);

    return jsonNoStore({
      ...OPERATIONS_EXECUTION_ENVELOPE,
      profiles: SYNTHETIC_PROFILE_DESCRIPTIONS,
      journeys: ((data ?? []) as JourneyRow[]).map((row) => ({
        id: row.id,
        projectId: row.project_id,
        projectName: row.project_name,
        monitorId: row.monitor_id,
        monitorName: row.monitor_name,
        name: row.name,
        profile: row.profile,
        baseUrl: row.base_url,
        steps: row.steps,
        enabled: row.enabled,
        connectionState: row.monitor_connection_state,
        connectionLabel: row.monitor_connection_state === "connected" ? "Connected" : "Not Connected",
        lastOutcome: row.last_outcome,
        lastObservedAt: row.last_observed_at,
      })),
    });
  } catch (error) {
    return operationsFailure(
      error,
      "synthetic_journeys_unavailable",
      "Synthetic journeys could not be loaded.",
    );
  }
}

/**
 * Define a synthetic journey for a synthetic monitor.
 *
 * Safety is checked twice on purpose: here, so the caller gets a useful
 * message, and again by CHECK constraint in the database, so an unsafe journey
 * cannot be stored even if this route is bypassed.
 */
export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const parsed = journeySchema.safeParse(await readBoundedJson(request, 16 * 1024));
    if (!parsed.success) {
      return invalidRequest("Provide a synthetic monitor, a name, a profile, an HTTPS base URL, and at least one step.");
    }
    if (findSensitiveData(parsed.data)) {
      return invalidRequest("The journey definition appears to contain sensitive data.");
    }

    const target = validateMonitorTarget(parsed.data.baseUrl);
    if (!target.valid) {
      return jsonNoStore(
        { error: { code: "invalid_journey_target", message: target.detail } },
        { status: 400 },
      );
    }

    const validation = validateSyntheticJourney({
      profile: parsed.data.profile,
      steps: parsed.data.steps.map((step) => ({
        kind: step.kind,
        name: step.name,
        path: step.path,
        method: step.method,
        expectedStatus: step.expectedStatus,
        reversalNote: step.reversalNote,
      })),
    });
    if (!validation.valid) {
      return jsonNoStore(
        {
          error: { code: "unsafe_journey", message: "The journey was rejected." },
          rejections: validation.rejections,
        },
        { status: 400 },
      );
    }

    const context = await operationsContext();
    const forbidden = requireManager(context);
    if (forbidden) return forbidden;

    const { data, error } = await context.client
      .rpc("configure_synthetic_journey", {
        p_monitor_id: parsed.data.monitorId,
        p_name: parsed.data.name,
        p_profile: parsed.data.profile,
        p_base_url: parsed.data.baseUrl,
        p_steps: parsed.data.steps.map((step) => ({
          kind: step.kind,
          name: step.name,
          path: step.path,
          method: step.method,
          expected_status: step.expectedStatus,
          ...(step.reversalNote ? { reversal_note: step.reversalNote } : {}),
        })),
      })
      .single();

    if (error) return databaseErrorResponse(error);
    const row = data as { id: string; name: string; profile: string; base_url: string; steps: unknown[] };

    return jsonNoStore(
      {
        ...OPERATIONS_EXECUTION_ENVELOPE,
        journey: {
          id: row.id,
          name: row.name,
          profile: row.profile,
          baseUrl: row.base_url,
          steps: row.steps,
        },
        note: "Declared write steps are recorded but never executed: production writes are Not Connected.",
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    return operationsFailure(
      error,
      "synthetic_journey_failed",
      "The synthetic journey could not be saved.",
    );
  }
}
