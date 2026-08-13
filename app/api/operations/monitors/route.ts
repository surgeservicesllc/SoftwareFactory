import { z } from "zod";

import { findMonitorProvider } from "@/lib/operations/providers";
import {
  OPERATIONS_EXECUTION_ENVELOPE,
  invalidRequest,
  operationsContext,
  operationsFailure,
  requireManager,
} from "@/lib/operations/route";
import { validateMonitorTarget } from "@/lib/operations/target";
import { PRODUCTION_SIGNAL_KINDS, SYNTHETIC_PROFILES } from "@/lib/operations/types";
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

const configureMonitorSchema = z
  .object({
    projectId: z.string().uuid(),
    name: z.string().trim().min(1).max(120),
    signalKind: z.enum(PRODUCTION_SIGNAL_KINDS),
    provider: z.string().trim().regex(/^[a-z][a-z0-9_-]{1,39}$/),
    targetUrl: z.string().trim().max(208).optional(),
    profile: z.enum(SYNTHETIC_PROFILES).optional(),
    expectedStatusCode: z.number().int().min(100).max(599).default(200),
    degradedLatencyMs: z.number().int().min(100).max(120_000).default(2_000),
    failureThreshold: z.number().int().min(1).max(10).default(2),
  })
  .strict()
  .refine((value) => (value.signalKind === "synthetic") === (value.profile !== undefined), {
    message: "A synthetic monitor needs a validation profile, and only a synthetic monitor may have one.",
  });

type MonitorRow = {
  id: string;
  name: string;
  signal_kind: string;
  provider: string;
  target_url: string | null;
  connection_state: string;
  unavailable_reason: string | null;
  enabled: boolean;
  failure_threshold: number;
  last_outcome: string;
};

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const parsed = configureMonitorSchema.safeParse(await readBoundedJson(request, 8 * 1024));
    if (!parsed.success) {
      return invalidRequest("Provide a project, monitor name, signal kind, and provider.");
    }
    if (findSensitiveData(parsed.data)) {
      return invalidRequest("Monitor details appear to contain sensitive data.");
    }

    const provider = findMonitorProvider(parsed.data.provider);
    if (!provider) {
      return invalidRequest("That monitoring provider is not recognized.");
    }

    // A connected provider still has to be given a probeable target; an
    // unconnected provider is recorded as Not Connected and cannot be enabled.
    if (provider.connected) {
      if (!parsed.data.targetUrl) {
        return invalidRequest("A connected provider needs an HTTPS target URL.");
      }
      const target = validateMonitorTarget(parsed.data.targetUrl);
      if (!target.valid) {
        return jsonNoStore(
          { error: { code: "invalid_monitor_target", message: target.detail } },
          { status: 400 },
        );
      }
      if (!provider.supports.includes(parsed.data.signalKind)) {
        return invalidRequest(`${provider.label} cannot observe a ${parsed.data.signalKind} signal.`);
      }
    }

    const context = await operationsContext();
    const forbidden = requireManager(context);
    if (forbidden) return forbidden;

    const { data, error } = await context.client
      .rpc("configure_production_monitor", {
        p_project_id: parsed.data.projectId,
        p_name: parsed.data.name,
        p_signal_kind: parsed.data.signalKind,
        p_provider: parsed.data.provider,
        p_target_url: provider.connected ? (parsed.data.targetUrl ?? null) : null,
        p_profile: parsed.data.profile ?? null,
        p_expected_status_code: parsed.data.expectedStatusCode,
        p_degraded_latency_ms: parsed.data.degradedLatencyMs,
        p_failure_threshold: parsed.data.failureThreshold,
        p_enabled: provider.connected,
      })
      .single();

    if (error) return databaseErrorResponse(error);

    const row = data as MonitorRow;
    return jsonNoStore(
      {
        ...OPERATIONS_EXECUTION_ENVELOPE,
        monitor: {
          id: row.id,
          name: row.name,
          signalKind: row.signal_kind,
          provider: row.provider,
          targetUrl: row.target_url,
          connectionState: row.connection_state,
          connectionLabel: row.connection_state === "connected" ? "Connected" : "Not Connected",
          unavailableReason: row.unavailable_reason,
          enabled: row.enabled,
          failureThreshold: row.failure_threshold,
          lastOutcome: row.last_outcome,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    return operationsFailure(
      error,
      "monitor_configuration_failed",
      "The monitor could not be configured safely.",
    );
  }
}
