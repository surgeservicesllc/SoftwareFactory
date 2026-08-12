import { z } from "zod";

import { PHASE_1D_SAFETY_DEFAULTS } from "@/lib/constants";
import { describeProviders } from "@/lib/providers/registry";
import { databaseErrorResponse, jsonNoStore, readBoundedJson } from "@/lib/server/http";
import { forbidden, invalidRequest, withTenant } from "@/lib/server/tenant-route";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { isWorkerTickConfigured } from "@/lib/worker/tick";

export const runtime = "nodejs";

const updateSchema = z
  .object({
    factoryName: z.string().trim().min(1).max(120).optional(),
    timezone: z.string().trim().min(1).max(64).optional(),
    executionEnabled: z.boolean().optional(),
    dailyReportEnabled: z.boolean().optional(),
    dailyReportHour: z.coerce.number().int().min(0).max(23).optional(),
    maxRepairAttempts: z.coerce.number().int().min(0).max(5).optional(),
    maxCiRepairAttempts: z.coerce.number().int().min(0).max(5).optional(),
    maxConcurrentRuns: z.coerce.number().int().min(1).max(10).optional(),
    defaultProvider: z.string().trim().min(1).max(64).optional(),
    defaultModel: z.string().trim().min(1).max(120).optional(),
    notifyOnOwnerAction: z.boolean().optional(),
    notifyOnRunFailure: z.boolean().optional(),
    notifyOnSecurityFinding: z.boolean().optional(),
    activityRetentionDays: z.coerce.number().int().min(30).max(3650).optional(),
  })
  .strict();

type SettingsRow = {
  factory_name: string;
  timezone: string;
  execution_enabled: boolean;
  daily_report_enabled: boolean;
  daily_report_hour: number;
  max_repair_attempts: number;
  max_ci_repair_attempts: number;
  max_concurrent_runs: number;
  default_provider: string;
  default_model: string;
  notify_on_owner_action: boolean;
  notify_on_run_failure: boolean;
  notify_on_security_finding: boolean;
  activity_retention_days: number;
  updated_at: string;
};

function present(settings: SettingsRow) {
  return {
    factory: {
      name: settings.factory_name,
      timezone: settings.timezone,
    },
    execution: {
      // Commanded execution is deliberately separate from the Phase 1D autonomy
      // kill switch. Turning it on lets an owner-submitted command reach a
      // worker; it never enables autonomous approval, merge, deploy, or rollback.
      enabled: settings.execution_enabled,
      maxRepairAttempts: settings.max_repair_attempts,
      maxCiRepairAttempts: settings.max_ci_repair_attempts,
      maxConcurrentRuns: settings.max_concurrent_runs,
      defaultProvider: settings.default_provider,
      defaultModel: settings.default_model,
    },
    reporting: {
      dailyReportEnabled: settings.daily_report_enabled,
      dailyReportHour: settings.daily_report_hour,
    },
    notifications: {
      onOwnerAction: settings.notify_on_owner_action,
      onRunFailure: settings.notify_on_run_failure,
      onSecurityFinding: settings.notify_on_security_finding,
    },
    data: {
      activityRetentionDays: settings.activity_retention_days,
    },
    updatedAt: settings.updated_at,
  };
}

export async function GET() {
  return withTenant(
    async ({ activeOrganization, client }) => {
      const { data, error } = await client
        .rpc("get_organization_settings", { p_organization_id: activeOrganization.id })
        .single();
      if (error) return databaseErrorResponse(error);

      const { data: killSwitch } = await client
        .from("organizations")
        .select("autonomy_kill_switch_active")
        .eq("id", activeOrganization.id)
        .maybeSingle();

      return jsonNoStore({
        activeOrganizationId: activeOrganization.id,
        canManage: activeOrganization.role === "owner",
        settings: present(data as SettingsRow),
        providers: describeProviders(),
        autonomy: {
          // These are enforced by database constraints, not by this response.
          autonomousMode: false,
          globalKillSwitchActive: killSwitch?.autonomy_kill_switch_active ?? true,
          maximumAutonomousRisk: "GREEN",
          autoApprove: false,
          autoMerge: false,
          autoDeploy: false,
          autoRollback: false,
          executorConnected: PHASE_1D_SAFETY_DEFAULTS.executorConnected,
          locked: true,
          lockedReason:
            "Autonomous Mode, the risk ceiling, and every automatic action are constrained by hosted database checks. No client control can change them.",
        },
        worker: {
          tickConfigured: isWorkerTickConfigured(),
        },
      });
    },
    { code: "settings_unavailable", message: "Factory settings could not be loaded." },
  );
}

export async function PATCH(request: Request) {
  return withTenant(
    async ({ activeOrganization, client }) => {
      assertSameOriginRequest(request);
      if (activeOrganization.role !== "owner") {
        return forbidden("Only an organization owner may change factory settings.");
      }

      const parsed = updateSchema.safeParse(await readBoundedJson(request, 8 * 1024));
      if (!parsed.success) {
        return invalidRequest(
          "invalid_settings",
          "The settings update is invalid.",
          z.flattenError(parsed.error).fieldErrors,
        );
      }
      if (Object.keys(parsed.data).length === 0) {
        return invalidRequest("empty_settings_update", "No settings were supplied.");
      }

      const providers = describeProviders();
      if (parsed.data.defaultProvider) {
        const provider = providers.implemented.find(
          (candidate) => candidate.key === parsed.data.defaultProvider,
        );
        if (!provider) {
          return invalidRequest("unsupported_provider", "That provider has no adapter in this build.");
        }
        if (parsed.data.defaultModel && !provider.models.includes(parsed.data.defaultModel)) {
          return invalidRequest("unsupported_model", "That model is not available for the chosen provider.");
        }
      }

      const { data, error } = await client
        .rpc("update_organization_settings", {
          p_organization_id: activeOrganization.id,
          p_factory_name: parsed.data.factoryName ?? null,
          p_timezone: parsed.data.timezone ?? null,
          p_execution_enabled: parsed.data.executionEnabled ?? null,
          p_daily_report_enabled: parsed.data.dailyReportEnabled ?? null,
          p_daily_report_hour: parsed.data.dailyReportHour ?? null,
          p_max_repair_attempts: parsed.data.maxRepairAttempts ?? null,
          p_max_ci_repair_attempts: parsed.data.maxCiRepairAttempts ?? null,
          p_max_concurrent_runs: parsed.data.maxConcurrentRuns ?? null,
          p_default_provider: parsed.data.defaultProvider ?? null,
          p_default_model: parsed.data.defaultModel ?? null,
          p_notify_on_owner_action: parsed.data.notifyOnOwnerAction ?? null,
          p_notify_on_run_failure: parsed.data.notifyOnRunFailure ?? null,
          p_notify_on_security_finding: parsed.data.notifyOnSecurityFinding ?? null,
          p_activity_retention_days: parsed.data.activityRetentionDays ?? null,
        })
        .single();
      if (error) return databaseErrorResponse(error);

      return jsonNoStore({ settings: present(data as SettingsRow) });
    },
    { code: "settings_update_failed", message: "Factory settings could not be updated." },
  );
}
