import "server-only";

import { findBotProvider } from "@/lib/bots/catalog";
import { isCredentialPresent } from "@/lib/bots/credentials";
import {
  evaluateBotReadiness,
  isBotReadiness,
  readinessLabel,
  readinessTone,
  type BotReadiness,
} from "@/lib/bots/readiness";
import { fromDatabaseRiskLevel } from "@/lib/bots/schemas";
import type {
  BotFabricSnapshot,
  SerializedAssignment,
  SerializedBot,
  SerializedBotRole,
  SerializedProject,
} from "@/lib/bots/types";

export type {
  BotFabricSnapshot,
  SerializedAssignment,
  SerializedBot,
  SerializedBotRole,
  SerializedProject,
};

/**
 * Tenant-scoped reads for the bot fabric.
 *
 * Every query here runs through the caller's session, so Supabase row-level
 * security is the second, independent check behind the application's active
 * organization binding. Serialized rows deliberately carry a credential
 * *reference* and a presence boolean — never a credential value.
 */

const MANAGER_ROLES = ["owner", "admin"] as const;

export function canManageBotFabric(role: string): boolean {
  return (MANAGER_ROLES as readonly string[]).includes(role);
}

type SupabaseLikeClient = {
  from: (table: string) => {
    select: (columns: string) => {
      eq: (column: string, value: string) => {
        order: (
          column: string,
          options: { ascending: boolean },
        ) => {
          limit: (count: number) => PromiseLike<{ data: unknown; error: DatabaseError | null }>;
        };
      };
    };
  };
};

type DatabaseError = { code?: string; message?: string };

type BotRow = {
  id: string;
  name: string;
  provider: string;
  model: string;
  credential_ref: string | null;
  base_url: string | null;
  readiness: string;
  readiness_detail: string | null;
  last_checked_at: string | null;
  notes: string | null;
  created_at: string;
};

type RoleRow = {
  id: string;
  name: string;
  slug: string;
  summary: string;
  instructions: string;
  risk_ceiling: string;
  capabilities: unknown;
  created_at: string;
  updated_at: string;
};

type AssignmentRow = {
  id: string;
  bot_id: string;
  project_id: string;
  role_id: string;
  status: string;
  assigned_at: string;
  released_at: string | null;
};

type ProjectRow = {
  id: string;
  name: string;
  status: string;
  github_repository: string | null;
  health_status: string;
};

export class BotFabricQueryError extends Error {
  readonly databaseError: DatabaseError;

  constructor(databaseError: DatabaseError) {
    super(databaseError.message ?? "The bot fabric could not be loaded.");
    this.name = "BotFabricQueryError";
    this.databaseError = databaseError;
  }
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string").slice(0, 12);
}

function toAssignmentStatus(value: string): SerializedAssignment["status"] {
  return value === "active" || value === "paused" ? value : "released";
}

export function serializeBot(row: BotRow): SerializedBot {
  const provider = findBotProvider(row.provider);
  const credentialPresent = isCredentialPresent(row.credential_ref);
  const current = evaluateBotReadiness({
    provider: row.provider,
    model: row.model,
    credentialRef: row.credential_ref,
    baseUrl: row.base_url,
    credentialPresent,
  });
  const persisted: BotReadiness = isBotReadiness(row.readiness) ? row.readiness : "not_connected";

  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    providerLabel: provider?.label ?? row.provider,
    providerVendor: provider?.vendor ?? "Unknown vendor",
    model: row.model,
    credentialRef: row.credential_ref,
    credentialPresent,
    baseUrl: row.base_url,
    notes: row.notes,
    readiness: persisted,
    readinessLabel: readinessLabel(persisted),
    readinessTone: readinessTone(persisted),
    readinessDetail: row.readiness_detail,
    lastCheckedAt: row.last_checked_at,
    currentReadiness: current.readiness,
    currentReadinessDetail: current.detail,
    createdAt: row.created_at,
  };
}

export function serializeBotRole(row: RoleRow): SerializedBotRole {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    summary: row.summary,
    instructions: row.instructions,
    riskCeiling: fromDatabaseRiskLevel(row.risk_ceiling),
    capabilities: toStringArray(row.capabilities),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function serializeAssignment(row: AssignmentRow): SerializedAssignment {
  return {
    id: row.id,
    botId: row.bot_id,
    projectId: row.project_id,
    roleId: row.role_id,
    status: toAssignmentStatus(row.status),
    assignedAt: row.assigned_at,
    releasedAt: row.released_at,
  };
}

export function serializeProject(row: ProjectRow): SerializedProject {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    githubRepository: row.github_repository,
    healthStatus: row.health_status,
  };
}

async function readTable<Row>(
  client: SupabaseLikeClient,
  table: string,
  columns: string,
  organizationId: string,
  orderColumn: string,
  limit: number,
): Promise<Row[]> {
  const { data, error } = await client
    .from(table)
    .select(columns)
    .eq("organization_id", organizationId)
    .order(orderColumn, { ascending: true })
    .limit(limit);

  if (error) throw new BotFabricQueryError(error);
  return (data ?? []) as Row[];
}

export async function loadBotFabric(
  client: unknown,
  organizationId: string,
): Promise<BotFabricSnapshot> {
  const supabase = client as SupabaseLikeClient;

  const [bots, roles, assignments, projects] = await Promise.all([
    readTable<BotRow>(
      supabase,
      "bots",
      "id,name,provider,model,credential_ref,base_url,readiness,readiness_detail,last_checked_at,notes,created_at",
      organizationId,
      "name",
      200,
    ),
    readTable<RoleRow>(
      supabase,
      "bot_roles",
      "id,name,slug,summary,instructions,risk_ceiling,capabilities,created_at,updated_at",
      organizationId,
      "name",
      200,
    ),
    readTable<AssignmentRow>(
      supabase,
      "bot_assignments",
      "id,bot_id,project_id,role_id,status,assigned_at,released_at",
      organizationId,
      "assigned_at",
      500,
    ),
    readTable<ProjectRow>(
      supabase,
      "projects",
      "id,name,status,github_repository,health_status",
      organizationId,
      "name",
      200,
    ),
  ]);

  return {
    bots: bots.map(serializeBot),
    roles: roles.map(serializeBotRole),
    assignments: assignments
      .map(serializeAssignment)
      .filter((assignment) => assignment.status !== "released"),
    projects: projects
      .filter((project) => project.status !== "archived")
      .map(serializeProject),
  };
}
