import { z } from "zod";

import {
  ApiRequestError,
  databaseErrorResponse,
  jsonNoStore,
  readBoundedJson,
  requestErrorResponse,
} from "@/lib/server/http";
import { AUTONOMY_MODES, controlsForMode, modeForControls } from "@/lib/autonomy/modes";
import { supabaseBoundaryErrorResponse } from "@/lib/supabase/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";
import { requireActiveOrganization } from "@/lib/supabase/tenant";

export const runtime = "nodejs";

/**
 * The organization's safety controls: the global kill switch, autonomous
 * mode, the risk ceiling, and the nine automatic actions. Reads are
 * member-scoped; every write is owner-only and reason-carrying in the
 * database (ADR-080), so this route reports refusals rather than deciding
 * anything itself.
 */

const RISK_LEVELS = ["green", "yellow"] as const;

const killSwitchSchema = z.object({
  control: z.literal("kill_switch"),
  active: z.boolean(),
  reason: z.string().trim().max(400).optional(),
}).strict();

const autonomySchema = z.object({
  control: z.literal("autonomy"),
  autonomousMode: z.boolean().optional(),
  // RED is not an option: the database refuses it, and so does the schema.
  maximumAutonomousRisk: z.enum(RISK_LEVELS).optional(),
  autoPlan: z.boolean().optional(),
  autoCode: z.boolean().optional(),
  autoTest: z.boolean().optional(),
  autoRepair: z.boolean().optional(),
  autoReview: z.boolean().optional(),
  autoApprove: z.boolean().optional(),
  autoMerge: z.boolean().optional(),
  autoDeploy: z.boolean().optional(),
  autoRollback: z.boolean().optional(),
  reason: z.string().trim().max(400).optional(),
}).strict();

/*
 * One named choice instead of eleven fields. The preset is expanded here
 * rather than in the browser so a client cannot compose a combination no mode
 * produces and have it stored under a mode's name; the expansion then goes
 * through the same owner-only, reason-carrying RPC as any other change.
 */
const modeSchema = z.object({
  control: z.literal("mode"),
  mode: z.enum(AUTONOMY_MODES),
  reason: z.string().trim().max(400).optional(),
}).strict();

const controlsSchema = z.discriminatedUnion("control", [
  killSwitchSchema,
  autonomySchema,
  modeSchema,
]);

type ControlsRow = {
  organization_id: string;
  kill_switch_active?: boolean;
  autonomous_mode: boolean;
  maximum_autonomous_risk: string;
  auto_plan: boolean; auto_code: boolean; auto_test: boolean; auto_repair: boolean;
  auto_review: boolean; auto_approve: boolean; auto_merge: boolean;
  auto_deploy: boolean; auto_rollback: boolean;
};

function shapeControls(row: ControlsRow) {
  const actions = {
    plan: row.auto_plan,
    code: row.auto_code,
    test: row.auto_test,
    repair: row.auto_repair,
    review: row.auto_review,
    approve: row.auto_approve,
    merge: row.auto_merge,
    deploy: row.auto_deploy,
    rollback: row.auto_rollback,
  };
  return {
    autonomousMode: row.autonomous_mode,
    maximumAutonomousRisk: row.maximum_autonomous_risk.toUpperCase(),
    /*
     * Null where the stored combination matches no preset. The interface shows
     * that as Custom — telling an operator who hand-enabled `deploy` that they
     * are in "Autonomous" would claim a safety story they stepped outside of.
     */
    mode: modeForControls({
      autonomousMode: row.autonomous_mode,
      maximumAutonomousRisk: (row.maximum_autonomous_risk.toUpperCase() === "YELLOW"
        ? "YELLOW"
        : row.maximum_autonomous_risk.toUpperCase() === "RED"
          ? "RED"
          : "GREEN"),
      actions,
    }),
    actions,
  };
}

export async function GET() {
  try {
    const { activeOrganization, client } = await requireActiveOrganization();
    const { data, error } = await client
      .rpc("get_organization_autonomy_controls", { p_organization_id: activeOrganization.id })
      .single();
    if (error) return databaseErrorResponse(error);

    const row = data as ControlsRow & { kill_switch_active: boolean };
    return jsonNoStore({
      killSwitchActive: row.kill_switch_active,
      controls: shapeControls(row),
      canOperate: activeOrganization.role === "owner",
    });
  } catch (error) {
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: "controls_unavailable", message: "Safety controls could not be loaded." } },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const parsed = controlsSchema.safeParse(await readBoundedJson(request, 16 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        { error: { code: "invalid_controls_request", message: "The control change is not valid. The autonomous ceiling can never be RED." } },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();

    if (parsed.data.control === "kill_switch") {
      const { data, error } = await client
        .rpc("set_autonomy_kill_switch", {
          p_organization_id: activeOrganization.id,
          p_active: parsed.data.active,
          p_reason: parsed.data.reason || null,
        })
        .single();
      if (error) return databaseErrorResponse(error);
      const row = data as { organization_id: string; kill_switch_active: boolean };
      return jsonNoStore({ killSwitchActive: row.kill_switch_active });
    }

    /*
     * A mode resolves to the same eleven values an explicit change sends, so
     * both paths land in one RPC call and one audit row.
     */
    const body =
      parsed.data.control === "mode"
        ? (() => {
            const preset = controlsForMode(parsed.data.mode);
            return {
              autonomousMode: preset.autonomousMode,
              maximumAutonomousRisk: preset.maximumAutonomousRisk.toLowerCase(),
              autoPlan: preset.actions.plan,
              autoCode: preset.actions.code,
              autoTest: preset.actions.test,
              autoRepair: preset.actions.repair,
              autoReview: preset.actions.review,
              autoApprove: preset.actions.approve,
              autoMerge: preset.actions.merge,
              autoDeploy: preset.actions.deploy,
              autoRollback: preset.actions.rollback,
              reason: parsed.data.reason,
            };
          })()
        : parsed.data;

    const { data, error } = await client
      .rpc("set_organization_autonomy_controls", {
        p_organization_id: activeOrganization.id,
        p_autonomous_mode: body.autonomousMode ?? null,
        p_maximum_autonomous_risk: body.maximumAutonomousRisk ?? null,
        p_auto_plan: body.autoPlan ?? null,
        p_auto_code: body.autoCode ?? null,
        p_auto_test: body.autoTest ?? null,
        p_auto_repair: body.autoRepair ?? null,
        p_auto_review: body.autoReview ?? null,
        p_auto_approve: body.autoApprove ?? null,
        p_auto_merge: body.autoMerge ?? null,
        p_auto_deploy: body.autoDeploy ?? null,
        p_auto_rollback: body.autoRollback ?? null,
        p_reason: body.reason || null,
      })
      .single();
    if (error) return databaseErrorResponse(error);
    return jsonNoStore({ controls: shapeControls(data as ControlsRow) });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      { error: { code: "controls_update_failed", message: "The control could not be changed safely." } },
      { status: 500 },
    );
  }
}
