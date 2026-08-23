import { z } from "zod";

import {
  botFabricErrorResponse,
  botMutationErrorResponse,
  requireBotFabricManager,
} from "@/lib/bots/route";
import { isMissingDatabaseFunction } from "@/lib/bots/schema-compat";
import { loadBotFabric, serializeAssignment } from "@/lib/bots/service";
import { jsonNoStore, readBoundedJson } from "@/lib/server/http";
import { assertSameOriginRequest } from "@/lib/supabase/request";

export const runtime = "nodejs";

const assignmentIdSchema = z.string().uuid();

const executionSchema = z
  .object({
    expectedProjectId: z.string().uuid().optional(),
    expectedRevision: z.number().int().positive().optional(),
    // "" clears the override back to the bot's default model.
    model: z.string().trim().max(128).optional(),
    workEffort: z.enum(["low", "medium", "high", "max"]).optional(),
  })
  .strict()
  .refine(
    (value) => value.model !== undefined || value.workEffort !== undefined,
    { message: "Set a model and/or a workEffort." },
  );

const statusSchema = z
  .object({
    status: z.enum(["active", "paused", "released"]),
    expectedProjectId: z.string().uuid().optional(),
    expectedRevision: z.number().int().positive().optional(),
  })
  .strict();

type AssignmentSnapshot = Awaited<ReturnType<typeof loadBotFabric>>["assignments"][number];

function postingMatches(current: AssignmentSnapshot, expected: AssignmentSnapshot) {
  return current.botId === expected.botId
    && current.projectId === expected.projectId
    && current.revision === expected.revision
    && current.roleId === expected.roleId
    && current.status === expected.status
    && current.assignedAt === expected.assignedAt
    && current.releasedAt === expected.releasedAt
    && current.model === expected.model
    && current.workEffort === expected.workEffort
    && JSON.stringify(current.config) === JSON.stringify(expected.config);
}

