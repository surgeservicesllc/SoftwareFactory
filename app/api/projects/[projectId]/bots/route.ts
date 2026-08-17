import { z } from "zod";

import {
  assignmentConfigSchema,
  IncoherentAssignmentError,
  MAX_BOTS_PER_ASSIGNMENT,
  normalizeAssignmentConfig,
  toDatabaseConfiguration,
} from "@/lib/bots/assignment-config";
import { canManageBotFabric, loadBotFabric } from "@/lib/bots/service";
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
      const assignable = bot.currentReadiness === "ready";

      return {
        ...bot,
        assignable,
        /** Null when assignable; otherwise the reason, in the person's words. */
        blockedReason: assignable ? null : bot.currentReadinessDetail,
        alreadyOnThisProject: posting?.projectId === projectId,
        /**
         * A bot holds one open posting, so assigning it here moves it. Naming
         * the project it would leave is the difference between an informed
         * choice and a surprise.
         */
        currentProjectId: elsewhere?.projectId ?? null,
        currentProjectName: elsewhere ? projectNameById.get(elsewhere.projectId) ?? null : null,
        currentRoleId: posting?.roleId ?? null,
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

    let payload: Array<Record<string, unknown>>;
    try {
      payload = parsed.data.bots.map((entry) => ({
        bot_id: entry.botId,
        role_id: entry.roleId,
        ...toDatabaseConfiguration(normalizeAssignmentConfig(entry.config ?? {})),
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

    const { data, error } = await client.rpc("assign_bots_to_project", {
      p_organization_id: activeOrganization.id,
      p_project_id: projectId,
      p_assignments: payload,
    });

    if (error) return databaseErrorResponse(error);

    return jsonNoStore({ assigned: Array.isArray(data) ? data.length : 0 }, { status: 201 });
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
