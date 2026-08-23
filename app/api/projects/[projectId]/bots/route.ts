import { z } from "zod";

import {
  assignmentConfigSchema,
  IncoherentAssignmentError,
  MAX_BOTS_PER_ASSIGNMENT,
  normalizeAssignmentConfig,
  toDatabaseConfiguration,
} from "@/lib/bots/assignment-config";
import { canManageBotFabric, loadBotFabric, serializeAssignment } from "@/lib/bots/service";
import { isMissingDatabaseFunction } from "@/lib/bots/schema-compat";
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
import { EXECUTION_PROVIDER, executionModel } from "@/lib/orchestration/plan";

/**
 * The bots serving one project.
 *
 * `GET` answers the question the assign wizard opens with — who is already
 * here, who could be, and what state each of them is in. `POST` assigns a
 * whole selection in one transaction.
 *
 * The batch is the interesting part. Assigning four bots as four requests can
 * half-succeed, and the person who asked has no way to tell which half landed;
 * `assign_bots_to_project` is one transaction, so the selection either lands
 * whole or changes nothing.
 *
 * Connectedness is checked here rather than in SQL because this is the layer
 * that can see it: readiness depends on whether a credential resolves on this
 * server, including credentials in the vault that the database itself stores
 * only as sealed material. The client sends bot ids and nothing else, so it
 * cannot talk its way past this.
 */

export const runtime = "nodejs";

const MANAGER_ROLES = ["owner", "admin"] as const;

const assignBotsSchema = z
  .object({
    bots: z
      .array(
        z
          .object({
            botId: z.string().uuid(),
            roleId: z.string().uuid(),
            config: assignmentConfigSchema.optional(),
            /** Optimistic identity for an existing open posting. */
            expectedAssignmentId: z.string().uuid().nullable().optional(),
            expectedProjectId: z.string().uuid().nullable().optional(),
            expectedAssignmentRevision: z.number().int().positive().nullable().optional(),
          })
          .strict(),
      )
      .min(1)
      .max(MAX_BOTS_PER_ASSIGNMENT),
  })
  .strict();

function invalidProjectIdResponse() {
  return jsonNoStore(
    { error: { code: "invalid_project_id", message: "Project id must be a UUID." } },
    { status: 400 },
  );
}

