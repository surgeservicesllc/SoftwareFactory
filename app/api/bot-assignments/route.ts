import { z } from "zod";

import { toDatabaseConfiguration } from "@/lib/bots/assignment-config";
import {
  botFabricErrorResponse,
  botMutationErrorResponse,
  requireBotFabricManager,
} from "@/lib/bots/route";
import { assignBotSchema } from "@/lib/bots/schemas";
import { isMissingDatabaseFunction } from "@/lib/bots/schema-compat";
import { loadBotFabric, serializeAssignment } from "@/lib/bots/service";
import { jsonNoStore, readBoundedJson } from "@/lib/server/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

const checkedAssignBotSchema = assignBotSchema.extend({
  expectedAssignmentId: z.string().uuid().nullable().optional(),
  expectedProjectId: z.string().uuid().nullable().optional(),
  expectedRevision: z.number().int().positive().nullable().optional(),
}).strict();

/**
 * Post a bot to a project under a role.
 *
 * A bot holds at most one open posting, so this endpoint covers first
 * assignment, moving between projects, and changing role. The database function
 * decides which transition occurred and records the matching audit event. An
 * assignment is routing intent; nothing executes as a result of it.
 */
export async function POST(request: Request) {
  try {
    assertSameOriginRequest(request);
    const parsed = checkedAssignBotSchema.safeParse(await readBoundedJson(request, 8 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_assignment",
            message: "Choose a bot, a project, and a role.",
          },
        },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireBotFabricManager();
    const hasCompleteExpectedIdentity = parsed.data.expectedAssignmentId !== undefined
      && parsed.data.expectedProjectId !== undefined
      && parsed.data.expectedRevision !== undefined;
    const fabric = await loadBotFabric(client, activeOrganization.id);
    const bot = fabric.bots.find((entry) => entry.id === parsed.data.botId);
    if (!bot || bot.currentReadiness !== "ready") {
      return jsonNoStore(
        {
          error: {
            code: "bot_not_connected",
            message: bot
              ? `${bot.name} is not connected: ${bot.currentReadinessDetail}`
              : "That bot is not connected in this organization.",
          },
        },
        { status: 409 },
      );
    }

    let expectedAssignmentId = parsed.data.expectedAssignmentId;
    let expectedProjectId = parsed.data.expectedProjectId;
    let expectedRevision = parsed.data.expectedRevision;
    const derivedCurrent = fabric.assignments.find(
      (assignment) => assignment.botId === parsed.data.botId,
    ) ?? null;
    if (!hasCompleteExpectedIdentity) {
      expectedAssignmentId = expectedAssignmentId !== undefined
        ? expectedAssignmentId
        : derivedCurrent?.id ?? null;
      expectedProjectId = expectedProjectId !== undefined
        ? expectedProjectId
        : derivedCurrent?.projectId ?? null;
      expectedRevision = expectedRevision !== undefined
        ? expectedRevision
        : derivedCurrent?.revision ?? null;
    }
    const explicitIdentityIsStale = derivedCurrent
      ? expectedAssignmentId !== derivedCurrent.id
        || expectedProjectId !== derivedCurrent.projectId
        || expectedRevision !== derivedCurrent.revision
      : expectedAssignmentId !== null
        || expectedProjectId !== null
        || expectedRevision !== null;
    if (explicitIdentityIsStale) {
      return jsonNoStore(
        {
          error: {
            code: "bot_assignment_changed",
            message: "The bot's current posting changed. Reload before assigning it.",
          },
        },
        { status: 409 },
      );
    }
    if (derivedCurrent?.status === "paused") {
      return jsonNoStore(
        {
          error: {
            code: "bot_assignment_paused",
            message: "Resume the paused posting before moving or changing it.",
          },
        },
        { status: 409 },
      );
    }
    if (derivedCurrent?.projectId === parsed.data.projectId) {
      const configuration = toDatabaseConfiguration(derivedCurrent.config);
      let sameProjectResult = await client
        .rpc("update_bot_assignment_configuration_checked", {
          p_organization_id: activeOrganization.id,
          p_assignment_id: derivedCurrent.id,
          p_expected_project_id: derivedCurrent.projectId,
          p_expected_revision: derivedCurrent.revision,
          p_configuration: configuration,
          p_role_id: parsed.data.roleId,
          p_status: null,
        })
        .single();
      if (isMissingDatabaseFunction(
        sameProjectResult.error,
        "update_bot_assignment_configuration_checked",
      )) {
        const fallbackFabric = await loadBotFabric(client, activeOrganization.id);
        const fallbackBot = fallbackFabric.bots.find((entry) => entry.id === parsed.data.botId);
        const current = fallbackFabric.assignments.find(
          (assignment) => assignment.botId === parsed.data.botId,
        ) ?? null;
        if (current?.status === "paused") {
          return jsonNoStore(
            {
              error: {
                code: "bot_assignment_paused",
                message: "Resume the paused posting before moving or changing it.",
              },
            },
            { status: 409 },
          );
        }
        if (!fallbackBot
          || fallbackBot.currentReadiness !== "ready"
          || !current
          || current.id !== derivedCurrent.id
          || current.projectId !== derivedCurrent.projectId
          || current.revision !== derivedCurrent.revision
          || current.roleId !== derivedCurrent.roleId
          || current.status !== derivedCurrent.status
          || current.assignedAt !== derivedCurrent.assignedAt
          || current.model !== derivedCurrent.model
          || current.workEffort !== derivedCurrent.workEffort
          || JSON.stringify(current.config) !== JSON.stringify(derivedCurrent.config)) {
          return jsonNoStore(
            {
              error: {
                code: "bot_assignment_changed",
                message: "The bot's current posting changed. Reload before assigning it.",
              },
            },
            { status: 409 },
          );
        }
        sameProjectResult = await client
          .rpc("update_bot_assignment_configuration", {
            p_organization_id: activeOrganization.id,
            p_assignment_id: current.id,
            p_configuration: toDatabaseConfiguration(current.config),
            p_role_id: parsed.data.roleId,
            p_status: null,
          })
          .single();
      }
      if (sameProjectResult.error) return botMutationErrorResponse(sameProjectResult.error);
      return jsonNoStore(
        {
          assignment: serializeAssignment(
            sameProjectResult.data as Parameters<typeof serializeAssignment>[0],
          ),
          executorConnected: false,
        },
        { status: 201 },
      );
    }

    const assignmentPayload = {
      bot_id: parsed.data.botId,
      role_id: parsed.data.roleId,
      expected_assignment_id: expectedAssignmentId,
      expected_project_id: expectedProjectId,
      expected_revision: expectedRevision,
      ...(derivedCurrent ? toDatabaseConfiguration(derivedCurrent.config) : {}),
    };
    let result = await client.rpc("assign_bots_to_project_checked", {
      p_organization_id: activeOrganization.id,
      p_project_id: parsed.data.projectId,
      p_assignments: [assignmentPayload],
    }).single();
    if (isMissingDatabaseFunction(result.error, "assign_bots_to_project_checked")) {
      const fallbackFabric = await loadBotFabric(client, activeOrganization.id);
      const fallbackBot = fallbackFabric.bots.find((entry) => entry.id === parsed.data.botId);
      if (!fallbackBot || fallbackBot.currentReadiness !== "ready") {
        return jsonNoStore(
          {
            error: {
              code: "bot_not_connected",
              message: fallbackBot
                ? `${fallbackBot.name} is not connected: ${fallbackBot.currentReadinessDetail}`
                : "That bot is not connected in this organization.",
            },
          },
          { status: 409 },
        );
      }
      const current = fallbackFabric.assignments.find(
        (assignment) => assignment.botId === parsed.data.botId,
      ) ?? null;
      if (current?.status === "paused") {
        return jsonNoStore(
          {
            error: {
              code: "bot_assignment_paused",
              message: "Resume the paused posting before moving or changing it.",
            },
          },
          { status: 409 },
        );
      }
      const identityMatches = current
        ? expectedAssignmentId === current.id
          && expectedProjectId === current.projectId
          && expectedRevision === current.revision
          && current.roleId === derivedCurrent?.roleId
          && current.status === derivedCurrent?.status
          && current.assignedAt === derivedCurrent?.assignedAt
          && current.model === derivedCurrent?.model
          && current.workEffort === derivedCurrent?.workEffort
          && JSON.stringify(current.config) === JSON.stringify(derivedCurrent?.config)
        : expectedAssignmentId === null
          && expectedProjectId === null
          && expectedRevision === null;
      if (!identityMatches) {
        return jsonNoStore(
          {
            error: {
              code: "bot_assignment_changed",
              message: "The bot's current posting changed. Reload before assigning it.",
            },
          },
          { status: 409 },
        );
      }
      const legacyAssignmentPayload = {
        bot_id: parsed.data.botId,
        role_id: parsed.data.roleId,
        ...(current ? toDatabaseConfiguration(current.config) : {}),
      };
      result = await client
        .rpc("assign_bots_to_project", {
          p_organization_id: activeOrganization.id,
          p_project_id: parsed.data.projectId,
          p_assignments: [legacyAssignmentPayload],
        })
        .single();
    }
    const { data, error } = result;

    if (error) return botMutationErrorResponse(error);

    return jsonNoStore(
      {
        assignment: serializeAssignment(data as Parameters<typeof serializeAssignment>[0]),
        executorConnected: false,
      },
      { status: 201 },
    );
  } catch (error) {
    return botFabricErrorResponse(
      error,
      "bot_assignment_failed",
      "The bot could not be assigned.",
    );
  }
}