async function verifyLegacyPosting(
  client: Awaited<ReturnType<typeof requireBotFabricManager>>["client"],
  organizationId: string,
  assignmentId: string,
  expected: AssignmentSnapshot,
) {
  const fabric = await loadBotFabric(client, organizationId);
  const current = fabric.assignments.find((assignment) => assignment.id === assignmentId);
  if (!current) {
    return {
      posting: null,
      response: jsonNoStore(
        { error: { code: "assignment_not_found", message: "That posting is not available." } },
        { status: 404 },
      ),
    };
  }
  if (!postingMatches(current, expected)) {
    return {
      posting: null,
      response: jsonNoStore(
        {
          error: {
            code: "bot_assignment_changed",
            message: "The posting changed. Reload it before making another change.",
          },
        },
        { status: 409 },
      ),
    };
  }
  return { posting: current, response: null };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ assignmentId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { assignmentId } = await params;
    if (!assignmentIdSchema.safeParse(assignmentId).success) {
      return jsonNoStore(
        { error: { code: "invalid_assignment_id", message: "The assignment reference is invalid." } },
        { status: 400 },
      );
    }

    const body = await readBoundedJson(request, 4 * 1024);

    // Two edits share this verb: the lifecycle status, and the posting's
    // execution preferences (model override + work effort). Each validates
    // its own shape; the database enforces both again.
    const execution = executionSchema.safeParse(body);
    if (execution.success) {
      const { activeOrganization, client } = await requireBotFabricManager();
      const initialFabric = await loadBotFabric(client, activeOrganization.id);
      const initial = initialFabric.assignments.find(
        (assignment) => assignment.id === assignmentId,
      );
      if (!initial) {
        return jsonNoStore(
          { error: { code: "assignment_not_found", message: "That posting is not available." } },
          { status: 404 },
        );
      }
      const expectedProjectId = execution.data.expectedProjectId ?? initial.projectId;
      const expectedRevision = execution.data.expectedRevision ?? initial.revision;
      if (expectedProjectId !== initial.projectId || expectedRevision !== initial.revision) {
        return jsonNoStore(
          {
            error: {
              code: "bot_assignment_changed",
              message: "The posting changed. Reload it before making another change.",
            },
          },
          { status: 409 },
        );
      }
      let usedLegacy = false;
      let legacyBefore: AssignmentSnapshot | null = null;
      let result = await client.rpc("set_bot_assignment_execution_checked", {
          p_organization_id: activeOrganization.id,
          p_assignment_id: assignmentId,
          p_expected_project_id: expectedProjectId,
          p_expected_revision: expectedRevision,
          // Omitted leaves the stored value; an empty string clears the
          // override back to the bot's own default model.
          p_model: execution.data.model === undefined ? null : execution.data.model,
          p_work_effort: execution.data.workEffort ?? null,
        }).single();
      if (isMissingDatabaseFunction(
        result.error,
        "set_bot_assignment_execution_checked",
      )) {
        const verified = await verifyLegacyPosting(
          client,
          activeOrganization.id,
          assignmentId,
          initial,
        );
        if (verified.response) return verified.response;
        legacyBefore = verified.posting;
        usedLegacy = true;
        result = await client
          .rpc("set_bot_assignment_execution", {
            p_organization_id: activeOrganization.id,
            p_assignment_id: assignmentId,
            p_model: execution.data.model === undefined ? null : execution.data.model,
            p_work_effort: execution.data.workEffort ?? null,
          })
          .single();
      }
      const { data, error } = result;
      if (error) return botMutationErrorResponse(error);
      if (usedLegacy) {
        const readback = (await loadBotFabric(client, activeOrganization.id))
          .assignments.find((assignment) => assignment.id === assignmentId) ?? null;
        if (!readback || !legacyBefore) {
          return jsonNoStore(
            {
              error: {
                code: "bot_assignment_readback_failed",
                message: "The posting was updated, but its exact revision could not be read back. Reload before changing it again.",
              },
            },
            { status: 503 },
          );
        }
        const expectedModel = execution.data.model === undefined
          ? legacyBefore.model
          : execution.data.model || null;
        const expectedWorkEffort = execution.data.workEffort ?? legacyBefore.workEffort;
        if (readback.botId !== legacyBefore.botId
          || readback.projectId !== legacyBefore.projectId
          || readback.roleId !== legacyBefore.roleId
          || readback.status !== legacyBefore.status
          || readback.assignedAt !== legacyBefore.assignedAt
          || readback.releasedAt !== legacyBefore.releasedAt
          || JSON.stringify(readback.config) !== JSON.stringify(legacyBefore.config)) {
          return jsonNoStore(
            {
              error: {
                code: "bot_assignment_changed",
                message: "The posting changed while its execution preferences were saved. Reload it.",
              },
            },
            { status: 409 },
          );
        }
        if (readback.model !== expectedModel || readback.workEffort !== expectedWorkEffort) {
          return jsonNoStore(
            {
              error: {
                code: "bot_assignment_write_mismatch",
                message: "The execution preference write could not be verified. Reload the posting.",
              },
            },
            { status: 503 },
          );
        }
        return jsonNoStore({
          assignment: {
            id: readback.id,
            revision: readback.revision,
            model: readback.model,
            workEffort: readback.workEffort,
          },
        });
      }
      const assignment = serializeAssignment(data as Parameters<typeof serializeAssignment>[0]);
      return jsonNoStore({
        assignment: {
          id: assignment.id,
          revision: assignment.revision,
          model: assignment.model,
          workEffort: assignment.workEffort,
        },
      });
    }

    const parsed = statusSchema.safeParse(body);
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_assignment_update",
            message: "Send a status (active, paused, released), or a model and/or workEffort (low, medium, high, max).",
          },
        },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireBotFabricManager();
    const initialFabric = await loadBotFabric(client, activeOrganization.id);
    const initial = initialFabric.assignments.find(
      (assignment) => assignment.id === assignmentId,
    );
    if (!initial) {
      return jsonNoStore(
        { error: { code: "assignment_not_found", message: "That posting is not available." } },
        { status: 404 },
      );
    }
    const expectedProjectId = parsed.data.expectedProjectId ?? initial.projectId;
    const expectedRevision = parsed.data.expectedRevision ?? initial.revision;
    if (expectedProjectId !== initial.projectId || expectedRevision !== initial.revision) {
      return jsonNoStore(
        {
          error: {
            code: "bot_assignment_changed",
            message: "The posting changed. Reload it before making another change.",
          },
        },
        { status: 409 },
      );
    }
    let result = await client.rpc("update_bot_assignment_checked", {
        p_organization_id: activeOrganization.id,
        p_assignment_id: assignmentId,
        p_expected_project_id: expectedProjectId,
        p_expected_revision: expectedRevision,
        p_status: parsed.data.status,
      }).single();
    if (isMissingDatabaseFunction(result.error, "update_bot_assignment_checked")) {
      const verified = await verifyLegacyPosting(
        client,
        activeOrganization.id,
        assignmentId,
        initial,
      );
      if (verified.response) return verified.response;
      result = await client
        .rpc("update_bot_assignment", {
          p_organization_id: activeOrganization.id,
          p_assignment_id: assignmentId,
          p_status: parsed.data.status,
        })
        .single();
    }
    const { data, error } = result;

    if (error) return botMutationErrorResponse(error);

    return jsonNoStore({
      assignment: serializeAssignment(data as Parameters<typeof serializeAssignment>[0]),
    });
  } catch (error) {
    return botFabricErrorResponse(
      error,
      "bot_assignment_update_failed",
      "The assignment could not be updated.",
    );
  }
}