function managerForbiddenResponse() {
  return jsonNoStore(
    {
      error: {
        code: "bot_assignment_forbidden",
        message: "Organization owner or administrator access is required to assign bots.",
      },
    },
    { status: 403 },
  );
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    const { projectId } = await params;
    if (!z.string().uuid().safeParse(projectId).success) return invalidProjectIdResponse();

    const { activeOrganization, client } = await requireActiveOrganization();
    const fabric = await loadBotFabric(client, activeOrganization.id);

    const project = fabric.projects.find((entry) => entry.id === projectId) ?? null;
    if (!project) {
      return jsonNoStore(
        {
          error: {
            code: "project_not_found",
            message: "That project is not available in this organization.",
          },
        },
        { status: 404 },
      );
    }

    const openPostings = fabric.assignments.filter(
      (assignment) => assignment.status !== "released",
    );
    const postingByBot = new Map(openPostings.map((posting) => [posting.botId, posting]));
    const projectNameById = new Map(fabric.projects.map((entry) => [entry.id, entry.name]));

    const assigned = openPostings
      .filter((assignment) => assignment.projectId === projectId)
      .map((assignment) => ({
        ...assignment,
        bot: fabric.bots.find((bot) => bot.id === assignment.botId) ?? null,
        role: fabric.roles.find((role) => role.id === assignment.roleId) ?? null,
      }))
      // A posting whose bot was deleted is a record, not a roster entry.
      .filter((entry) => entry.bot !== null);

    /*
     * Every bot, each carrying why it can or cannot be assigned right now.
     * Filtering the unavailable ones out here would leave someone staring at a
     * roster with a bot missing and no explanation — the picker needs to show
     * them and say what to fix.
     */
    const available = fabric.bots.map((bot) => {
      const posting = postingByBot.get(bot.id) ?? null;
      const elsewhere = posting && posting.projectId !== projectId ? posting : null;
      const alreadyOnThisProject = posting?.projectId === projectId;
      const pausedPosting = posting?.status === "paused";
      const assignable = bot.currentReadiness === "ready"
        && !alreadyOnThisProject
        && !pausedPosting;

      return {
        ...bot,
        assignable,
        /** Null when assignable; otherwise the reason, in the person's words. */
        blockedReason: assignable
          ? null
          : pausedPosting
            ? "This posting is paused. Resume it before moving the bot."
            : alreadyOnThisProject
            ? "Already on this project. Use Configure, Pause, or Resume on the existing posting."
            : bot.currentReadinessDetail,
        alreadyOnThisProject,
        /**
         * A bot holds one open posting, so assigning it here moves it. Naming
         * the project it would leave is the difference between an informed
         * choice and a surprise.
         */
        currentProjectId: elsewhere?.projectId ?? null,
        currentProjectName: elsewhere ? projectNameById.get(elsewhere.projectId) ?? null : null,
        /**
         * Exact open-posting state. The assignment wizard excludes bots already
         * on this project; these fields still make cross-project moves compare
         * the exact posting identity rather than a stale browser snapshot.
         */
        currentAssignmentId: posting?.id ?? null,
        currentAssignmentProjectId: posting?.projectId ?? null,
        currentAssignmentRevision: posting?.revision ?? null,
        currentRoleId: posting?.roleId ?? null,
        currentRole: posting
          ? fabric.roles.find((role) => role.id === posting.roleId) ?? null
          : null,
        currentAssignmentConfig: posting?.config ?? null,
        /** How much this bot is already carrying, from its own configuration. */
        workload: posting ? posting.config.maxConcurrentTasks : 0,
      };
    });

    return jsonNoStore({
      project,
      canManage: canManageBotFabric(activeOrganization.role),
      assigned,
      available,
      roles: fabric.roles,
      projects: fabric.projects,
      /*
       * The provider and model a command actually executes on, resolved
       * server-side so an operator's model pin is included.
       *
       * The roster's model picker offers every model the catalog lists for a
       * provider, and exactly one of them can run — routing refuses the rest
       * at submission, at the last step of the journey. Sending this lets the
       * picker say which is which rather than presenting choices that quietly
       * end it.
       */
      execution: { provider: EXECUTION_PROVIDER, model: executionModel() },
    });
  } catch (error) {
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      {
        error: {
          code: "project_bots_unavailable",
          message: "The bots for this project could not be read.",
        },
      },
      { status: 500 },
    );
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ projectId: string }> },
) {
  try {
    assertSameOriginRequest(request);
    const { projectId } = await params;
    if (!z.string().uuid().safeParse(projectId).success) return invalidProjectIdResponse();

    const parsed = assignBotsSchema.safeParse(await readBoundedJson(request, 128 * 1024));
    if (!parsed.success) {
      return jsonNoStore(
        {
          error: {
            code: "invalid_bot_assignment",
            message: `Select between 1 and ${MAX_BOTS_PER_ASSIGNMENT} bots, each with a role.`,
          },
        },
        { status: 400 },
      );
    }

    const { activeOrganization, client } = await requireActiveOrganization();
    if (!(MANAGER_ROLES as readonly string[]).includes(activeOrganization.role)) {
      return managerForbiddenResponse();
    }

    // The same bot twice would apply two configurations to one posting and let
    // the last silently win. Refused here as well as in SQL so the message is
    // one a person can act on.
    const selected = parsed.data.bots.map((entry) => entry.botId);
    if (new Set(selected).size !== selected.length) {
      return jsonNoStore(
        {
          error: {
            code: "duplicate_bot_selected",
            message: "Each bot may appear once in a selection.",
          },
        },
        { status: 400 },
      );
    }

    /*
     * Readiness is resolved from the server's own view of the credentials,
     * never from anything the browser sent. A bot whose key has gone missing
     * since the wizard opened is refused here, which is the point: the badge
     * the person saw may be a minute old.
     */
    const fabric = await loadBotFabric(client, activeOrganization.id);
    const botById = new Map(fabric.bots.map((bot) => [bot.id, bot]));
    const openPostingByBot = new Map(
      fabric.assignments
        .filter((assignment) => assignment.status !== "released")
        .map((assignment) => [assignment.botId, assignment]),
    );
    const selectionWithExpectedIdentity = parsed.data.bots.map((entry) => {
      const current = openPostingByBot.get(entry.botId);
      return {
        ...entry,
        // Preserve every explicit component. A cached client may omit only a
        // newer peer field; filling that `undefined` peer must never launder an
        // explicitly stale id/project/revision into the current value.
        expectedAssignmentId: entry.expectedAssignmentId !== undefined
          ? entry.expectedAssignmentId
          : current?.id ?? null,
        expectedProjectId: entry.expectedProjectId !== undefined
          ? entry.expectedProjectId
          : current?.projectId ?? null,
        expectedAssignmentRevision: entry.expectedAssignmentRevision !== undefined
          ? entry.expectedAssignmentRevision
          : current?.revision ?? null,
      };
    });
    const stalePosting = selectionWithExpectedIdentity.find((entry) => {
      const current = openPostingByBot.get(entry.botId);
      if (!current) {
        return entry.expectedAssignmentId != null
          || entry.expectedProjectId != null
          || entry.expectedAssignmentRevision != null;
      }
      return entry.expectedAssignmentId !== current.id
        || entry.expectedProjectId !== current.projectId
        || entry.expectedAssignmentRevision !== current.revision;
    });
    if (stalePosting) {
      return jsonNoStore(
        {
          error: {
            code: "bot_assignment_changed",
            message: "A selected bot's current assignment changed. Reload the roster before moving or reconfiguring it.",
          },
        },
        { status: 409 },
      );
    }
    const pausedPosting = selectionWithExpectedIdentity.find(
      (entry) => openPostingByBot.get(entry.botId)?.status === "paused",
    );
    if (pausedPosting) {
      return jsonNoStore(
        {
          error: {
            code: "bot_assignment_paused",
            message: "A selected bot's posting is paused. Resume it before moving the bot.",
          },
        },
        { status: 409 },
      );
    }
    const alreadyOnThisProject = selectionWithExpectedIdentity.find(
      (entry) => openPostingByBot.get(entry.botId)?.projectId === projectId,
    );
    if (alreadyOnThisProject) {
      return jsonNoStore(
        {
          error: {
            code: "bot_already_assigned_to_project",
            message: "A selected bot is already on this project. Use Configure or Resume on its existing posting.",
          },
        },
        { status: 409 },
      );
    }
    const notReady = parsed.data.bots
      .map((entry) => botById.get(entry.botId))
      .filter((bot) => bot === undefined || bot.currentReadiness !== "ready");

    if (notReady.length > 0) {
      return jsonNoStore(
        {
          error: {
            code: "bot_not_connected",
            message:
              notReady.length === 1 && notReady[0]
                ? `${notReady[0].name} is not connected: ${notReady[0].currentReadinessDetail}`
                : "One or more selected bots are not connected. Reconnect them and try again.",
          },
        },
        { status: 409 },
      );
    }

    let normalizedSelection: Array<{
      botId: string;
      roleId: string;
      config: ReturnType<typeof normalizeAssignmentConfig>;
      expectedAssignmentId: string | null;
      expectedProjectId: string | null;
      expectedAssignmentRevision: number | null;
    }>;
    let payload: Array<Record<string, unknown>>;
    try {
      normalizedSelection = selectionWithExpectedIdentity.map((entry) => ({
        botId: entry.botId,
        roleId: entry.roleId,
        expectedAssignmentId: entry.expectedAssignmentId ?? null,
        expectedProjectId: entry.expectedProjectId ?? null,
        expectedAssignmentRevision: entry.expectedAssignmentRevision ?? null,
        /*
         * Treat the optional configuration as a patch for a bot that already
         * has an open posting. Older clients and partial requests must not
         * erase fields they never edited; a genuinely new bot still merges
         * over an empty object and therefore receives least privilege.
         */
        config: normalizeAssignmentConfig({
          ...(openPostingByBot.has(entry.botId)
            ? {
              ...openPostingByBot.get(entry.botId)?.config,
              responsibilities: [
                ...(openPostingByBot.get(entry.botId)?.config.responsibilities ?? []),
              ],
              tools: [...(openPostingByBot.get(entry.botId)?.config.tools ?? [])],
            }
            : {}),
          ...(entry.config ?? {}),
        }),
      }));
      payload = normalizedSelection.map((entry) => ({
        bot_id: entry.botId,
        role_id: entry.roleId,
        expected_assignment_id: entry.expectedAssignmentId,
        expected_project_id: entry.expectedProjectId,
        expected_revision: entry.expectedAssignmentRevision,
        ...toDatabaseConfiguration(entry.config),
      }));
    } catch (error) {
      if (error instanceof IncoherentAssignmentError) {
        return jsonNoStore(
          { error: { code: "incoherent_bot_permissions", message: error.message } },
          { status: 400 },
        );
      }
      throw error;
    }

    let result = await client.rpc("assign_bots_to_project_checked", {
      p_organization_id: activeOrganization.id,
      p_project_id: projectId,
      p_assignments: payload,
    });
    if (isMissingDatabaseFunction(result.error, "assign_bots_to_project_checked")) {
      // Re-read after discovering the missing wrapper so a move during the RPC
      // round trip is still caught before the bounded legacy write. The old
      // schema has no atomic revision CAS, but it need not widen that window.
      const fallbackFabric = await loadBotFabric(client, activeOrganization.id);
      const fallbackBotById = new Map(fallbackFabric.bots.map((bot) => [bot.id, bot]));
      const fallbackNotReady = selected
        .map((botId) => fallbackBotById.get(botId))
        .filter((bot) => bot === undefined || bot.currentReadiness !== "ready");
      if (fallbackNotReady.length > 0) {
        return jsonNoStore(
          {
            error: {
              code: "bot_not_connected",
              message:
                fallbackNotReady.length === 1 && fallbackNotReady[0]
                  ? `${fallbackNotReady[0].name} is not connected: ${fallbackNotReady[0].currentReadinessDetail}`
                  : "One or more selected bots are not connected. Reconnect them and try again.",
            },
          },
          { status: 409 },
        );
      }
      const fallbackPostingByBot = new Map(
        fallbackFabric.assignments.map((assignment) => [assignment.botId, assignment]),
      );
      if (normalizedSelection.some(
        (entry) => fallbackPostingByBot.get(entry.botId)?.status === "paused",
      )) {
        return jsonNoStore(
          {
            error: {
              code: "bot_assignment_paused",
              message: "A selected bot's posting is paused. Resume it before moving the bot.",
            },
          },
          { status: 409 },
        );
      }
      const changedBeforeLegacy = normalizedSelection.some((entry) => {
        const current = fallbackPostingByBot.get(entry.botId);
        const initiallyRead = openPostingByBot.get(entry.botId);
        return current
          ? entry.expectedAssignmentId !== current.id
            || entry.expectedProjectId !== current.projectId
            || entry.expectedAssignmentRevision !== current.revision
            || current.roleId !== initiallyRead?.roleId
            || current.status !== initiallyRead?.status
            || current.assignedAt !== initiallyRead?.assignedAt
            || current.model !== initiallyRead?.model
            || current.workEffort !== initiallyRead?.workEffort
            || JSON.stringify(current.config) !== JSON.stringify(initiallyRead?.config)
          : entry.expectedAssignmentId !== null
            || entry.expectedProjectId !== null
            || entry.expectedAssignmentRevision !== null;
      });
      if (changedBeforeLegacy) {
        return jsonNoStore(
          {
            error: {
              code: "bot_assignment_changed",
              message: "A selected bot's current assignment changed. Reload before assigning it.",
            },
          },
          { status: 409 },
        );
      }

      // Until the row-revision wrapper exists, retain the legacy atomic batch
      // and strip fields its configuration normalizer does not own.
      result = await client.rpc("assign_bots_to_project", {
        p_organization_id: activeOrganization.id,
        p_project_id: projectId,
        p_assignments: payload.map((entry) => {
          const legacyEntry = { ...entry };
          delete legacyEntry.expected_assignment_id;
          delete legacyEntry.expected_project_id;
          delete legacyEntry.expected_revision;
          return legacyEntry;
        }),
      });
    }
    const { data, error } = result;

    if (error) return databaseErrorResponse(error);

    const assignments = Array.isArray(data)
      ? data.map((row) => serializeAssignment(
        row as Parameters<typeof serializeAssignment>[0],
      ))
      : [];
    const assignmentByBot = new Map(assignments.map((assignment) => [assignment.botId, assignment]));
    const exactWrite = assignments.length === normalizedSelection.length
      && normalizedSelection.every((expected) => {
        const actual = assignmentByBot.get(expected.botId);
        return actual?.projectId === projectId
          && actual.roleId === expected.roleId
          && actual.status === "active"
          && JSON.stringify(actual.config) === JSON.stringify(expected.config);
      });

    if (!exactWrite) {
      return jsonNoStore(
        {
          error: {
            code: "bot_assignment_write_mismatch",
            message: "The assignment write returned unexpected data. Reload the roster before trying again.",
          },
        },
        { status: 500 },
      );
    }

    return jsonNoStore({ assigned: assignments.length, assignments }, { status: 201 });
  } catch (error) {
    if (error instanceof ApiRequestError) return requestErrorResponse(error);
    const boundaryResponse = supabaseBoundaryErrorResponse(error);
    if (boundaryResponse) return boundaryResponse;
    return jsonNoStore(
      {
        error: {
          code: "bot_assignment_failed",
          message: "The bots could not be assigned to this project.",
        },
      },
      { status: 500 },
    );
  }
}
